import { useEffect, useMemo, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import clsx from 'clsx'
import { Check, Files, GitBranch, GitCompare, Search, Settings, X } from 'lucide-react'
import { onApproval, onClaude } from './lib/ipc'
import { GIT_ASK_LABELS, useStore, type View } from './lib/store'
import { DEFAULT_POLICY, MODELS, type Policy } from './lib/session'
import { TitleBar } from './components/TitleBar'
import { FileTree } from './components/FileTree'
import { ChangesPanel } from './components/ChangesPanel'
import { SearchPanel } from './components/SearchPanel'
import { GitPanel } from './components/GitPanel'
import { EditorPane } from './components/EditorPane'
import { ChatPanel } from './components/ChatPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { CommandPalette, type Command } from './components/CommandPalette'
import { Button } from './components/ui'

const VIEWS: { id: View; icon: typeof Files; label: string }[] = [
  { id: 'explorer', icon: Files, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'changes', icon: GitCompare, label: 'Changes' },
  { id: 'git', icon: GitBranch, label: 'Source control' },
]

export default function App() {
  const store = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const offClaude = onClaude((e) => {
      const s = useStore.getState()
      if (e.kind === 'message') s.ingest(e.data)
      else if (e.kind === 'closed') s.sessionClosed()
      else if (e.kind === 'stderr' && typeof e.data === 'string' && e.data.trim()) {
        useStore.setState({ status: e.data.slice(0, 160) })
      }
    })
    // A blocked tool call is waiting on this — the CLI is paused until we answer.
    const offApproval = onApproval((r) => useStore.getState().onApproval(r))
    return () => {
      void offClaude.then((f) => f())
      void offApproval.then((f) => f())
    }
  }, [])

  useEffect(() => {
    void store.detectClaude()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false })
    if (typeof picked === 'string') await store.openFolder(picked)
  }

  const commands: Command[] = useMemo(
    () => [
      { id: 'open', label: 'Open folder…', keys: '⌘O', run: () => void pickFolder() },
      { id: 'explorer', label: 'Show Explorer', keys: '⌘1', run: () => store.set('view', 'explorer') },
      { id: 'search', label: 'Show Search', keys: '⌘⇧F', run: () => store.set('view', 'search') },
      { id: 'changes', label: 'Show Changes', keys: '⌘2', run: () => store.set('view', 'changes') },
      { id: 'git', label: 'Show Source control', keys: '⌘3', run: () => store.set('view', 'git') },
      { id: 'term', label: 'Toggle terminal', keys: '⌘J', run: () => store.set('terminalOpen', !store.terminalOpen) },
      { id: 'rescan', label: 'Rescan project intelligence', run: () => void store.refreshIntel() },
      { id: 'refresh', label: 'Refresh changes', run: () => void store.refreshChanges() },
      { id: 'checkpoint', label: 'Create checkpoint', hint: 'restore point', run: () => void store.snapshot('Manual checkpoint') },
      { id: 'accept', label: 'Accept all changes', run: () => void store.acceptAll() },
      { id: 'reject', label: 'Reject all changes', hint: 'revert to checkpoint', run: () => void store.rejectAll() },
      ...GIT_ASK_LABELS.map((a) => ({
        id: `git-${a.id}`,
        label: a.label,
        hint: 'git · Claude',
        run: () => void store.askGit(a.id),
      })),
      ...MODELS.filter((m) => m.id).map((m) => ({
        id: `model-${m.id}`,
        label: `Use ${m.label}`,
        hint: m.hint,
        run: () => void store.setModel(m.id),
      })),
      { id: 'stop', label: 'Stop Claude', run: () => void store.stop() },
      { id: 'settings', label: 'Settings', keys: '⌘,', run: () => setSettingsOpen(true) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.terminalOpen],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (e.key === 'Escape') return s.set('paletteOpen', false)
      if (!(e.metaKey || e.ctrlKey)) return
      const hit = (k: string) => e.key.toLowerCase() === k
      if (hit('f') && e.shiftKey) { e.preventDefault(); s.set('view', 'search') }
      else if (hit('k')) { e.preventDefault(); s.set('paletteOpen', !s.paletteOpen) }
      else if (hit('j')) { e.preventDefault(); s.set('terminalOpen', !s.terminalOpen) }
      else if (hit('o')) { e.preventDefault(); void pickFolder() }
      else if (hit(',')) { e.preventDefault(); setSettingsOpen(true) }
      else if (hit('1')) { e.preventDefault(); s.set('view', 'explorer') }
      else if (hit('2')) { e.preventDefault(); s.set('view', 'changes') }
      else if (hit('3')) { e.preventDefault(); s.set('view', 'git') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TitleBar onPickFolder={pickFolder} />

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Views"
          className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg pt-2"
        >
          {VIEWS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => store.set('view', id)}
              title={label}
              aria-label={label}
              aria-pressed={store.view === id}
              className={clsx(
                'anim relative flex h-9 w-9 items-center justify-center rounded-lg',
                store.view === id ? 'bg-raised text-fg' : 'text-fg-dim hover:bg-elevated hover:text-fg-muted',
              )}
            >
              <Icon size={16} />
              {id === 'changes' && store.files.length > 0 && (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>
          ))}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="anim mt-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg text-fg-dim hover:bg-elevated hover:text-fg-muted"
          >
            <Settings size={15} />
          </button>
        </nav>

        <aside className="flex w-[268px] shrink-0 flex-col border-r border-border">
          {store.view === 'explorer' && <FileTree onPickFolder={pickFolder} />}
          {store.view === 'search' && <SearchPanel />}
          {store.view === 'changes' && <ChangesPanel />}
          {store.view === 'git' && <GitPanel />}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div
            className={clsx(
              'flex min-h-0 min-w-0 overflow-hidden',
              store.terminalOpen ? 'flex-[3]' : 'flex-1',
            )}
          >
            <EditorPane />
          </div>
          {store.terminalOpen && (
            <div className="flex min-h-[140px] flex-[1] flex-col">
              <TerminalPanel />
            </div>
          )}
        </main>

        <aside className="flex w-[380px] shrink-0 flex-col">
          <ChatPanel />
        </aside>
      </div>

      <footer className="tnum flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg px-3 text-[11px] text-fg-dim">
        <span className="truncate">{store.status}</span>
        {store.approvals.length > 0 && (
          <span className="shrink-0 text-accent">
            {store.approvals.length} awaiting approval
          </span>
        )}
        <span className="ml-auto shrink-0">
          {store.detection?.found ? store.detection.version : 'Claude Code not found'}
        </span>
      </footer>

      <CommandPalette commands={commands} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

const POLICY_ROWS: { family: keyof typeof DEFAULT_POLICY; label: string; note: string }[] = [
  { family: 'edit', label: 'Edit files', note: 'Reviewed line by line in Changes afterwards' },
  { family: 'run', label: 'Run shell commands', note: 'Tests, builds, git — anything in a terminal' },
  { family: 'network', label: 'Access the network', note: 'Fetch pages, web search' },
  { family: 'agent', label: 'Run subagents', note: 'Delegated exploration and research' },
]

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const detection = useStore((s) => s.detection)
  const detect = useStore((s) => s.detectClaude)
  const policy = useStore((s) => s.policy)
  const setPolicy = useStore((s) => s.setPolicy)
  const lean = useStore((s) => s.lean)
  const set = useStore((s) => s.set)
  const [path, setPath] = useState(detection?.path ?? '')
  const [checking, setChecking] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-[min(600px,92vw)] overflow-y-auto rounded-xl border border-border bg-elevated p-5 shadow-2xl shadow-black/60"
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-sm font-semibold">Settings</h2>
          <Button compact variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close">
            <X size={13} />
          </Button>
        </div>

        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-fg-dim uppercase">
          Claude Code
        </h3>
        <div
          className={clsx(
            'mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs',
            detection?.found ? 'border-add/30 bg-add-bg text-add' : 'border-del/30 bg-del-bg text-del',
          )}
        >
          {detection?.found ? (
            <Check size={13} className="mt-0.5 shrink-0" />
          ) : (
            <X size={13} className="mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {detection?.found ? `Detected ${detection.version}` : 'Not detected'}
            </p>
            {detection?.found && (
              <p className="truncate font-mono text-[11px] opacity-70">{detection.path}</p>
            )}
          </div>
        </div>

        <div className="flex gap-1.5">
          <input
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/you/.local/bin/claude"
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-[11.5px] text-fg outline-none anim focus:border-accent/50"
          />
          <Button
            variant="accent"
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              await detect(path)
              setChecking(false)
            }}
          >
            {checking ? 'Checking…' : 'Verify'}
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-dim">
          Authentication, your subscription and usage limits stay entirely inside Claude Code.
          This app never handles credentials and holds no API key.
        </p>

        <h3 className="mt-5 mb-2 text-[11px] font-semibold tracking-wide text-fg-dim uppercase">
          What Claude may do without asking
        </h3>
        <div className="space-y-1">
          {POLICY_ROWS.map((r) => (
            <div key={r.family} className="flex items-center gap-3 rounded-md border border-border px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] text-fg">{r.label}</p>
                <p className="text-[10.5px] text-fg-dim">{r.note}</p>
              </div>
              <div className="flex shrink-0 gap-0.5">
                {(['ask', 'allow'] as Policy[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPolicy(r.family, p)}
                    className={clsx(
                      'anim rounded px-2 py-0.5 text-[10.5px] capitalize',
                      policy[r.family] === p
                        ? 'bg-raised text-fg'
                        : 'text-fg-dim hover:text-fg-muted',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-dim">
          Requests are intercepted by a PreToolUse hook, so declining actually stops the call.
          Obviously destructive shell commands always ask, whatever this is set to.
        </p>

        <label className="mt-4 flex cursor-pointer items-start gap-2 text-[11.5px] text-fg-muted">
          <input
            type="checkbox"
            checked={lean}
            onChange={(e) => set('lean', e.target.checked)}
            className="mt-0.5 accent-[var(--color-accent)]"
          />
          <span>
            Lean sessions
            <span className="block text-[10.5px] text-fg-dim">
              Skip your MCP servers. Measured ~209k fewer tokens of session startup.
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}
