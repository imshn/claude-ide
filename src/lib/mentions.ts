/**
 * `@file` and `/skill` autocomplete in the chat composer.
 *
 * Pure text logic, kept away from the popup so the fiddly part — deciding when a
 * bare `@` or `/` is actually a trigger and not just punctuation someone typed —
 * can be tested directly.
 */

export type TriggerKind = 'file' | 'skill'

export interface Trigger {
  kind: TriggerKind
  /** Text between the sigil and the caret. */
  query: string
  /** Index of the sigil itself. */
  start: number
}

const BOUNDARY = /[\s([{'"`,]/

/**
 * Find an active trigger at the caret.
 *
 * `@` fires anywhere a word could start, because you reference files mid-sentence.
 * `/` only fires at the very beginning of the message, because that is the only
 * position where Claude Code treats it as a skill — firing on every path
 * separator would be constant noise.
 */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const upto = text.slice(0, caret)

  const slash = upto.match(/^\s*\/([A-Za-z0-9:_-]*)$/)
  if (slash) {
    return { kind: 'skill', query: slash[1], start: upto.lastIndexOf('/') }
  }

  const at = upto.lastIndexOf('@')
  if (at === -1) return null
  const before = at === 0 ? '' : upto[at - 1]
  if (before && !BOUNDARY.test(before)) return null

  const query = upto.slice(at + 1)
  // A space ends the mention; a path may contain anything but whitespace.
  if (/\s/.test(query)) return null
  return { kind: 'file', query, start: at }
}

/** Replace the trigger with the chosen value, leaving the caret after it. */
export function applyCompletion(
  text: string,
  trigger: Trigger,
  value: string,
): { text: string; caret: number } {
  const sigil = trigger.kind === 'skill' ? '/' : '@'
  const head = text.slice(0, trigger.start)
  const tail = text.slice(trigger.start + 1 + trigger.query.length)
  const insert = `${sigil}${value} `
  return { text: head + insert + tail, caret: head.length + insert.length }
}

/**
 * Subsequence match with a bias towards the basename, which is how people think
 * about files: "authsvc" should find `src/services/authService.ts`.
 */
export function scoreMatch(candidate: string, query: string): number {
  if (!query) return 1
  const c = candidate.toLowerCase()
  const q = query.toLowerCase()

  const base = c.slice(c.lastIndexOf('/') + 1)
  if (base.startsWith(q)) return 1000 - base.length
  if (base.includes(q)) return 700 - base.length
  if (c.includes(q)) return 400 - c.length

  // Fall back to in-order subsequence.
  let i = 0
  for (const ch of c) if (ch === q[i]) i++
  return i === q.length ? 100 - c.length : -1
}

export function rank<T>(items: T[], query: string, key: (t: T) => string, limit = 12): T[] {
  return items
    .map((item) => ({ item, score: scoreMatch(key(item), query) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item)
}

/**
 * Turn `@path` mentions into something unambiguous for Claude, and collect the
 * paths so the UI can show what it attached.
 */
export function expandMentions(text: string, known: string[]): { text: string; files: string[] } {
  const files: string[] = []
  const out = text.replace(/(^|[\s([{'"`,])@([^\s]+)/g, (whole, pre: string, path: string) => {
    const hit = known.find((k) => k === path) ?? known.find((k) => k.endsWith(`/${path}`))
    if (!hit) return whole
    files.push(hit)
    return `${pre}\`${hit}\``
  })
  return { text: out, files: [...new Set(files)] }
}
