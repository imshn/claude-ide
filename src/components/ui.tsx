import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Rollup } from '../lib/review'

/* Hand-rolled rather than shadcn/ui: the surface this app needs is a button, a
   pill and a panel header. Pulling in a component library plus Radix for that
   is more dependency than code. */

type Variant = 'ghost' | 'accept' | 'reject' | 'accent' | 'outline'

const VARIANTS: Record<Variant, string> = {
  ghost: 'text-fg-muted hover:text-fg hover:bg-raised',
  outline: 'text-fg-muted border border-border hover:text-fg hover:border-fg-dim',
  accent: 'bg-accent text-on-accent hover:brightness-110 font-medium',
  accept: 'text-add hover:bg-add-bg border border-transparent hover:border-add/40',
  reject: 'text-del hover:bg-del-bg border border-transparent hover:border-del/40',
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  compact?: boolean
}

export function Button({ variant = 'ghost', compact, className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'anim inline-flex items-center gap-1.5 rounded-md whitespace-nowrap select-none',
        compact ? 'h-6 px-1.5 text-[11px]' : 'h-7 px-2.5 text-xs',
        VARIANTS[variant],
        className,
      )}
    />
  )
}

export function Panel({
  title,
  actions,
  children,
  className,
  /** Panels that scroll internally must opt out, or their own scroller sits
   *  inside this one and their pinned footers get pushed off-screen. */
  scroll = true,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  scroll?: boolean
}) {
  return (
    // h-full is load-bearing: without it the panel grows to fit its content and
    // any pinned footer (the composer, the plan gate) is pushed off-screen.
    <div className={clsx('flex h-full min-h-0 flex-col bg-panel', className)}>
      {title !== undefined && (
        <header className="hairline flex h-9 shrink-0 items-center justify-between px-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-dim">
            {title}
          </h2>
          <div className="flex items-center gap-0.5">{actions}</div>
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', scroll ? 'overflow-auto' : 'overflow-hidden')}>
        {children}
      </div>
    </div>
  )
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      {icon && <div className="text-fg-dim opacity-60">{icon}</div>}
      <p className="text-sm text-fg-muted">{title}</p>
      {hint && <p className="max-w-xs text-xs leading-relaxed text-fg-dim">{hint}</p>}
    </div>
  )
}

/** Review state indicator. Shape carries the meaning, not colour alone. */
export function StateMark({ state, className }: { state: Rollup; className?: string }) {
  const map: Record<Rollup, [string, string, string]> = {
    accepted: ['✓', 'text-add', 'Accepted'],
    rejected: ['✕', 'text-del', 'Reverted'],
    partial: ['◐', 'text-pending', 'Partly reviewed'],
    pending: ['○', 'text-fg-dim', 'Not reviewed'],
  }
  const [glyph, color, label] = map[state]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={clsx('w-3 shrink-0 text-center text-[11px] leading-none', color, className)}
    >
      {glyph}
    </span>
  )
}

export function Stat({ add, del }: { add: number; del: number }) {
  return (
    <span className="tnum shrink-0 text-[11px] tabular-nums">
      {add > 0 && <span className="text-add">+{add}</span>}
      {add > 0 && del > 0 && <span className="text-fg-dim"> </span>}
      {del > 0 && <span className="text-del">-{del}</span>}
    </span>
  )
}
