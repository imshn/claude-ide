import clsx from 'clsx'
import { AlertTriangle, Check, ShieldQuestion, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { describeCall, familyOf, isDestructive, type ApprovalRequest } from '../lib/session'
import { Button } from './ui'

const FAMILY_LABEL: Record<string, string> = {
  edit: 'Edit files',
  run: 'Run shell commands',
  network: 'Access the network',
  agent: 'Run subagents',
}

/**
 * Shown when Claude Code asks to use a tool the workspace policy gates.
 *
 * The request is a real one: a PreToolUse hook is blocking the CLI until this
 * is answered, so declining actually prevents the call rather than undoing it
 * afterwards. Unanswered requests fail closed after ten minutes.
 */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const respond = useStore((s) => s.respond)
  const family = familyOf(request.tool)
  const danger = isDestructive(request.tool, request.input)
  const detail = describeCall(request.tool, request.input)

  return (
    <section
      className={clsx(
        'rounded-lg border',
        danger ? 'border-del/40 bg-del-bg/40' : 'border-accent/35 bg-accent-soft/30',
      )}
    >
      <header className="flex items-center gap-2 px-2.5 pt-2">
        {danger ? (
          <AlertTriangle size={12} className="shrink-0 text-del" />
        ) : (
          <ShieldQuestion size={12} className="shrink-0 text-accent" />
        )}
        <h3
          className={clsx(
            'text-[11px] font-semibold tracking-wide uppercase',
            danger ? 'text-del' : 'text-accent',
          )}
        >
          {danger ? 'Destructive command' : 'Permission needed'}
        </h3>
        <span className="ml-auto font-mono text-[10px] text-fg-dim">{request.tool}</span>
      </header>

      {detail && (
        <pre className="mx-2.5 mt-1.5 max-h-32 overflow-auto rounded border border-border-soft bg-bg px-2 py-1.5 font-mono text-[10.5px] whitespace-pre-wrap text-fg">
          {detail}
        </pre>
      )}

      <div className="flex flex-wrap items-center gap-1.5 p-2.5">
        <Button variant="accept" compact onClick={() => void respond(request.id, true)}>
          <Check size={11} /> Allow once
        </Button>
        {!danger && (
          <Button
            variant="outline"
            compact
            title={`Allow "${FAMILY_LABEL[family]}" for the rest of this session`}
            onClick={() => void respond(request.id, true, true)}
          >
            Allow for session
          </Button>
        )}
        <Button
          variant="reject"
          compact
          className="ml-auto"
          onClick={() => void respond(request.id, false)}
        >
          <X size={11} /> Decline
        </Button>
      </div>
    </section>
  )
}
