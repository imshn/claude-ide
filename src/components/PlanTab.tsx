import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, MessageSquarePlus, Play, Trash2, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { renderMarkdown } from '../lib/markdown'
import type { PlanDoc } from '../lib/session'
import { Button } from './ui'

/**
 * A plan opened as a document rather than a chat bubble: rendered markdown you
 * can read, select and comment on, with approval as the document's own action.
 * Comments are anchored to the exact text selected, and are folded into the
 * message sent to Claude on approval.
 */
export function PlanTab({ plan }: { plan: PlanDoc }) {
  const addComment = useStore((s) => s.addComment)
  const removeComment = useStore((s) => s.removeComment)
  const approvePlan = useStore((s) => s.approvePlan)
  const discardPlan = useStore((s) => s.discardPlan)

  const bodyRef = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const [selection, setSelection] = useState<{ text: string; top: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [general, setGeneral] = useState(false)

  const html = useMemo(() => renderMarkdown(plan.markdown), [plan.markdown])

  // Offer a comment affordance whenever the user selects text in the document.
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const body = bodyRef.current
      if (!body) return
      // Only react to mouse-ups inside the document. Clicking the comment box
      // or a button collapses the browser selection, and treating that as
      // "deselected" silently dropped the anchor the user had just made.
      if (!(e.target instanceof Node) || !body.contains(e.target)) return

      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!text || !sel?.anchorNode || !body.contains(sel.anchorNode)) {
        return setSelection(null)
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      const host = body.getBoundingClientRect()
      setSelection({ text, top: rect.top - host.top + body.scrollTop })
      setGeneral(false)
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  const commit = () => {
    if (!draft.trim()) return
    addComment(plan.id, general ? '' : (selection?.text ?? ''), draft.trim())
    setDraft('')
    setSelection(null)
    setGeneral(false)
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
      <header className="hairline flex h-11 shrink-0 items-center gap-2 px-4">
        <span
          className={clsx(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            plan.approved ? 'bg-add-bg text-add' : 'bg-accent-soft text-accent',
          )}
        >
          {plan.approved ? 'Approved' : 'Awaiting approval'}
        </span>
        <h1 className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{plan.title}</h1>
        {plan.path && (
          <span className="shrink-0 truncate font-mono text-[10px] text-fg-dim">
            {plan.path.split('/').pop()}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={bodyRef} className="relative min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <article className="md mx-auto max-w-[70ch]" dangerouslySetInnerHTML={{ __html: html }} />

          {selection && !plan.approved && (
            <div
              style={{ top: Math.max(0, selection.top - 34) }}
              className="absolute right-4 z-10"
            >
              <Button
                variant="accent"
                compact
                onClick={() => {
                  setGeneral(false)
                  composer.current?.focus()
                }}
              >
                <MessageSquarePlus size={11} /> Comment on selection
              </Button>
            </div>
          )}
        </div>

        <aside className="flex w-[280px] shrink-0 flex-col border-l border-border">
          <p className="hairline flex h-9 shrink-0 items-center px-3 text-[11px] font-semibold tracking-[0.08em] text-fg-dim uppercase">
            Comments
            {plan.comments.length > 0 && (
              <span className="tnum ml-auto text-fg-muted">{plan.comments.length}</span>
            )}
          </p>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            {!plan.comments.length && (
              <p className="px-1 text-[11px] leading-relaxed text-fg-dim">
                Select any part of the plan to comment on it, or add a general note below.
                Comments are sent to Claude with the approval and override the plan where
                they conflict.
              </p>
            )}
            {plan.comments.map((c) => (
              <div key={c.id} className="group/c rounded-md border border-border bg-elevated p-2">
                {c.quote ? (
                  <p className="mb-1 border-l-2 border-accent/50 pl-1.5 font-mono text-[10px] leading-snug text-fg-dim">
                    {c.quote.slice(0, 140)}
                    {c.quote.length > 140 && '…'}
                  </p>
                ) : (
                  <p className="mb-1 text-[10px] text-fg-dim">General</p>
                )}
                <p className="text-[11.5px] leading-snug text-fg">{c.body}</p>
                <button
                  onClick={() => removeComment(plan.id, c.id)}
                  className="anim mt-1 text-[10px] text-fg-dim opacity-0 hover:text-del group-hover/c:opacity-100"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {!plan.approved && (
            <div className="shrink-0 border-t border-border p-2.5">
              {selection && !general && (
                <p className="mb-1.5 border-l-2 border-accent/50 pl-1.5 font-mono text-[10px] leading-snug text-fg-dim">
                  {selection.text.slice(0, 120)}
                  {selection.text.length > 120 && '…'}
                </p>
              )}
              <textarea
                ref={composer}
                value={draft}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
                }}
                rows={3}
                placeholder={
                  selection && !general ? 'Comment on the selection…' : 'General comment…'
                }
                className="anim w-full resize-none rounded-md border border-border bg-elevated px-2 py-1.5 text-[11.5px] text-fg outline-none placeholder:text-fg-dim focus:border-accent/50"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button compact variant="outline" onClick={commit} disabled={!draft.trim()}>
                  Add comment
                </Button>
                {selection && (
                  <Button
                    compact
                    variant="ghost"
                    onClick={() => {
                      setSelection(null)
                      setGeneral(true)
                    }}
                  >
                    <X size={10} /> Unpin
                  </Button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-4">
        {plan.approved ? (
          <p className="text-[11px] text-fg-muted">
            Approved — changes will appear in the Changes workspace for review.
          </p>
        ) : (
          <>
            <Button variant="accent" onClick={() => void approvePlan(plan.id)}>
              <Play size={12} />
              {plan.comments.length
                ? `Approve with ${plan.comments.length} comment${plan.comments.length > 1 ? 's' : ''}`
                : 'Approve and implement'}
            </Button>
            <Button variant="outline" onClick={() => setGeneral(true)}>
              <MessageSquarePlus size={12} /> Comment
            </Button>
            <Button variant="reject" className="ml-auto" onClick={() => discardPlan(plan.id)}>
              <Trash2 size={12} /> Discard
            </Button>
          </>
        )}
        {plan.approved && (
          <Button variant="ghost" className="ml-auto" onClick={() => discardPlan(plan.id)}>
            <Check size={12} /> Close
          </Button>
        )}
      </footer>
    </div>
  )
}
