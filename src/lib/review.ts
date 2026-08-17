import { diffLines } from 'diff'

/**
 * The change-review model.
 *
 * A file's diff is stored as ONE ordered list covering every line of the file
 * (not just changed regions). Hunks are display windows into that list. That
 * single decision is what makes line-level accept/reject work: reconstructing
 * the file is a straight walk over the list, so any subset of decisions
 * produces a valid file.
 *
 * Semantics that matter:
 *   - The file on disk already contains all of Claude's changes.
 *   - "Accept" is a review decision. It does not rewrite the file.
 *   - "Reject" is the only destructive action: a rejected addition is dropped,
 *     a rejected deletion is restored.
 *   - "Pending" behaves like accepted on disk — nothing is silently reverted
 *     just because you have not looked at it yet.
 */

export type Decision = 'pending' | 'accepted' | 'rejected'
export type Op = 'ctx' | 'add' | 'del'
/** Mixed decisions inside a hunk/file/group. */
export type Rollup = Decision | 'partial'

export interface DiffLine {
  id: string
  op: Op
  text: string
  /** 1-based line number in the checkpoint baseline, when the line exists there. */
  baseNo?: number
  /** 1-based line number in the file as it is now, when the line exists there. */
  curNo?: number
}

export interface Hunk {
  id: string
  /** Index range in FileChange.lines, inclusive, including display context. */
  from: number
  to: number
  /** Indices of the changed (non-context) lines in this hunk. */
  changed: number[]
  header: string
}

export type FileStatus = 'A' | 'M' | 'D'

export interface FileChange {
  path: string
  absPath: string
  status: FileStatus
  baseline: string
  current: string
  lines: DiffLine[]
  hunks: Hunk[]
  additions: number
  deletions: number
}

export interface Group {
  name: string
  files: string[]
}

const CONTEXT = 3

function splitLines(value: string): string[] {
  if (value === '') return []
  const lines = value.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Build the full-file diff line list plus display hunks. */
export function buildFileChange(
  path: string,
  absPath: string,
  status: FileStatus,
  baseline: string,
  current: string,
): FileChange {
  const parts = diffLines(baseline, current)
  const lines: DiffLine[] = []
  let baseNo = 0
  let curNo = 0

  for (const part of parts) {
    const op: Op = part.added ? 'add' : part.removed ? 'del' : 'ctx'
    for (const text of splitLines(part.value)) {
      const line: DiffLine = { id: `${path}#${lines.length}`, op, text }
      if (op !== 'add') line.baseNo = ++baseNo
      if (op !== 'del') line.curNo = ++curNo
      lines.push(line)
    }
  }

  const changedIdx = lines.map((l, i) => (l.op === 'ctx' ? -1 : i)).filter((i) => i >= 0)

  const hunks: Hunk[] = []
  let run: number[] = []
  const flush = () => {
    if (!run.length) return
    const from = Math.max(0, run[0] - CONTEXT)
    const to = Math.min(lines.length - 1, run[run.length - 1] + CONTEXT)
    const baseStart = lines.slice(from, to + 1).find((l) => l.baseNo)?.baseNo ?? 0
    const curStart = lines.slice(from, to + 1).find((l) => l.curNo)?.curNo ?? 0
    hunks.push({
      id: `${path}@${hunks.length}`,
      from,
      to,
      changed: [...run],
      header: `@@ -${baseStart} +${curStart} @@`,
    })
    run = []
  }
  for (const i of changedIdx) {
    // Two runs merge when their context windows would touch or overlap.
    if (run.length && i - run[run.length - 1] > CONTEXT * 2) flush()
    run.push(i)
  }
  flush()

  return {
    path,
    absPath,
    status,
    baseline,
    current,
    lines,
    hunks,
    additions: lines.filter((l) => l.op === 'add').length,
    deletions: lines.filter((l) => l.op === 'del').length,
  }
}

/**
 * The file contents implied by the current set of decisions.
 * Pure — callers decide whether to write it to disk.
 */
export function reconstruct(file: FileChange, decisions: Map<string, Decision>): string {
  const out: string[] = []
  for (const line of file.lines) {
    const d = decisions.get(line.id) ?? 'pending'
    if (line.op === 'ctx') out.push(line.text)
    else if (line.op === 'add') {
      if (d !== 'rejected') out.push(line.text)
    } else if (d === 'rejected') {
      out.push(line.text)
    }
  }
  const text = out.join('\n')
  // Preserve whichever side had a trailing newline, so accepting everything is
  // byte-identical to what Claude wrote.
  const wantsNewline = file.current.endsWith('\n') || file.baseline.endsWith('\n')
  return text.length && wantsNewline ? text + '\n' : text
}

/** Roll a set of line decisions up to a hunk / file / group verdict. */
export function rollup(ids: string[], decisions: Map<string, Decision>): Rollup {
  if (!ids.length) return 'accepted'
  let accepted = 0
  let rejected = 0
  for (const id of ids) {
    const d = decisions.get(id) ?? 'pending'
    if (d === 'accepted') accepted++
    else if (d === 'rejected') rejected++
  }
  if (accepted === ids.length) return 'accepted'
  if (rejected === ids.length) return 'rejected'
  if (accepted + rejected === 0) return 'pending'
  return 'partial'
}

export function changedIdsInHunk(file: FileChange, hunk: Hunk): string[] {
  return hunk.changed.map((i) => file.lines[i].id)
}

export function changedIdsInFile(file: FileChange): string[] {
  return file.lines.filter((l) => l.op !== 'ctx').map((l) => l.id)
}

// ---------------------------------------------------------------------------
// Logical grouping. A flat file list hides intent; these rules recover the
// shape of the change. Order matters — a test file for auth belongs to Tests.
// ---------------------------------------------------------------------------

const RULES: [RegExp, string][] = [
  [/(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[jt]sx?$|_test\.(py|go|rs)$/i, 'Tests'],
  [/migrations?\/|schema\.|\.sql$|prisma\/|models?\//i, 'Database'],
  [/auth|login|logout|register|signup|session|jwt|passwordoauth|permission/i, 'Authentication'],
  [/(^|\/)(api|routes?|controllers?|handlers?|endpoints?)\//i, 'API'],
  [/(^|\/)(components?|views?|pages?|screens?)\/|\.(tsx|jsx|vue|svelte)$/i, 'Interface'],
  [/\.(css|scss|sass|less)$|tailwind|theme|styles?\//i, 'Styling'],
  [/(^|\/)(docs?)\/|\.mdx?$|^readme/i, 'Documentation'],
  [/(^|\/)(config|\.github|scripts?)\/|\.(json|ya?ml|toml|ini)$|dockerfile|makefile/i, 'Configuration'],
  [/(^|\/)(utils?|lib|helpers?|shared|common)\//i, 'Shared code'],
]

export function groupOf(path: string): string {
  for (const [re, name] of RULES) if (re.test(path)) return name
  const top = path.split('/')[0]
  if (top && top !== path) return top.charAt(0).toUpperCase() + top.slice(1)
  return 'Other'
}

export function groupFiles(files: FileChange[]): Group[] {
  const map = new Map<string, string[]>()
  for (const f of files) {
    const name = groupOf(f.path)
    const list = map.get(name)
    if (list) list.push(f.path)
    else map.set(name, [f.path])
  }
  return [...map.entries()]
    .map(([name, paths]) => ({ name, files: paths.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
