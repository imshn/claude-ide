/**
 * Session-level types and pure logic.
 *
 * Replaces the Phase A task model: there is one conversation per window again.
 * What survived from Phase A is the part that earned its place — project
 * intelligence, the activity feed, and plan capture.
 */

export interface ChatItem {
  kind: 'user' | 'assistant' | 'notice' | 'turn'
  text?: string
  tone?: 'info' | 'error'
  ok?: boolean
  ms?: number
  at: number
}

export interface Checkpoint {
  tree: string
  label: string
  at: number
}

/** A comment the user anchored to part of a plan. */
export interface PlanComment {
  id: string
  /** The exact text the comment is attached to; empty means whole-document. */
  quote: string
  body: string
  at: number
}

export interface PlanDoc {
  id: string
  title: string
  markdown: string
  /** Where Claude wrote it, when it came from a file. */
  path?: string
  source: 'tool' | 'file'
  comments: PlanComment[]
  approved: boolean
  at: number
}

// ---------------------------------------------------------------------------
// Models. Aliases rather than pinned ids, so these keep resolving to the
// current release without the IDE needing an update.
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string
  label: string
  hint: string
}

export const MODELS: ModelOption[] = [
  { id: '', label: 'Default', hint: "whatever Claude Code is configured to use" },
  { id: 'opus', label: 'Opus', hint: 'most capable, slowest' },
  { id: 'sonnet', label: 'Sonnet', hint: 'balanced' },
  { id: 'haiku', label: 'Haiku', hint: 'fastest, cheapest' },
]

/** Reasoning effort, passed through as --effort. */
export const EFFORTS: ModelOption[] = [
  { id: '', label: 'Effort', hint: "Claude Code's configured default" },
  { id: 'low', label: 'Low', hint: 'fastest, least thorough' },
  { id: 'medium', label: 'Medium', hint: 'balanced' },
  { id: 'high', label: 'High', hint: 'more thorough, slower' },
  { id: 'xhigh', label: 'X-High', hint: 'harder problems' },
  { id: 'max', label: 'Max', hint: 'most thorough, slowest' },
]

// ---------------------------------------------------------------------------
// Usage. Accumulated from `result` events — this is what this session spent,
// not an account balance. We have no access to subscription limits and do not
// pretend to.
// ---------------------------------------------------------------------------

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  turns: number
  ms: number
}

export const emptyUsage = (): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, turns: 0, ms: 0,
})

export function addUsage(u: Usage, ev: any): Usage {
  const raw = ev?.usage ?? {}
  return {
    input: u.input + (raw.input_tokens ?? 0),
    output: u.output + (raw.output_tokens ?? 0),
    cacheRead: u.cacheRead + (raw.cache_read_input_tokens ?? 0),
    cacheWrite: u.cacheWrite + (raw.cache_creation_input_tokens ?? 0),
    costUsd: u.costUsd + (ev?.total_cost_usd ?? 0),
    turns: u.turns + 1,
    ms: u.ms + (ev?.duration_ms ?? 0),
  }
}

export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

// ---------------------------------------------------------------------------
// Tool permissions
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  id: string
  tool: string
  input: any
  cwd: string
}

export type Policy = 'ask' | 'allow'

/** Per-tool-family policy. Edits default to allow because the whole point of
 *  this IDE is that edits are reviewed *after* the fact, line by line. */
export const DEFAULT_POLICY: Record<string, Policy> = {
  edit: 'allow',
  run: 'ask',
  network: 'ask',
  agent: 'allow',
}

export function familyOf(tool: string): keyof typeof DEFAULT_POLICY {
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') return 'edit'
  if (tool === 'Bash') return 'run'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'network'
  return 'agent'
}

/** A short human description of what a tool call will actually do. */
export function describeCall(tool: string, input: any): string {
  const a = input ?? {}
  switch (tool) {
    case 'Bash':
      return a.command ?? ''
    case 'Write':
      return `Create or overwrite ${a.file_path ?? ''}`
    case 'Edit':
      return `Modify ${a.file_path ?? ''}`
    case 'NotebookEdit':
      return `Modify ${a.notebook_path ?? ''}`
    case 'WebFetch':
      return `Fetch ${a.url ?? ''}`
    case 'WebSearch':
      return `Search the web for “${a.query ?? ''}”`
    case 'Task':
      return a.description ?? 'Run a subagent'
    default:
      return a.description ?? ''
  }
}

/** Commands worth a second look even when Bash is allowed for the session. */
const DESTRUCTIVE = /\brm\s+-[rf]|\bgit\s+(push|reset\s+--hard|clean)|\bsudo\b|\bmkfs|\bdd\s|\bchmod\s+777|>\s*\/dev\/|\bcurl\b[^|]*\|\s*(ba)?sh/i

export function isDestructive(tool: string, input: any): boolean {
  return tool === 'Bash' && DESTRUCTIVE.test(String(input?.command ?? ''))
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

const BIG = /\b(implement|build|create|add|refactor|migrate|redesign|rewrite|integrate|introduce|port|convert|overhaul|set up|authentication|authorisation|authorization|architecture)\b/i
const SMALL = /\b(typo|rename|comment|format|bump|tweak|quick|small|just|one-line|why|what|where|explain|show|list|read|how does)\b/i
const EXPLICIT_PLAN = /\b(plan|design|propose|approach|strategy)\b/i

export function shouldPlan(request: string): { plan: boolean; reason: string } {
  const words = request.trim().split(/\s+/).length
  if (EXPLICIT_PLAN.test(request)) return { plan: true, reason: 'you asked for a plan' }
  if (SMALL.test(request)) return { plan: false, reason: 'small or read-only request' }
  if (BIG.test(request) && words >= 6) return { plan: true, reason: 'multi-step change' }
  if (words >= 30) return { plan: true, reason: 'long request' }
  return { plan: false, reason: 'small request' }
}

/**
 * Claude Code emits a plan either as an ExitPlanMode tool call or as a markdown
 * file under ~/.claude/plans. Verified against 2.1.226, which does the latter.
 */
export function planFromTool(
  name: string,
  input: unknown,
): { inline?: string; path?: string } | null {
  const arg = (input ?? {}) as Record<string, unknown>
  if (name === 'ExitPlanMode') {
    const text = typeof arg.plan === 'string' ? arg.plan : ''
    return text ? { inline: text } : null
  }
  if (name === 'Write') {
    const path = typeof arg.file_path === 'string' ? arg.file_path : ''
    if (/\/\.claude\/plans\/[^/]+\.md$/.test(path)) return { path }
  }
  return null
}

export function titleFromMarkdown(md: string, fallback: string): string {
  const heading = md.split('\n').find((l) => l.trim().startsWith('# '))
  return heading ? heading.replace(/^#\s*/, '').trim().slice(0, 60) : fallback
}

/** Compose the message sent when a plan is approved, folding in comments. */
export function approvalMessage(plan: PlanDoc): string {
  const notes = plan.comments
    .map((c) =>
      c.quote
        ? `- On "${c.quote.trim().slice(0, 160)}": ${c.body}`
        : `- ${c.body}`,
    )
    .join('\n')

  return notes
    ? `Implement this plan. Apply my comments below — they override the plan where they conflict. Do not re-plan.\n\n${plan.markdown}\n\n## My comments\n${notes}`
    : `Implement this plan exactly. Do not re-plan.\n\n${plan.markdown}`
}
