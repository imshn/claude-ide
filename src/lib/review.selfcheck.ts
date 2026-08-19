/**
 * Self-check for the review engine — the one piece where a bug silently
 * corrupts a user's file. Run:
 *   npx esbuild src/lib/review.selfcheck.ts --bundle --platform=node --outfile=/tmp/rc.js && node /tmp/rc.js
 */
import assert from 'node:assert/strict'
import {
  buildFileChange,
  changedIdsInFile,
  changedIdsInHunk,
  groupOf,
  reconstruct,
  rollup,
  type Decision,
  proposalAction,
  groupFiles,
  stemOf,
  unreviewedCount,
} from './review'

const decisions = new Map<string, Decision>()
const reset = () => decisions.clear()

// --- 1. All-pending must leave the file exactly as Claude wrote it ----------
{
  reset()
  const base = 'const a = 1\nconst b = 2\nconst c = 3\n'
  const cur = 'const a = 1\nconst b = 22\nconst c = 3\n'
  const f = buildFileChange('src/x.ts', '/abs/src/x.ts', 'M', base, cur)
  assert.equal(reconstruct(f, decisions), cur, 'pending must not revert anything')
  assert.equal(f.additions, 1)
  assert.equal(f.deletions, 1)
}

// --- 2. Rejecting everything restores the baseline byte for byte -----------
{
  reset()
  const base = 'one\ntwo\nthree\nfour\n'
  const cur = 'one\nTWO\nthree\nfour\nfive\n'
  const f = buildFileChange('a.txt', '/abs/a.txt', 'M', base, cur)
  for (const id of changedIdsInFile(f)) decisions.set(id, 'rejected')
  assert.equal(reconstruct(f, decisions), base, 'reject-all must equal baseline')
  assert.equal(rollup(changedIdsInFile(f), decisions), 'rejected')
}

// --- 3. Accepting everything is identical to the current file --------------
{
  reset()
  const base = 'a\nb\n'
  const cur = 'a\nx\ny\n'
  const f = buildFileChange('a.txt', '/abs/a.txt', 'M', base, cur)
  for (const id of changedIdsInFile(f)) decisions.set(id, 'accepted')
  assert.equal(reconstruct(f, decisions), cur, 'accept-all must equal current')
}

// --- 4. The headline capability: one line without the rest of the hunk -----
{
  reset()
  const base = 'header\nfooter\n'
  const cur = 'header\nkeep me\ndrop me\nfooter\n'
  const f = buildFileChange('a.txt', '/abs/a.txt', 'M', base, cur)
  const added = f.lines.filter((l) => l.op === 'add')
  assert.equal(added.length, 2)
  decisions.set(added[0].id, 'accepted')
  decisions.set(added[1].id, 'rejected')
  assert.equal(
    reconstruct(f, decisions),
    'header\nkeep me\nfooter\n',
    'accepting one added line must not drag its neighbour along',
  )
  assert.equal(rollup(changedIdsInFile(f), decisions), 'partial')
}

// --- 5. Rejecting a single deletion restores just that line ----------------
{
  reset()
  const base = 'a\nb\nc\n'
  const cur = 'a\n'
  const f = buildFileChange('a.txt', '/abs/a.txt', 'M', base, cur)
  const dels = f.lines.filter((l) => l.op === 'del')
  assert.equal(dels.length, 2)
  decisions.set(dels[0].id, 'rejected')
  assert.equal(reconstruct(f, decisions), 'a\nb\n', 'restored line must land in order')
}

// --- 6. New file: reject-all yields empty, so the caller can delete it -----
{
  reset()
  const cur = 'brand new\ncontent\n'
  const f = buildFileChange('n.ts', '/abs/n.ts', 'A', '', cur)
  assert.equal(reconstruct(f, decisions), cur)
  for (const id of changedIdsInFile(f)) decisions.set(id, 'rejected')
  assert.equal(reconstruct(f, decisions), '', 'rejecting a whole new file empties it')
}

// --- 7. Distant edits become separate hunks; adjacent ones merge -----------
{
  const base = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n'
  const far = base.replace('line 2', 'LINE 2').replace('line 30', 'LINE 30')
  assert.equal(buildFileChange('f', '/f', 'M', base, far).hunks.length, 2, 'far edits split')

  const near = base.replace('line 10', 'LINE 10').replace('line 11', 'LINE 11')
  assert.equal(buildFileChange('f', '/f', 'M', base, near).hunks.length, 1, 'near edits merge')
}

// --- 8. Hunk-level rollup only considers that hunk's lines ----------------
{
  reset()
  const base = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n') + '\n'
  const cur = base.replace('l2', 'X2').replace('l30', 'X30')
  const f = buildFileChange('f', '/f', 'M', base, cur)
  for (const id of changedIdsInHunk(f, f.hunks[0])) decisions.set(id, 'accepted')
  assert.equal(rollup(changedIdsInHunk(f, f.hunks[0]), decisions), 'accepted')
  assert.equal(rollup(changedIdsInHunk(f, f.hunks[1]), decisions), 'pending')
  assert.equal(rollup(changedIdsInFile(f), decisions), 'partial')
}

// --- 9. Files with no trailing newline stay that way -----------------------
{
  reset()
  const f = buildFileChange('a.txt', '/a', 'M', 'x\ny', 'x\nz')
  assert.equal(reconstruct(f, decisions), 'x\nz', 'must not invent a trailing newline')
}

// --- 10. Grouping reproduces the intended shape ---------------------------
{
  assert.equal(groupOf('src/auth.ts'), 'Authentication')
  assert.equal(groupOf('src/middleware.ts'), 'Src')
  assert.equal(groupOf('src/api/login.ts'), 'Authentication')
  assert.equal(groupOf('tests/auth.test.ts'), 'Tests', 'tests win over auth')
  assert.equal(groupOf('src/users.test.ts'), 'Tests')
  assert.equal(groupOf('db/migrations/001_init.sql'), 'Database')
  assert.equal(groupOf('src/components/Button.tsx'), 'Interface')
  assert.equal(groupOf('README.md'), 'Documentation')
}

// --- Proposal retention: the rule that makes a rejection reversible ---------
{
  // Nothing held yet — whatever is on disk is the proposal.
  assert.equal(proposalAction(false, undefined, 'anything'), 'replace')

  // We wrote this exact content, so the disk is our projection of the user's
  // decisions. Keeping the held proposal is what lets a rejected line be
  // un-rejected instead of disappearing from the list.
  assert.equal(proposalAction(true, 'reverted', 'reverted'), 'keep')

  // Claude wrote something new over the top — the old decisions are stale.
  assert.equal(proposalAction(true, 'reverted', 'claude wrote this'), 'replace')

  // We hold a proposal but never wrote anything: the user has decided nothing
  // yet, so the disk is still Claude's version.
  assert.equal(proposalAction(true, undefined, 'claude version'), 'replace')
}

// --- Grouping beyond top-level directories ---------------------------------
{
  const mk = (path: string) => buildFileChange(path, `/r/${path}`, 'M', 'a\n', 'b\n')

  // Files sharing a stem group together even across unrelated directories —
  // the case a top-level-directory heuristic gets wrong.
  const g1 = groupFiles([mk('server/billing.go'), mk('client/billing.ts')])
  assert.equal(g1.length, 1, `expected one group, got ${JSON.stringify(g1)}`)
  assert.equal(g1[0].name, 'Billing')
  assert.deepEqual(g1[0].files, ['client/billing.ts', 'server/billing.go'])

  // A lone file is named for its directory, skipping generic wrappers.
  const g2 = groupFiles([mk('src/features/checkout/flow.go')])
  assert.equal(g2[0].name, 'Checkout')

  // Keyword rules still win over both.
  const g3 = groupFiles([mk('anywhere/auth.go'), mk('other/login.go')])
  assert.equal(g3[0].name, 'Authentication')
  assert.equal(g3[0].files.length, 2)

  // Compound names reduce to their head, so auth.service.ts and
  // auth.controller.ts land in the same group.
  assert.equal(stemOf('src/auth.service.test.ts'), 'auth')
  assert.equal(stemOf('src/index.d.ts'), 'index')
  assert.equal(stemOf('a/b/user_test.go'), 'user')
  assert.equal(stemOf('Makefile'), 'makefile')
}

{
  // A fully-decided file (accepted or rejected) is reviewed, not "to review" —
  // this is the count the title bar badge uses, and only it decrementing on
  // accept is what tells a user the click actually did something.
  const a = buildFileChange('a', '/a', 'M', 'x', 'y')
  const b = buildFileChange('b', '/b', 'M', 'p', 'q')
  const files = [a, b]
  const d = new Map<string, Decision>()
  assert.equal(unreviewedCount(files, d), 2, 'nothing decided yet')
  for (const id of changedIdsInFile(a)) d.set(id, 'accepted')
  assert.equal(unreviewedCount(files, d), 1, 'accepting a file must drop the badge count')
  for (const id of changedIdsInFile(b)) d.set(id, 'rejected')
  assert.equal(unreviewedCount(files, d), 0, 'a rejected file has also been reviewed')
}

console.log('review engine: all checks passed')
