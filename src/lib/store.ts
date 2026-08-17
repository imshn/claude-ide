import { create } from 'zustand'
import {
  buildFileChange,
  changedIdsInFile,
  groupFiles,
  reconstruct,
  type Decision,
  type FileChange,
  type FileStatus,
} from './review'
import {
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
  createTask,
  planFromTool,
  shouldPlan,
  titleFrom,
  type ChatItem,
  type Task,
  type TaskStatus,
} from './tasks'

export type View = 'explorer' | 'changes' | 'git' | 'tasks'
export type { ChatItem, Task }

/** Stable identity so components can read fields with no task open. */
const EMPTY: Task = Object.freeze({ ...createTask(''), id: '', title: '' }) as Task

/** tool_use id -> plan file path, awaiting the tool result that creates it. */
const pendingPlans = new Map<string, string>()

interface State {
  root: string | null
  repo: RepoStatus | null
  intel: Intel | null
  intelLoading: boolean
  detection: Detection | null
  /** Skip the user's MCP servers in task sessions. See claude.rs for why. */
  lean: boolean

  tasks: Task[]
  activeId: string | null

  tabs: string[]
  active: string | null
  contents: Record<string, string>
  reveal: { abs: string; line: number } | null

  view: View
  paletteOpen: boolean
  terminalOpen: boolean
  contextOpen: boolean
  status: string
}

interface Actions {
  openFolder: (path: string) => Promise<void>
  refreshRepo: () => Promise<void>
  refreshIntel: () => Promise<void>
  detectClaude: (override?: string) => Promise<void>

  newTask: (request: string) => Promise<void>
  selectTask: (id: string) => void
  closeTask: (id: string) => Promise<void>
  sendToActive: (text: string) => Promise<void>
  approvePlan: (id: string, text: string) => Promise<void>
  cancelPlan: (id: string) => Promise<void>
  stopTask: (id: string) => Promise<void>
  ingest: (sessionId: string, raw: unknown) => void
  sessionClosed: (sessionId: string) => void

  openFile: (abs: string) => Promise<void>
  closeTab: (abs: string) => void
  setActive: (abs: string | null) => void
  saveFile: (abs: string, text: string) => Promise<void>
  setReveal: (r: { abs: string; line: number } | null) => void

  /** `taskId` is required for background work: the active task can change
   *  mid-run, and a checkpoint or diff must belong to the task that caused it. */
  snapshot: (label: string, taskId?: string) => Promise<string | null>
  refreshChanges: (taskId?: string) => Promise<void>
  decide: (ids: string[], d: Decision) => Promise<void>
  acceptAll: () => Promise<void>
  rejectAll: () => Promise<void>
  restore: (tree: string) => Promise<void>
  select: (path: string | null) => void
  setBaseTree: (tree: string) => void

  set: <K extends keyof State>(k: K, v: State[K]) => void
  note: (text: string) => void
}

type Store = State & Actions

export const useStore = create<Store>((setState, get) => {
  /** Replace one task immutably. */
  const patch = (id: string, fn: (t: Task) => Task) =>
    setState({ tasks: get().tasks.map((t) => (t.id === id ? fn(t) : t)) })

  const find = (id: string) => get().tasks.find((t) => t.id === id)
  const activeTask = () => get().tasks.find((t) => t.id === get().activeId)

  /** Sequential execution: one task may hold the working tree at a time. */
  const holder = () => get().tasks.find((t) => t.busy)

  const setStatus = (id: string, status: TaskStatus) => patch(id, (t) => ({ ...t, status }))

  /** Spawn (or respawn) the CLI for a task. Resumes when we already have a session. */
  const spawn = async (task: Task, permissionMode: string): Promise<boolean> => {
    const { root, detection, lean } = get()
    if (!root || !detection?.found) return false
    await claude.stop(task.sessionId).catch(() => {})
    try {
      await claude.start({
        id: task.sessionId,
        cwd: root,
        bin: detection.path,
        permissionMode,
        lean,
        resume: task.claudeSessionId,
      })
      patch(task.id, (t) => ({ ...t, running: true, planMode: permissionMode === 'plan' }))
      return true
    } catch (e) {
      patch(task.id, (t) => ({
        ...t,
        running: false,
        status: 'failed',
        error: String(e),
        chat: [...t.chat, { kind: 'notice', tone: 'error', text: String(e), at: Date.now() }],
      }))
      return false
    }
  }

  /** Send text, taking a checkpoint first so the turn is always reversible. */
  const send = async (id: string, text: string) => {
    const task = find(id)
    const root = get().root
    if (!task || !root) return
    const tree = await get().snapshot(task.title, id)
    patch(id, (t) => ({
      ...t,
      busy: true,
      streaming: '',
      turns: t.turns + 1,
      baseTree: tree ?? t.baseTree,
    }))
    try {
      await claude.send(task.sessionId, text)
    } catch (e) {
      patch(id, (t) => ({
        ...t,
        busy: false,
        status: 'failed',
        error: String(e),
        chat: [...t.chat, { kind: 'notice', tone: 'error', text: String(e), at: Date.now() }],
      }))
    }
  }

  /** Start the next queued task once the tree is free. */
  const drain = () => {
    if (holder()) return
    const next = get().tasks.find((t) => t.status === 'queued')
    if (next) void begin(next.id)
  }

  /** Plan-first or straight to execution, depending on the request. */
  const begin = async (id: string) => {
    const task = find(id)
    if (!task) return
    if (holder() && holder()!.id !== id) {
      setStatus(id, 'queued')
      return
    }

    const { plan, reason } = shouldPlan(task.request)
    // Request first: Claude Code derives plan filenames from the opening line,
    // and a brief-first prompt produced plans named after the brief.
    const card = projectCard(get().intel)
    const opener = card ? `${task.request}\n\n${card}` : task.request

    if (plan) {
      patch(id, (t) => ({
        ...t,
        status: 'planning',
        chat: [
          ...t.chat,
          { kind: 'user', text: t.request, at: Date.now() },
          { kind: 'notice', tone: 'info', text: `Planning first — ${reason}.`, at: Date.now() },
        ],
      }))
      if (!(await spawn(task, 'plan'))) return
      await send(id, opener)
    } else {
      patch(id, (t) => ({
        ...t,
        status: 'executing',
        chat: [...t.chat, { kind: 'user', text: t.request, at: Date.now() }],
      }))
      if (!(await spawn(task, 'acceptEdits'))) return
      await send(id, opener)
    }
  }

  return {
    root: null,
    repo: null,
    intel: null,
    intelLoading: false,
    detection: null,
    lean: true,
    tasks: [],
    activeId: null,
    tabs: [],
    active: null,
    contents: {},
    reveal: null,
    view: 'explorer',
    paletteOpen: false,
    terminalOpen: false,
    contextOpen: false,
    status: 'Ready',

    set: (k, v) => setState({ [k]: v } as Pick<State, typeof k>),
    note: (text) => setState({ status: text }),
    setReveal: (r) => setState({ reveal: r }),
    setActive: (abs) => setState({ active: abs }),
    select: (path) => {
      const t = activeTask()
      if (t) patch(t.id, (x) => ({ ...x, selected: path }))
    },
    setBaseTree: (tree) => {
      const t = activeTask()
      if (t) patch(t.id, (x) => ({ ...x, baseTree: tree }))
    },

    // -- workspace ----------------------------------------------------------
    async openFolder(path) {
      for (const t of get().tasks) await claude.stop(t.sessionId).catch(() => {})
      let root = path
      try {
        root = (await git.root(path)) || path
      } catch {
        /* not a repo — surfaced by refreshRepo */
      }
      setState({
        root,
        tasks: [],
        activeId: null,
        tabs: [],
        active: null,
        contents: {},
        intel: null,
        view: 'explorer',
        status: `Opened ${root.split('/').pop()}`,
      })
      await get().refreshRepo()
      void get().refreshIntel()
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

    // -- tasks --------------------------------------------------------------
    async newTask(request) {
      if (!get().root || !request.trim()) return
      const task = createTask(request.trim())
      setState({ tasks: [task, ...get().tasks], activeId: task.id, view: 'tasks' })
      await begin(task.id)
    },

    selectTask: (id) => setState({ activeId: id, view: 'tasks' }),

    async closeTask(id) {
      const task = find(id)
      if (task) await claude.stop(task.sessionId).catch(() => {})
      const tasks = get().tasks.filter((t) => t.id !== id)
      setState({ tasks, activeId: get().activeId === id ? (tasks[0]?.id ?? null) : get().activeId })
      drain()
    },

    /** A follow-up message inside the active task's existing conversation. */
    async sendToActive(text) {
      const task = activeTask()
      if (!task || !text.trim()) return
      if (!task.running && !(await spawn(task, 'acceptEdits'))) return
      patch(task.id, (t) => ({
        ...t,
        status: 'executing',
        chat: [...t.chat, { kind: 'user', text, at: Date.now() }],
      }))
      await send(task.id, text)
    },

    async approvePlan(id, text) {
      const task = find(id)
      if (!task) return
      patch(id, (t) => ({
        ...t,
        status: 'executing',
        plan: t.plan ? { ...t.plan, text, approved: true } : undefined,
        chat: [...t.chat, { kind: 'notice', tone: 'info', text: 'Plan approved — executing.', at: Date.now() }],
      }))
      // Permission mode is fixed per process, so drop out of plan mode by
      // resuming the same Claude session in an editing mode.
      const fresh = find(id)!
      if (!(await spawn(fresh, 'acceptEdits'))) return
      await send(id, `Implement this plan exactly. Do not re-plan.\n\n${text}`)
    },

    async cancelPlan(id) {
      const task = find(id)
      if (task) await claude.stop(task.sessionId).catch(() => {})
      patch(id, (t) => ({
        ...t,
        running: false,
        busy: false,
        status: 'idle',
        chat: [...t.chat, { kind: 'notice', tone: 'info', text: 'Plan cancelled.', at: Date.now() }],
      }))
      drain()
    },

    async stopTask(id) {
      const task = find(id)
      if (task) await claude.stop(task.sessionId).catch(() => {})
      patch(id, (t) => ({ ...t, running: false, busy: false, status: 'idle' }))
      drain()
    },

    sessionClosed(sessionId) {
      const task = get().tasks.find((t) => t.sessionId === sessionId)
      if (!task) return
      patch(task.id, (t) => ({ ...t, running: false, busy: false }))
      drain()
    },

    /** Route one stream-json event into its task. */
    ingest(sessionId, raw) {
      const task = get().tasks.find((t) => t.sessionId === sessionId)
      if (!task) return
      const id = task.id
      const ev = raw as any

      switch (ev?.type) {
        case 'system':
          if (ev.subtype === 'init') {
            patch(id, (t) => ({ ...t, claudeSessionId: ev.session_id ?? t.claudeSessionId }))
            setState({ status: `Claude ready · ${ev.model ?? ''}`.trim() })
          }
          return

        case 'stream_event': {
          const d = ev.event?.delta
          if (d?.type === 'text_delta') {
            patch(id, (t) => ({ ...t, streaming: t.streaming + d.text }))
          }
          return
        }

        case 'assistant': {
          for (const block of ev.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              patch(id, (t) => ({
                ...t,
                streaming: '',
                chat: [...t.chat, { kind: 'assistant', text: block.text, at: Date.now() }],
              }))
            } else if (block.type === 'tool_use') {
              const act = activityFor(block.id, block.name, block.input, Date.now())
              patch(id, (t) => ({ ...t, streaming: '', activity: [...t.activity, act] }))

              // A tool_use is only the *request*. An inline plan is already in
              // the payload, but a plan file does not exist until the tool has
              // run, so defer that read until its result arrives.
              const found = planFromTool(block.name, block.input)
              if (found?.inline) void capturePlan(id, found)
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
              if (!block.is_error) void capturePlan(id, { path: planPath })
            }

            const text =
              typeof block.content === 'string'
                ? block.content
                : (block.content ?? []).map((c: any) => c.text ?? '').join('\n')
            patch(id, (t) => ({
              ...t,
              activity: t.activity.map((a) =>
                a.id === block.tool_use_id ? applyResult(a, text, !!block.is_error) : a,
              ),
            }))
          }
          return
        }

        case 'result': {
          const ok = ev.subtype === 'success'
          patch(id, (t) => ({
            ...t,
            busy: false,
            streaming: '',
            ms: t.ms + (ev.duration_ms ?? 0),
            chat: [...t.chat, { kind: 'turn', ok, ms: ev.duration_ms ?? 0, at: Date.now() }],
            // An unapproved plan always parks at the gate — capturePlan may have
            // already set that, and this must not race past it.
            status: t.planMode
              ? t.plan && !t.plan.approved
                ? 'plan-ready'
                : 'planning' // still thinking; a plan has not landed yet
              : ok
                ? 'review'
                : 'failed',
          }))
          void get().refreshChanges(id)
          void get().refreshRepo()
          drain()
          return
        }
      }
    },

    // -- editor -------------------------------------------------------------
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

    async saveFile(abs, text) {
      await fs.write(abs, text)
      setState({ contents: { ...get().contents, [abs]: text }, status: 'Saved' })
      void get().refreshRepo()
    },

    // -- change review (scoped to the active task) --------------------------
    async snapshot(label, taskId) {
      const { root } = get()
      const task = taskId ? find(taskId) : activeTask()
      if (!root || !task) return null
      try {
        const tree = await checkpoint.create(root)
        patch(task.id, (t) =>
          t.checkpoints[0]?.tree === tree
            ? t
            : { ...t, checkpoints: [{ tree, label, at: Date.now() }, ...t.checkpoints].slice(0, 40) },
        )
        return tree
      } catch (e) {
        setState({ status: `Checkpoint failed: ${e}` })
        return null
      }
    },

    async refreshChanges(taskId) {
      const { root } = get()
      const task = taskId ? find(taskId) : activeTask()
      if (!root || !task?.baseTree) return
      try {
        const changed = await checkpoint.changes(root, task.baseTree)
        const files: FileChange[] = []
        for (const c of changed) {
          const abs = `${root}/${c.path}`
          const baseline = await checkpoint.fileAt(root, task.baseTree, c.path)
          const current = c.status === 'D' ? '' : await fs.read(abs).catch(() => '')
          const status = (c.status === 'A' ? 'A' : c.status === 'D' ? 'D' : 'M') as FileStatus
          files.push(buildFileChange(c.path, abs, status, baseline, current))
        }
        files.sort((a, b) => a.path.localeCompare(b.path))
        patch(task.id, (t) => ({
          ...t,
          files,
          groups: groupFiles(files),
          selected:
            t.selected && files.some((f) => f.path === t.selected)
              ? t.selected
              : (files[0]?.path ?? null),
        }))
        setState({
          view: files.length ? 'changes' : get().view,
          status: files.length
            ? `${files.length} file${files.length > 1 ? 's' : ''} to review`
            : 'No changes',
        })
      } catch (e) {
        setState({ status: `Diff failed: ${e}` })
      }
    },

    async decide(ids, d) {
      const task = activeTask()
      if (!task) return
      const decisions = new Map(task.decisions)
      for (const id of ids) decisions.set(id, d)

      const touched = new Set(ids.map((id) => id.split('#')[0]))
      const written = { ...task.written }
      const contents = { ...get().contents }

      for (const file of task.files) {
        if (!touched.has(file.path)) continue
        const next = reconstruct(file, decisions)
        if (written[file.path] === next) continue
        if (next === '' && file.status === 'A') await fs.remove(file.absPath).catch(() => {})
        else await fs.write(file.absPath, next).catch(() => {})
        written[file.path] = next
        if (file.absPath in contents) contents[file.absPath] = next
      }

      patch(task.id, (t) => ({ ...t, decisions, written }))
      setState({ contents })
      void get().refreshRepo()
    },

    async acceptAll() {
      const task = activeTask()
      if (!task) return
      await get().decide(task.files.flatMap(changedIdsInFile), 'accepted')
      patch(task.id, (t) => ({ ...t, status: 'completed' }))
      setState({ status: 'All changes accepted' })
    },

    async rejectAll() {
      const task = activeTask()
      if (!task) return
      await get().decide(task.files.flatMap(changedIdsInFile), 'rejected')
      setState({ status: 'All changes reverted' })
    },

    async restore(tree) {
      const { root } = get()
      const task = activeTask()
      if (!root || !task) return
      const changed = await checkpoint.changes(root, tree)
      for (const c of changed) {
        const abs = `${root}/${c.path}`
        const baseline = await checkpoint.fileAt(root, tree, c.path)
        if (c.status === 'A' && baseline === '') await fs.remove(abs).catch(() => {})
        else await fs.write(abs, baseline).catch(() => {})
      }
      patch(task.id, (t) => ({ ...t, decisions: new Map(), written: {} }))
      setState({ contents: {}, status: 'Restored checkpoint' })
      await get().refreshChanges()
      await get().refreshRepo()
    },
  }

  /**
   * Plans arrive either inline or as a file Claude wrote; normalise both.
   *
   * Reading the file is async and routinely finishes *after* the turn's `result`
   * event, so this also settles the status rather than leaving that to whichever
   * of the two happens to land last.
   */
  async function capturePlan(id: string, found: { inline?: string; path?: string }) {
    let text = found.inline ?? ''
    if (!text && found.path) text = await fs.read(found.path).catch(() => '')
    if (!text.trim()) return
    setState({
      tasks: get().tasks.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              plan: {
                text,
                source: found.inline ? 'tool' : 'file',
                path: found.path,
                approved: false,
              },
              title: t.title || titleFrom(text),
              // Any unapproved plan from a plan-mode session opens the gate,
              // however many turns the planning took.
              status: t.planMode ? 'plan-ready' : t.status,
            },
      ),
    })
  }
})

/** Stable-identity accessor for the task the UI is showing. */
export const useActiveTask = (): Task =>
  useStore((s) => s.tasks.find((t) => t.id === s.activeId) ?? EMPTY)

export const rel = relative
export type { Activity }
