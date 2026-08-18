/**
 * API workbench logic: auth, query params, assertions, code generation and
 * cURL import. All pure — the network call itself lives in Rust.
 */

import type { ApiHeader } from './postman'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthKind = 'none' | 'bearer' | 'basic' | 'apikey'

export interface Auth {
  kind: AuthKind
  token?: string
  username?: string
  password?: string
  key?: string
  value?: string
  /** API keys can travel in a header or the query string. */
  in?: 'header' | 'query'
}

/** base64 without Buffer, so this stays usable in the webview. */
export function b64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  // btoa is present in the webview and in Node 16+, so no fallback is needed.
  return btoa(bin)
}

/** Headers the auth block contributes. Query-placed API keys yield none. */
export function authHeaders(auth: Auth | undefined): ApiHeader[] {
  if (!auth || auth.kind === 'none') return []
  switch (auth.kind) {
    case 'bearer':
      return auth.token ? [{ key: 'Authorization', value: `Bearer ${auth.token}`, enabled: true }] : []
    case 'basic':
      return [
        {
          key: 'Authorization',
          value: `Basic ${b64(`${auth.username ?? ''}:${auth.password ?? ''}`)}`,
          enabled: true,
        },
      ]
    case 'apikey':
      return auth.in === 'query' || !auth.key
        ? []
        : [{ key: auth.key, value: auth.value ?? '', enabled: true }]
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Query parameters — kept in sync with the URL, which is the part people get
// wrong when the two are edited independently.
// ---------------------------------------------------------------------------

export interface QueryParam {
  key: string
  value: string
  enabled: boolean
}

/** A multipart/form-data field; `path` set means it's a file, not text. */
export interface MultipartField {
  key: string
  value: string
  path?: string
  enabled: boolean
}

export function splitUrl(url: string): { base: string; params: QueryParam[] } {
  const i = url.indexOf('?')
  if (i === -1) return { base: url, params: [] }
  const base = url.slice(0, i)
  const params = url
    .slice(i + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      return { key: safeDecode(key), value: safeDecode(value), enabled: true }
    })
  return { base, params }
}

/** A half-written `%` in the editor must not throw. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

export function joinUrl(base: string, params: QueryParam[], auth?: Auth): string {
  const active = params.filter((p) => p.enabled && p.key.trim())
  if (auth?.kind === 'apikey' && auth.in === 'query' && auth.key) {
    active.push({ key: auth.key, value: auth.value ?? '', enabled: true })
  }
  if (!active.length) return base
  const qs = active
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return `${base.replace(/\?$/, '')}?${qs}`
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export type AssertKind = 'status' | 'time' | 'header' | 'body-contains' | 'json-path'

export interface Assertion {
  id: string
  kind: AssertKind
  /** Header name, or a dotted JSON path like `data.items.0.id`. */
  target?: string
  /** Comparison operand. Numeric kinds parse it as a number. */
  expected: string
  op?: 'equals' | 'contains' | 'lt' | 'gt' | 'exists'
  enabled: boolean
}

export interface AssertionResult {
  id: string
  label: string
  passed: boolean
  actual: string
}

export interface ResponseFacts {
  status: number
  ms: number
  headers: { key: string; value: string }[]
  body: string
}

/** Read `a.b.0.c` out of parsed JSON. Returns undefined when absent. */
export function jsonPath(body: string, path: string): unknown {
  let doc: any
  try {
    doc = JSON.parse(body)
  } catch {
    return undefined
  }
  let cur = doc
  for (const seg of path.split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined
    cur = Array.isArray(cur) && /^\d+$/.test(seg) ? cur[Number(seg)] : cur[seg]
  }
  return cur
}

const show = (v: unknown) =>
  v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v)

export function runAssertions(list: Assertion[], res: ResponseFacts): AssertionResult[] {
  return list
    .filter((a) => a.enabled)
    .map((a) => {
      const op = a.op ?? 'equals'
      let actual = ''
      let passed = false
      let label = ''

      switch (a.kind) {
        case 'status': {
          actual = String(res.status)
          const want = Number(a.expected)
          passed = op === 'lt' ? res.status < want : op === 'gt' ? res.status > want : res.status === want
          label = `Status ${op === 'equals' ? 'is' : op} ${a.expected}`
          break
        }
        case 'time': {
          actual = `${res.ms} ms`
          const want = Number(a.expected)
          passed = op === 'gt' ? res.ms > want : res.ms < want
          label = `Response time ${op === 'gt' ? '>' : '<'} ${a.expected} ms`
          break
        }
        case 'header': {
          const h = res.headers.find((x) => x.key.toLowerCase() === (a.target ?? '').toLowerCase())
          actual = h?.value ?? '(missing)'
          passed =
            op === 'exists'
              ? !!h
              : op === 'contains'
                ? (h?.value ?? '').includes(a.expected)
                : (h?.value ?? '') === a.expected
          label = `Header ${a.target} ${op} ${op === 'exists' ? '' : a.expected}`.trim()
          break
        }
        case 'body-contains': {
          actual = res.body.length > 60 ? `${res.body.slice(0, 60)}…` : res.body
          passed = res.body.includes(a.expected)
          label = `Body contains "${a.expected}"`
          break
        }
        case 'json-path': {
          const v = jsonPath(res.body, a.target ?? '')
          actual = show(v)
          passed =
            op === 'exists'
              ? v !== undefined
              : op === 'contains'
                ? show(v).includes(a.expected)
                : show(v) === a.expected
          label = `${a.target} ${op} ${op === 'exists' ? '' : a.expected}`.trim()
          break
        }
      }
      return { id: a.id, label, passed, actual }
    })
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

export type CodeTarget = 'curl' | 'fetch' | 'axios' | 'python'

export interface CodeSpec {
  method: string
  url: string
  headers: ApiHeader[]
  body?: string
}

const q = (s: string) => `'${s.replace(/'/g, "\\'")}'`

export function generateCode(spec: CodeSpec, target: CodeTarget): string {
  const headers = spec.headers.filter((h) => h.enabled && h.key.trim())
  const hasBody = !!spec.body && spec.body.trim() !== ''

  if (target === 'curl') {
    const parts = [`curl -X ${spec.method} ${q(spec.url)}`]
    for (const h of headers) parts.push(`  -H ${q(`${h.key}: ${h.value}`)}`)
    if (hasBody) parts.push(`  -d ${q(spec.body!)}`)
    return parts.join(' \\\n')
  }

  if (target === 'fetch') {
    const h = headers.map((x) => `    ${JSON.stringify(x.key)}: ${JSON.stringify(x.value)},`).join('\n')
    return [
      `const res = await fetch(${JSON.stringify(spec.url)}, {`,
      `  method: ${JSON.stringify(spec.method)},`,
      headers.length ? `  headers: {\n${h}\n  },` : '',
      hasBody ? `  body: ${JSON.stringify(spec.body)},` : '',
      `})`,
      `const data = await res.json()`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (target === 'axios') {
    const h = headers.map((x) => `    ${JSON.stringify(x.key)}: ${JSON.stringify(x.value)},`).join('\n')
    return [
      `const { data } = await axios({`,
      `  method: ${JSON.stringify(spec.method.toLowerCase())},`,
      `  url: ${JSON.stringify(spec.url)},`,
      headers.length ? `  headers: {\n${h}\n  },` : '',
      hasBody ? `  data: ${spec.body},` : '',
      `})`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  const h = headers.map((x) => `    ${JSON.stringify(x.key)}: ${JSON.stringify(x.value)},`).join('\n')
  return [
    `import requests`,
    ``,
    `res = requests.request(`,
    `    ${JSON.stringify(spec.method)},`,
    `    ${JSON.stringify(spec.url)},`,
    headers.length ? `    headers={\n${h}\n    },` : '',
    hasBody ? `    data=${JSON.stringify(spec.body)},` : '',
    `)`,
    `print(res.status_code, res.text)`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// cURL import
// ---------------------------------------------------------------------------

/** Split a shell-ish command respecting quotes and line continuations. */
export function tokenize(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let started = false

  const src = cmd.replace(/\\\r?\n/g, ' ')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < src.length) cur += src[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
      continue
    }
    if (/\s/.test(c)) {
      if (cur || started) out.push(cur)
      cur = ''
      started = false
      continue
    }
    cur += c
  }
  if (cur || started) out.push(cur)
  return out
}

export interface ParsedCurl {
  method: string
  url: string
  headers: ApiHeader[]
  body: string
}

export function parseCurl(cmd: string): ParsedCurl {
  const t = tokenize(cmd.trim())
  if (t[0] !== 'curl') throw new Error('not a curl command')

  const out: ParsedCurl = { method: '', url: '', headers: [], body: '' }
  for (let i = 1; i < t.length; i++) {
    const a = t[i]
    if (a === '-X' || a === '--request') out.method = (t[++i] ?? '').toUpperCase()
    else if (a === '-H' || a === '--header') {
      const raw = t[++i] ?? ''
      const c = raw.indexOf(':')
      if (c > 0) out.headers.push({ key: raw.slice(0, c).trim(), value: raw.slice(c + 1).trim(), enabled: true })
    } else if (a === '-d' || a === '--data' || a === '--data-raw' || a === '--data-binary') {
      out.body = t[++i] ?? ''
    } else if (a === '-u' || a === '--user') {
      out.headers.push({ key: 'Authorization', value: `Basic ${b64(t[++i] ?? '')}`, enabled: true })
    } else if (a === '--compressed' || a === '-L' || a === '--location' || a === '-k' || a === '--insecure' || a === '-s' || a === '--silent') {
      continue
    } else if (a.startsWith('-')) {
      // Unknown flag: skip its value when it plainly has one.
      if (i + 1 < t.length && !t[i + 1].startsWith('-') && !/^https?:/i.test(t[i + 1])) i++
    } else if (!out.url) out.url = a
  }

  if (!out.url) throw new Error('no URL found in the curl command')
  // curl implies POST when a body is present and no method was given.
  if (!out.method) out.method = out.body ? 'POST' : 'GET'
  return out
}
