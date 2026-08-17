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

console.log('review engine: all checks passed')
