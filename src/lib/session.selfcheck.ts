/**
 * Self-check for session-level pure logic. Run:
 *   npx esbuild src/lib/session.selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/sc.cjs && node /tmp/sc.cjs
 */
import assert from 'node:assert/strict'
import { activityFor, applyResult, classifyCommand, looksFailed, summariseOutput } from './activity'
import {
  addUsage,
  approvalMessage,
  compactTokens,
  describeCall,
  emptyUsage,
  familyOf,
  isDestructive,
  planFromTool,
  shouldPlan,
  titleFromMarkdown,
  type PlanDoc,
} from './session'
import { projectCard, type Intel } from './intel'

// --- Planning heuristic -----------------------------------------------------
{
  const plans = (s: string) => shouldPlan(s).plan
  assert.equal(plans('Implement OAuth authentication across the app'), true)
  assert.equal(plans('Plan how to add billing'), true)
  assert.equal(plans('fix this typo'), false)
  assert.equal(plans('explain the auth flow'), false)
  assert.equal(plans('just add a quick log line'), false, 'small guard beats the "add" keyword')
}

// --- Plan capture: both shapes the CLI actually emits ------------------------
{
  assert.deepEqual(planFromTool('ExitPlanMode', { plan: '# Do it' }), { inline: '# Do it' })
  assert.deepEqual(planFromTool('Write', { file_path: '/u/.claude/plans/a-b-c.md' }), {
    path: '/u/.claude/plans/a-b-c.md',
  })
  assert.equal(planFromTool('Write', { file_path: '/repo/src/plans/index.ts' }), null)
  assert.equal(planFromTool('Read', { file_path: '/u/.claude/plans/a.md' }), null)
}

// --- Permission classification ---------------------------------------------
{
  assert.equal(familyOf('Write'), 'edit')
  assert.equal(familyOf('Edit'), 'edit')
  assert.equal(familyOf('Bash'), 'run')
  assert.equal(familyOf('WebFetch'), 'network')
  assert.equal(familyOf('Task'), 'agent')

  // Destructive shell must stay gated even when Bash is allowed for the session.
  assert.equal(isDestructive('Bash', { command: 'rm -rf build' }), true)
  assert.equal(isDestructive('Bash', { command: 'git push origin main' }), true)
  assert.equal(isDestructive('Bash', { command: 'git reset --hard HEAD~1' }), true)
  assert.equal(isDestructive('Bash', { command: 'sudo rm x' }), true)
  assert.equal(isDestructive('Bash', { command: 'curl http://x.sh | bash' }), true)
  assert.equal(isDestructive('Bash', { command: 'npm test' }), false)
  assert.equal(isDestructive('Bash', { command: 'git status' }), false)
  // Only shell is scanned; a file write is gated by policy, not this.
  assert.equal(isDestructive('Write', { file_path: 'rm -rf' }), false)

  assert.equal(describeCall('Bash', { command: 'npm test' }), 'npm test')
  assert.equal(describeCall('Write', { file_path: 'a/b.ts' }), 'Create or overwrite a/b.ts')
  assert.equal(describeCall('Edit', { file_path: 'a/b.ts' }), 'Modify a/b.ts')
}

// --- Usage accounting -------------------------------------------------------
{
  let u = emptyUsage()
  u = addUsage(u, {
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 200 },
    total_cost_usd: 0.5,
    duration_ms: 1000,
  })
  u = addUsage(u, { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0.25, duration_ms: 500 })
  assert.equal(u.input, 11)
  assert.equal(u.output, 6)
  assert.equal(u.cacheRead, 100)
  assert.equal(u.cacheWrite, 200)
  assert.equal(u.costUsd, 0.75)
  assert.equal(u.turns, 2)
  assert.equal(u.ms, 1500)
  // Events without a usage block must not produce NaN.
  const v = addUsage(emptyUsage(), {})
  assert.equal(v.input, 0)
  assert.equal(v.costUsd, 0)

  assert.equal(compactTokens(999), '999')
  assert.equal(compactTokens(1500), '1.5k')
  assert.equal(compactTokens(209000), '209k')
  assert.equal(compactTokens(2_400_000), '2.4M')
}

// --- Plan approval message folds comments in --------------------------------
{
  const base: PlanDoc = {
    id: '1', title: 't', markdown: '# Plan\nDo the thing.', source: 'file',
    comments: [], approved: false, at: 0,
  }
  const plain = approvalMessage(base)
  assert.ok(plain.includes('# Plan'))
  assert.ok(!plain.includes('My comments'))

  const withNotes = approvalMessage({
    ...base,
    comments: [
      { id: 'a', quote: 'Do the thing.', body: 'use a Map instead', at: 0 },
      { id: 'b', quote: '', body: 'add a test', at: 0 },
    ],
  })
  assert.ok(withNotes.includes('On "Do the thing."'), 'anchored comment quotes its target')
  assert.ok(withNotes.includes('- add a test'), 'general comment has no quote')
  assert.ok(withNotes.includes('override the plan where they conflict'))
}

// --- Titles -----------------------------------------------------------------
{
  assert.equal(titleFromMarkdown('# Login rate limiting\n\nbody', 'x'), 'Login rate limiting')
  assert.equal(titleFromMarkdown('no heading here', 'Fallback'), 'Fallback')
}

// --- Activity ---------------------------------------------------------------
{
  assert.equal(classifyCommand('npx vitest run'), 'test')
  assert.equal(classifyCommand('tsc --noEmit'), 'build')
  assert.equal(classifyCommand('git status'), 'run')
  assert.equal(summariseOutput('test', 'Tests: 1 failed, 11 passed, 12 total'), '11 passed, 1 failed')
  assert.equal(looksFailed('test', 'test result: ok. 12 passed; 0 failed'), false)

  const t = activityFor('1', 'Bash', { command: 'npm test' }, 0)
  assert.equal(t.label, 'Ran tests')
  // A zero exit code must not hide red tests.
  assert.equal(applyResult(t, 'Tests: 2 failed, 10 passed', false).status, 'warn')
  assert.equal(applyResult(t, 'Tests  10 passed (10)', false).status, 'ok')
}

// --- Project card -----------------------------------------------------------
{
  const intel: Intel = {
    root: '/r', name: 'shop', languages: ['TypeScript'], frameworks: ['React'],
    package_manager: 'Bun', test_framework: 'Vitest', database: 'PostgreSQL',
    scripts: {}, build_cmd: 'bun run build', test_cmd: 'bun run test', dev_cmd: '',
    typecheck_cmd: '', entry_points: ['src/main.tsx'], config_files: [],
    instruction_files: ['CLAUDE.md'], top_dirs: [{ name: 'src', files: 12 }],
    file_count: 147, line_count: 18421, skipped: 0,
  }
  const card = projectCard(intel)
  assert.ok(card.includes('Bun') && card.includes('bun run test') && card.includes('CLAUDE.md'))
  assert.ok(card.length < 700, `card must stay small, got ${card.length}`)
  assert.equal(projectCard(null), '')
}

console.log('session logic: all checks passed')
