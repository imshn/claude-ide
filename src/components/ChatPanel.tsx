import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, ChevronRight, CornerDownLeft, Loader2, Square, Terminal as TermIcon,
} from 'lucide-react'
import { useStore, type ChatItem } from '../lib/store'
import { Button, Empty, Panel } from './ui'

const SUGGESTIONS = [
  'Explain the structure of this repository.',
  'Find and fix the bug in the current file.',
  'Run the tests and report what fails.',
  'Refactor the selected file for clarity.',
]

export function ChatPanel() {
  const chat = useStore((s) => s.chat)
  const streaming = useStore((s) => s.streaming)
  const busy = useStore((s) => s.busy)
  const claudeUp = useStore((s) => s.claudeUp)
  const detection = useStore((s) => s.detection)
  const root = useStore((s) => s.root)
  const prompt = useStore((s) => s.prompt)
  const stopClaude = useStore((s) => s.stopClaude)
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [chat.length, streaming])

  const send = () => {
    const t = text.trim()
    if (!t || !root) return
    setText('')
    void prompt(t)
  }

  return (
    <Panel
      title="Claude Code"
      className="border-l border-border"
      actions={
        <span
          className={clsx(
            'flex items-center gap-1.5 text-[11px]',
            claudeUp ? 'text-add' : 'text-fg-dim',
          )}
        >
          <span
            className={clsx('h-1.5 w-1.5 rounded-full', claudeUp ? 'bg-add' : 'bg-fg-dim/50')}
          />
          {claudeUp ? 'connected' : detection?.found ? 'idle' : 'not found'}
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {!chat.length && (
            <div className="pt-6">
              <Empty
                title={root ? 'Ask Claude to work in this repo' : 'Open a folder first'}
                hint={
                  detection?.found
                    ? `Using ${detection.version || 'local Claude Code'}. Every turn is checkpointed before any file is touched.`
                    : 'Claude Code was not detected on this machine.'
                }
              />
              {root && detection?.found && (
                <div className="mt-4 space-y-1.5 px-3">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void prompt(s)}
                      className="anim flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-[11.5px] text-fg-muted hover:border-accent/40 hover:text-fg"
                    >
                      <ChevronRight size={11} className="shrink-0 text-fg-dim" />
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {chat.map((item, i) => (
            <Message key={i} item={item} />
          ))}

          {streaming && (
            <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg">
              {streaming}
              <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-2.5">
          <div className="rounded-lg border border-border bg-elevated focus-within:border-accent/50 anim">
            <textarea
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={3}
              disabled={!root}
              placeholder={root ? 'Build authentication…  (⏎ to send, ⇧⏎ for a new line)' : 'Open a folder to begin'}
              className="w-full resize-none bg-transparent px-2.5 py-2 text-[12.5px] text-fg outline-none placeholder:text-fg-dim disabled:opacity-50"
            />
            <div className="flex items-center gap-1.5 px-2 pb-2">
              {busy ? (
                <>
                  <Loader2 size={12} className="animate-spin text-accent" />
                  <span className="text-[11px] text-fg-muted">working…</span>
                  <Button compact variant="outline" className="ml-auto" onClick={() => void stopClaude()}>
                    <Square size={10} /> Stop
                  </Button>
                </>
              ) : (
                <Button
                  variant="accent"
                  compact
                  className="ml-auto"
                  disabled={!text.trim() || !root}
                  onClick={send}
                >
                  Send <CornerDownLeft size={11} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function Message({ item }: { item: ChatItem }) {
  if (item.kind === 'user') {
    return (
      <div className="rounded-lg border border-border bg-elevated px-2.5 py-2 text-[12.5px] whitespace-pre-wrap text-fg">
        {item.text}
      </div>
    )
  }

  if (item.kind === 'assistant') {
    return (
      <div className="px-0.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg">
        {item.text}
      </div>
    )
  }

  if (item.kind === 'tool') return <ToolRow call={item.call} />

  if (item.kind === 'notice') {
    return (
      <div
        className={clsx(
          'flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11.5px]',
          item.tone === 'error'
            ? 'border-del/30 bg-del-bg text-del'
            : 'border-border bg-elevated text-fg-muted',
        )}
      >
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap">{item.text}</span>
      </div>
    )
  }

  return (
    <div className="tnum flex items-center gap-2 py-0.5 text-[10.5px] text-fg-dim">
      <span className="h-px flex-1 bg-border" />
      {item.ok ? 'turn complete' : 'turn failed'} · {(item.ms / 1000).toFixed(1)}s
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function ToolRow({ call }: { call: { name: string; input: unknown; result?: string; isError?: boolean } }) {
  const [open, setOpen] = useState(false)
  const arg = summarise(call.input)
  return (
    <div className="rounded-md border border-border-soft bg-elevated/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="anim flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <TermIcon size={11} className={clsx('shrink-0', call.isError ? 'text-del' : 'text-accent/80')} />
        <span className="shrink-0 text-[11px] font-medium text-fg-muted">{call.name}</span>
        {arg && <span className="truncate font-mono text-[10.5px] text-fg-dim">{arg}</span>}
        <ChevronRight
          size={11}
          className={clsx('ml-auto shrink-0 text-fg-dim anim', open && 'rotate-90')}
        />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-border-soft px-2.5 py-2 font-mono text-[10.5px] whitespace-pre-wrap text-fg-muted">
          {JSON.stringify(call.input, null, 2)}
          {call.result ? `\n\n→ ${call.result.slice(0, 4000)}` : ''}
        </pre>
      )}
    </div>
  )
}

function summarise(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  for (const k of ['file_path', 'path', 'command', 'pattern', 'description']) {
    if (typeof o[k] === 'string') return o[k] as string
  }
  return ''
}
