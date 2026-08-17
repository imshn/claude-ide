import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { FileCode2, Sparkles } from 'lucide-react'
import type { TriggerKind } from '../lib/mentions'

export interface Suggestion {
  value: string
  label: string
  hint?: string
}

/**
 * The `@file` / `/skill` list above the composer. Keyboard is the primary path —
 * ↑ ↓ to move, ⏎ or ⇥ to accept — so it stays usable without leaving the keys.
 */
export function MentionPopup({
  kind,
  items,
  index,
  onPick,
}: {
  kind: TriggerKind
  items: Suggestion[]
  index: number
  onPick: (s: Suggestion) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!items.length) return null
  const Icon = kind === 'skill' ? Sparkles : FileCode2

  return (
    <div className="absolute right-2.5 bottom-full left-2.5 z-30 mb-1 overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl shadow-black/50">
      <p className="hairline px-2.5 py-1 text-[10px] tracking-[0.08em] text-fg-dim uppercase">
        {kind === 'skill' ? 'Skills' : 'Files'}
      </p>
      <div ref={listRef} className="max-h-56 overflow-y-auto py-0.5">
        {items.map((s, i) => (
          <button
            key={s.value}
            data-i={i}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(s)
            }}
            className={clsx(
              'flex w-full items-center gap-2 px-2.5 py-1 text-left',
              i === index ? 'bg-raised' : 'hover:bg-raised/60',
            )}
          >
            <Icon size={11} className={clsx('shrink-0', kind === 'skill' ? 'text-accent' : 'text-fg-dim')} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[11.5px] text-fg">{s.label}</span>
              {s.hint && <span className="block truncate text-[10px] text-fg-dim">{s.hint}</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="hairline px-2.5 py-1 text-[10px] text-fg-dim">↑↓ move · ⏎ or ⇥ insert · esc dismiss</p>
    </div>
  )
}
