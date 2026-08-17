import { useState } from 'react'
import clsx from 'clsx'
import { Check, CornerDownLeft, FileCode2, MessageSquarePlus, X } from 'lucide-react'
import { useStore } from '../lib/store'
import {
  changedIdsInFile,
  changedIdsInHunk,
  rollup,
  type Decision,
  type FileChange,
  type Hunk,
} from '../lib/review'
import { Button, Stat, StateMark } from './ui'

/**
 * Review surface for one file. Every level — line, hunk, file — offers the same
 * three actions, so the granularity you work at is a choice rather than a
 * limitation.
 */
export function DiffReview({ file }: { file: FileChange }) {
  const decisions = useStore((s) => s.decisions)
  const decide = useStore((s) => s.decide)
  const openFile = useStore((s) => s.openFile)
  const setReveal = useStore((s) => s.setReveal)
  const [asking, setAsking] = useState<string | null>(null)

  const fileIds = changedIdsInFile(file)
  const fileState = rollup(fileIds, decisions)

  const focusEditor = async (line?: number) => {
    await openFile(file.absPath)
    if (line) setReveal({ abs: file.absPath, line })
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="hairline z-10 flex h-11 shrink-0 items-center gap-2 overflow-hidden bg-panel px-3">
        <StateMark state={fileState} />
        <button
          onClick={() => void focusEditor()}
          className="anim group flex min-w-0 items-center gap-1.5 text-left"
          title="Open in editor"
        >
          <span className="truncate font-mono text-xs text-fg group-hover:text-accent">
            {file.path}
          </span>
          <FileCode2 size={11} className="shrink-0 text-fg-dim opacity-0 group-hover:opacity-100" />
        </button>
        <Stat add={file.additions} del={file.deletions} />
        <div className="ml-auto flex items-center gap-1">
          <Button compact variant="accept" onClick={() => void decide(fileIds, 'accepted')}>
            <Check size={12} /> Accept file
          </Button>
          <Button compact variant="reject" onClick={() => void decide(fileIds, 'rejected')}>
            <X size={12} /> Reject file
          </Button>
          <Button
            compact
            variant="outline"
            onClick={() => setAsking(asking === 'file' ? null : 'file')}
            title="Accept with an instruction back to Claude"
          >
            <MessageSquarePlus size={12} /> Edit
          </Button>
        </div>
      </header>

      {asking === 'file' && (
        <AskClaude
          scope={`the changes in ${file.path}`}
          ids={fileIds}
          onDone={() => setAsking(null)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto font-mono text-[12px] leading-[19px]">
        {file.hunks.map((hunk) => (
          <HunkBlock
            key={hunk.id}
            file={file}
            hunk={hunk}
            decisions={decisions}
            onDecide={decide}
            onFocus={focusEditor}
            asking={asking}
            setAsking={setAsking}
          />
        ))}
        {!file.hunks.length && (
          <p className="p-6 text-center text-xs text-fg-dim">No textual changes.</p>
        )}
      </div>
    </div>
  )
}

function HunkBlock({
  file,
  hunk,
  decisions,
  onDecide,
  onFocus,
  asking,
  setAsking,
}: {
  file: FileChange
  hunk: Hunk
  decisions: Map<string, Decision>
  onDecide: (ids: string[], d: Decision) => Promise<void>
  onFocus: (line?: number) => void
  asking: string | null
  setAsking: (v: string | null) => void
}) {
  const ids = changedIdsInHunk(file, hunk)
  const state = rollup(ids, decisions)

  return (
    <section className="border-b border-border-soft last:border-0">
      <div className="group/hunk sticky top-0 z-[5] flex h-7 items-center gap-2 bg-elevated/95 px-3 backdrop-blur">
        <StateMark state={state} />
        <span className="text-[11px] text-fg-dim">{hunk.header}</span>
        <span className="tnum text-[11px] text-fg-dim">
          {hunk.changed.length} line{hunk.changed.length > 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 anim group-hover/hunk:opacity-100 focus-within:opacity-100">
          <Button compact variant="accept" onClick={() => void onDecide(ids, 'accepted')}>
            <Check size={11} /> Hunk
          </Button>
          <Button compact variant="reject" onClick={() => void onDecide(ids, 'rejected')}>
            <X size={11} /> Hunk
          </Button>
          <Button
            compact
            variant="ghost"
            title="Send an instruction about this hunk"
            onClick={() => setAsking(asking === hunk.id ? null : hunk.id)}
          >
            <MessageSquarePlus size={11} />
          </Button>
        </div>
      </div>

      {asking === hunk.id && (
        <AskClaude
          scope={`this hunk in ${file.path}`}
          ids={ids}
          snippet={hunk.changed
            .map((i) => `${file.lines[i].op === 'add' ? '+' : '-'}${file.lines[i].text}`)
            .join('\n')}
          onDone={() => setAsking(null)}
        />
      )}

      <div>
        {file.lines.slice(hunk.from, hunk.to + 1).map((line, i) => {
          const idx = hunk.from + i
          const d = decisions.get(line.id) ?? 'pending'
          const changed = line.op !== 'ctx'
          return (
            <div
              key={line.id}
              className={clsx(
                'group/line anim flex items-stretch',
                line.op === 'add' && 'bg-add-bg',
                line.op === 'del' && 'bg-del-bg',
                changed && d === 'rejected' && 'opacity-40',
                changed && d === 'accepted' && 'ring-inset',
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  'w-[3px] shrink-0',
                  changed && d === 'accepted' && 'bg-add',
                  changed && d === 'rejected' && 'bg-del',
                  changed && d === 'pending' && 'bg-pending/50',
                )}
              />
              <button
                onClick={() => onFocus(line.curNo ?? line.baseNo)}
                title="Reveal in editor"
                className="tnum flex shrink-0 select-none gap-2 px-2 text-right text-[11px] text-fg-dim hover:text-fg-muted"
              >
                <span className="w-9">{line.baseNo ?? ''}</span>
                <span className="w-9">{line.curNo ?? ''}</span>
              </button>
              <span
                aria-hidden
                className={clsx(
                  'w-3 shrink-0 select-none text-center',
                  line.op === 'add' && 'text-add',
                  line.op === 'del' && 'text-del',
                  line.op === 'ctx' && 'text-fg-dim',
                )}
              >
                {line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' '}
              </span>
              {/* Wrap rather than scroll: a per-line horizontal scrollbar in a
                  review surface is unusable, and it pushed the row actions off-pane. */}
              <pre className="min-w-0 flex-1 px-1 break-words whitespace-pre-wrap text-fg">
                {line.text || ' '}
              </pre>

              {changed && (
                <div className="flex shrink-0 items-start gap-0.5 self-start pt-px pr-2 pl-1 opacity-0 anim group-hover/line:opacity-100 focus-within:opacity-100">
                  <StateMark state={d} />
                  <Button
                    compact
                    variant="accept"
                    aria-label={`Accept line ${idx + 1}`}
                    onClick={() => void onDecide([line.id], 'accepted')}
                  >
                    <Check size={11} />
                  </Button>
                  <Button
                    compact
                    variant="reject"
                    aria-label={`Reject line ${idx + 1}`}
                    onClick={() => void onDecide([line.id], 'rejected')}
                  >
                    <X size={11} />
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * "Accept this change but rename the variable" — marks the change accepted and
 * sends the follow-up instruction to the running Claude Code session, with the
 * relevant diff quoted so it knows exactly what you mean.
 */
function AskClaude({
  scope,
  ids,
  snippet,
  onDone,
}: {
  scope: string
  ids: string[]
  snippet?: string
  onDone: () => void
}) {
  const [text, setText] = useState('')
  const prompt = useStore((s) => s.prompt)
  const decide = useStore((s) => s.decide)

  const submit = async () => {
    if (!text.trim()) return
    await decide(ids, 'accepted')
    const body = [
      `Keep ${scope}, with this adjustment: ${text.trim()}`,
      snippet ? `\nThe change in question:\n\`\`\`diff\n${snippet}\n\`\`\`` : '',
    ].join('')
    onDone()
    await prompt(body)
  }

  return (
    <div className="flex items-center gap-2 border-y border-accent/25 bg-accent-soft/40 px-3 py-2">
      <MessageSquarePlus size={13} className="shrink-0 text-accent" />
      <input
        autoFocus
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onDone()
        }}
        placeholder="Accept, but… e.g. rename the variable to sessionToken"
        className="min-w-0 flex-1 bg-transparent font-sans text-xs text-fg outline-none placeholder:text-fg-dim"
      />
      <Button compact variant="accent" onClick={() => void submit()} disabled={!text.trim()}>
        Send <CornerDownLeft size={11} />
      </Button>
      <Button compact variant="ghost" onClick={onDone} aria-label="Cancel">
        <X size={12} />
      </Button>
    </div>
  )
}
