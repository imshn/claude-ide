import { create } from 'zustand'
import {
  buildFileChange,
  changedIdsInFile,
  groupFiles,
  reconstruct,
  type Decision,
  type FileChange,
  type FileStatus,
  type Group,
} from './review'
import { checkpoint, claude, fs, git, relative, type Detection, type RepoStatus } from './ipc'

export interface ToolCall {
  id: string
  name: string
  input: unknown
  result?: string
  isError?: boolean
}

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'notice'; text: string; tone: 'info' | 'error' }
  | { kind: 'turn'; ok: boolean; ms: number; checkpoint?: string }

export interface Checkpoint {
  tree: string
  label: string
  at: number
}

export type View = 'explorer' | 'changes' | 'git'

interface State {
  root: string | null
  repo: RepoStatus | null

  detection: Detection | null
  sessionId: string
  claudeUp: boolean
  busy: boolean
  chat: ChatItem[]
  streaming: string

  tabs: string[]
  active: string | null
  contents: Record<string, string>
  reveal: { abs: string; line: number } | null

  baseTree: string | null
  checkpoints: Checkpoint[]
  files: FileChange[]
  groups: Group[]
  decisions: Map<string, Decision>
  written: Record<string, string>
  selected: string | null

  view: View
  paletteOpen: boolean
  terminalOpen: boolean
  status: string
}

interface Actions {
  openFolder: (path: string) => Promise<void>
  refreshRepo: () => Promise<void>
  detectClaude: (override?: string) => Promise<void>
  startClaude: () => Promise<void>
  stopClaude: () => Promise<void>
  prompt: (text: string) => Promise<void>
  ingest: (raw: unknown) => void

  openFile: (abs: string) => Promise<void>
  closeTab: (abs: string) => void
  setActive: (abs: string | null) => void
  saveFile: (abs: string, text: string) => Promise<void>
  setReveal: (r: { abs: string; line: number } | null) => void

  snapshot: (label: string) => Promise<string | null>
  refreshChanges: () => Promise<void>
  decide: (ids: string[], d: Decision) => Promise<void>
  acceptAll: () => Promise<void>
  rejectAll: () => Promise<void>
  restore: (tree: string) => Promise<void>
  select: (path: string | null) => void

  set: <K extends keyof State>(k: K, v: State[K]) => void
  note: (text: string) => void
}

const SESSION = crypto.randomUUID()

export const useStore = create<State & Actions>((setState, get) => ({
  root: null,
  repo: null,
  detection: null,
  sessionId: SESSION,
  claudeUp: false,
  busy: false,
  chat: [],
  streaming: '',
  tabs: [],
  active: null,
  contents: {},
  reveal: null,
  baseTree: null,
  checkpoints: [],
  files: [],
  groups: [],
  decisions: new Map(),
  written: {},
  selected: null,
  view: 'explorer',
  paletteOpen: false,
  terminalOpen: false,
  status: 'Ready',

  set: (k, v) => setState({ [k]: v } as Pick<State, typeof k>),
  note: (text) => setState({ status: text }),

  // -- workspace ------------------------------------------------------------
  async openFolder(path) {
    let root = path
    try {
      root = (await git.root(path)) || path
    } catch {
      /* not a repo — handled by refreshRepo */
    }
    setState({
      root,
      tabs: [],
      active: null,
      contents: {},
      files: [],
      groups: [],
      decisions: new Map(),
      written: {},
      baseTree: null,
      checkpoints: [],
      chat: [],
      status: `Opened ${root.split('/').pop()}`,
    })
    await get().refreshRepo()
    // Becomes the diff baseline immediately, so changes made by anything —
    // Claude, the terminal, another editor — are reviewable from the start.
    const tree = await get().snapshot('Opened workspace')
    setState({ baseTree: tree })
  },

  async refreshRepo() {
    const root = get().root
    if (!root) return
    try {
      setState({ repo: await git.status(root) })
    } catch (e) {
      setState({ repo: null, status: String(e) })
    }
  },

  // -- claude ---------------------------------------------------------------
  async detectClaude(override) {
    const detection = await claude.detect(override)
    setState({ detection })
  },

  async startClaude() {
    const { root, detection, sessionId } = get()
    if (!root) return
    if (!detection?.found) {
      setState({
        chat: [
          ...get().chat,
          {
            kind: 'notice',
            tone: 'error',
            text: 'Claude Code was not found. Set its path in Settings (⌘,).',
          },
        ],
      })
      return
    }
    try {
      await claude.start({ id: sessionId, cwd: root, bin: detection.path })
      setState({ claudeUp: true, status: 'Claude Code running' })
    } catch (e) {
      setState({
        claudeUp: false,
        chat: [...get().chat, { kind: 'notice', tone: 'error', text: String(e) }],
      })
    }
  },

  async stopClaude() {
    await claude.stop(get().sessionId).catch(() => {})
    setState({ claudeUp: false, busy: false, status: 'Claude Code stopped' })
  },

  async prompt(text) {
    const { root, claudeUp, sessionId } = get()
    if (!root || !text.trim()) return
    if (!claudeUp) await get().startClaude()
    if (!get().claudeUp) return

    // Every turn gets a restore point before Claude touches anything.
    const tree = await get().snapshot(text.slice(0, 60))
    setState({
      chat: [...get().chat, { kind: 'user', text }],
      busy: true,
      streaming: '',
      baseTree: tree ?? get().baseTree,
    })
    try {
      await claude.send(sessionId, text)
    } catch (e) {
      setState({
        busy: false,
        chat: [...get().chat, { kind: 'notice', tone: 'error', text: String(e) }],
      })
    }
  },

  /** Translate one Claude Code stream-json event into chat state. */
  ingest(raw) {
    const ev = raw as any
    const chat = [...get().chat]

    switch (ev?.type) {
      case 'system':
        if (ev.subtype === 'init') setState({ status: `Claude ready · ${ev.model ?? ''}`.trim() })
        return

      case 'stream_event': {
        const d = ev.event?.delta
        if (d?.type === 'text_delta') setState({ streaming: get().streaming + d.text })
        return
      }

      case 'assistant': {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) {
            chat.push({ kind: 'assistant', text: block.text })
          } else if (block.type === 'tool_use') {
            chat.push({
              kind: 'tool',
              call: { id: block.id, name: block.name, input: block.input },
            })
          }
        }
        setState({ chat, streaming: '' })
        return
      }

      case 'user': {
        // Tool results arrive as synthetic user turns.
        for (const block of ev.message?.content ?? []) {
          if (block.type !== 'tool_result') continue
          const idx = chat.findIndex((c) => c.kind === 'tool' && c.call.id === block.tool_use_id)
          if (idx < 0) continue
          const item = chat[idx] as Extract<ChatItem, { kind: 'tool' }>
          const text =
            typeof block.content === 'string'
              ? block.content
              : (block.content ?? [])
                  .map((c: any) => c.text ?? '')
                  .join('\n')
          chat[idx] = {
            kind: 'tool',
            call: { ...item.call, result: text, isError: !!block.is_error },
          }
        }
        setState({ chat })
        return
      }

      case 'result': {
        chat.push({
          kind: 'turn',
          ok: ev.subtype === 'success',
          ms: ev.duration_ms ?? 0,
          checkpoint: get().baseTree ?? undefined,
        })
        setState({ chat, busy: false, streaming: '' })
        // Claude has stopped writing — surface whatever landed on disk.
        void get().refreshChanges()
        void get().refreshRepo()
        return
      }
    }
  },

  // -- editor ---------------------------------------------------------------
  async openFile(abs) {
    const { tabs, contents } = get()
    if (!(abs in contents)) {
      try {
        const text = await fs.read(abs)
        setState({ contents: { ...get().contents, [abs]: text } })
      } catch (e) {
        setState({ status: `Cannot open: ${e}` })
        return
      }
    }
    setState({ tabs: tabs.includes(abs) ? tabs : [...tabs, abs], active: abs })
  },

  closeTab(abs) {
    const tabs = get().tabs.filter((t) => t !== abs)
    const active = get().active === abs ? (tabs[tabs.length - 1] ?? null) : get().active
    setState({ tabs, active })
  },

  setActive: (abs) => setState({ active: abs }),
  setReveal: (r) => setState({ reveal: r }),

  async saveFile(abs, text) {
    await fs.write(abs, text)
    setState({ contents: { ...get().contents, [abs]: text }, status: 'Saved' })
    void get().refreshRepo()
  },

  // -- change review --------------------------------------------------------
  async snapshot(label) {
    const root = get().root
    if (!root) return null
    try {
      const tree = await checkpoint.create(root)
      const existing = get().checkpoints
      if (existing[0]?.tree === tree) return tree
      setState({ checkpoints: [{ tree, label, at: Date.now() }, ...existing].slice(0, 40) })
      return tree
    } catch (e) {
      setState({ status: `Checkpoint failed: ${e}` })
      return null
    }
  },

  /**
   * Recompute the review set from the active checkpoint. Decisions already
   * applied to disk are folded in: a rejected line is gone from the file, so it
   * simply no longer appears as a change. Undo lives at checkpoint granularity.
   */
  async refreshChanges() {
    const { root, baseTree } = get()
    if (!root || !baseTree) return
    try {
      const changed = await checkpoint.changes(root, baseTree)
      const files: FileChange[] = []
      for (const c of changed) {
        const abs = `${root}/${c.path}`
        const baseline = await checkpoint.fileAt(root, baseTree, c.path)
        let current = ''
        if (c.status !== 'D') current = await fs.read(abs).catch(() => '')
        const status = (c.status === 'A' ? 'A' : c.status === 'D' ? 'D' : 'M') as FileStatus
        files.push(buildFileChange(c.path, abs, status, baseline, current))
      }
      files.sort((a, b) => a.path.localeCompare(b.path))
      setState({
        files,
        groups: groupFiles(files),
        selected: get().selected && files.some((f) => f.path === get().selected)
          ? get().selected
          : (files[0]?.path ?? null),
        view: files.length ? 'changes' : get().view,
        status: files.length ? `${files.length} file${files.length > 1 ? 's' : ''} to review` : 'No changes',
      })
    } catch (e) {
      setState({ status: `Diff failed: ${e}` })
    }
  },

  async decide(ids, d) {
    const decisions = new Map(get().decisions)
    for (const id of ids) decisions.set(id, d)
    setState({ decisions })

    // Only rejections change bytes; write the files those ids belong to.
    const touched = new Set(ids.map((id) => id.split('#')[0]))
    const written = { ...get().written }
    for (const file of get().files) {
      if (!touched.has(file.path)) continue
      const next = reconstruct(file, decisions)
      if (written[file.path] === next) continue
      if (next === '' && file.status === 'A') {
        await fs.remove(file.absPath).catch(() => {})
      } else {
        await fs.write(file.absPath, next).catch(() => {})
      }
      written[file.path] = next
      // Keep an open editor tab in step with what is now on disk.
      if (file.absPath in get().contents) {
        setState({ contents: { ...get().contents, [file.absPath]: next } })
      }
    }
    setState({ written })
    void get().refreshRepo()
  },

  async acceptAll() {
    const ids = get().files.flatMap(changedIdsInFile)
    await get().decide(ids, 'accepted')
    setState({ status: 'All changes accepted' })
  },

  async rejectAll() {
    const ids = get().files.flatMap(changedIdsInFile)
    await get().decide(ids, 'rejected')
    setState({ status: 'All changes reverted' })
  },

  /** Put every file back the way it was at a checkpoint. */
  async restore(tree) {
    const root = get().root
    if (!root) return
    const changed = await checkpoint.changes(root, tree)
    for (const c of changed) {
      const abs = `${root}/${c.path}`
      const baseline = await checkpoint.fileAt(root, tree, c.path)
      if (c.status === 'A' && baseline === '') await fs.remove(abs).catch(() => {})
      else await fs.write(abs, baseline).catch(() => {})
    }
    setState({
      decisions: new Map(),
      written: {},
      contents: {},
      status: 'Restored checkpoint',
    })
    await get().refreshChanges()
    await get().refreshRepo()
  },

  select: (path) => setState({ selected: path }),
}))

export const rel = relative
