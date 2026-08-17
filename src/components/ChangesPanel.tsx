import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, History, RotateCcw, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { changedIdsInFile, rollup, type Decision, type FileChange } from '../lib/review'
import { Button, Empty, Panel, Stat, StateMark } from './ui'

/**
 * The Changes workspace: a summary bar, changes grouped into logical units, and
 * the checkpoint history that makes any of it reversible.
 */
export function ChangesPanel() {
  const files = useStore((s) => s.files)
  const groups = useStore((s) => s.groups)
  const decisions = useStore((s) => s.decisions)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const decide = useStore((s) => s.decide)
  const acceptAll = useStore((s) => s.acceptAll)
  const rejectAll = useStore((s) => s.rejectAll)
  const refreshChanges = useStore((s) => s.refreshChanges)
  const [showHistory, setShowHistory] = useState(false)

  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])

  const totals = useMemo(() => {
    let add = 0
    let del = 0
    let pending = 0
    let accepted = 0
    let rejected = 0
    for (const f of files) {
      add += f.additions
      del += f.deletions
      const s = rollup(changedIdsInFile(f), decisions)
      if (s === 'accepted') accepted++
      else if (s === 'rejected') rejected++
      else pending++
    }
    return { add, del, pending, accepted, rejected }
  }, [files, decisions])

  if (!files.length) {
    return (
      <Panel
        title="Changes"
        actions={
          <Button compact variant="ghost" onClick={() => void refreshChanges()}>
            Refresh
          </Button>
        }
      >
        <Empty
          title="Nothing to review"
          hint="Changes made by Claude Code since the last checkpoint appear here, grouped by what they do."
        />
      </Panel>
    )
  }

  return (
    <Panel
      title="Changes"
      actions={
        <>
          <Button
            compact
            variant="ghost"
            onClick={() => setShowHistory((v) => !v)}
            title="Checkpoint history"
            aria-pressed={showHistory}
          >
            <History size={12} />
          </Button>
          <Button compact variant="ghost" onClick={() => void refreshChanges()}>
            Refresh
          </Button>
        </>
      }
    >
      <div className="hairline sticky top-0 z-10 bg-panel px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="tnum text-sm font-semibold text-fg">{files.length}</span>
          <span className="text-xs text-fg-muted">
            file{files.length > 1 ? 's' : ''} changed
          </span>
          <span className="ml-auto">
            <Stat add={totals.add} del={totals.del} />
          </span>
        </div>

        <div className="tnum mt-2 flex items-center gap-3 text-[11px]">
          <Meter label="pending" n={totals.pending} tone="text-pending" />
          <Meter label="accepted" n={totals.accepted} tone="text-add" />
          <Meter label="reverted" n={totals.rejected} tone="text-del" />
        </div>

        <div className="mt-2.5 flex gap-1.5">
          <Button variant="accept" compact className="flex-1 justify-center" onClick={() => void acceptAll()}>
            <Check size={12} /> Accept all
          </Button>
          <Button variant="reject" compact className="flex-1 justify-center" onClick={() => void rejectAll()}>
            <X size={12} /> Reject all
          </Button>
        </div>
      </div>

      {showHistory && <CheckpointList />}

      <div className="pb-4">
        {groups.map((g) => {
          const groupFilesList = g.files.map((p) => byPath.get(p)!).filter(Boolean)
          return (
            <GroupBlock
              key={g.name}
              name={g.name}
              files={groupFilesList}
              decisions={decisions}
              selected={selected}
              onSelect={select}
              onDecide={decide}
            />
          )
        })}
      </div>
    </Panel>
  )
}

function Meter({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <span className={clsx('flex items-center gap-1', n ? tone : 'text-fg-dim')}>
      <span className="font-semibold">{n}</span>
      <span className="text-fg-dim">{label}</span>
    </span>
  )
}

function GroupBlock({
  name,
  files,
  decisions,
  selected,
  onSelect,
  onDecide,
}: {
  name: string
  files: FileChange[]
  decisions: Map<string, Decision>
  selected: string | null
  onSelect: (p: string) => void
  onDecide: (ids: string[], d: Decision) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  const ids = files.flatMap(changedIdsInFile)
  const state = rollup(ids, decisions)
  const add = files.reduce((n, f) => n + f.additions, 0)
  const del = files.reduce((n, f) => n + f.deletions, 0)

  return (
    <section className="mt-2">
      <div className="group/g flex h-7 items-center gap-1.5 px-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="anim flex min-w-0 flex-1 items-center gap-1.5 text-fg-muted hover:text-fg"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <StateMark state={state} />
          <span className="truncate text-xs font-semibold">{name}</span>
          <span className="tnum text-[11px] text-fg-dim">{files.length}</span>
        </button>
        <Stat add={add} del={del} />
        <div className="flex items-center gap-0.5 opacity-0 anim group-hover/g:opacity-100 focus-within:opacity-100">
          <Button
            compact
            variant="accept"
            title={`Accept everything in ${name}`}
            onClick={() => void onDecide(ids, 'accepted')}
          >
            <Check size={11} />
          </Button>
          <Button
            compact
            variant="reject"
            title={`Reject everything in ${name}`}
            onClick={() => void onDecide(ids, 'rejected')}
          >
            <X size={11} />
          </Button>
        </div>
      </div>

      {open &&
        files.map((f) => {
          const fIds = changedIdsInFile(f)
          const fState = rollup(fIds, decisions)
          const isSel = selected === f.path
          return (
            <div
              key={f.path}
              className={clsx(
                'group/f anim flex h-7 items-center gap-1.5 pr-2 pl-6',
                isSel ? 'bg-raised' : 'hover:bg-elevated',
              )}
            >
              <StateMark state={fState} />
              <button
                onClick={() => onSelect(f.path)}
                className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-fg-muted group-hover/f:text-fg"
                title={f.path}
              >
                {f.path.split('/').pop()}
                <span className="ml-1.5 text-fg-dim">{f.path.split('/').slice(0, -1).join('/')}</span>
              </button>
              <Stat add={f.additions} del={f.deletions} />
              <div className="flex items-center gap-0.5 opacity-0 anim group-hover/f:opacity-100 focus-within:opacity-100">
                <Button compact variant="accept" title="Accept file" onClick={() => void onDecide(fIds, 'accepted')}>
                  <Check size={11} />
                </Button>
                <Button compact variant="reject" title="Reject file" onClick={() => void onDecide(fIds, 'rejected')}>
                  <X size={11} />
                </Button>
              </div>
            </div>
          )
        })}
    </section>
  )
}

function CheckpointList() {
  const checkpoints = useStore((s) => s.checkpoints)
  const restore = useStore((s) => s.restore)
  const baseTree = useStore((s) => s.baseTree)
  const setBase = useStore((s) => s.set)
  const refresh = useStore((s) => s.refreshChanges)

  return (
    <div className="border-y border-border bg-elevated/60 py-1">
      <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-dim">
        Checkpoints
      </p>
      {!checkpoints.length && <p className="px-3 pb-2 text-[11px] text-fg-dim">None yet.</p>}
      {checkpoints.map((c) => (
        <div key={c.tree + c.at} className="group/c flex h-7 items-center gap-2 px-3">
          <span
            className={clsx(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              baseTree === c.tree ? 'bg-accent' : 'bg-fg-dim/40',
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted" title={c.label}>
            {c.label}
          </span>
          <span className="tnum shrink-0 text-[10px] text-fg-dim">
            {new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <div className="flex gap-0.5 opacity-0 anim group-hover/c:opacity-100 focus-within:opacity-100">
            <Button
              compact
              variant="ghost"
              title="Diff against this checkpoint"
              onClick={() => {
                setBase('baseTree', c.tree)
                void refresh()
              }}
            >
              Diff
            </Button>
            <Button
              compact
              variant="reject"
              title="Restore every file to this point"
              onClick={() => void restore(c.tree)}
            >
              <RotateCcw size={11} /> Restore
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
