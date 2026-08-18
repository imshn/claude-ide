import { useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, Check, ChevronDown, Clock, Copy, FileUp, Loader2, Plus, Send, Trash2, X,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { interpolate, type ApiRequest } from '../lib/postman'
import {
  b64,
  generateCode,
  joinUrl,
  splitUrl,
  type Assertion,
  type AssertKind,
  type Auth,
  type AuthKind,
  type CodeTarget,
} from '../lib/apitest'
import { Button } from './ui'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const REQ_TABS = ['params', 'auth', 'headers', 'body', 'tests', 'code'] as const
type ReqTab = (typeof REQ_TABS)[number]

const statusTone = (s: number) =>
  s === 0 ? 'text-del' : s < 300 ? 'text-add' : s < 400 ? 'text-pending' : 'text-del'

export function ApiRequestTab({ id }: { id: string }) {
  const req = useStore((s) => s.requests[id])
  const res = useStore((s) => s.responses[id])
  const tests = useStore((s) => s.testResults[id])
  const history = useStore((s) => s.history[id])
  const sending = useStore((s) => s.sendingApi === id)
  const vars = useStore((s) => s.activeVars())
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const setActiveEnv = useStore((s) => s.setActiveEnv)
  const addEnvironment = useStore((s) => s.addEnvironment)
  const update = useStore((s) => s.updateRequest)
  const send = useStore((s) => s.sendRequest)
  const [tab, setTab] = useState<ReqTab>('params')
  const [resTab, setResTab] = useState<'body' | 'headers' | 'tests' | 'history'>('body')
  const [varsOpen, setVarsOpen] = useState(false)

  if (!req) return null
  const patch = (p: Partial<ApiRequest>) => update(id, p)
  const resolved = interpolate(req.url, vars)
  const unresolved = resolved.match(/\{\{[^}]+\}\}/g)
  const { base } = splitUrl(req.url)
  const params = req.params ?? splitUrl(req.url).params
  const auth = req.auth ?? { kind: 'none' as AuthKind }

  const setParams = (next: typeof params) => patch({ params: next, url: joinUrl(base, next, auth) })

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-panel">
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
        <select
          value={activeEnvId ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              const name = window.prompt('Environment name')
              if (name?.trim()) addEnvironment(name.trim())
              return
            }
            setActiveEnv(e.target.value || null)
          }}
          aria-label="Active environment"
          className="anim shrink-0 cursor-pointer rounded border border-border bg-elevated px-1.5 py-1 text-[10.5px] text-fg-muted outline-none"
        >
          <option value="">No environment</option>
          {environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
          <option value="__new__">+ New environment…</option>
        </select>
        <Button compact variant="ghost" onClick={() => setVarsOpen((v) => !v)} title="Edit variables">
          Vars
        </Button>
      </header>

      {varsOpen && (
        <VarsEditor onClose={() => setVarsOpen(false)} activeEnvId={activeEnvId} />
      )}

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
          Unresolved variable {unresolved.join(', ')} — set it above or import an environment.
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-1 overflow-x-auto px-2.5 pt-2">
          {REQ_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'anim shrink-0 rounded px-2 py-0.5 text-[11px] capitalize',
                tab === t ? 'bg-raised text-fg' : 'text-fg-dim hover:text-fg-muted',
              )}
            >
              {t}
              {t === 'headers' && req.headers.filter((h) => h.enabled && h.key).length > 0 && (
                <span className="tnum ml-1 text-fg-dim">{req.headers.filter((h) => h.enabled && h.key).length}</span>
              )}
              {t === 'params' && params.filter((p) => p.enabled && p.key).length > 0 && (
                <span className="tnum ml-1 text-fg-dim">{params.filter((p) => p.enabled && p.key).length}</span>
              )}
              {t === 'auth' && auth.kind !== 'none' && <span className="ml-1 text-accent">●</span>}
              {t === 'tests' && (req.assertions?.length ?? 0) > 0 && (
                <span className="tnum ml-1 text-fg-dim">{req.assertions?.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-[2] overflow-y-auto p-2.5">
          {tab === 'params' && (
            <ParamsTab params={params} onChange={setParams} />
          )}
          {tab === 'auth' && <AuthTab auth={auth} onChange={(a) => patch({ auth: a })} />}
          {tab === 'headers' && <HeadersTab req={req} patch={patch} />}
          {tab === 'body' && <BodyTab req={req} patch={patch} />}
          {tab === 'tests' && (
            <TestsTab assertions={req.assertions ?? []} onChange={(a) => patch({ assertions: a })} />
          )}
          {tab === 'code' && <CodeTab req={req} vars={vars} auth={auth} params={params} base={base} />}
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
              {tests && tests.length > 0 && (
                <span
                  className={clsx(
                    'tnum text-[10.5px] font-medium',
                    tests.every((t) => t.passed) ? 'text-add' : 'text-del',
                  )}
                >
                  {tests.filter((t) => t.passed).length}/{tests.length} tests
                </span>
              )}
              <div className="ml-auto flex gap-1">
                {(['body', 'headers', 'tests', 'history'] as const).map((t) => (
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
            <>
              <span className="text-[10.5px] text-fg-dim">No response yet</span>
              {history && history.length > 0 && (
                <button
                  onClick={() => setResTab('history')}
                  className="ml-auto rounded px-1.5 py-0.5 text-[10.5px] text-fg-dim hover:text-fg-muted"
                >
                  history
                </button>
              )}
            </>
          )}
        </div>

        <div className="min-h-0 flex-[3] overflow-auto bg-bg">
          {resTab === 'body' &&
            (res ? (
              <pre className="p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg">
                {pretty(res.body, res.contentType)}
              </pre>
            ) : null)}
          {resTab === 'headers' && res && (
            <div className="p-3">
              {res.headers.map((h, i) => (
                <div key={i} className="flex gap-2 py-0.5 font-mono text-[11px]">
                  <span className="w-48 shrink-0 truncate text-fg-dim">{h.key}</span>
                  <span className="min-w-0 flex-1 break-all text-fg-muted">{h.value}</span>
                </div>
              ))}
            </div>
          )}
          {resTab === 'tests' && (
            <div className="p-3">
              {!tests?.length && <p className="text-[11px] text-fg-dim">No assertions configured — add some in the Tests tab.</p>}
              {tests?.map((t) => (
                <div key={t.id} className="flex items-start gap-2 py-1 text-[11.5px]">
                  {t.passed ? (
                    <Check size={13} className="mt-0.5 shrink-0 text-add" />
                  ) : (
                    <X size={13} className="mt-0.5 shrink-0 text-del" />
                  )}
                  <div className="min-w-0">
                    <p className={t.passed ? 'text-fg' : 'text-del'}>{t.label}</p>
                    {!t.passed && <p className="font-mono text-[10.5px] text-fg-dim">got: {t.actual}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {resTab === 'history' && (
            <div className="p-3">
              {!history?.length && <p className="text-[11px] text-fg-dim">No requests sent yet.</p>}
              {history?.map((h) => (
                <div key={h.id} className="flex items-center gap-2 border-b border-border py-1.5 text-[11px]">
                  <Clock size={10} className="shrink-0 text-fg-dim" />
                  <span className="w-14 shrink-0 font-mono font-semibold text-fg-muted">{h.method}</span>
                  <span className={clsx('tnum w-10 shrink-0 font-mono', statusTone(h.status))}>{h.status || 'ERR'}</span>
                  <span className="tnum w-16 shrink-0 text-fg-dim">{h.ms} ms</span>
                  <span className="min-w-0 flex-1 truncate text-fg-dim" title={h.url}>
                    {h.url}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ParamsTab({
  params,
  onChange,
}: {
  params: { key: string; value: string; enabled: boolean }[]
  onChange: (p: { key: string; value: string; enabled: boolean }[]) => void
}) {
  const rows = params.length ? params : [{ key: '', value: '', enabled: true }]
  return (
    <div className="space-y-1">
      {rows.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={p.enabled}
            aria-label={`Enable ${p.key || 'param'}`}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...p, enabled: e.target.checked }
              onChange(next)
            }}
            className="accent-[var(--color-accent)]"
          />
          <input
            value={p.key}
            placeholder="key"
            spellCheck={false}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...p, key: e.target.value }
              if (i === rows.length - 1 && e.target.value) next.push({ key: '', value: '', enabled: true })
              onChange(next)
            }}
            className="w-[38%] rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
          />
          <input
            value={p.value}
            placeholder="value"
            spellCheck={false}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...p, value: e.target.value }
              onChange(next)
            }}
            className="min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
          />
          <Button compact variant="ghost" aria-label="Remove param" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 size={11} />
          </Button>
        </div>
      ))}
      <Button compact variant="ghost" onClick={() => onChange([...rows, { key: '', value: '', enabled: true }])}>
        <Plus size={11} /> Add param
      </Button>
    </div>
  )
}

function AuthTab({ auth, onChange }: { auth: Auth; onChange: (a: Auth) => void }) {
  return (
    <div className="space-y-2.5">
      <select
        value={auth.kind}
        onChange={(e) => onChange({ kind: e.target.value as AuthKind })}
        className="anim w-full cursor-pointer rounded border border-border bg-elevated px-2 py-1.5 text-[11.5px] text-fg outline-none"
      >
        <option value="none">No auth</option>
        <option value="bearer">Bearer token</option>
        <option value="basic">Basic auth</option>
        <option value="apikey">API key</option>
      </select>

      {auth.kind === 'bearer' && (
        <Field label="Token">
          <input
            value={(auth.token as string) ?? ''}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
            spellCheck={false}
            className="anim w-full rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
          />
        </Field>
      )}

      {auth.kind === 'basic' && (
        <>
          <Field label="Username">
            <input
              value={(auth.username as string) ?? ''}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
              spellCheck={false}
              className="anim w-full rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={(auth.password as string) ?? ''}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
              className="anim w-full rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
            />
          </Field>
          <p className="truncate text-[10.5px] text-fg-dim">
            Sent as <code>Authorization: Basic {b64(`${auth.username ?? ''}:${auth.password ?? ''}`)}</code>
          </p>
        </>
      )}

      {auth.kind === 'apikey' && (
        <>
          <Field label="Key name">
            <input
              value={(auth.key as string) ?? ''}
              placeholder="X-API-Key"
              onChange={(e) => onChange({ ...auth, key: e.target.value })}
              spellCheck={false}
              className="anim w-full rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
            />
          </Field>
          <Field label="Value">
            <input
              value={(auth.value as string) ?? ''}
              onChange={(e) => onChange({ ...auth, value: e.target.value })}
              spellCheck={false}
              className="anim w-full rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
            />
          </Field>
          <Field label="Add to">
            <select
              value={auth.in ?? 'header'}
              onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })}
              className="anim rounded border border-border bg-elevated px-2 py-1 text-[11px] text-fg outline-none"
            >
              <option value="header">Header</option>
              <option value="query">Query param</option>
            </select>
          </Field>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] tracking-[0.06em] text-fg-dim uppercase">{label}</span>
      {children}
    </label>
  )
}

function HeadersTab({ req, patch }: { req: ApiRequest; patch: (p: Partial<ApiRequest>) => void }) {
  return (
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
      <Button compact variant="ghost" onClick={() => patch({ headers: [...req.headers, { key: '', value: '', enabled: true }] })}>
        <Plus size={11} /> Add header
      </Button>
    </div>
  )
}

function BodyTab({ req, patch }: { req: ApiRequest; patch: (p: Partial<ApiRequest>) => void }) {
  const form = req.form ?? []

  const pickFile = async (i: number) => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ multiple: false })
    if (typeof picked !== 'string') return
    const next = [...form]
    next[i] = { ...next[i], path: picked, value: '' }
    patch({ form: next })
  }

  return (
    <>
      <div className="mb-1.5 flex gap-1">
        {(['none', 'json', 'text', 'form', 'multipart'] as const).map((b) => (
          <button
            key={b}
            onClick={() => patch({ bodyType: b })}
            className={clsx(
              'anim rounded border px-1.5 py-0.5 text-[10.5px]',
              req.bodyType === b ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-fg-dim hover:text-fg-muted',
            )}
          >
            {b}
          </button>
        ))}
      </div>

      {req.bodyType === 'multipart' ? (
        <div className="space-y-1">
          {(form.length ? form : [{ key: '', value: '', enabled: true }]).map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => {
                  const next = [...form]
                  next[i] = { ...f, enabled: e.target.checked }
                  patch({ form: next })
                }}
                className="accent-[var(--color-accent)]"
              />
              <input
                value={f.key}
                placeholder="field"
                spellCheck={false}
                onChange={(e) => {
                  const next = form.length ? [...form] : [{ key: '', value: '', enabled: true }]
                  next[i] = { ...next[i], key: e.target.value }
                  if (i === next.length - 1 && e.target.value) next.push({ key: '', value: '', enabled: true })
                  patch({ form: next })
                }}
                className="w-[30%] rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
              />
              {f.path ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded border border-border bg-elevated px-2 py-1 font-mono text-[10.5px] text-fg-muted">
                  {f.path.split('/').pop()}
                  <button onClick={() => { const next = [...form]; next[i] = { ...f, path: undefined }; patch({ form: next }) }} className="ml-auto text-fg-dim hover:text-del">
                    <X size={10} />
                  </button>
                </span>
              ) : (
                <input
                  value={f.value}
                  placeholder="value"
                  spellCheck={false}
                  onChange={(e) => {
                    const next = [...form]
                    next[i] = { ...f, value: e.target.value }
                    patch({ form: next })
                  }}
                  className="min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                />
              )}
              <Button compact variant="ghost" title="Attach a file" onClick={() => void pickFile(i)}>
                <FileUp size={11} />
              </Button>
              <Button compact variant="ghost" aria-label="Remove field" onClick={() => patch({ form: form.filter((_, j) => j !== i) })}>
                <Trash2 size={11} />
              </Button>
            </div>
          ))}
          <Button compact variant="ghost" onClick={() => patch({ form: [...form, { key: '', value: '', enabled: true }] })}>
            <Plus size={11} /> Add field
          </Button>
        </div>
      ) : (
        req.bodyType !== 'none' && (
          <textarea
            value={req.body}
            spellCheck={false}
            onChange={(e) => patch({ body: e.target.value })}
            placeholder={req.bodyType === 'form' ? 'a=1&b=2' : '{ }'}
            className="h-40 w-full resize-y rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-[11.5px] text-fg outline-none focus:border-accent/50"
          />
        )
      )}
    </>
  )
}

const ASSERT_KINDS: { value: AssertKind; label: string }[] = [
  { value: 'status', label: 'Status code' },
  { value: 'time', label: 'Response time' },
  { value: 'header', label: 'Header' },
  { value: 'body-contains', label: 'Body contains' },
  { value: 'json-path', label: 'JSON path' },
]

function TestsTab({ assertions, onChange }: { assertions: Assertion[]; onChange: (a: Assertion[]) => void }) {
  const add = () =>
    onChange([...assertions, { id: crypto.randomUUID(), kind: 'status', expected: '200', op: 'equals', enabled: true }])

  return (
    <div className="space-y-2">
      {!assertions.length && <p className="text-[11px] text-fg-dim">No assertions yet. They run against every response.</p>}
      {assertions.map((a, i) => (
        <div key={a.id} className="rounded border border-border bg-elevated p-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={a.enabled}
              onChange={(e) => {
                const next = [...assertions]
                next[i] = { ...a, enabled: e.target.checked }
                onChange(next)
              }}
              className="accent-[var(--color-accent)]"
            />
            <select
              value={a.kind}
              onChange={(e) => {
                const next = [...assertions]
                next[i] = { ...a, kind: e.target.value as AssertKind }
                onChange(next)
              }}
              className="anim flex-1 cursor-pointer rounded border border-border bg-panel px-1.5 py-1 text-[11px] text-fg outline-none"
            >
              {ASSERT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <Button compact variant="ghost" aria-label="Remove assertion" onClick={() => onChange(assertions.filter((_, j) => j !== i))}>
              <Trash2 size={11} />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            {(a.kind === 'header' || a.kind === 'json-path') && (
              <input
                value={a.target ?? ''}
                placeholder={a.kind === 'header' ? 'Header name' : 'data.items.0.id'}
                spellCheck={false}
                onChange={(e) => {
                  const next = [...assertions]
                  next[i] = { ...a, target: e.target.value }
                  onChange(next)
                }}
                className="w-[42%] rounded border border-border bg-panel px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
              />
            )}
            <select
              value={a.op ?? 'equals'}
              onChange={(e) => {
                const next = [...assertions]
                next[i] = { ...a, op: e.target.value as Assertion['op'] }
                onChange(next)
              }}
              className="anim shrink-0 cursor-pointer rounded border border-border bg-panel px-1.5 py-1 text-[11px] text-fg outline-none"
            >
              {(a.kind === 'time'
                ? [['lt', '<'], ['gt', '>']]
                : a.kind === 'status'
                  ? [['equals', '='], ['lt', '<'], ['gt', '>']]
                  : [['equals', '='], ['contains', 'contains'], ['exists', 'exists']]
              ).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {a.op !== 'exists' && (
              <input
                value={a.expected}
                placeholder="expected"
                spellCheck={false}
                onChange={(e) => {
                  const next = [...assertions]
                  next[i] = { ...a, expected: e.target.value }
                  onChange(next)
                }}
                className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
              />
            )}
          </div>
        </div>
      ))}
      <Button compact variant="ghost" onClick={add}>
        <Plus size={11} /> Add assertion
      </Button>
    </div>
  )
}

function CodeTab({
  req,
  vars,
  auth,
  params,
  base,
}: {
  req: ApiRequest
  vars: Record<string, string>
  auth: Auth
  params: { key: string; value: string; enabled: boolean }[]
  base: string
}) {
  const [target, setTarget] = useState<CodeTarget>('curl')
  const [copied, setCopied] = useState(false)
  const url = interpolate(joinUrl(base, params, auth as any), vars)
  const headers = req.headers.filter((h) => h.enabled && h.key.trim()).map((h) => ({ ...h, value: interpolate(h.value, vars) }))
  const code = generateCode({ method: req.method, url, headers, body: interpolate(req.body, vars) }, target)

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        {(['curl', 'fetch', 'axios', 'python'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTarget(t)}
            className={clsx(
              'anim rounded border px-1.5 py-0.5 text-[10.5px]',
              target === t ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-fg-dim hover:text-fg-muted',
            )}
          >
            {t}
          </button>
        ))}
        <Button compact variant="ghost" className="ml-auto" onClick={copy}>
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-bg p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted">
        {code}
      </pre>
    </div>
  )
}

function VarsEditor({ activeEnvId, onClose }: { activeEnvId: string | null; onClose: () => void }) {
  const apiVars = useStore((s) => s.apiVars)
  const environments = useStore((s) => s.environments)
  const setGlobalVar = useStore((s) => s.setGlobalVar)
  const removeGlobalVar = useStore((s) => s.removeGlobalVar)
  const setEnvVar = useStore((s) => s.setEnvVar)
  const removeEnvVar = useStore((s) => s.removeEnvVar)
  const deleteEnvironment = useStore((s) => s.deleteEnvironment)
  const env = environments.find((e) => e.id === activeEnvId)

  return (
    <div className="absolute top-11 right-2 z-20 max-h-[70%] w-80 overflow-y-auto rounded-md border border-border bg-panel p-3 shadow-lg">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10px] tracking-[0.06em] text-fg-dim uppercase">Global variables</p>
      </div>
      <VarRows vars={apiVars} onSet={setGlobalVar} onRemove={removeGlobalVar} />

      {env && (
        <>
          <div className="mt-3 mb-1 flex items-center justify-between">
            <p className="text-[10px] tracking-[0.06em] text-fg-dim uppercase">{env.name}</p>
            <button onClick={() => deleteEnvironment(env.id)} className="text-fg-dim hover:text-del" title="Delete environment">
              <Trash2 size={10} />
            </button>
          </div>
          <VarRows vars={env.vars} onSet={(k, v) => setEnvVar(env.id, k, v)} onRemove={(k) => removeEnvVar(env.id, k)} />
        </>
      )}
      <Button compact variant="ghost" className="mt-2 w-full justify-center" onClick={onClose}>
        <ChevronDown size={11} /> Close
      </Button>
    </div>
  )
}

function VarRows({
  vars,
  onSet,
  onRemove,
}: {
  vars: Record<string, string>
  onSet: (k: string, v: string) => void
  onRemove: (k: string) => void
}) {
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const entries = Object.entries(vars)

  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5">
          <span className="w-[38%] truncate font-mono text-[11px] text-fg-muted">{k}</span>
          <input
            value={v}
            spellCheck={false}
            onChange={(e) => onSet(k, e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
          />
          <Button compact variant="ghost" aria-label={`Remove ${k}`} onClick={() => onRemove(k)}>
            <Trash2 size={11} />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          value={newKey}
          placeholder="key"
          spellCheck={false}
          onChange={(e) => setNewKey(e.target.value)}
          className="w-[38%] rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
        />
        <input
          value={newVal}
          placeholder="value"
          spellCheck={false}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newKey.trim()) {
              onSet(newKey.trim(), newVal)
              setNewKey('')
              setNewVal('')
            }
          }}
          className="min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
        />
        <Button
          compact
          variant="ghost"
          disabled={!newKey.trim()}
          onClick={() => {
            onSet(newKey.trim(), newVal)
            setNewKey('')
            setNewVal('')
          }}
        >
          <Plus size={11} />
        </Button>
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
