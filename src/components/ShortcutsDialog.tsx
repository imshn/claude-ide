import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { groupedBindings, prettyKeys } from '../lib/keys'
import { Button } from './ui'

/**
 * ⌘K ⌘S — the shortcut reference, read from the same table the handler uses, so
 * it cannot advertise a key that does nothing.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupedBindings(query), [query])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[84vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl shadow-black/60"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <div className="anim ml-auto flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 focus-within:border-accent/50">
            <Search size={11} className="shrink-0 text-fg-dim" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="w-44 bg-transparent py-1 text-xs text-fg outline-none placeholder:text-fg-dim"
            />
          </div>
          <Button compact variant="ghost" onClick={onClose} aria-label="Close">
            <X size={13} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!groups.length && <p className="text-xs text-fg-dim">Nothing matches “{query}”.</p>}

          {groups.map(({ group, items }) => (
            <section key={group} className="mb-5 last:mb-0">
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-dim uppercase">
                {group}
              </h3>
              <div className="overflow-hidden rounded-lg border border-border">
                {items.map((b, i) => (
                  <div
                    key={b.id}
                    className={`flex items-center gap-3 px-3 py-1.5 ${i % 2 ? 'bg-bg/40' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{b.label}</span>
                    {b.when && b.when !== 'always' && (
                      <span className="shrink-0 text-[10px] text-fg-dim">in {b.when}</span>
                    )}
                    <kbd className="shrink-0 rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] text-fg">
                      {prettyKeys(b.keys)}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="mt-4 text-[11px] leading-relaxed text-fg-dim">
            Editing and multi-cursor shortcuts are Monaco's own — the same ones VS Code uses.
            Hold ⌥ and click to drop an extra cursor, or ⌥⇧ and drag for a column selection.
          </p>
        </div>
      </div>
    </div>
  )
}
