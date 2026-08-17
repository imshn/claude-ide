import { useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, Check, ChevronRight, FileEdit, FileText, Globe, Hammer,
  Loader2, Search, SquareTerminal, Users, Wrench,
} from 'lucide-react'
import type { Activity, ActivityKind } from '../lib/activity'

const ICON: Record<ActivityKind, typeof FileText> = {
  read: FileText,
  edit: FileEdit,
  search: Search,
  run: SquareTerminal,
  test: Check,
  build: Hammer,
  plan: FileText,
  task: Users,
  web: Globe,
  other: Wrench,
}

/**
 * One row per meaningful thing the agent did. Collapsed it reads as prose;
 * expanded it shows the exact tool input and output, so the abstraction is
 * never load-bearing — you can always get to the truth.
 */
export function ActivityRow({ a }: { a: Activity }) {
  const [open, setOpen] = useState(false)
  const Icon = ICON[a.kind]

  const tone =
    a.status === 'error' ? 'text-del'
    : a.status === 'warn' ? 'text-pending'
    : a.status === 'running' ? 'text-accent'
    : 'text-fg-dim'

  return (
    <div className="rounded-md hover:bg-elevated/60 anim">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left"
        aria-expanded={open}
      >
        {a.status === 'running' ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
        ) : a.status === 'error' || a.status === 'warn' ? (
          <AlertTriangle size={11} className={clsx('shrink-0', tone)} />
        ) : (
          <Icon size={11} className={clsx('shrink-0', tone)} />
        )}

        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-[11.5px]',
            a.status === 'running' ? 'text-fg' : 'text-fg-muted',
          )}
        >
          {a.label}
        </span>

        {a.outcome && (
          <span
            className={clsx(
              'tnum shrink-0 text-[10.5px]',
              a.status === 'ok' ? 'text-add' : a.status === 'warn' ? 'text-pending' : 'text-del',
            )}
          >
            {a.outcome}
          </span>
        )}

        <ChevronRight size={10} className={clsx('shrink-0 text-fg-dim anim', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="px-2 pb-2">
          {a.detail && (
            <pre className="mb-1 overflow-x-auto rounded border border-border-soft bg-bg px-2 py-1 font-mono text-[10.5px] whitespace-pre-wrap text-fg-muted">
              {a.detail}
            </pre>
          )}
          <pre className="max-h-60 overflow-auto rounded border border-border-soft bg-bg px-2 py-1 font-mono text-[10.5px] whitespace-pre-wrap text-fg-dim">
            {a.result ? a.result.slice(0, 4000) : JSON.stringify(a.input, null, 2).slice(0, 4000)}
          </pre>
        </div>
      )}
    </div>
  )
}
