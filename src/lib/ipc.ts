import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface Entry {
  name: string
  path: string
  is_dir: boolean
}
export interface StatusEntry {
  path: string
  index: string
  worktree: string
}
export interface RepoStatus {
  is_repo: boolean
  branch: string
  ahead: number
  behind: number
  entries: StatusEntry[]
}
export interface Commit {
  hash: string
  short: string
  author: string
  date: string
  subject: string
}
export interface ChangedFile {
  path: string
  status: string
}
export interface Detection {
  found: boolean
  path: string
  version: string
  searched: string[]
}

export const fs = {
  listDir: (path: string) => invoke<Entry[]>('list_dir', { path }),
  read: (path: string) => invoke<string>('read_file', { path }),
  write: (path: string, contents: string) => invoke<void>('write_file', { path, contents }),
  remove: (path: string) => invoke<void>('delete_file', { path }),
  reveal: (path: string) => invoke<void>('reveal_in_finder', { path }),
  exists: (path: string) => invoke<boolean>('path_exists', { path }),
}

export const git = {
  status: (cwd: string) => invoke<RepoStatus>('git_status', { cwd }),
  stage: (cwd: string, paths: string[]) => invoke<void>('git_stage', { cwd, paths }),
  unstage: (cwd: string, paths: string[]) => invoke<void>('git_unstage', { cwd, paths }),
  commit: (cwd: string, message: string) => invoke<string>('git_commit', { cwd, message }),
  branches: (cwd: string) => invoke<string[]>('git_branches', { cwd }),
  checkout: (cwd: string, branch: string) => invoke<string>('git_checkout', { cwd, branch }),
  log: (cwd: string, limit: number) => invoke<Commit[]>('git_log', { cwd, limit }),
  root: (cwd: string) => invoke<string>('git_repo_root', { cwd }),
  init: (cwd: string) => invoke<string>('git_init', { cwd }),
  lsFiles: async (cwd: string) =>
    (await invoke<string[]>('git_ls_files', { cwd })) ?? [],
  fileDiff: (cwd: string, path: string, staged: boolean) =>
    invoke<string>('git_file_diff', { cwd, path, staged }),
}

export const checkpoint = {
  create: (cwd: string) => invoke<string>('checkpoint_create', { cwd }),
  changes: (cwd: string, tree: string) => invoke<ChangedFile[]>('checkpoint_changes', { cwd, tree }),
  fileAt: (cwd: string, tree: string, path: string) =>
    invoke<string>('file_at_tree', { cwd, tree, path }),
}

export const intel = {
  scan: <T>(root: string) => invoke<T>('project_intel', { root }),
}

export interface Hit {
  path: string
  line: number
  col: number
  text: string
  before: string[]
  after: string[]
}
export interface SearchResults {
  hits: Hit[]
  files: string[]
  truncated: boolean
  scanned: number
}

export const search = {
  run: (root: string, query: string, mode: string, caseSensitive: boolean) =>
    invoke<SearchResults>('repo_search', { root, query, mode, caseSensitive }),
}

export interface Blob {
  mime: string
  base64: string
  size: number
  kind: 'image' | 'svg' | 'video' | 'audio' | 'pdf' | 'binary' | 'text'
}

export const media = {
  read: (path: string) => invoke<Blob>('read_binary', { path }),
  kind: (path: string) => invoke<[string, string]>('media_kind', { path }),
}

export interface Skill {
  name: string
  description: string
  user_invocable: boolean
  source: string
}

export const skills = {
  list: (cwd?: string) => invoke<Skill[]>('list_skills', { cwd }),
}

export interface ApiWire {
  method: string
  url: string
  headers: { key: string; value: string; enabled: boolean }[]
  body?: string
  followRedirects?: boolean
  timeoutSecs?: number
  insecure?: boolean
  form?: { key: string; value: string; path?: string; enabled: boolean }[]
}

export interface ApiResponseWire {
  status: number
  statusText: string
  headers: { key: string; value: string }[]
  body: string
  bodyIsBinary: boolean
  contentType: string
  ms: number
  size: number
}

export const api = {
  send: (req: ApiWire) => invoke<ApiResponseWire>('api_send', { req }),
  readJson: (path: string) => invoke<string>('read_json_file', { path }),
}

export interface SymbolDef {
  name: string
  kind: string
  path: string
  line: number
  exported: boolean
}
export interface SymbolRef {
  name: string
  path: string
  line: number
  text: string
}
export interface ImpactReport {
  path: string
  definitions: SymbolDef[]
  importers: SymbolRef[]
  callers: SymbolRef[]
  tests: string[]
  files_affected: number
  scanned: number
  truncated: boolean
}

export const impact = {
  analyze: (root: string, path: string) => invoke<ImpactReport>('analyze_impact', { root, path }),
  symbols: (root: string, query: string) => invoke<SymbolDef[]>('symbol_index', { root, query }),
}

export interface DebugTarget {
  id: string
  ws_url: string
  port: number
  pid: number
}

export const debug = {
  start: (opts: { id: string; cwd: string; program: string; args: string[]; runtime?: string }) =>
    invoke<DebugTarget>('debug_start', opts),
  stop: (id: string) => invoke<void>('debug_stop', { id }),
  running: (id: string) => invoke<boolean>('debug_running', { id }),
}

export const onDebugOutput = (cb: (e: { id: string; stream: string; line: string }) => void) =>
  listen<{ id: string; stream: string; line: string }>('debug-output', (e) => cb(e.payload))

export const watch = {
  start: (root: string) => invoke<void>('watch_start', { root }),
  stop: () => invoke<void>('watch_stop'),
}

export const onFsChanged = (cb: (paths: string[]) => void) =>
  listen<string[]>('fs-changed', (e) => cb(e.payload))

export const approval = {
  setup: () => invoke<string>('approval_setup'),
  respond: (id: string, allow: boolean, reason: string) =>
    invoke<void>('approval_respond', { id, allow, reason }),
}

export interface ApprovalEvent {
  id: string
  tool: string
  input: unknown
  cwd: string
}

export const onApproval = (cb: (e: ApprovalEvent) => void) =>
  listen<ApprovalEvent>('approval', (e) => cb(e.payload))

export interface WireAttachment {
  name: string
  kind: string
  mime: string
  base64?: string
  text?: string
}

export const claude = {
  detect: (overridePath?: string) => invoke<Detection>('claude_detect', { overridePath }),
  start: (opts: {
    id: string
    cwd: string
    bin: string
    model?: string
    permissionMode?: string
    resume?: string
    lean?: boolean
    settings?: string
    effort?: string
  }) => invoke<void>('claude_start', opts),
  send: (id: string, text: string, attachments?: WireAttachment[]) =>
    invoke<void>('claude_send', { id, text, attachments }),
  stop: (id: string) => invoke<void>('claude_stop', { id }),
  running: (id: string) => invoke<boolean>('claude_running', { id }),
}

export const pty = {
  open: (id: string, cwd: string, rows: number, cols: number) =>
    invoke<void>('pty_open', { id, cwd, rows, cols }),
  write: (id: string, data: string) => invoke<void>('pty_write', { id, data }),
  resize: (id: string, rows: number, cols: number) => invoke<void>('pty_resize', { id, rows, cols }),
  close: (id: string) => invoke<void>('pty_close', { id }),
}

export interface ClaudeEvent {
  session: string
  kind: 'message' | 'raw' | 'stderr' | 'closed'
  data: unknown
}

export const onClaude = (cb: (e: ClaudeEvent) => void) =>
  listen<ClaudeEvent>('claude', (e) => cb(e.payload))

export const onPty = (cb: (e: { id: string; data: string }) => void) =>
  listen<{ id: string; data: string }>('pty', (e) => cb(e.payload))

export const relative = (root: string, abs: string) =>
  abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs
