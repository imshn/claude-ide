/**
 * Chrome DevTools Protocol client.
 *
 * Spoken directly from the webview over a WebSocket — it is JSON both ways, and
 * relaying it through Rust would add a hop without adding anything.
 *
 * Verified against Node 24: under `--inspect-brk` nothing is parsed before the
 * program runs, so breakpoints are set by file URL up front and resolve when the
 * script loads. A breakpoint with no resolved location yet is pending, not broken.
 */

export interface RemoteObject {
  type: string
  subtype?: string
  value?: unknown
  description?: string
  objectId?: string
  className?: string
  unserializableValue?: string
}

export interface Scope {
  type: string
  object: RemoteObject
  name?: string
}

export interface CallFrame {
  callFrameId: string
  functionName: string
  location: { scriptId: string; lineNumber: number; columnNumber?: number }
  url: string
  scopeChain: Scope[]
  this?: RemoteObject
}

export interface PausedEvent {
  reason: string
  callFrames: CallFrame[]
  hitBreakpoints?: string[]
}

/** A local path as V8 reports it. Spaces and unicode must be percent-encoded. */
export function fileUrl(path: string): string {
  const abs = path.startsWith('/') ? path : `/${path}`
  return (
    'file://' +
    abs
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
  )
}

/** Inverse of fileUrl, for mapping a paused location back to an editor tab. */
export function pathFromUrl(url: string): string {
  if (!url.startsWith('file://')) return url
  try {
    return decodeURIComponent(url.slice('file://'.length))
  } catch {
    return url.slice('file://'.length)
  }
}

/** One-line rendering of a CDP RemoteObject for a variables tree. */
export function formatValue(o: RemoteObject | undefined): string {
  if (!o) return 'undefined'
  if (o.unserializableValue) return o.unserializableValue
  switch (o.type) {
    case 'undefined':
      return 'undefined'
    case 'string':
      return JSON.stringify(o.value)
    case 'number':
    case 'boolean':
      return String(o.value)
    case 'function':
      return o.description?.split('\n')[0] ?? 'function'
    case 'object':
      if (o.subtype === 'null') return 'null'
      if (o.subtype === 'array') return o.description ?? 'Array'
      return o.description ?? o.className ?? 'Object'
    default:
      return o.description ?? o.type
  }
}

/** Scopes worth showing, in the order a person reads them. */
export function usefulScopes(scopes: Scope[]): Scope[] {
  const rank: Record<string, number> = { local: 0, closure: 1, catch: 2, block: 3, with: 4, script: 5 }
  return scopes
    .filter((s) => s.type !== 'global' && s.object.objectId)
    .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))
}

/** Node's internals are noise in a call stack; a user wants their own frames. */
export function isUserFrame(url: string): boolean {
  if (!url) return false
  if (url.startsWith('node:')) return false
  return !url.includes('/node_modules/') && !url.includes('internal/')
}

type Handler = (params: any) => void

export class CdpClient {
  private ws?: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private handlers = new Map<string, Set<Handler>>()

  async connect(wsUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      this.ws = ws
      const fail = () => reject(new Error('could not connect to the inspector'))
      ws.onopen = () => resolve()
      ws.onerror = fail
      ws.onclose = () => {
        // Reject anything still in flight; a silent hang is worse than an error.
        for (const [, p] of this.pending) p.reject(new Error('debug session closed'))
        this.pending.clear()
        this.emit('__closed', {})
      }
      ws.onmessage = (e) => this.receive(String(e.data))
    })
  }

  private receive(raw: string) {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'CDP error'))
      else p.resolve(msg.result)
      return
    }
    if (msg.method) this.emit(msg.method, msg.params ?? {})
  }

  private emit(method: string, params: any) {
    for (const h of this.handlers.get(method) ?? []) h(params)
  }

  on(method: string, handler: Handler): () => void {
    const set = this.handlers.get(method) ?? new Set()
    set.add(handler)
    this.handlers.set(method, set)
    return () => set.delete(handler)
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('not connected'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.ws?.close()
    this.ws = undefined
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
