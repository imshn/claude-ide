import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CornerDownLeft, Layers, Loader2, Plus, Square } from 'lucide-react'
import { useActiveTask, useStore, type ChatItem } from '../lib/store'
import type { Activity } from '../lib/activity'
import { STATUS_LABEL } from '../lib/tasks'
import { ActivityRow } from './ActivityFeed'
import { PlanPanel } from './PlanPanel'
import { Button, Empty, Panel } from './ui'

const SUGGESTIONS = [
  'Explain the structure of this repository.',
  'Find and fix the bug in the current file.',
  'Run the tests and report what fails.',
]

type Entry = { at: number } & ({ t: 'chat'; item: ChatItem } | { t: 'act'; item: Activity })

export function ChatPanel() {
  const task = useActiveTask()
  const root = useStore((s) => s.root)
  const detection = useStore((s) => s.detection)
  const newTask = useStore((s) => s.newTask)
  const sendToActive = useStore((s) => s.sendToActive)
  const stopTask = useStore((s) => s.stopTask)
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  const live = !!task.id

  // One timeline: conversation and tool activity merged by time.
  const timeline = useMemo<Entry[]>(() => {
    const entries: Entry[] = [
      ...task.chat.map((item) => ({ at: item.at, t: 'chat' as const, item })),
      ...task.activity.map((item) => ({ at: item.at, t: 'act' as const, item })),
    ]
    return entries.sort((a, b) => a.at - b.at)
  }, [task.chat, task.activity])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [timeline.length, task.streaming])

  const submit = () => {
    const t = text.trim()
    if (!t || !root) return
    setText('')
    // A new request starts a task; follow-ups continue the open one.
    if (!live || task.status === 'completed') void newTask(t)
    else void sendToActive(t)
  }

  return (
    <Panel
      title={live ? task.title : 'Claude Code'}
      className="border-l border-border"
      scroll={false}
      actions={
        live ? (
          <>
            <span
              className={clsx(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                task.busy ? 'bg-accent-soft text-accent'
                : task.status === 'review' ? 'bg-pending/15 text-pending'
                : task.status === 'failed' ? 'bg-del-bg text-del'
                : 'text-fg-dim',
              )}
            >
              {STATUS_LABEL[task.status]}
            </span>
            <Button compact variant="ghost" onClick={() => setText('')} title="New task (⌘⇧N)">
              <Plus size={12} />
            </Button>
          </>
        ) : (
          <span
            className={clsx(
              'flex items-center gap-1.5 text-[11px]',
              detection?.found ? 'text-fg-dim' : 'text-del',
            )}
          >
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full',
                detection?.found ? 'bg-fg-dim/50' : 'bg-del',
              )}
            />
            {detection?.found ? 'idle' : 'not found'}
          </span>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {!live && (
            <div className="pt-6">
              <Empty
                icon={<Layers size={20} />}
                title={root ? 'Start a task' : 'Open a folder first'}
                hint={
                  detection?.found
                    ? 'Large requests get a plan you approve first. Every turn is checkpointed before any file is touched.'
                    : 'Claude Code was not detected on this machine.'
                }
              />
              {root && detection?.found && (
                <div className="mt-4 space-y-1.5 px-3">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void newTask(s)}
                      className="anim w-full rounded-md border border-border px-2.5 py-1.5 text-left text-[11.5px] text-fg-muted hover:border-accent/40 hover:text-fg"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {timeline.map((e, i) =>
            e.t === 'act' ? (
              <ActivityRow key={e.item.id + i} a={e.item} />
            ) : (
              <Message key={i} item={e.item} />
            ),
          )}

          {task.status === 'plan-ready' && <PlanPanel task={task} />}

          {task.streaming && (
            <div className="px-0.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg">
              {task.streaming}
              <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-2.5">
          <div className="anim rounded-lg border border-border bg-elevated focus-within:border-accent/50">
            <textarea
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={3}
              disabled={!root}
              placeholder={
                !root ? 'Open a folder to begin'
                : live && task.status !== 'completed' ? 'Reply in this task…'
                : 'Describe a task…  (⏎ to send, ⇧⏎ for a new line)'
              }
              className="w-full resize-none bg-transparent px-2.5 py-2 text-[12.5px] text-fg outline-none placeholder:text-fg-dim disabled:opacity-50"
            />
            <div className="flex items-center gap-1.5 px-2 pb-2">
              {task.busy ? (
                <>
                  <Loader2 size={12} className="animate-spin text-accent" />
                  <span className="text-[11px] text-fg-muted">
                    {task.status === 'planning' ? 'planning…' : 'working…'}
                  </span>
                  <Button
                    compact
                    variant="outline"
                    className="ml-auto"
                    onClick={() => void stopTask(task.id)}
                  >
                    <Square size={10} /> Stop
                  </Button>
                </>
              ) : (
                <Button
                  variant="accent"
                  compact
                  className="ml-auto"
                  disabled={!text.trim() || !root}
                  onClick={submit}
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
  if (item.kind === 'notice') {
    return (
      <div
        className={clsx(
          'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px]',
          item.tone === 'error'
            ? 'border-del/30 bg-del-bg text-del'
            : 'border-border bg-elevated text-fg-muted',
        )}
      >
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
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
