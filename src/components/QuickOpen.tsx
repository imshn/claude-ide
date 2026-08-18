import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CornerDownLeft, FileCode2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { rank } from '../lib/mentions'

/** ⌘P — jump to a file by fuzzy name, VS Code's most-used shortcut. */
export function QuickOpen({ onClose }: { onClose: () => void }) {
  const fileIndex = useStore((s) => s.fileIndex)
  const openFile = useStore((s) => s.openFile)
  const root = useStore((s) => s.root)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(
    () => rank(fileIndex, query, (f) => f, 60),
    [fileIndex, query],
  )

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (rel: string) => {
    if (root) void openFile(`${root}/${rel}`)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Go to file"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(620px,92vw)] overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl shadow-black/60"
      >
        <input
          autoFocus
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => (i + 1) % Math.max(matches.length, 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => (i - 1 + matches.length) % Math.max(matches.length, 1))
            } else if (e.key === 'Enter' && matches[index]) {
              e.preventDefault()
              choose(matches[index])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="Go to file…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-dim"
        />

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {!matches.length && (
            <p className="px-4 py-3 text-xs text-fg-dim">
              {fileIndex.length ? 'No matching file.' : 'No folder open.'}
            </p>
          )}
          {matches.map((rel, i) => {
            const name = rel.split('/').pop()
            const dir = rel.split('/').slice(0, -1).join('/')
            return (
              <button
                key={rel}
                data-i={i}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(rel)}
                className={clsx(
                  'flex w-full items-baseline gap-2 px-4 py-1.5 text-left',
                  i === index ? 'bg-raised' : 'hover:bg-raised/60',
                )}
              >
                <FileCode2 size={12} className="shrink-0 translate-y-0.5 text-fg-dim" />
                <span className="shrink-0 font-mono text-[12.5px] text-fg">{name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim">{dir}</span>
                {i === index && <CornerDownLeft size={11} className="shrink-0 text-fg-dim" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
