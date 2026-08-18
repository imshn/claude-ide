import { useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Download, FolderClosed, FolderOpen, Plus, Send, Terminal, X } from 'lucide-react'
import { useStore } from '../lib/store'
import type { TreeNode } from '../lib/postman'
import { Button, Empty, Panel } from './ui'

const METHOD_TONE: Record<string, string> = {
  GET: 'text-add',
  POST: 'text-accent',
  PUT: 'text-pending',
  PATCH: 'text-pending',
  DELETE: 'text-del',
}

export function ApiPanel() {
  const collections = useStore((s) => s.collections)
  const importCollection = useStore((s) => s.importCollection)
  const importCurl = useStore((s) => s.importCurl)
  const newRequest = useStore((s) => s.newRequest)
  const loose = useStore((s) => s.looseRequests)
  const [curlOpen, setCurlOpen] = useState(false)
  const [curlText, setCurlText] = useState('')

  const doImportCurl = () => {
    if (!curlText.trim()) return
    importCurl(curlText)
    setCurlText('')
    setCurlOpen(false)
  }

  return (
    <Panel
      title="API"
      actions={
        <>
          <Button compact variant="ghost" title="New request" onClick={() => newRequest()}>
            <Plus size={12} />
          </Button>
          <Button compact variant="ghost" title="Paste a cURL command" onClick={() => setCurlOpen((v) => !v)}>
            <Terminal size={12} />
          </Button>
          <Button compact variant="ghost" title="Import a Postman collection" onClick={() => void importCollection()}>
            <Download size={12} />
          </Button>
        </>
      }
    >
      {curlOpen && (
        <div className="border-b border-border p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] tracking-[0.06em] text-fg-dim uppercase">Paste a cURL command</p>
            <button onClick={() => setCurlOpen(false)} className="text-fg-dim hover:text-fg">
              <X size={11} />
            </button>
          </div>
          <textarea
            value={curlText}
            onChange={(e) => setCurlText(e.target.value)}
            spellCheck={false}
            placeholder="curl -X POST https://api.example.com/v1/users -H 'Authorization: Bearer …' -d '{ }'"
            className="h-24 w-full resize-y rounded-md border border-border bg-elevated px-2.5 py-2 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
          />
          <Button variant="accent" compact className="mt-1.5 w-full justify-center" disabled={!curlText.trim()} onClick={doImportCurl}>
            Import
          </Button>
        </div>
      )}
      {!collections.length && !loose.length ? (
        <div className="px-3">
          <Empty
            icon={<Send size={20} />}
            title="No requests yet"
            hint="Create a request, paste a cURL command, or import a Postman collection export (v2.x JSON)."
          />
          <div className="space-y-1.5 pb-4">
            <Button variant="accent" className="w-full justify-center" onClick={() => newRequest()}>
              <Plus size={12} /> New request
            </Button>
            <Button variant="outline" className="w-full justify-center" onClick={() => setCurlOpen(true)}>
              <Terminal size={12} /> Paste cURL command
            </Button>
            <Button variant="outline" className="w-full justify-center" onClick={() => void importCollection()}>
              <Download size={12} /> Import Postman collection
            </Button>
          </div>
        </div>
      ) : (
        <div className="pb-4">
          {loose.length > 0 && (
            <section className="mt-1">
              <p className="px-3 py-1 text-[10px] tracking-[0.08em] text-fg-dim uppercase">Requests</p>
              {loose.map((id) => (
                <RequestRow key={id} id={id} depth={0} />
              ))}
            </section>
          )}
          {collections.map((c) => (
            <section key={c.id} className="mt-1">
              <p className="truncate px-3 py-1 text-[10px] tracking-[0.08em] text-fg-dim uppercase">
                {c.name}
              </p>
              <FolderRow node={c.tree} depth={0} />
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}

function FolderRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1)
  const empty = !node.folders.length && !node.requests.length

  return (
    <>
      {depth > 0 && (
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: 8 + depth * 12 }}
          className="anim flex h-[26px] w-full items-center gap-1.5 pr-2 text-left text-xs text-fg-muted hover:bg-elevated hover:text-fg"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={11} className="shrink-0 text-fg-dim" /> : <ChevronRight size={11} className="shrink-0 text-fg-dim" />}
          {open ? <FolderOpen size={12} className="shrink-0 text-accent/70" /> : <FolderClosed size={12} className="shrink-0 text-fg-dim" />}
          <span className="truncate">{node.name}</span>
        </button>
      )}
      {(open || depth === 0) && (
        <>
          {node.folders.map((f) => (
            <FolderRow key={f.id} node={f} depth={depth + 1} />
          ))}
          {node.requests.map((id) => (
            <RequestRow key={id} id={id} depth={depth + 1} />
          ))}
          {empty && depth > 0 && (
            <p style={{ paddingLeft: 20 + depth * 12 }} className="py-1 text-[10.5px] text-fg-dim">
              empty
            </p>
          )}
        </>
      )}
    </>
  )
}

function RequestRow({ id, depth }: { id: string; depth: number }) {
  const req = useStore((s) => s.requests[id])
  const openRequest = useStore((s) => s.openRequest)
  const activeTab = useStore((s) => s.activeTab)
  const active = activeTab?.kind === 'api' && activeTab.id === id
  if (!req) return null

  return (
    <button
      onClick={() => openRequest(id)}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={clsx(
        'anim flex h-[26px] w-full items-center gap-2 pr-2 text-left',
        active ? 'bg-raised text-fg' : 'text-fg-muted hover:bg-elevated hover:text-fg',
      )}
      title={req.url}
    >
      <span
        className={clsx(
          'w-10 shrink-0 text-right font-mono text-[9.5px] font-semibold',
          METHOD_TONE[req.method] ?? 'text-fg-dim',
        )}
      >
        {req.method}
      </span>
      <span className="truncate text-xs">{req.name}</span>
    </button>
  )
}
