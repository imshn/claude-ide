/**
 * Self-check for Phase A's pure logic. Run:
 *   npx esbuild src/lib/phasea.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/pa.cjs && node /tmp/pa.cjs
 */
import assert from 'node:assert/strict'
import { activityFor, applyResult, classifyCommand, looksFailed, summariseOutput } from './activity'
import { planFromTool, shouldPlan, titleFrom } from './tasks'
import { projectCard, type Intel } from './intel'

// --- Planning heuristic: must not tax small requests ------------------------
{
  const plans = (s: string) => shouldPlan(s).plan

  assert.equal(plans('Implement OAuth authentication across the app'), true)
  assert.equal(plans('Refactor the API client to use fetch'), true)
  assert.equal(plans('Plan how to add billing'), true, 'explicit ask wins')
  assert.equal(
    plans('Add a feature that does '.repeat(6)),
    true,
    'very long requests get a plan',
  )

  assert.equal(plans('fix this typo'), false)
  assert.equal(plans('rename this variable'), false)
  assert.equal(plans('what does this function do?'), false)
  assert.equal(plans('explain the auth flow'), false, 'read-only never plans')
  assert.equal(plans('add a comment here'), false)
  // "add" is a planning keyword but the small-request guard must win.
  assert.equal(plans('just add a quick log line'), false)
}

// --- Plan capture: both shapes Claude Code actually emits -------------------
{
  assert.deepEqual(planFromTool('ExitPlanMode', { plan: '# Do the thing' }), {
    inline: '# Do the thing',
  })
  assert.equal(planFromTool('ExitPlanMode', { plan: '' }), null)

  const written = planFromTool('Write', {
    file_path: '/Users/x/.claude/plans/add-rate-limiting-to-oasis.md',
  })
  assert.deepEqual(written, { path: '/Users/x/.claude/plans/add-rate-limiting-to-oasis.md' })

  // An ordinary source write must never be mistaken for a plan.
  assert.equal(planFromTool('Write', { file_path: '/repo/src/plans/index.ts' }), null)
  assert.equal(planFromTool('Write', { file_path: '/repo/src/auth.ts' }), null)
  assert.equal(planFromTool('Read', { file_path: '/x/.claude/plans/a.md' }), null)
}

// --- Command classification -------------------------------------------------
{
  assert.equal(classifyCommand('npm test'), 'test')
  assert.equal(classifyCommand('npx vitest run'), 'test')
  assert.equal(classifyCommand('cargo test --all'), 'test')
  assert.equal(classifyCommand('npm run build'), 'build')
  assert.equal(classifyCommand('tsc --noEmit'), 'build')
  assert.equal(classifyCommand('ls -la'), 'run')
  assert.equal(classifyCommand('git status'), 'run')
}

// --- Outcome parsing across the formats we actually meet --------------------
{
  assert.equal(summariseOutput('test', 'Tests  12 passed (12)'), '12 passed')
  assert.equal(summariseOutput('test', 'Tests: 1 failed, 11 passed, 12 total'), '11 passed, 1 failed')
  assert.equal(summariseOutput('test', 'test result: ok. 12 passed; 0 failed'), '12 passed, 0 failed')
  assert.equal(summariseOutput('build', 'Found 3 errors.'), '3 errors')
  assert.equal(summariseOutput('run', 'whatever'), undefined)

  assert.equal(looksFailed('test', 'Tests: 1 failed, 11 passed'), true)
  assert.equal(looksFailed('test', 'Tests  12 passed (12)'), false)
  assert.equal(looksFailed('test', 'test result: ok. 12 passed; 0 failed'), false, '0 failed is a pass')
  assert.equal(looksFailed('build', 'Found 0 errors.'), false)
}

// --- Activity labels read as prose -----------------------------------------
{
  const at = 1
  assert.equal(activityFor('1', 'Read', { file_path: '/a/b/authService.ts' }, at).label, 'Read authService.ts')
  assert.equal(activityFor('2', 'Edit', { file_path: '/a/b/mw.ts' }, at).label, 'Edited mw.ts')
  assert.equal(activityFor('3', 'Grep', { pattern: 'jwt' }, at).label, 'Searched for “jwt”')

  const tests = activityFor('4', 'Bash', { command: 'npm test' }, at)
  assert.equal(tests.kind, 'test')
  assert.equal(tests.label, 'Ran tests')
  assert.equal(tests.status, 'running')

  // A tool that exits 0 while its output says tests failed must still read as failed.
  const done = applyResult(tests, 'Tests: 2 failed, 10 passed', false)
  assert.equal(done.outcome, '10 passed, 2 failed')
  assert.equal(done.status, 'warn', 'green exit code must not hide red tests')

  const good = applyResult(tests, 'Tests  10 passed (10)', false)
  assert.equal(good.status, 'ok')
  assert.equal(applyResult(tests, 'boom', true).status, 'error')
}

// --- Titles -----------------------------------------------------------------
{
  assert.equal(titleFrom('add oauth login. then tests'), 'Add oauth login')
  assert.ok(titleFrom('x'.repeat(120)).length <= 55)
}

// --- Project card: compact, and only what saves Claude a turn ---------------
{
  const intel: Intel = {
    root: '/r', name: 'shop', languages: ['TypeScript'], frameworks: ['React', 'Vite'],
    package_manager: 'Bun', test_framework: 'Vitest', database: 'PostgreSQL',
    scripts: { build: 'vite build', test: 'vitest' },
    build_cmd: 'bun run build', test_cmd: 'bun run test', dev_cmd: '', typecheck_cmd: '',
    entry_points: ['src/main.tsx'], config_files: ['package.json'],
    instruction_files: ['CLAUDE.md'],
    top_dirs: [{ name: 'src', files: 120 }], file_count: 147, line_count: 18421, skipped: 0,
  }
  const card = projectCard(intel)
  assert.ok(card.includes('Bun'), 'package manager is a convention Claude must not guess')
  assert.ok(card.includes('bun run test'))
  assert.ok(card.includes('CLAUDE.md'))
  assert.ok(card.includes('18,421'))
  assert.ok(!card.includes('dev '), 'absent commands are omitted, not blanked')
  assert.ok(card.length < 700, `card must stay small, got ${card.length} chars`)
  assert.equal(projectCard(null), '')
}

console.log('phase A logic: all checks passed')
