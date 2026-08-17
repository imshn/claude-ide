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
  fileDiff: (cwd: string, path: string, staged: boolean) =>
    invoke<string>('git_file_diff', { cwd, path, staged }),
}

export const checkpoint = {
  create: (cwd: string) => invoke<string>('checkpoint_create', { cwd }),
  changes: (cwd: string, tree: string) => invoke<ChangedFile[]>('checkpoint_changes', { cwd, tree }),
  fileAt: (cwd: string, tree: string, path: string) =>
    invoke<string>('file_at_tree', { cwd, tree, path }),
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
  }) => invoke<void>('claude_start', opts),
  send: (id: string, text: string) => invoke<void>('claude_send', { id, text }),
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
