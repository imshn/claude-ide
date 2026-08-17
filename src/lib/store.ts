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
import {
  approval,
  checkpoint,
  claude,
  fs,
  git,
  intel as intelApi,
  relative,
  type Detection,
  type RepoStatus,
} from './ipc'
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

export type View = 'explorer' | 'changes' | 'git' | 'search'
export type Tab = { kind: 'file'; path: string } | { kind: 'plan'; id: string }
export type { ChatItem }

const SESSION = crypto.randomUUID()

interface State {
  root: string | null
  repo: RepoStatus | null
  intel: Intel | null
  intelLoading: boolean
  detection: Detection | null

  model: string
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

  commitDraft: string
  /** When set, the next assistant message is routed somewhere other than chat. */
  capture: 'commit' | null
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
  closeTab: (t: Tab) => void
  setActiveTab: (t: Tab | null) => void
  saveFile: (abs: string, text: string) => Promise<void>
  setReveal: (r: { abs: string; line: number } | null) => void

  snapshot: (label: string) => Promise<string | null>
  refreshChanges: () => Promise<void>
  decide: (ids: string[], d: Decision) => Promise<void>
  acceptAll: () => Promise<void>
  rejectAll: () => Promise<void>
  restore: (tree: string) => Promise<void>
  select: (path: string | null) => void
  setBaseTree: (tree: string) => void

  askGit: (kind: GitAsk) => Promise<void>
  setCommitDraft: (s: string) => void

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
    const { root, detection, lean, model, claudeSessionId } = get()
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

  const send = async (text: string) => {
    const tree = await get().snapshot(text.slice(0, 60))
    setState({ busy: true, streaming: '', baseTree: tree ?? get().baseTree })
    try {
      await claude.send(SESSION, text)
    } catch (e) {
      setState({ busy: false })
      say({ kind: 'notice', tone: 'error', text: String(e) })
    }
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
    commitDraft: '',
    capture: null,

    setCommitDraft: (s) => setState({ commitDraft: s }),

    async askGit(kind) {
      const ask = GIT_ASKS[kind]
      if (!get().root) return
      setState({ capture: ask.capture ?? null })
      await get().prompt(ask.prompt)
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
        usage: emptyUsage(),
        running: false,
        busy: false,
        claudeSessionId: undefined,
        view: 'explorer',
        status: `Opened ${root.split('/').pop()}`,
      })
      await get().refreshRepo()
      void get().refreshIntel()
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
      const { root, running, planMode } = get()
      if (!root || !text.trim()) return

      const { plan, reason } = shouldPlan(text)
      const card = projectCard(get().intel)
      // Only the first message of a session needs the brief.
      const body = get().chat.length === 0 && card ? `${text}\n\n${card}` : text

      say({ kind: 'user', text })

      // Plan mode is a property of the process, so switching costs a respawn.
      const wantPlan = plan && !planMode
      if (wantPlan) say({ kind: 'notice', tone: 'info', text: `Planning first — ${reason}.` })

      if (!running || wantPlan || (planMode && !plan)) {
        if (!(await spawn(wantPlan ? 'plan' : 'acceptEdits'))) return
      }
      await send(body)
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
      if (!(abs in contents)) {
        try {
          setState({ contents: { ...contents, [abs]: await fs.read(abs) } })
        } catch (e) {
          setState({ status: `Cannot open: ${e}` })
          return
        }
      }
      const tab: Tab = { kind: 'file', path: abs }
      const exists = tabs.some((t) => t.kind === 'file' && t.path === abs)
      setState({ tabs: exists ? tabs : [...tabs, tab], activeTab: tab })
    },

    closeTab(t) {
      const same = (a: Tab, b: Tab) =>
        a.kind === b.kind &&
        (a.kind === 'file' ? a.path === (b as any).path : a.id === (b as any).id)
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
        const files: FileChange[] = []
        for (const c of changed) {
          const abs = `${root}/${c.path}`
          const baseline = await checkpoint.fileAt(root, baseTree, c.path)
          const current = c.status === 'D' ? '' : await fs.read(abs).catch(() => '')
          const status = (c.status === 'A' ? 'A' : c.status === 'D' ? 'D' : 'M') as FileStatus
          files.push(buildFileChange(c.path, abs, status, baseline, current))
        }
        files.sort((a, b) => a.path.localeCompare(b.path))
        setState({
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
      const decisions = new Map(get().decisions)
      for (const id of ids) decisions.set(id, d)

      const touched = new Set(ids.map((id) => id.split('#')[0]))
      const written = { ...get().written }
      const contents = { ...get().contents }
      const failures: string[] = []

      for (const file of get().files) {
        if (!touched.has(file.path)) continue
        const next = reconstruct(file, decisions)
        if (written[file.path] === next) continue
        try {
          if (next === '' && file.status === 'A') await fs.remove(file.absPath)
          else await fs.write(file.absPath, next)
          written[file.path] = next
          if (file.absPath in contents) contents[file.absPath] = next
        } catch (e) {
          // A swallowed write error is indistinguishable from a dead button, and
          // recording the decision anyway would claim a revert that never
          // happened. Roll this file's decisions back and say so.
          failures.push(`${file.path}: ${e}`)
          for (const id of ids) if (id.startsWith(`${file.path}#`)) decisions.delete(id)
        }
      }

      setState({ decisions, written, contents })

      if (failures.length) {
        setState({ status: `Could not write ${failures[0]}` })
        say({ kind: 'notice', tone: 'error', text: `Could not apply your review:\n${failures.join('\n')}` })
      } else {
        const total = get().files.flatMap(changedIdsInFile)
        const settled = total.filter((id) => get().decisions.has(id)).length
        setState({
          status:
            settled === total.length
              ? 'Every change reviewed'
              : `${total.length - settled} change${total.length - settled === 1 ? '' : 's'} left to review`,
        })
      }
      void get().refreshRepo()
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
