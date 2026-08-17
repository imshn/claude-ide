import type { Activity } from './activity'
import type { Decision, FileChange, Group } from './review'

export type TaskStatus =
  | 'idle'        // created, nothing sent yet
  | 'planning'    // a plan-mode turn is running
  | 'plan-ready'  // plan produced, waiting on the user
  | 'executing'
  | 'review'      // finished, changes await review
  | 'completed'   // every change reviewed
  | 'failed'
  | 'queued'      // another task holds the working tree

export interface ToolCall {
  id: string
  name: string
  input: unknown
  result?: string
  isError?: boolean
}

/** `at` lets the UI merge conversation and tool activity into one timeline. */
export type ChatItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'assistant'; text: string; at: number }
  | { kind: 'notice'; text: string; tone: 'info' | 'error'; at: number }
  | { kind: 'turn'; ok: boolean; ms: number; at: number }

export interface Checkpoint {
  tree: string
  label: string
  at: number
}

export interface Plan {
  /** Markdown, either from ExitPlanMode or from a file Claude wrote. */
  text: string
  source: 'tool' | 'file'
  path?: string
  approved: boolean
}

export interface Task {
  id: string
  title: string
  createdAt: number
  status: TaskStatus
  /** Our IPC handle for the child process. */
  sessionId: string
  /** Claude Code's own session id, from system/init — enables --resume. */
  claudeSessionId?: string
  running: boolean
  busy: boolean
  /** The session was spawned with --permission-mode plan. Planning can take
   *  several turns, so the approval gate keys off this rather than a status. */
  planMode: boolean
  chat: ChatItem[]
  activity: Activity[]
  streaming: string
  plan?: Plan
  /** The prompt the task was created from, replayed after plan approval. */
  request: string
  baseTree: string | null
  checkpoints: Checkpoint[]
  files: FileChange[]
  groups: Group[]
  decisions: Map<string, Decision>
  written: Record<string, string>
  selected: string | null
  turns: number
  ms: number
  error?: string
}

export function createTask(request: string): Task {
  return {
    id: crypto.randomUUID(),
    title: titleFrom(request),
    createdAt: Date.now(),
    status: 'idle',
    sessionId: crypto.randomUUID(),
    running: false,
    busy: false,
    planMode: false,
    chat: [],
    activity: [],
    streaming: '',
    request,
    baseTree: null,
    checkpoints: [],
    files: [],
    groups: [],
    decisions: new Map(),
    written: {},
    selected: null,
    turns: 0,
    ms: 0,
  }
}

/** A short human label. First clause, trimmed, capitalised. */
export function titleFrom(request: string): string {
  const first = request.trim().split(/[.\n]/)[0].trim()
  const short = first.length > 52 ? first.slice(0, 52).replace(/\s\S*$/, '') + '…' : first
  return short.charAt(0).toUpperCase() + short.slice(1) || 'Untitled task'
}

const BIG = /\b(implement|build|create|add|refactor|migrate|redesign|rewrite|integrate|introduce|port|convert|overhaul|set up|authentication|authorisation|authorization|architecture)\b/i
const SMALL = /\b(typo|rename|comment|format|bump|tweak|quick|small|just|one-line|why|what|where|explain|show|list|read|how does)\b/i
const EXPLICIT_PLAN = /\b(plan|design|propose|approach|strategy)\b/i

/**
 * Whether a request is big enough to be worth a planning round-trip.
 * Errs towards *not* planning: an unwanted plan step is friction on every small
 * request, whereas a missing one is recoverable — the changes still land in the
 * review workspace either way.
 */
export function shouldPlan(request: string): { plan: boolean; reason: string } {
  const words = request.trim().split(/\s+/).length

  if (EXPLICIT_PLAN.test(request)) return { plan: true, reason: 'you asked for a plan' }
  if (SMALL.test(request)) return { plan: false, reason: 'small or read-only request' }
  if (BIG.test(request) && words >= 6) return { plan: true, reason: 'multi-step change' }
  if (words >= 30) return { plan: true, reason: 'long request' }
  return { plan: false, reason: 'small request' }
}

/**
 * Claude Code emits a plan one of two ways depending on version and config:
 * an ExitPlanMode tool call, or a markdown file written under ~/.claude/plans.
 * Verified against 2.1.226, which does the latter. Handle both.
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

export const STATUS_LABEL: Record<TaskStatus, string> = {
  idle: 'Ready',
  planning: 'Planning',
  'plan-ready': 'Plan ready',
  executing: 'Running',
  review: 'Review required',
  completed: 'Completed',
  failed: 'Failed',
  queued: 'Queued',
}
