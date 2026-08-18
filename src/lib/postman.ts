/**
 * Postman Collection v2.x import.
 *
 * Only the parts that survive a round trip into a request runner: folders,
 * requests, method, URL, headers, body and the common auth schemes. Scripts
 * (pre-request / tests) are deliberately not executed — running arbitrary
 * JavaScript out of an imported file is not something this IDE should do
 * silently — but they are preserved so nothing is lost on re-export.
 */

import type { Assertion, Auth, MultipartField, QueryParam } from './apitest'

export interface ApiHeader {
  key: string
  value: string
  enabled: boolean
}

export interface ApiRequest {
  id: string
  name: string
  method: string
  url: string
  headers: ApiHeader[]
  body: string
  bodyType: 'none' | 'json' | 'text' | 'form' | 'multipart'
  /** Present when the collection carried scripts we chose not to run. */
  notes?: string
  auth?: Auth
  /** Query params as a table; kept in sync with `url` at the editing seam. */
  params?: QueryParam[]
  assertions?: Assertion[]
  /** multipart/form-data fields, used when bodyType is 'multipart'. */
  form?: MultipartField[]
}

export interface ApiFolder {
  id: string
  name: string
  requests: ApiRequest[]
  folders: ApiFolder[]
}

export interface Collection {
  id: string
  name: string
  variables: Record<string, string>
  root: ApiFolder
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`

/** Postman stores URLs either as a string or as a decomposed object. */
export function urlOf(url: unknown): string {
  if (typeof url === 'string') return url
  if (!url || typeof url !== 'object') return ''
  const u = url as any
  if (typeof u.raw === 'string' && u.raw) return u.raw

  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host ?? '')
  const path = Array.isArray(u.path) ? u.path.join('/') : (u.path ?? '')
  const proto = u.protocol ? `${u.protocol}://` : ''
  const port = u.port ? `:${u.port}` : ''
  const query = Array.isArray(u.query)
    ? u.query
        .filter((q: any) => !q.disabled && q.key)
        .map((q: any) => `${q.key}=${q.value ?? ''}`)
        .join('&')
    : ''
  const base = `${proto}${host}${port}${path ? `/${path}` : ''}`
  return query ? `${base}?${query}` : base
}

function headersOf(header: unknown): ApiHeader[] {
  if (!Array.isArray(header)) return []
  return header
    .filter((h: any) => h && h.key)
    .map((h: any) => ({
      key: String(h.key),
      value: String(h.value ?? ''),
      enabled: !h.disabled,
    }))
}

function bodyOf(body: any): { body: string; bodyType: ApiRequest['bodyType'] } {
  if (!body || !body.mode) return { body: '', bodyType: 'none' }
  switch (body.mode) {
    case 'raw': {
      const raw = String(body.raw ?? '')
      const lang = body.options?.raw?.language
      return { body: raw, bodyType: lang === 'json' || looksJson(raw) ? 'json' : 'text' }
    }
    case 'urlencoded':
    case 'formdata': {
      const rows = Array.isArray(body[body.mode]) ? body[body.mode] : []
      const pairs = rows
        .filter((r: any) => !r.disabled && r.key)
        .map((r: any) => `${r.key}=${r.value ?? ''}`)
        .join('&')
      return { body: pairs, bodyType: 'form' }
    }
    default:
      return { body: '', bodyType: 'none' }
  }
}

function looksJson(s: string): boolean {
  const t = s.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

/** Fold Postman's auth block into a header, which is all a runner needs. */
function authHeader(auth: any): ApiHeader | null {
  if (!auth || !auth.type) return null
  const pick = (list: any, key: string) =>
    Array.isArray(list) ? (list.find((x: any) => x.key === key)?.value ?? '') : ''

  switch (auth.type) {
    case 'bearer':
      return { key: 'Authorization', value: `Bearer ${pick(auth.bearer, 'token')}`, enabled: true }
    case 'basic': {
      const user = pick(auth.basic, 'username')
      const pass = pick(auth.basic, 'password')
      return { key: 'Authorization', value: `Basic {{base64:${user}:${pass}}}`, enabled: true }
    }
    case 'apikey': {
      const key = pick(auth.apikey, 'key') || 'X-API-Key'
      const value = pick(auth.apikey, 'value')
      const location = pick(auth.apikey, 'in')
      return location === 'query' ? null : { key, value, enabled: true }
    }
    default:
      return null
  }
}

function requestOf(item: any): ApiRequest {
  const r = item.request ?? {}
  const headers = headersOf(r.header)
  const auth = authHeader(r.auth)
  if (auth && !headers.some((h) => h.key.toLowerCase() === auth.key.toLowerCase())) {
    headers.push(auth)
  }
  const { body, bodyType } = bodyOf(r.body)

  const scripts = (Array.isArray(item.event) ? item.event : [])
    .filter((e: any) => e?.script?.exec?.length)
    .map((e: any) => e.listen)
  const notes = scripts.length
    ? `Imported with ${scripts.join(' and ')} script(s), which are not run.`
    : undefined

  return {
    id: uid(),
    name: String(item.name ?? urlOf(r.url) ?? 'Request'),
    method: String(r.method ?? 'GET').toUpperCase(),
    url: urlOf(r.url),
    headers,
    body,
    bodyType,
    notes,
  }
}

function folderOf(name: string, items: any[]): ApiFolder {
  const folder: ApiFolder = { id: uid(), name, requests: [], folders: [] }
  for (const item of items ?? []) {
    if (!item) continue
    if (Array.isArray(item.item)) folder.folders.push(folderOf(String(item.name ?? 'Folder'), item.item))
    else if (item.request) folder.requests.push(requestOf(item))
  }
  return folder
}

export function parseCollection(json: string): Collection {
  let doc: any
  try {
    doc = JSON.parse(json)
  } catch (e) {
    throw new Error(`not valid JSON: ${e}`)
  }
  if (!doc || !Array.isArray(doc.item)) {
    throw new Error('not a Postman collection (no top-level "item" array)')
  }

  const variables: Record<string, string> = {}
  for (const v of doc.variable ?? []) {
    if (v?.key) variables[String(v.key)] = String(v.value ?? '')
  }

  return {
    id: uid(),
    name: String(doc.info?.name ?? 'Imported collection'),
    variables,
    root: folderOf(String(doc.info?.name ?? 'Collection'), doc.item),
  }
}

/** Postman environment export — a flat list of values. */
export function parseEnvironment(json: string): Record<string, string> {
  return parseEnvironmentNamed(json).vars
}

/** Same as {@link parseEnvironment}, but keeps the environment's own name. */
export function parseEnvironmentNamed(json: string): { name: string; vars: Record<string, string> } {
  const doc = JSON.parse(json)
  const vars: Record<string, string> = {}
  for (const v of doc?.values ?? []) {
    if (v?.key && v.enabled !== false) vars[String(v.key)] = String(v.value ?? '')
  }
  return { name: String(doc?.name ?? 'Imported environment'), vars }
}

/** Substitute `{{var}}`, leaving unknown ones visible rather than blanking them. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (whole, name: string) => {
    const v = vars[name.trim()]
    return v === undefined ? whole : v
  })
}

export interface TreeNode {
  id: string
  name: string
  folders: TreeNode[]
  requests: string[]
}

/**
 * Split the imported tree into a display shape and a flat id -> request map.
 * Editing a request then means one map write instead of walking and rebuilding
 * a nested structure on every keystroke.
 */
export function flatten(folder: ApiFolder): {
  tree: TreeNode
  requests: Record<string, ApiRequest>
} {
  const requests: Record<string, ApiRequest> = {}
  const walk = (f: ApiFolder): TreeNode => {
    for (const r of f.requests) requests[r.id] = r
    return {
      id: f.id,
      name: f.name,
      folders: f.folders.map(walk),
      requests: f.requests.map((r) => r.id),
    }
  }
  return { tree: walk(folder), requests }
}

export function countRequests(folder: ApiFolder): number {
  return folder.requests.length + folder.folders.reduce((n, f) => n + countRequests(f), 0)
}

export function blankRequest(name = 'New request'): ApiRequest {
  return {
    id: uid(),
    name,
    method: 'GET',
    url: '',
    headers: [{ key: '', value: '', enabled: true }],
    body: '',
    bodyType: 'none',
  }
}
