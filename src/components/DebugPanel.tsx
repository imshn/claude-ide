import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDownToLine, ArrowRightToLine, ArrowUpFromLine, Bug, CircleDot, Play, Send, Square, Trash2,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { pathFromUrl } from '../lib/cdp'
import { Button, Empty, Panel } from './ui'

export function DebugPanel() {
  const { debug, breakpoints, root, intel } = useStore()
  const debugStart = useStore((s) => s.debugStart)
  const debugStop = useStore((s) => s.debugStop)
  const control = useStore((s) => s.debugControl)
  const selectFrame = useStore((s) => s.selectFrame)
  const evaluate = useStore((s) => s.debugEvaluate)
  const toggleBreakpoint = useStore((s) => s.toggleBreakpoint)
  const openFile = useStore((s) => s.openFile)
  const setReveal = useStore((s) => s.setReveal)
  const prompt = useStore((s) => s.prompt)

  const [program, setProgram] = useState('')
  const [watch, setWatch] = useState('')
  const [watchResult, setWatchResult] = useState('')

  // Default to the project's entry point rather than an empty box.
  useEffect(() => {
    if (!program && intel?.entry_points?.length) setProgram(intel.entry_points[0])
  }, [intel, program])

  const paused = debug.status === 'paused'
  const live = debug.status === 'running' || paused

  const bpList = Object.entries(breakpoints).flatMap(([path, lines]) =>
    lines.map((line) => ({ path, line })),
  )

  const askClaude = () => {
    const frame = debug.frames[debug.activeFrame]
    if (!frame) return
    const vars = debug.scopes
      .map((s) => `${s.name}: ${s.vars.slice(0, 12).map((v) => `${v.name}=${v.value}`).join(', ')}`)
      .join('\n')
    void prompt(
      `I am paused in the debugger at \`${pathFromUrl(frame.url)}\` line ${frame.location.lineNumber + 1}, ` +
        `in \`${frame.functionName || '(top level)'}\`.\n\nCall stack:\n` +
        debug.frames.slice(0, 8).map((f) => `- ${f.functionName || '(anonymous)'} at ${pathFromUrl(f.url)}:${f.location.lineNumber + 1}`).join('\n') +
        `\n\nVariables in scope:\n${vars}\n\nExplain what is happening here and what looks wrong.`,
    )
  }

  return (
    <Panel
      title="Debug"
      actions={
        live ? (
          <Button compact variant="reject" onClick={() => void debugStop()}>
            <Square size={11} /> Stop
          </Button>
        ) : (
          <Button compact variant="accent" disabled={!root || !program} onClick={() => void debugStart(program)}>
            <Play size={11} /> Start
          </Button>
        )
      }
    >
      {!root ? (
        <Empty title="No folder open" />
      ) : (
        <div className="pb-4">
          <div className="border-b border-border p-2.5">
            <label className="mb-1 block text-[10px] tracking-[0.08em] text-fg-dim uppercase">
              Program
            </label>
            <input
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              spellCheck={false}
              placeholder="src/index.js"
              className="anim w-full rounded-md border border-border bg-elevated px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none focus:border-accent/50"
            />
            <p className="mt-1 text-[10px] text-fg-dim">
              Runs under Node with the inspector attached. Breakpoints are set before the first line.
            </p>
            {debug.error && <p className="mt-1.5 text-[10.5px] text-del">{debug.error}</p>}
          </div>

          {live && (
            <div className="flex items-center gap-1 border-b border-border px-2.5 py-2">
              <Button compact variant="accent" disabled={!paused} onClick={() => void control('resume')} title="Continue (F5)">
                <Play size={11} />
              </Button>
              <Button compact variant="outline" disabled={!paused} onClick={() => void control('stepOver')} title="Step over (F10)">
                <ArrowRightToLine size={11} />
              </Button>
              <Button compact variant="outline" disabled={!paused} onClick={() => void control('stepInto')} title="Step into (F11)">
                <ArrowDownToLine size={11} />
              </Button>
              <Button compact variant="outline" disabled={!paused} onClick={() => void control('stepOut')} title="Step out (⇧F11)">
                <ArrowUpFromLine size={11} />
              </Button>
              <span
                className={clsx(
                  'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  paused ? 'bg-pending/15 text-pending' : 'bg-add-bg text-add',
                )}
              >
                {paused ? 'paused' : 'running'}
              </span>
            </div>
          )}

          {paused && (
            <>
              <Section title="Call stack">
                {debug.frames.map((f, i) => (
                  <button
                    key={f.callFrameId}
                    onClick={() => void selectFrame(i)}
                    className={clsx(
                      'anim flex w-full items-baseline gap-2 px-3 py-1 text-left',
                      i === debug.activeFrame ? 'bg-raised' : 'hover:bg-elevated',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">
                      {f.functionName || '(anonymous)'}
                    </span>
                    <span className="tnum shrink-0 text-[10px] text-fg-dim">
                      {pathFromUrl(f.url).split('/').pop()}:{f.location.lineNumber + 1}
                    </span>
                  </button>
                ))}
              </Section>

              <Section title="Variables">
                {debug.scopes.map((scope) => (
                  <div key={scope.name}>
                    <p className="px-3 py-0.5 text-[10px] tracking-wide text-fg-dim uppercase">{scope.name}</p>
                    {scope.vars.map((v) => (
                      <div key={v.name} className="flex items-baseline gap-2 px-3 py-0.5">
                        <span className="shrink-0 font-mono text-[11px] text-accent">{v.name}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-muted" title={v.value}>
                          {v.value}
                        </span>
                      </div>
                    ))}
                    {!scope.vars.length && <p className="px-3 py-0.5 text-[10.5px] text-fg-dim">empty</p>}
                  </div>
                ))}
              </Section>

              <Section title="Evaluate">
                <div className="flex gap-1 px-2.5 py-1">
                  <input
                    value={watch}
                    onChange={(e) => setWatch(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && watch.trim()) setWatchResult(await evaluate(watch))
                    }}
                    spellCheck={false}
                    placeholder="expression…"
                    className="anim min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                  />
                  <Button compact variant="outline" onClick={async () => setWatchResult(await evaluate(watch))}>
                    <Send size={10} />
                  </Button>
                </div>
                {watchResult && (
                  <pre className="mx-2.5 mb-1 overflow-x-auto rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg-muted">
                    {watchResult}
                  </pre>
                )}
              </Section>

              <div className="px-2.5 py-2">
                <Button variant="outline" className="w-full justify-center" onClick={askClaude}>
                  <Bug size={11} /> Ask Claude about this state
                </Button>
              </div>
            </>
          )}

          <Section title="Breakpoints" count={bpList.length}>
            {!bpList.length && (
              <p className="px-3 py-1 text-[10.5px] text-fg-dim">
                Click a line's gutter in the editor to add one.
              </p>
            )}
            {bpList.map(({ path, line }) => (
              <div key={`${path}:${line}`} className="group/b flex items-center gap-2 px-3 py-0.5">
                <CircleDot size={9} className="shrink-0 text-del" />
                <button
                  onClick={async () => {
                    if (!root) return
                    await openFile(`${root}/${path}`)
                    setReveal({ abs: `${root}/${path}`, line })
                  }}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-fg-muted hover:text-fg"
                >
                  {path}
                </button>
                <span className="tnum shrink-0 text-[10px] text-fg-dim">{line}</span>
                <button
                  onClick={() => toggleBreakpoint(path, line)}
                  aria-label="Remove breakpoint"
                  className="anim text-fg-dim opacity-0 hover:text-del group-hover/b:opacity-100"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </Section>

          {debug.output.length > 0 && (
            <Section title="Output">
              <pre className="max-h-48 overflow-auto px-3 py-1 font-mono text-[10.5px] whitespace-pre-wrap">
                {debug.output.map((o, i) => (
                  <span key={i} className={o.stream === 'stderr' ? 'text-del' : 'text-fg-muted'}>
                    {o.line}
                    {'\n'}
                  </span>
                ))}
              </pre>
            </Section>
          )}
        </div>
      )}
    </Panel>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-1">
      <p className="flex items-center px-3 py-1 text-[11px] font-semibold tracking-wide text-fg-dim uppercase">
        {title}
        {count !== undefined && <span className="tnum ml-auto text-fg-muted">{count}</span>}
      </p>
      {children}
    </section>
  )
}
