import { useState } from 'react'
import clsx from 'clsx'
import {
  Boxes, ChevronDown, ChevronRight, Database, FileCode2, Loader2, ScrollText,
  TerminalSquare, X,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { projectCard } from '../lib/intel'
import { STATUS_LABEL, type Task, type TaskStatus } from '../lib/tasks'
import { Button, Empty, Panel } from './ui'

const DOT: Record<TaskStatus, string> = {
  idle: 'bg-fg-dim/50',
  planning: 'bg-accent animate-pulse',
  'plan-ready': 'bg-accent',
  executing: 'bg-accent animate-pulse',
  review: 'bg-pending',
  completed: 'bg-add',
  failed: 'bg-del',
  queued: 'bg-fg-dim',
}

export function TasksPanel() {
  const tasks = useStore((s) => s.tasks)
  const activeId = useStore((s) => s.activeId)
  const selectTask = useStore((s) => s.selectTask)
  const closeTask = useStore((s) => s.closeTask)
  const root = useStore((s) => s.root)

  return (
    <Panel title="Tasks">
      {!root ? (
        <Empty title="No folder open" />
      ) : (
        <>
          <ProjectIntel />
          <ContextSection />

          <div className="mt-1 border-t border-border pt-1">
            <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-fg-dim uppercase">
              Tasks
            </p>
            {!tasks.length && (
              <p className="px-3 pb-3 text-[11px] leading-relaxed text-fg-dim">
                Describe something in the Claude panel to start one. Tasks run one at a
                time so they cannot overwrite each other.
              </p>
            )}
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                active={t.id === activeId}
                onSelect={() => selectTask(t.id)}
                onClose={() => void closeTask(t.id)}
              />
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

function TaskRow({
  task,
  active,
  onSelect,
  onClose,
}: {
  task: Task
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const pending = task.files.length
  return (
    <div
      className={clsx(
        'group/t anim flex items-center gap-2 px-3 py-1.5',
        active ? 'bg-raised' : 'hover:bg-elevated',
      )}
    >
      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[task.status])} />
      <button onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[11.5px] text-fg">{task.title}</span>
        <span className="tnum block truncate text-[10px] text-fg-dim">
          {STATUS_LABEL[task.status]}
          {pending > 0 && ` · ${pending} file${pending > 1 ? 's' : ''}`}
          {task.turns > 0 && ` · ${task.turns} turn${task.turns > 1 ? 's' : ''}`}
        </span>
      </button>
      {task.busy && <Loader2 size={11} className="shrink-0 animate-spin text-accent" />}
      <Button
        compact
        variant="ghost"
        aria-label={`Close ${task.title}`}
        className="opacity-0 anim group-hover/t:opacity-100 focus-within:opacity-100"
        onClick={onClose}
      >
        <X size={11} />
      </Button>
    </div>
  )
}

function ProjectIntel() {
  const intel = useStore((s) => s.intel)
  const loading = useStore((s) => s.intelLoading)
  const repo = useStore((s) => s.repo)
  const openFile = useStore((s) => s.openFile)
  const root = useStore((s) => s.root)
  const [open, setOpen] = useState(true)

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-3 py-2 text-[11px] text-fg-dim">
        <Loader2 size={11} className="animate-spin" /> Scanning project…
      </p>
    )
  }
  if (!intel) return null

  const rows: [typeof Boxes, string, string][] = [
    [Boxes, 'Stack', [intel.languages.join(', '), intel.frameworks.slice(0, 3).join(', ')].filter(Boolean).join(' · ')],
    [TerminalSquare, 'Package manager', intel.package_manager],
    [FileCode2, 'Tests', intel.test_framework],
    [Database, 'Database', intel.database],
  ]

  return (
    <section className="border-b border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="anim flex w-full items-center gap-1.5 px-3 py-1.5 text-fg-muted hover:text-fg"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-[11px] font-semibold tracking-wide uppercase">
          Project intelligence
        </span>
      </button>

      {open && (
        <div className="space-y-1 px-3 pb-2.5">
          {rows.filter(([, , v]) => v).map(([Icon, label, value]) => (
            <div key={label} className="flex items-baseline gap-2 text-[11px]">
              <Icon size={10} className="shrink-0 translate-y-0.5 text-fg-dim" />
              <span className="w-[86px] shrink-0 text-fg-dim">{label}</span>
              <span className="min-w-0 flex-1 truncate text-fg-muted" title={value}>
                {value}
              </span>
            </div>
          ))}

          {intel.build_cmd || intel.test_cmd ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {[intel.test_cmd, intel.build_cmd, intel.dev_cmd].filter(Boolean).map((c) => (
                <code
                  key={c}
                  className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
                >
                  {c}
                </code>
              ))}
            </div>
          ) : null}

          <div className="tnum flex items-baseline gap-2 pt-1 text-[11px]">
            <span className="w-[96px] shrink-0 text-fg-dim">Repository</span>
            <span className="text-fg-muted">
              {intel.file_count.toLocaleString()} files · {intel.line_count.toLocaleString()} lines
            </span>
          </div>
          {repo?.is_repo && (
            <div className="tnum flex items-baseline gap-2 text-[11px]">
              <span className="w-[96px] shrink-0 text-fg-dim">Working tree</span>
              <span className="text-fg-muted">
                {repo.branch} · {repo.entries.length} changed
              </span>
            </div>
          )}

          {intel.instruction_files.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <ScrollText size={10} className="shrink-0 text-accent" />
              {intel.instruction_files.map((f) => (
                <button
                  key={f}
                  onClick={() => root && void openFile(`${root}/${f}`)}
                  className="anim rounded border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:border-accent/60"
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * What we send, not what Claude knows.
 *
 * We cannot introspect Claude Code's own context assembly — its CLAUDE.md
 * loading, its own file reads. Claiming otherwise would be a confident lie, so
 * this panel is scoped to the part we actually control.
 */
function ContextSection() {
  const intel = useStore((s) => s.intel)
  const lean = useStore((s) => s.lean)
  const set = useStore((s) => s.set)
  const [open, setOpen] = useState(false)

  const card = projectCard(intel)
  const approxTokens = Math.round(card.length / 4)

  return (
    <section className="border-b border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="anim flex w-full items-center gap-1.5 px-3 py-1.5 text-fg-muted hover:text-fg"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-[11px] font-semibold tracking-wide uppercase">Context sent</span>
        {card && <span className="tnum ml-auto text-[10px] text-fg-dim">~{approxTokens} tok</span>}
      </button>

      {open && (
        <div className="px-3 pb-2.5">
          <p className="mb-1.5 text-[10.5px] leading-relaxed text-fg-dim">
            Prepended to each task's first message. Claude Code assembles its own context
            on top of this; we can only show our part.
          </p>
          <pre className="max-h-40 overflow-auto rounded border border-border bg-bg px-2 py-1.5 font-mono text-[10px] whitespace-pre-wrap text-fg-muted">
            {card || 'No project brief yet.'}
          </pre>
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[10.5px] text-fg-muted">
            <input
              type="checkbox"
              checked={lean}
              onChange={(e) => set('lean', e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              Lean sessions
              <span className="block text-fg-dim">
                Skip your MCP servers. Measured ~209k fewer tokens of session startup.
              </span>
            </span>
          </label>
        </div>
      )}
    </section>
  )
}
