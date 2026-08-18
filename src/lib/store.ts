import { create } from 'zustand'
import {
  buildFileChange,
  changedIdsInFile,
  groupFiles,
  proposalAction,
  reconstruct,
  type Decision,
  type FileChange,
  type FileStatus,
  type Group,
} from './review'
import {
  api as apiIpc,
  approval,
  checkpoint,
  claude,
  fs,
  git,
  intel as intelApi,
  media,
  relative,
  skills as skillsIpc,
  watch,
  type Detection,
  type RepoStatus,
  type Skill,
} from './ipc'
import { expandMentions } from './mentions'
import {
  blankRequest,
  flatten,
  interpolate,
  parseCollection,
  parseEnvironment,
  type ApiRequest,
  type TreeNode,
} from './postman'
import { canFormat, format, readConfig } from './format'
import { isMediaPath } from './media'
import { activityFor, applyResult, type Activity } from './activity'
import { projectCard, type Intel } from './intel'
import {
  addUsage,
  approvalMessage,
  DEFAULT_POLICY,
  emptyUsage,
  familyOf,
  isDestructive,
  planFromTool,
  shouldPlan,
  titleFromMarkdown,
  type ApprovalRequest,
  type ChatItem,
  type Checkpoint,
  type PlanComment,
  type PlanDoc,
  type Policy,
  type Usage,
} from './session'

export type View = 'explorer' | 'changes' | 'git' | 'search' | 'api'
export type Tab =
  | { kind: 'file'; path: string }
  | { kind: 'plan'; id: string }
  | { kind: 'api'; id: string }
  | { kind: 'impact'; path: string }

export interface Attachment {
  id: string
  name: string
  path?: string
  kind: string
  mime: string
  base64?: string
  text?: string
  size: number
}
export type { ChatItem }

const SESSION = crypto.randomUUID()

interface State {
  root: string | null
  repo: RepoStatus | null
  intel: Intel | null
  intelLoading: boolean
  detection: Detection | null

  model: string
  /** low | medium | high | xhigh | max, or '' for the CLI default. */
  effort: string
  lean: boolean
  settingsPath: string | null

  claudeSessionId?: string
  running: boolean
  busy: boolean
  planMode: boolean
  chat: ChatItem[]
  activity: Activity[]
  streaming: string
  usage: Usage

  plans: PlanDoc[]
  approvals: ApprovalRequest[]
  policy: Record<string, Policy>
  /** Tool families the user allowed for the rest of this session. */
  sessionAllow: string[]

  tabs: Tab[]
  activeTab: Tab | null
  contents: Record<string, string>
  /** Files that are not text; they open in the media viewer. */
  binaryPaths: string[]
  reveal: { abs: string; line: number } | null
  /** Bumped when a file is opened deliberately, so the editor takes focus. */
  focusEditor: number
  /** Code the user sent to chat with ⌘L. */
  codeSelection: CodeSelection | null

  baseTree: string | null
  checkpoints: Checkpoint[]
  /**
   * What Claude proposed this review round, captured once and held.
   * The diff is derived from this rather than from disk — deriving it from disk
   * meant a rejection erased itself from the next refresh, because rejecting
   * writes the baseline back and the file then looks unchanged.
   */
  proposals: Record<string, Proposal>
  /** Decision undo/redo, so a reject is reversible without a checkpoint. */
  past: DecisionEdit[]
  futureEdits: DecisionEdit[]
  files: FileChange[]
  groups: Group[]
  decisions: Map<string, Decision>
  written: Record<string, string>
  selected: string | null

  /** Live multi-cursor readout for the status bar. */
  cursors: { count: number; chars: number }
  sidebarOpen: boolean
  view: View
  paletteOpen: boolean
  quickOpenOpen: boolean
  shortcutsOpen: boolean
  terminalOpen: boolean
  status: string

  commitDraft: string
  /** When set, the next assistant message is routed somewhere other than chat. */
  capture: 'commit' | null

  attachments: Attachment[]
  skills: Skill[]
  /** Repo-relative paths, for @ mentions. */
  fileIndex: string[]
  prettierConfig: Record<string, unknown> | null

  collections: { id: string; name: string; tree: TreeNode }[]
  requests: Record<string, ApiRequest>
  responses: Record<string, ApiResponse>
  looseRequests: string[]
  apiVars: Record<string, string>
  sendingApi: string | null
}

export interface Proposal {
  baseline: string
  proposed: string
  status: FileStatus
  absPath: string
}

export interface DecisionEdit {
  ids: string[]
  /** Previous value per id; undefined means it had no decision. */
  prev: [string, Decision | undefined][]
}

export interface CodeSelection {
  path: string
  from: number
  to: number
  text: string
}

export interface ApiResponse {
  status: number
  statusText: string
  headers: { key: string; value: string }[]
  body: string
  contentType: string
  ms: number
  size: number
}

export type GitAsk =
  | 'explain'
  | 'commit-message'
  | 'group'
  | 'unrelated'
  | 'review'
  | 'pr'

interface Actions {
  openFolder: (path: string) => Promise<void>
  refreshRepo: () => Promise<void>
  refreshIntel: () => Promise<void>
  detectClaude: (override?: string) => Promise<void>

  prompt: (text: string) => Promise<void>
  stop: () => Promise<void>
  setModel: (m: string) => Promise<void>
  ingest: (raw: unknown) => void
  sessionClosed: () => void

  onApproval: (r: ApprovalRequest) => void
  respond: (id: string, allow: boolean, remember?: boolean) => Promise<void>
  setPolicy: (family: string, p: Policy) => void

  openPlan: (id: string) => void
  addComment: (planId: string, quote: string, body: string) => void
  removeComment: (planId: string, commentId: string) => void
  approvePlan: (planId: string) => Promise<void>
  discardPlan: (planId: string) => void

  openFile: (abs: string) => Promise<void>
  attachSelection: (sel: CodeSelection) => void
  openAsText: (abs: string) => Promise<boolean>
  clearSelection: () => void
  closeTab: (t: Tab) => void
  setActiveTab: (t: Tab | null) => void
  saveFile: (abs: string, text: string) => Promise<void>
  setReveal: (r: { abs: string; line: number } | null) => void

  snapshot: (label: string) => Promise<string | null>
  refreshChanges: () => Promise<void>
  decide: (ids: string[], d: Decision) => Promise<void>
  undoDecision: () => Promise<void>
  redoDecision: () => Promise<void>
  acceptAll: () => Promise<void>
  rejectAll: () => Promise<void>
  restore: (tree: string) => Promise<void>
  select: (path: string | null) => void
  setBaseTree: (tree: string) => void

  askGit: (kind: GitAsk) => Promise<void>
  setCommitDraft: (s: string) => void

  setEffort: (e: string) => Promise<void>
  attachPaths: (paths: string[]) => Promise<void>
  attachRaw: (name: string, mime: string, base64: string) => void
  removeAttachment: (id: string) => void
  loadSkills: () => Promise<void>
  loadFileIndex: () => Promise<void>
  onDiskChanged: (paths: string[]) => Promise<void>
  formatActive: () => Promise<void>

  importCollection: () => Promise<void>
  newRequest: () => void
  openRequest: (id: string) => void
  openImpact: (path: string) => void
  updateRequest: (id: string, patch: Partial<ApiRequest>) => void
  sendRequest: (id: string) => Promise<void>

  set: <K extends keyof State>(k: K, v: State[K]) => void
  note: (text: string) => void
}

/** Smart Git prompts. Each is read-only by construction — none of them ask
 *  Claude to stage, commit or push, which stays a human action. */
const GIT_ASKS: Record<GitAsk, { label: string; prompt: string; capture?: 'commit' }> = {
  explain: {
    label: 'Explain changes',
    prompt:
      'Run `git diff HEAD` and explain what changed and why, grouped by intent. Be concise. Do not modify anything.',
  },
  'commit-message': {
    label: 'Generate commit message',
    capture: 'commit',
    prompt:
      'Run `git diff --staged` (fall back to `git diff HEAD` if nothing is staged) and write one commit message for it. ' +
      'Reply with ONLY the message: a concise subject line under 72 characters, then a blank line, then a short body explaining why. ' +
      'No preamble, no code fences, no quotes. Do not commit anything.',
  },
  group: {
    label: 'Group into commits',
    prompt:
      'Run `git diff HEAD --stat` and `git diff HEAD`, then propose how to split these changes into separate logical commits. ' +
      'For each, give a subject line and the exact file list. Do not stage or commit anything.',
  },
  unrelated: {
    label: 'Find unrelated changes',
    prompt:
      'Run `git diff HEAD` and identify changes unrelated to the main intent — stray formatting, debug output, commented-out code, accidental edits. ' +
      'List them as `path:line` with a one-line reason. If everything looks intentional, say so. Do not modify anything.',
  },
  review: {
    label: 'Review the diff',
    prompt:
      'Run `git diff HEAD` and review it for real defects: logic errors, unhandled failures, security problems, missing tests. ' +
      'Report only issues you are confident about, each as `path:line` with the specific failure. Do not modify anything.',
  },
  pr: {
    label: 'Draft PR description',
    prompt:
      'Run `git diff $(git merge-base HEAD @{u} 2>/dev/null || echo HEAD~1)...HEAD` and write a pull request description: ' +
      'a one-line summary, what changed and why, and how to test it. Markdown. Do not modify anything.',
  },
}

export const GIT_ASK_LABELS = Object.entries(GIT_ASKS).map(([id, v]) => ({
  id: id as GitAsk,
  label: v.label,
}))

/** tool_use id -> plan path, awaiting the result that actually writes it. */
const pendingPlans = new Map<string, string>()

export const useStore = create<State & Actions>((setState, get) => {
  const now = () => Date.now()
  const say = (item: Omit<ChatItem, 'at'>) =>
    setState({ chat: [...get().chat, { ...item, at: now() } as ChatItem] })

  /** Spawn or respawn the CLI. Permission mode and model are fixed per process,
   *  so changing either means a respawn with --resume to keep the thread. */
  const spawn = async (permissionMode: string): Promise<boolean> => {
    const { root, detection, lean, model, effort, claudeSessionId } = get()
    if (!root || !detection?.found) {
      say({ kind: 'notice', tone: 'error', text: 'Claude Code was not found. Set its path in Settings (⌘,).' })
      return false
    }
    let settingsPath = get().settingsPath
    if (!settingsPath) {
      settingsPath = await approval.setup().catch(() => null)
      setState({ settingsPath })
    }
    await claude.stop(SESSION).catch(() => {})
    try {
      await claude.start({
        id: SESSION,
        cwd: root,
        bin: detection.path,
        permissionMode,
        lean,
        model,
        effort,
        resume: claudeSessionId,
        settings: settingsPath ?? undefined,
      })
      setState({ running: true, planMode: permissionMode === 'plan' })
      return true
    } catch (e) {
      setState({ running: false })
      say({ kind: 'notice', tone: 'error', text: String(e) })
      return false
    }
  }

  const send = async (text: string, attachments: Attachment[] = []) => {
    const tree = await get().snapshot(text.slice(0, 60))
    setState({ busy: true, streaming: '', baseTree: tree ?? get().baseTree })
    try {
      await claude.send(
        SESSION,
        text,
        attachments.map((a) => ({
          name: a.name,
          kind: a.kind,
          mime: a.mime,
          base64: a.base64,
          text: a.text,
        })),
      )
    } catch (e) {
      setState({ busy: false })
      say({ kind: 'notice', tone: 'error', text: String(e) })
    }
  }

  /**
   * Write every touched file to what the current decisions imply.
   * Disk is a projection of the decision map, never the source of truth — that
   * inversion is what makes a rejection reversible.
   */
  async function project(decisions: Map<string, Decision>): Promise<string[]> {
    const written = { ...get().written }
    const contents = { ...get().contents }
    const failures: string[] = []

    for (const file of get().files) {
      const next = reconstruct(file, decisions)
      if (written[file.path] === next) continue
      try {
        if (next === '' && file.status === 'A') await fs.remove(file.absPath)
        else await fs.write(file.absPath, next)
        written[file.path] = next
        if (file.absPath in contents) contents[file.absPath] = next
      } catch (e) {
        failures.push(`${file.path}: ${e}`)
      }
    }
    setState({ written, contents })
    void get().refreshRepo()
    return failures
  }

  async function applyDecisions(ids: string[], d: Decision) {
    const decisions = new Map(get().decisions)
    for (const id of ids) decisions.set(id, d)

    const failures = await project(decisions)
    if (failures.length) {
      // Recording a decision whose write failed would claim a revert that never
      // happened, so drop those files' decisions and say so.
      for (const f of failures) {
        const path = f.split(':')[0]
        for (const id of ids) if (id.startsWith(`${path}#`)) decisions.delete(id)
      }
      setState({ decisions, status: `Could not write ${failures[0]}` })
      say({ kind: 'notice', tone: 'error', text: `Could not apply your review:\n${failures.join('\n')}` })
      return
    }

    setState({ decisions })
    const total = get().files.flatMap(changedIdsInFile)
    const left = total.filter((id) => !decisions.has(id)).length
    setState({
      status: left ? `${left} change${left === 1 ? '' : 's'} left to review` : 'Every change reviewed',
    })
  }

  /** Honour the repo's own prettier settings rather than imposing ours. */
  async function loadPrettierConfig(root: string) {
    for (const [file, fromPkg] of [
      ['.prettierrc', false],
      ['.prettierrc.json', false],
      ['package.json', true],
    ] as const) {
      const raw = await fs.read(`${root}/${file}`).catch(() => null)
      const cfg = raw && readConfig(raw, fromPkg)
      if (cfg) return setState({ prettierConfig: cfg })
    }
    setState({ prettierConfig: null })
  }

  async function capturePlan(found: { inline?: string; path?: string }) {
    let markdown = found.inline ?? ''
    if (!markdown && found.path) markdown = await fs.read(found.path).catch(() => '')
    if (!markdown.trim()) return

    const id = crypto.randomUUID()
    const doc: PlanDoc = {
      id,
      title: titleFromMarkdown(markdown, 'Implementation plan'),
      markdown,
      path: found.path,
      source: found.inline ? 'tool' : 'file',
      comments: [],
      approved: false,
      at: now(),
    }
    setState({ plans: [doc, ...get().plans] })
    // Open it like any other document — the whole point of the change.
    get().openPlan(id)
    say({ kind: 'notice', tone: 'info', text: `Plan ready: ${doc.title}` })
  }

  const patchPlan = (id: string, fn: (p: PlanDoc) => PlanDoc) =>
    setState({ plans: get().plans.map((p) => (p.id === id ? fn(p) : p)) })

  return {
    root: null,
    repo: null,
    intel: null,
    intelLoading: false,
    detection: null,
    model: '',
    effort: '',
    lean: true,
    settingsPath: null,
    running: false,
    busy: false,
    planMode: false,
    chat: [],
    activity: [],
    streaming: '',
    usage: emptyUsage(),
    plans: [],
    approvals: [],
    policy: { ...DEFAULT_POLICY },
    sessionAllow: [],
    tabs: [],
    activeTab: null,
    contents: {},
    binaryPaths: [],
    reveal: null,
    focusEditor: 0,
    codeSelection: null,
    baseTree: null,
    checkpoints: [],
    proposals: {},
    past: [],
    futureEdits: [],
    files: [],
    groups: [],
    decisions: new Map(),
    written: {},
    selected: null,
    cursors: { count: 0, chars: 0 },
    sidebarOpen: true,
    view: 'explorer',
    paletteOpen: false,
    quickOpenOpen: false,
    shortcutsOpen: false,
    terminalOpen: false,
    status: 'Ready',
    commitDraft: '',
    capture: null,
    attachments: [],
    skills: [],
    fileIndex: [],
    prettierConfig: null,
    collections: [],
    requests: {},
    responses: {},
    looseRequests: [],
    apiVars: {},
    sendingApi: null,

    setCommitDraft: (s) => setState({ commitDraft: s }),

    async askGit(kind) {
      const ask = GIT_ASKS[kind]
      if (!get().root) return
      setState({ capture: ask.capture ?? null })
      await get().prompt(ask.prompt)
    },


    // -- chat attachments, skills, formatting -------------------------------
    async setEffort(e) {
      setState({ effort: e })
      if (get().running) {
        await spawn(get().planMode ? 'plan' : 'acceptEdits')
        setState({ status: `Effort: ${e || 'default'}` })
      }
    },

    /** Attach files by path — from the picker, a drop, or the file tree. */
    async attachPaths(paths) {
      const added: Attachment[] = []
      for (const path of paths) {
        try {
          const blob = await media.read(path)
          const name = path.split('/').pop() ?? path
          added.push(
            blob.kind === 'image'
              ? { id: crypto.randomUUID(), name, path, kind: 'image', mime: blob.mime, base64: blob.base64, size: blob.size }
              : {
                  id: crypto.randomUUID(),
                  name,
                  path,
                  kind: 'text',
                  mime: blob.mime,
                  // Non-images go as text; binaries would be noise to the model.
                  text: blob.kind === 'binary' ? undefined : await fs.read(path).catch(() => undefined),
                  size: blob.size,
                },
          )
        } catch (e) {
          setState({ status: `Cannot attach ${path.split('/').pop()}: ${e}` })
        }
      }
      const usable = added.filter((a) => a.kind === 'image' || a.text)
      if (usable.length < added.length) {
        setState({ status: 'Skipped a binary file — Claude cannot read it' })
      }
      setState({ attachments: [...get().attachments, ...usable] })
    },

    /** Attach something pasted or dropped that never had a path. */
    attachRaw(name, mime, base64) {
      setState({
        attachments: [
          ...get().attachments,
          {
            id: crypto.randomUUID(),
            name,
            kind: mime.startsWith('image/') ? 'image' : 'text',
            mime,
            base64,
            size: Math.floor((base64.length * 3) / 4),
          },
        ],
      })
    },

    removeAttachment: (id) => setState({ attachments: get().attachments.filter((a) => a.id !== id) }),

    async loadSkills() {
      try {
        const all = await skillsIpc.list(get().root ?? undefined)
        // Model-only skills would be dead entries in a `/` menu.
        setState({ skills: all.filter((s) => s.user_invocable) })
      } catch {
        setState({ skills: [] })
      }
    },

    /**
     * Something changed on disk outside the app. Re-derive the review state and
     * reload open files — except the one being edited, whose in-memory edits we
     * would otherwise silently discard.
     */
    async onDiskChanged(paths) {
      const { root, activeTab } = get()
      if (!root) return
      const active = activeTab?.kind === 'file' ? activeTab.path : null

      const contents = { ...get().contents }
      let reloaded = 0
      for (const abs of paths) {
        if (!(abs in contents) || abs === active) continue
        const next = await fs.read(abs).catch(() => null)
        if (next !== null && next !== contents[abs]) {
          contents[abs] = next
          reloaded++
        }
      }
      if (reloaded) setState({ contents })

      await get().refreshRepo()
      await get().refreshChanges()
      void get().loadFileIndex()
    },

    async loadFileIndex() {
      const root = get().root
      if (!root) return
      try {
        const out = await git.lsFiles(root)
        setState({ fileIndex: out })
      } catch {
        setState({ fileIndex: [] })
      }
    },

    async formatActive() {
      const tab = get().activeTab
      if (tab?.kind !== 'file') return setState({ status: 'Nothing to format' })
      const path = tab.path
      if (!canFormat(path)) return setState({ status: `No formatter for ${path.split('/').pop()}` })
      try {
        const next = await format(path, get().contents[path] ?? '', get().prettierConfig)
        if (next === get().contents[path]) return setState({ status: 'Already formatted' })
        await get().saveFile(path, next)
        setState({ status: 'Formatted' })
      } catch (e) {
        setState({ status: `Format failed: ${String(e).split('\n')[0]}` })
      }
    },

    // -- API workbench ------------------------------------------------------
    async importCollection() {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        multiple: true,
        filters: [{ name: 'Postman export', extensions: ['json'] }],
      })
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
      let imported = 0

      for (const path of paths) {
        try {
          const raw = await apiIpc.readJson(path)
          // An environment export has `values` and no `item`.
          if (/"values"\s*:/.test(raw) && !/"item"\s*:/.test(raw)) {
            setState({ apiVars: { ...get().apiVars, ...parseEnvironment(raw) } })
            setState({ status: 'Imported environment variables' })
            continue
          }
          const parsed = parseCollection(raw)
          const { tree, requests } = flatten(parsed.root)
          setState({
            collections: [...get().collections, { id: parsed.id, name: parsed.name, tree }],
            requests: { ...get().requests, ...requests },
            apiVars: { ...parsed.variables, ...get().apiVars },
          })
          imported += Object.keys(requests).length
        } catch (e) {
          setState({ status: `Import failed: ${e}` })
          return
        }
      }
      if (imported) setState({ status: `Imported ${imported} request${imported === 1 ? '' : 's'}` })
    },

    newRequest() {
      const req = blankRequest()
      setState({
        requests: { ...get().requests, [req.id]: req },
        looseRequests: [...get().looseRequests, req.id],
      })
      get().openRequest(req.id)
    },

    openImpact(path) {
      const tab: Tab = { kind: 'impact', path }
      const exists = get().tabs.some((t) => t.kind === 'impact' && t.path === path)
      setState({ tabs: exists ? get().tabs : [...get().tabs, tab], activeTab: tab })
    },

    openRequest(id) {
      const tab: Tab = { kind: 'api', id }
      const exists = get().tabs.some((t) => t.kind === 'api' && t.id === id)
      setState({ tabs: exists ? get().tabs : [...get().tabs, tab], activeTab: tab })
    },

    updateRequest(id, patch) {
      const req = get().requests[id]
      if (!req) return
      setState({ requests: { ...get().requests, [id]: { ...req, ...patch } } })
    },

    async sendRequest(id) {
      const req = get().requests[id]
      if (!req) return
      const vars = get().apiVars
      setState({ sendingApi: id })
      try {
        const res = await apiIpc.send({
          method: req.method,
          url: interpolate(req.url, vars),
          headers: req.headers
            .filter((h) => h.enabled && h.key.trim())
            .map((h) => ({ key: h.key, value: interpolate(h.value, vars), enabled: true })),
          body: req.bodyType === 'none' ? undefined : interpolate(req.body, vars),
        })
        setState({
          responses: {
            ...get().responses,
            [id]: {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
              body: res.body,
              contentType: res.contentType,
              ms: res.ms,
              size: res.size,
            },
          },
          status: `${req.method} ${res.status} · ${res.ms} ms`,
        })
      } catch (e) {
        setState({
          responses: {
            ...get().responses,
            [id]: {
              status: 0,
              statusText: 'Request failed',
              headers: [],
              body: String(e),
              contentType: '',
              ms: 0,
              size: 0,
            },
          },
          status: `Request failed: ${String(e).slice(0, 80)}`,
        })
      } finally {
        setState({ sendingApi: null })
      }
    },

    set: (k, v) => setState({ [k]: v } as Pick<State, typeof k>),
    note: (text) => setState({ status: text }),
    setReveal: (r) => setState({ reveal: r }),
    select: (path) => setState({ selected: path }),
    setBaseTree: (tree) => setState({ baseTree: tree }),
    setActiveTab: (t) => setState({ activeTab: t }),

    // -- workspace ----------------------------------------------------------
    async openFolder(path) {
      await claude.stop(SESSION).catch(() => {})
      let root = path
      try {
        root = (await git.root(path)) || path
      } catch {
        /* not a repo — surfaced by refreshRepo */
      }
      setState({
        root,
        tabs: [],
        activeTab: null,
        contents: {},
        binaryPaths: [],
        codeSelection: null,
        intel: null,
        chat: [],
        activity: [],
        plans: [],
        approvals: [],
        files: [],
        groups: [],
        decisions: new Map(),
        written: {},
        checkpoints: [],
        proposals: {},
        past: [],
        futureEdits: [],
        usage: emptyUsage(),
        running: false,
        busy: false,
        claudeSessionId: undefined,
        view: 'explorer',
        status: `Opened ${root.split('/').pop()}`,
      })
      await get().refreshRepo()
      void get().refreshIntel()
      void get().loadSkills()
      void get().loadFileIndex()
      void loadPrettierConfig(root)
      void watch.start(root).catch(() => setState({ status: 'File watching unavailable' }))
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

    async refreshIntel() {
      const root = get().root
      if (!root) return
      setState({ intelLoading: true })
      try {
        setState({ intel: await intelApi.scan<Intel>(root), intelLoading: false })
      } catch (e) {
        setState({ intelLoading: false, status: `Project scan failed: ${e}` })
      }
    },

    async detectClaude(override) {
      setState({ detection: await claude.detect(override) })
    },

    // -- conversation -------------------------------------------------------
    async prompt(text) {
      const { root, running, planMode, attachments } = get()
      if (!root || (!text.trim() && !attachments.length)) return

      // `@path` becomes a backticked repo path so Claude reads it unambiguously.
      const { text: mentioned } = expandMentions(text, get().fileIndex)

      // ⌘L selections travel as a fenced block with their real line numbers, so
      // Claude can act on "these lines" without guessing where they came from.
      const sel = get().codeSelection
      const withCode = sel
        ? `${mentioned}\n\nFrom \`${sel.path}\` lines ${sel.from}-${sel.to}:\n\n\`\`\`\n${sel.text}\n\`\`\``
        : mentioned

      const { plan, reason } = shouldPlan(text)
      const card = projectCard(get().intel)
      // Only the first message of a session needs the brief.
      const body = get().chat.length === 0 && card ? `${withCode}\n\n${card}` : withCode

      say({
        kind: 'user',
        text: [
          text,
          sel ? `[${sel.path.split('/').pop()}:${sel.from}-${sel.to}]` : '',
          attachments.length ? `[${attachments.map((a) => a.name).join(', ')}]` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      })
      const outgoing = attachments
      setState({ attachments: [], codeSelection: null })

      // Plan mode is a property of the process, so switching costs a respawn.
      const wantPlan = plan && !planMode
      if (wantPlan) say({ kind: 'notice', tone: 'info', text: `Planning first — ${reason}.` })

      if (!running || wantPlan || (planMode && !plan)) {
        if (!(await spawn(wantPlan ? 'plan' : 'acceptEdits'))) return
      }
      await send(body, outgoing)
    },

    async stop() {
      await claude.stop(SESSION).catch(() => {})
      setState({ running: false, busy: false, status: 'Stopped' })
    },

    async setModel(m) {
      setState({ model: m })
      if (get().running) {
        await spawn(get().planMode ? 'plan' : 'acceptEdits')
        setState({ status: `Model: ${m || 'default'}` })
      }
    },

    sessionClosed() {
      setState({ running: false, busy: false })
    },

    ingest(raw) {
      const ev = raw as any
      switch (ev?.type) {
        case 'system':
          if (ev.subtype === 'init') {
            setState({
              claudeSessionId: ev.session_id ?? get().claudeSessionId,
              status: `Claude ready · ${ev.model ?? ''}`.trim(),
            })
          }
          return

        case 'stream_event': {
          const d = ev.event?.delta
          if (d?.type === 'text_delta') setState({ streaming: get().streaming + d.text })
          return
        }

        case 'assistant': {
          for (const block of ev.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              setState({ streaming: '' })
              if (get().capture === 'commit') {
                // Strip any fencing the model added despite being told not to.
                const msg = block.text
                  .replace(/^\s*```[a-z]*\n?/i, '')
                  .replace(/```\s*$/, '')
                  .trim()
                setState({ capture: null, commitDraft: msg, status: 'Commit message ready' })
              }
              say({ kind: 'assistant', text: block.text })
            } else if (block.type === 'tool_use') {
              setState({
                streaming: '',
                activity: [...get().activity, activityFor(block.id, block.name, block.input, now())],
              })
              const found = planFromTool(block.name, block.input)
              if (found?.inline) void capturePlan(found)
              // A plan file does not exist until the tool has actually run.
              else if (found?.path) pendingPlans.set(block.id, found.path)
            }
          }
          return
        }

        case 'user': {
          for (const block of ev.message?.content ?? []) {
            if (block.type !== 'tool_result') continue
            const planPath = pendingPlans.get(block.tool_use_id)
            if (planPath) {
              pendingPlans.delete(block.tool_use_id)
              if (!block.is_error) void capturePlan({ path: planPath })
            }
            const text =
              typeof block.content === 'string'
                ? block.content
                : (block.content ?? []).map((c: any) => c.text ?? '').join('\n')
            setState({
              activity: get().activity.map((a) =>
                a.id === block.tool_use_id ? applyResult(a, text, !!block.is_error) : a,
              ),
            })
          }
          return
        }

        case 'result': {
          const ok = ev.subtype === 'success'

          // Claude sometimes plans by delegating to a subagent and never emits a
          // plan tool call or file, which used to mean no approval gate opened
          // at all. Fall back to the turn's final prose, which *is* the plan.
          if (get().planMode && !get().plans.some((p) => !p.approved) && ok) {
            const lastText = [...get().chat].reverse().find((c) => c.kind === 'assistant')?.text
            if (lastText && lastText.trim().length > 120) {
              void capturePlan({ inline: lastText })
            }
          }

          setState({
            busy: false,
            streaming: '',
            usage: addUsage(get().usage, ev),
            chat: [...get().chat, { kind: 'turn', ok, ms: ev.duration_ms ?? 0, at: now() }],
          })
          void get().refreshChanges()
          void get().refreshRepo()
          return
        }
      }
    },

    // -- approvals ----------------------------------------------------------
    onApproval(r) {
      const family = familyOf(r.tool)
      const allowed =
        get().policy[family] === 'allow' || get().sessionAllow.includes(family)
      // A session-wide allow still does not cover obviously destructive shell.
      if (allowed && !isDestructive(r.tool, r.input)) {
        void approval.respond(r.id, true, 'Allowed by workspace policy')
        return
      }
      setState({ approvals: [...get().approvals, r], status: `Claude needs approval: ${r.tool}` })
    },

    async respond(id, allow, remember) {
      const req = get().approvals.find((a) => a.id === id)
      await approval.respond(id, allow, '').catch(() => {})
      setState({ approvals: get().approvals.filter((a) => a.id !== id) })
      if (remember && req && allow) {
        const family = familyOf(req.tool)
        setState({ sessionAllow: [...new Set([...get().sessionAllow, family])] })
      }
    },

    setPolicy: (family, p) => setState({ policy: { ...get().policy, [family]: p } }),

    // -- plans --------------------------------------------------------------
    openPlan(id) {
      const tab: Tab = { kind: 'plan', id }
      const exists = get().tabs.some((t) => t.kind === 'plan' && t.id === id)
      setState({
        tabs: exists ? get().tabs : [...get().tabs, tab],
        activeTab: tab,
        view: get().view === 'changes' ? 'explorer' : get().view,
      })
    },

    addComment(planId, quote, body) {
      const c: PlanComment = { id: crypto.randomUUID(), quote, body, at: now() }
      patchPlan(planId, (p) => ({ ...p, comments: [...p.comments, c] }))
    },

    removeComment(planId, commentId) {
      patchPlan(planId, (p) => ({ ...p, comments: p.comments.filter((c) => c.id !== commentId) }))
    },

    async approvePlan(planId) {
      const plan = get().plans.find((p) => p.id === planId)
      if (!plan) return
      patchPlan(planId, (p) => ({ ...p, approved: true }))
      say({ kind: 'notice', tone: 'info', text: `Plan approved${plan.comments.length ? ` with ${plan.comments.length} comment${plan.comments.length > 1 ? 's' : ''}` : ''} — executing.` })
      if (!(await spawn('acceptEdits'))) return
      await send(approvalMessage(plan))
    },

    discardPlan(planId) {
      const active = get().activeTab
      const wasActive = active?.kind === 'plan' && active.id === planId
      setState({
        plans: get().plans.filter((p) => p.id !== planId),
        tabs: get().tabs.filter((t) => !(t.kind === 'plan' && t.id === planId)),
        activeTab: wasActive ? null : active,
      })
    },

    // -- editor -------------------------------------------------------------
    async openFile(abs) {
      const { tabs, contents } = get()
      const seen = abs in contents || get().binaryPaths.includes(abs)

      if (!seen) {
        // Known media never gets a text read. Anything else is tried as text and
        // falls back to the viewer if it isn't — refusing to open a file the
        // extension list happens to miss is the bug this replaces.
        if (isMediaPath(abs)) {
          setState({ binaryPaths: [...get().binaryPaths, abs] })
        } else {
          try {
            setState({ contents: { ...contents, [abs]: await fs.read(abs) } })
          } catch {
            setState({ binaryPaths: [...get().binaryPaths, abs] })
          }
        }
      }

      const tab: Tab = { kind: 'file', path: abs }
      const exists = tabs.some((t) => t.kind === 'file' && t.path === abs)
      // Opening a file is a deliberate act; VS Code puts the caret in it.
      setState({
        tabs: exists ? tabs : [...tabs, tab],
        activeTab: tab,
        focusEditor: get().focusEditor + 1,
      })
    },

    /** Load a media file's text so it can be edited as source (SVG, mostly). */
    async openAsText(abs) {
      if (abs in get().contents) return true
      try {
        setState({ contents: { ...get().contents, [abs]: await fs.read(abs) } })
        return true
      } catch (e) {
        setState({ status: `Cannot edit as text: ${e}` })
        return false
      }
    },

    attachSelection(sel) {
      setState({
        codeSelection: sel,
        status: `Sent ${sel.path.split('/').pop()}:${sel.from}-${sel.to} to chat`,
      })
    },

    clearSelection: () => setState({ codeSelection: null }),

    closeTab(t) {
      const same = (a: Tab, b: Tab) =>
        a.kind === b.kind &&
        (a.kind === 'file' || a.kind === 'impact'
          ? a.path === (b as any).path
          : a.id === (b as any).id)
      const tabs = get().tabs.filter((x) => !same(x, t))
      const active = get().activeTab && same(get().activeTab!, t)
        ? (tabs[tabs.length - 1] ?? null)
        : get().activeTab
      setState({ tabs, activeTab: active })
    },

    async saveFile(abs, text) {
      await fs.write(abs, text)
      setState({ contents: { ...get().contents, [abs]: text }, status: 'Saved' })
      void get().refreshRepo()
    },

    // -- change review ------------------------------------------------------
    async snapshot(label) {
      const root = get().root
      if (!root) return null
      try {
        const tree = await checkpoint.create(root)
        if (get().checkpoints[0]?.tree !== tree) {
          setState({
            checkpoints: [{ tree, label, at: now() }, ...get().checkpoints].slice(0, 40),
          })
        }
        return tree
      } catch (e) {
        setState({ status: `Checkpoint failed: ${e}` })
        return null
      }
    },

    async refreshChanges() {
      const root = get().root
      if (!root) return setState({ status: 'No folder open' })

      // A missing baseline used to make this a silent no-op, which reads exactly
      // like a dead Refresh button. Establish one instead and say so.
      let baseTree = get().baseTree
      if (!baseTree) {
        baseTree = await get().snapshot('Baseline')
        if (!baseTree) return setState({ status: 'Could not create a baseline checkpoint' })
        setState({ baseTree })
      }

      try {
        const changed = await checkpoint.changes(root, baseTree)
        const proposals = { ...get().proposals }
        const written = get().written
        let decisions = new Map(get().decisions)

        for (const c of changed) {
          const abs = `${root}/${c.path}`
          const disk = c.status === 'D' ? '' : await fs.read(abs).catch(() => '')
          const existing = proposals[c.path]

          // If the disk matches what we last wrote, this is our own projection of
          // the user's decisions — keep the proposal we already hold. Otherwise
          // Claude has written something new, so it becomes the proposal and any
          // decisions about the old one no longer mean anything.
          if (proposalAction(!!existing, written[c.path], disk) === 'keep') continue

          if (existing) {
            for (const id of changedIdsInFile(buildFileChange(c.path, abs, existing.status, existing.baseline, existing.proposed))) {
              decisions.delete(id)
            }
          }
          proposals[c.path] = {
            baseline: await checkpoint.fileAt(root, baseTree, c.path),
            proposed: disk,
            status: (c.status === 'A' ? 'A' : c.status === 'D' ? 'D' : 'M') as FileStatus,
            absPath: abs,
          }
        }

        const files = Object.entries(proposals)
          .map(([path, p]) => buildFileChange(path, p.absPath, p.status, p.baseline, p.proposed))
          .filter((f) => f.hunks.length > 0)
          .sort((a, b) => a.path.localeCompare(b.path))

        setState({
          proposals,
          decisions,
          files,
          groups: groupFiles(files),
          selected:
            get().selected && files.some((f) => f.path === get().selected)
              ? get().selected
              : (files[0]?.path ?? null),
          view: files.length ? 'changes' : get().view,
          status: files.length
            ? `${files.length} file${files.length > 1 ? 's' : ''} to review`
            : `No changes since checkpoint ${baseTree.slice(0, 7)}`,
        })
      } catch (e) {
        setState({ status: `Diff failed: ${e}` })
      }
    },

    async decide(ids, d) {
      const prev: [string, Decision | undefined][] = ids.map((id) => [id, get().decisions.get(id)])
      await applyDecisions(ids, d)
      // One entry per user action, so undo steps back the way they clicked.
      setState({ past: [...get().past, { ids, prev }].slice(-100), futureEdits: [] })
    },

    async undoDecision() {
      const past = [...get().past]
      const edit = past.pop()
      if (!edit) return setState({ status: 'Nothing to undo' })

      const redo: [string, Decision | undefined][] = edit.ids.map((id) => [id, get().decisions.get(id)])
      const decisions = new Map(get().decisions)
      for (const [id, value] of edit.prev) {
        if (value === undefined) decisions.delete(id)
        else decisions.set(id, value)
      }
      await project(decisions)
      setState({
        decisions,
        past,
        futureEdits: [...get().futureEdits, { ids: edit.ids, prev: redo }],
        status: 'Undid last review decision',
      })
    },

    async redoDecision() {
      const future = [...get().futureEdits]
      const edit = future.pop()
      if (!edit) return setState({ status: 'Nothing to redo' })

      const undo: [string, Decision | undefined][] = edit.ids.map((id) => [id, get().decisions.get(id)])
      const decisions = new Map(get().decisions)
      for (const [id, value] of edit.prev) {
        if (value === undefined) decisions.delete(id)
        else decisions.set(id, value)
      }
      await project(decisions)
      setState({
        decisions,
        futureEdits: future,
        past: [...get().past, { ids: edit.ids, prev: undo }],
        status: 'Redid review decision',
      })
    },

    async acceptAll() {
      await get().decide(get().files.flatMap(changedIdsInFile), 'accepted')
      setState({ status: 'All changes accepted' })
    },

    async rejectAll() {
      await get().decide(get().files.flatMap(changedIdsInFile), 'rejected')
      setState({ status: 'All changes reverted' })
    },

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
      setState({ decisions: new Map(), written: {}, contents: {}, status: 'Restored checkpoint' })
      await get().refreshChanges()
      await get().refreshRepo()
    },
  }
})

export const rel = relative
export type { Activity }
