import { useState } from 'react'
import { Check, FileText, Pencil, X } from 'lucide-react'
import { useStore } from '../lib/store'
import type { Task } from '../lib/tasks'
import { Button } from './ui'

/**
 * The gate before a large change. Claude Code produces the plan natively via
 * `--permission-mode plan`; this renders it and makes approval an explicit act.
 * The plan is editable, and the edited text is what gets executed — so
 * "approve" and "approve with changes" are the same single motion.
 */
export function PlanPanel({ task }: { task: Task }) {
  const approve = useStore((s) => s.approvePlan)
  const cancel = useStore((s) => s.cancelPlan)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(task.plan?.text ?? '')

  if (!task.plan) return null
  const dirty = text !== task.plan.text

  return (
    <section className="rounded-lg border border-accent/30 bg-accent-soft/25">
      <header className="flex items-center gap-2 border-b border-accent/20 px-2.5 py-1.5">
        <FileText size={12} className="shrink-0 text-accent" />
        <h3 className="text-[11px] font-semibold tracking-wide text-accent uppercase">
          Implementation plan
        </h3>
        {task.plan.source === 'file' && task.plan.path && (
          <span className="ml-auto truncate font-mono text-[10px] text-fg-dim">
            {task.plan.path.split('/').pop()}
          </span>
        )}
      </header>

      {editing ? (
        <textarea
          autoFocus
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          className="max-h-[46vh] w-full resize-y bg-transparent px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg outline-none"
        />
      ) : (
        <pre className="max-h-[46vh] overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted">
          {text}
        </pre>
      )}

      <footer className="flex items-center gap-1.5 border-t border-accent/20 px-2.5 py-2">
        <Button variant="accent" compact onClick={() => void approve(task.id, text)}>
          <Check size={11} /> {dirty ? 'Approve edited plan' : 'Approve plan'}
        </Button>
        <Button variant="outline" compact onClick={() => setEditing((v) => !v)}>
          <Pencil size={11} /> {editing ? 'Done' : 'Modify'}
        </Button>
        <Button variant="reject" compact className="ml-auto" onClick={() => void cancel(task.id)}>
          <X size={11} /> Cancel
        </Button>
      </footer>
    </section>
  )
}
