import { useEffect, useMemo, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import clsx from 'clsx'
import { Check, Files, GitBranch, GitCompare, Settings, X } from 'lucide-react'
import { onClaude } from './lib/ipc'
import { useStore, type View } from './lib/store'
import { TitleBar } from './components/TitleBar'
import { FileTree } from './components/FileTree'
import { ChangesPanel } from './components/ChangesPanel'
import { GitPanel } from './components/GitPanel'
import { EditorPane } from './components/EditorPane'
import { ChatPanel } from './components/ChatPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { CommandPalette, type Command } from './components/CommandPalette'
import { Button } from './components/ui'

const VIEWS: { id: View; icon: typeof Files; label: string }[] = [
  { id: 'explorer', icon: Files, label: 'Explorer' },
  { id: 'changes', icon: GitCompare, label: 'Changes' },
  { id: 'git', icon: GitBranch, label: 'Source control' },
]

export default function App() {
  const store = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // One listener for the whole app; the store turns events into chat state.
  useEffect(() => {
    const off = onClaude((e) => {
      if (e.session !== useStore.getState().sessionId) return
      if (e.kind === 'message') useStore.getState().ingest(e.data)
      else if (e.kind === 'closed') useStore.setState({ claudeUp: false, busy: false })
      else if (e.kind === 'stderr' && typeof e.data === 'string' && e.data.trim()) {
        useStore.setState({ status: e.data.slice(0, 160) })
      }
    })
    return () => void off.then((f) => f())
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
      { id: 'changes', label: 'Show Changes', keys: '⌘2', run: () => store.set('view', 'changes') },
      { id: 'git', label: 'Show Source control', keys: '⌘3', run: () => store.set('view', 'git') },
      { id: 'term', label: 'Toggle terminal', keys: '⌘J', run: () => store.set('terminalOpen', !store.terminalOpen) },
      { id: 'refresh', label: 'Refresh changes', hint: 'recompute diff', run: () => void store.refreshChanges() },
      { id: 'checkpoint', label: 'Create checkpoint', hint: 'restore point', run: () => void store.snapshot('Manual checkpoint') },
      { id: 'accept', label: 'Accept all changes', run: () => void store.acceptAll() },
      { id: 'reject', label: 'Reject all changes', hint: 'revert to checkpoint', run: () => void store.rejectAll() },
      { id: 'restart', label: 'Restart Claude Code session', run: () => void store.stopClaude().then(() => store.startClaude()) },
      { id: 'settings', label: 'Settings', keys: '⌘,', run: () => setSettingsOpen(true) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.terminalOpen],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const s = useStore.getState()
      const hit = (k: string) => e.key.toLowerCase() === k
      if (hit('k')) { e.preventDefault(); s.set('paletteOpen', !s.paletteOpen) }
      else if (hit('j')) { e.preventDefault(); s.set('terminalOpen', !s.terminalOpen) }
      else if (hit('o')) { e.preventDefault(); void pickFolder() }
      else if (hit(',')) { e.preventDefault(); setSettingsOpen(true) }
      else if (hit('1')) { e.preventDefault(); s.set('view', 'explorer') }
      else if (hit('2')) { e.preventDefault(); s.set('view', 'changes') }
      else if (hit('3')) { e.preventDefault(); s.set('view', 'git') }
      else if (hit('escape')) s.set('paletteOpen', false)
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

        <aside className="w-[380px] shrink-0">
          <ChatPanel />
        </aside>
      </div>

      <footer className="tnum flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg px-3 text-[11px] text-fg-dim">
        <span className="truncate">{store.status}</span>
        <span className="ml-auto shrink-0">
          {store.detection?.found ? store.detection.version : 'Claude Code not found'}
        </span>
      </footer>

      <CommandPalette commands={commands} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const detection = useStore((s) => s.detection)
  const detect = useStore((s) => s.detectClaude)
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
        className="w-[min(560px,90vw)] rounded-xl border border-border bg-elevated p-5 shadow-2xl shadow-black/60"
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-sm font-semibold">Claude Code</h2>
          <Button compact variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close">
            <X size={13} />
          </Button>
        </div>

        <div
          className={clsx(
            'mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs',
            detection?.found ? 'border-add/30 bg-add-bg text-add' : 'border-del/30 bg-del-bg text-del',
          )}
        >
          {detection?.found ? <Check size={13} className="mt-0.5 shrink-0" /> : <X size={13} className="mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <p className="font-medium">
              {detection?.found ? `Detected ${detection.version}` : 'Not detected'}
            </p>
            {detection?.found && (
              <p className="truncate font-mono text-[11px] opacity-70">{detection.path}</p>
            )}
          </div>
        </div>

        <label className="mb-1.5 block text-[11px] font-medium text-fg-muted" htmlFor="bin">
          Executable path
        </label>
        <div className="flex gap-1.5">
          <input
            id="bin"
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
          Leave blank to search your login shell's PATH and the usual install locations.
          Authentication, your subscription and usage limits stay entirely inside Claude Code —
          this app never handles credentials and holds no API key.
        </p>

        {detection && !detection.found && detection.searched.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-fg-dim">
              Searched {detection.searched.length} locations
            </summary>
            <pre className="mt-1.5 max-h-32 overflow-auto rounded border border-border bg-bg p-2 font-mono text-[10px] text-fg-dim">
              {detection.searched.join('\n')}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
