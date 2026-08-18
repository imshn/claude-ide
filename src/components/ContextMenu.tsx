import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'

export interface MenuItem {
  id: string
  label?: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  run?: () => void
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/**
 * Right-click menu. Positioned at the cursor and flipped when it would run off
 * the window, so an item near the bottom edge is still reachable.
 */
export function ContextMenu({ state, onClose }: { state: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!state || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(state.x, window.innerWidth - width - 8),
      y: Math.min(state.y, window.innerHeight - height - 8),
    })
  }, [state])

  useEffect(() => {
    if (!state) return
    // Must test the target here rather than rely on stopPropagation inside the
    // menu: this listener runs in the capture phase, so React's bubble-phase
    // handler cannot cancel it. Closing unconditionally unmounted the menu
    // before the click landed, which made every item silently do nothing.
    const close = (e: MouseEvent) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const dismiss = () => onClose()
    window.addEventListener('mousedown', close, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', key)
    }
  }, [state, onClose])

  if (!state) return null

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[60] min-w-[210px] rounded-lg border border-border bg-elevated py-1 shadow-2xl shadow-black/60"
    >
      {state.items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.run?.()
            }}
            className={clsx(
              'anim flex w-full items-center gap-3 px-3 py-1 text-left text-[12px]',
              item.disabled
                ? 'cursor-default text-fg-dim/50'
                : item.danger
                  ? 'text-del hover:bg-del-bg'
                  : 'text-fg-muted hover:bg-raised hover:text-fg',
            )}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="shrink-0 text-[10.5px] text-fg-dim">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  )
}
