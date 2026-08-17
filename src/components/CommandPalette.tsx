import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../lib/store'

export interface Command {
  id: string
  label: string
  hint?: string
  keys?: string
  run: () => void
}

/** Subsequence match, the same forgiving behaviour editors use for "gto" → "Go To". */
function score(query: string, text: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let hits = 0
  let streak = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      qi++
      streak++
      hits += streak
    } else streak = 0
  }
  return qi === q.length ? hits / t.length : 0
}

export function CommandPalette({ commands }: { commands: Command[] }) {
  const open = useStore((s) => s.paletteOpen)
  const set = useStore((s) => s.set)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    return commands
      .map((c) => ({ c, s: score(query, c.label + ' ' + (c.hint ?? '')) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.c)
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  useEffect(() => setCursor(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const close = () => set('paletteOpen', false)
  const pick = (c?: Command) => {
    if (!c) return
    close()
    c.run()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-[2px]"
      onMouseDown={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(560px,90vw)] overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl shadow-black/60"
      >
        <input
          autoFocus
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              pick(results[cursor])
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-dim"
        />
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
          {!results.length && (
            <p className="px-4 py-6 text-center text-xs text-fg-dim">No matching command</p>
          )}
          {results.map((c, i) => (
            <button
              key={c.id}
              data-active={i === cursor}
              onMouseMove={() => setCursor(i)}
              onClick={() => pick(c)}
              className={clsx(
                'flex w-full items-center gap-3 px-4 py-2 text-left text-xs anim',
                i === cursor ? 'bg-raised text-fg' : 'text-fg-muted',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.hint && <span className="shrink-0 text-[11px] text-fg-dim">{c.hint}</span>}
              {c.keys && (
                <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-dim">
                  {c.keys}
                </kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
