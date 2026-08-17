/**
 * Turns raw Claude Code tool traffic into a readable timeline.
 *
 * The chat panel used to show `Bash` + a truncated argument, which is accurate
 * and useless. This maps the same events to what actually happened — "Ran tests",
 * "Edited authService.ts", "18/18 passed" — while keeping the raw payload
 * attached so any row can be expanded back to the truth.
 */

export type ActivityKind =
  | 'read' | 'edit' | 'search' | 'run' | 'test' | 'build'
  | 'plan' | 'task' | 'web' | 'other'

export type ActivityStatus = 'running' | 'ok' | 'warn' | 'error'

export interface Activity {
  id: string
  kind: ActivityKind
  label: string
  detail: string
  status: ActivityStatus
  /** Filled in from the tool result, e.g. "18/18 passed". */
  outcome?: string
  input: unknown
  result?: string
  at: number
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

const TEST_RE = /\b(vitest|jest|pytest|mocha|ava|cypress|playwright|go test|cargo test|npm t\b|yarn test|pnpm test|bun test|rspec|phpunit)\b|\btest(s)?\b/i
const BUILD_RE = /\b(build|compile|tsc|webpack|rollup|esbuild|cargo build|go build|make)\b/i

export function classifyCommand(cmd: string): ActivityKind {
  if (TEST_RE.test(cmd)) return 'test'
  if (BUILD_RE.test(cmd)) return 'build'
  return 'run'
}

/** Extract a pass/fail summary from test or typecheck output. */
export function summariseOutput(kind: ActivityKind, out: string): string | undefined {
  if (!out) return undefined

  if (kind === 'test') {
    // Vitest / Jest: "Tests  12 passed (12)" or "Tests: 1 failed, 11 passed, 12 total"
    const failed = out.match(/(\d+)\s+failed/i)
    const passed = out.match(/(\d+)\s+passed/i)
    if (failed && passed) return `${passed[1]} passed, ${failed[1]} failed`
    if (passed) return `${passed[1]} passed`
    if (failed) return `${failed[1]} failed`
    // Go: "ok  package  0.1s" / "FAIL"
    if (/\bFAIL\b/.test(out)) return 'failed'
    if (/^ok\s/m.test(out)) return 'passed'
    // Cargo: "test result: ok. 12 passed; 0 failed"
    const cargo = out.match(/test result:\s*(\w+)\.\s*(\d+) passed;\s*(\d+) failed/i)
    if (cargo) return `${cargo[2]} passed, ${cargo[3]} failed`
  }

  if (kind === 'build') {
    const errors = out.match(/(\d+)\s+error/i)
    if (errors) return `${errors[1]} errors`
    if (/error(:|\s)/i.test(out)) return 'errors'
  }

  return undefined
}

/** Did this output indicate failure, regardless of the tool's own exit status? */
export function looksFailed(kind: ActivityKind, out: string): boolean {
  if (kind === 'test') {
    const failed = out.match(/(\d+)\s+failed/i)
    if (failed) return Number(failed[1]) > 0
    return /\bFAIL\b/.test(out)
  }
  if (kind === 'build') {
    const errors = out.match(/(\d+)\s+error/i)
    if (errors) return Number(errors[1]) > 0
    return /\berror(:|\s)/i.test(out)
  }
  return false
}

export function activityFor(
  id: string,
  name: string,
  input: unknown,
  at: number,
): Activity {
  const arg = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof arg[k] === 'string' ? (arg[k] as string) : '')
  const path = str('file_path') || str('path') || str('notebook_path')

  const make = (kind: ActivityKind, label: string, detail = ''): Activity => ({
    id, kind, label, detail, status: 'running', input, at,
  })

  switch (name) {
    case 'Read':
      return make('read', `Read ${base(path)}`, path)
    case 'Write':
      return make('edit', `Wrote ${base(path)}`, path)
    case 'Edit':
    case 'NotebookEdit':
      return make('edit', `Edited ${base(path)}`, path)
    case 'Glob':
      return make('search', `Searched files`, str('pattern'))
    case 'Grep':
      return make('search', `Searched for “${str('pattern')}”`, str('path'))
    case 'WebSearch':
      return make('web', 'Searched the web', str('query'))
    case 'WebFetch':
      return make('web', 'Fetched a page', str('url'))
    case 'Task':
    case 'Agent':
      return make('task', `Delegated: ${str('description') || 'subtask'}`, str('subagent_type'))
    case 'TodoWrite':
      return make('other', 'Updated its task list', '')
    case 'ExitPlanMode':
      return make('plan', 'Produced a plan', '')
    case 'Bash': {
      const cmd = str('command')
      const kind = classifyCommand(cmd)
      const label =
        kind === 'test' ? 'Ran tests' : kind === 'build' ? 'Built the project' : `Ran ${base(cmd.split(' ')[0])}`
      return make(kind, str('description') || label, cmd)
    }
    default:
      return make('other', name, str('description'))
  }
}

export function applyResult(a: Activity, result: string, isError: boolean): Activity {
  const outcome = summariseOutput(a.kind, result)
  const failed = isError || looksFailed(a.kind, result)
  return {
    ...a,
    result,
    outcome,
    status: failed ? (isError ? 'error' : 'warn') : 'ok',
  }
}
