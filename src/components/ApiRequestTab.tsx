import { useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Loader2, Plus, Send, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { interpolate, type ApiRequest } from '../lib/postman'
import { Button } from './ui'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const statusTone = (s: number) =>
  s === 0 ? 'text-del' : s < 300 ? 'text-add' : s < 400 ? 'text-pending' : 'text-del'

export function ApiRequestTab({ id }: { id: string }) {
  const req = useStore((s) => s.requests[id])
  const res = useStore((s) => s.responses[id])
  const sending = useStore((s) => s.sendingApi === id)
  const vars = useStore((s) => s.apiVars)
  const update = useStore((s) => s.updateRequest)
  const send = useStore((s) => s.sendRequest)
  const [tab, setTab] = useState<'headers' | 'body'>('headers')
  const [resTab, setResTab] = useState<'body' | 'headers'>('body')

  if (!req) return null
  const patch = (p: Partial<ApiRequest>) => update(id, p)
  const resolved = interpolate(req.url, vars)
  const unresolved = resolved.match(/\{\{[^}]+\}\}/g)

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="hairline flex h-11 shrink-0 items-center gap-2 px-3">
        <input
          value={req.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-fg outline-none"
          aria-label="Request name"
        />
        {req.notes && (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-pending" title={req.notes}>
            <AlertTriangle size={10} /> scripts not run
          </span>
        )}
      </header>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2.5">
        <select
          value={req.method}
          onChange={(e) => patch({ method: e.target.value })}
          aria-label="Method"
          className="anim shrink-0 cursor-pointer rounded-md border border-border bg-elevated px-2 py-1.5 font-mono text-[11px] font-semibold text-fg outline-none"
        >
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          value={req.url}
          onChange={(e) => patch({ url: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && void send(id)}
          spellCheck={false}
          placeholder="https://api.example.com/v1/users  ({{vars}} supported)"
          className="anim min-w-0 flex-1 rounded-md border border-border bg-elevated px-2.5 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-fg-dim focus:border-accent/50"
        />
        <Button variant="accent" disabled={sending || !req.url.trim()} onClick={() => void send(id)}>
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
        </Button>
      </div>

      {unresolved && (
        <p className="shrink-0 border-b border-border bg-pending/10 px-3 py-1 text-[10.5px] text-pending">
          Unresolved variable {unresolved.join(', ')} — set it in the collection or import an environment.
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-1 px-2.5 pt-2">
          {(['headers', 'body'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'anim rounded px-2 py-0.5 text-[11px] capitalize',
                tab === t ? 'bg-raised text-fg' : 'text-fg-dim hover:text-fg-muted',
              )}
            >
              {t}
              {t === 'headers' && req.headers.filter((h) => h.enabled && h.key).length > 0 && (
                <span className="tnum ml-1 text-fg-dim">
                  {req.headers.filter((h) => h.enabled && h.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-[2] overflow-y-auto p-2.5">
          {tab === 'headers' ? (
            <div className="space-y-1">
              {req.headers.map((h, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    aria-label={`Enable ${h.key || 'header'}`}
                    onChange={(e) => {
                      const headers = [...req.headers]
                      headers[i] = { ...h, enabled: e.target.checked }
                      patch({ headers })
                    }}
                    className="accent-[var(--color-accent)]"
                  />
                  <input
                    value={h.key}
                    placeholder="Header"
                    spellCheck={false}
                    onChange={(e) => {
                      const headers = [...req.headers]
                      headers[i] = { ...h, key: e.target.value }
                      if (i === req.headers.length - 1 && e.target.value) {
                        headers.push({ key: '', value: '', enabled: true })
                      }
                      patch({ headers })
                    }}
                    className="w-[38%] rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                  />
                  <input
                    value={h.value}
                    placeholder="Value"
                    spellCheck={false}
                    onChange={(e) => {
                      const headers = [...req.headers]
                      headers[i] = { ...h, value: e.target.value }
                      patch({ headers })
                    }}
                    className="min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                  />
                  <Button
                    compact
                    variant="ghost"
                    aria-label="Remove header"
                    onClick={() => patch({ headers: req.headers.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={11} />
                  </Button>
                </div>
              ))}
              <Button
                compact
                variant="ghost"
                onClick={() => patch({ headers: [...req.headers, { key: '', value: '', enabled: true }] })}
              >
                <Plus size={11} /> Add header
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-1.5 flex gap-1">
                {(['none', 'json', 'text', 'form'] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => patch({ bodyType: b })}
                    className={clsx(
                      'anim rounded border px-1.5 py-0.5 text-[10.5px]',
                      req.bodyType === b
                        ? 'border-accent/40 bg-accent-soft text-accent'
                        : 'border-border text-fg-dim hover:text-fg-muted',
                    )}
                  >
                    {b}
                  </button>
                ))}
              </div>
              {req.bodyType !== 'none' && (
                <textarea
                  value={req.body}
                  spellCheck={false}
                  onChange={(e) => patch({ body: e.target.value })}
                  placeholder={req.bodyType === 'form' ? 'a=1&b=2' : '{ }'}
                  className="h-40 w-full resize-y rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-[11.5px] text-fg outline-none focus:border-accent/50"
                />
              )}
            </>
          )}
        </div>

        <div className="hairline flex shrink-0 items-center gap-2 px-3 py-1.5">
          {res ? (
            <>
              <span className={clsx('tnum font-mono text-[11px] font-semibold', statusTone(res.status))}>
                {res.status || 'ERR'} {res.statusText}
              </span>
              <span className="tnum text-[10.5px] text-fg-dim">
                {res.ms} ms · {res.size < 1024 ? `${res.size} B` : `${(res.size / 1024).toFixed(1)} KB`}
              </span>
              <div className="ml-auto flex gap-1">
                {(['body', 'headers'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setResTab(t)}
                    className={clsx(
                      'anim rounded px-1.5 py-0.5 text-[10.5px] capitalize',
                      resTab === t ? 'bg-raised text-fg' : 'text-fg-dim hover:text-fg-muted',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <span className="text-[10.5px] text-fg-dim">No response yet</span>
          )}
        </div>

        <div className="min-h-0 flex-[3] overflow-auto bg-bg">
          {res &&
            (resTab === 'body' ? (
              <pre className="p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg">
                {pretty(res.body, res.contentType)}
              </pre>
            ) : (
              <div className="p-3">
                {res.headers.map((h, i) => (
                  <div key={i} className="flex gap-2 py-0.5 font-mono text-[11px]">
                    <span className="w-48 shrink-0 truncate text-fg-dim">{h.key}</span>
                    <span className="min-w-0 flex-1 break-all text-fg-muted">{h.value}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

/** Pretty-print JSON responses; leave everything else exactly as received. */
function pretty(body: string, contentType: string): string {
  if (!/json/i.test(contentType)) return body
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
