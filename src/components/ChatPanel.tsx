import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, ChevronDown, FileText, Sparkles } from 'lucide-react'
import { useStore, type ChatItem } from '../lib/store'
import type { Activity } from '../lib/activity'
import { compactTokens, EFFORTS, MODELS } from '../lib/session'
import { renderMarkdown } from '../lib/markdown'
import { ActivityRow } from './ActivityFeed'
import { Composer } from './Composer'
import { ApprovalCard } from './ApprovalCard'
import { Empty, Panel } from './ui'

const SUGGESTIONS = [
  'Explain the structure of this repository.',
  'Find and fix the bug in the current file.',
  'Run the tests and report what fails.',
]

type Entry = { at: number } & ({ t: 'chat'; item: ChatItem } | { t: 'act'; item: Activity })

export function ChatPanel() {
  const { chat, activity, streaming, root, detection, plans, approvals } = useStore()
  const prompt = useStore((s) => s.prompt)
  const openPlan = useStore((s) => s.openPlan)
  const scroller = useRef<HTMLDivElement>(null)

  const timeline = useMemo<Entry[]>(
    () =>
      [
        ...chat.map((item) => ({ at: item.at, t: 'chat' as const, item })),
        ...activity.map((item) => ({ at: item.at, t: 'act' as const, item })),
      ].sort((a, b) => a.at - b.at),
    [chat, activity],
  )

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [timeline.length, streaming, approvals.length])

  const pendingPlan = plans.find((p) => !p.approved)

  return (
    <Panel
      title="Claude Code"
      className="border-l border-border"
      scroll={false}
      actions={
        <>
          <EffortPicker />
          <ModelPicker />
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {!timeline.length && (
            <div className="pt-6">
              <Empty
                icon={<Sparkles size={20} />}
                title={root ? 'Ask Claude to work in this repo' : 'Open a folder first'}
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
                      onClick={() => void prompt(s)}
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
            e.t === 'act' ? <ActivityRow key={e.item.id + i} a={e.item} /> : <Message key={i} item={e.item} />,
          )}

          {pendingPlan && (
            <button
              onClick={() => openPlan(pendingPlan.id)}
              className="anim flex w-full items-center gap-2 rounded-lg border border-accent/35 bg-accent-soft/30 px-2.5 py-2 text-left hover:border-accent/60"
            >
              <FileText size={13} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium text-fg">
                  {pendingPlan.title}
                </span>
                <span className="block text-[10.5px] text-fg-dim">
                  Open the plan to review, comment and approve
                </span>
              </span>
            </button>
          )}

          {approvals.map((a) => (
            <ApprovalCard key={a.id} request={a} />
          ))}

          {streaming && (
            <div className="px-0.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg">
              {streaming}
              <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" />
            </div>
          )}
        </div>

        <UsageBar />
        <Composer />
      </div>
    </Panel>
  )
}

function EffortPicker() {
  const effort = useStore((s) => s.effort)
  const setEffort = useStore((s) => s.setEffort)
  const current = EFFORTS.find((e) => e.id === effort) ?? EFFORTS[0]

  return (
    <div className="relative">
      <select
        value={effort}
        onChange={(e) => void setEffort(e.target.value)}
        title={`Reasoning effort — ${current.hint}`}
        aria-label="Effort"
        className="anim cursor-pointer appearance-none rounded-md border border-border bg-transparent py-0.5 pr-5 pl-1.5 text-[11px] text-fg-muted outline-none hover:border-fg-dim hover:text-fg"
      >
        {EFFORTS.map((e) => (
          <option key={e.id} value={e.id} className="bg-elevated">
            {e.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={10}
        className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-fg-dim"
      />
    </div>
  )
}

function ModelPicker() {
  const model = useStore((s) => s.model)
  const setModel = useStore((s) => s.setModel)
  const current = MODELS.find((m) => m.id === model) ?? MODELS[0]

  return (
    <div className="relative">
      <select
        value={model}
        onChange={(e) => void setModel(e.target.value)}
        title={current.hint}
        aria-label="Model"
        className="anim cursor-pointer appearance-none rounded-md border border-border bg-transparent py-0.5 pr-5 pl-1.5 text-[11px] text-fg-muted outline-none hover:border-fg-dim hover:text-fg"
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id} className="bg-elevated">
            {m.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={10}
        className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-fg-dim"
      />
    </div>
  )
}

/**
 * What this session has spent. Deliberately not framed as a quota: the CLI
 * exposes no account balance and we do not guess at one.
 */
function UsageBar() {
  const usage = useStore((s) => s.usage)
  const [open, setOpen] = useState(false)
  if (!usage.turns) return null

  const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite

  return (
    <div className="shrink-0 border-t border-border-soft bg-elevated/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="tnum flex w-full items-center gap-2 px-3 py-1 text-[10.5px] text-fg-dim anim hover:text-fg-muted"
      >
        <span>{usage.turns} turn{usage.turns > 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{compactTokens(total)} tokens</span>
        {usage.costUsd > 0 && (
          <>
            <span>·</span>
            <span>${usage.costUsd.toFixed(3)}</span>
          </>
        )}
        <span className="ml-auto">{(usage.ms / 1000).toFixed(0)}s</span>
        <ChevronDown size={10} className={clsx('anim', open && 'rotate-180')} />
      </button>
      {open && (
        <dl className="tnum grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 pb-2 text-[10.5px]">
          {[
            ['Input', usage.input],
            ['Output', usage.output],
            ['Cache read', usage.cacheRead],
            ['Cache write', usage.cacheWrite],
          ].map(([label, n]) => (
            <div key={label as string} className="flex justify-between gap-2">
              <dt className="text-fg-dim">{label}</dt>
              <dd className="text-fg-muted">{compactTokens(n as number)}</dd>
            </div>
          ))}
          <p className="col-span-2 pt-1 text-[10px] leading-snug text-fg-dim">
            This session only. Subscription limits live in Claude Code.
          </p>
        </dl>
      )}
    </div>
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
    // Claude answers in markdown; showing the raw source meant reading literal
    // asterisks and backticks all day.
    return (
      <div
        className="md md-chat px-0.5"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text ?? '') }}
      />
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
      {item.ok ? 'turn complete' : 'turn failed'} · {((item.ms ?? 0) / 1000).toFixed(1)}s
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
