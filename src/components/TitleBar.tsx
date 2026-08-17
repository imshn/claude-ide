import clsx from 'clsx'
import { FolderGit2, GitBranch, Search, SquareTerminal } from 'lucide-react'
import { useActiveTask, useStore } from '../lib/store'
import { Button } from './ui'

export function TitleBar({ onPickFolder }: { onPickFolder: () => void }) {
  const root = useStore((s) => s.root)
  const repo = useStore((s) => s.repo)
  const { files } = useActiveTask()
  const set = useStore((s) => s.set)
  const terminalOpen = useStore((s) => s.terminalOpen)

  return (
    <header className="drag-region hairline flex h-11 shrink-0 items-center gap-3 bg-bg pr-2 pl-[86px]">
      <button
        onClick={onPickFolder}
        className="no-drag anim flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-elevated"
        title="Open a different folder"
      >
        <FolderGit2 size={13} className="shrink-0 text-accent" />
        <span className="truncate font-medium text-fg">
          {root ? root.split('/').pop() : 'Open folder…'}
        </span>
      </button>

      {repo?.is_repo && (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
          <GitBranch size={11} className="shrink-0 text-fg-dim" />
          <span className="truncate">{repo.branch}</span>
        </span>
      )}

      {files.length > 0 && (
        <button
          onClick={() => set('view', 'changes')}
          className="no-drag anim tnum rounded-full border border-accent/35 bg-accent-soft px-2 py-0.5 text-[11px] text-accent hover:border-accent/60"
        >
          {files.length} to review
        </button>
      )}

      <div className="no-drag ml-auto flex items-center gap-1">
        <Button
          compact
          variant="ghost"
          onClick={() => set('paletteOpen', true)}
          title="Command palette"
        >
          <Search size={12} />
          <kbd className="font-mono text-[10px] text-fg-dim">⌘K</kbd>
        </Button>
        <Button
          compact
          variant="ghost"
          aria-pressed={terminalOpen}
          className={clsx(terminalOpen && 'text-fg')}
          onClick={() => set('terminalOpen', !terminalOpen)}
          title="Toggle terminal (⌘J)"
        >
          <SquareTerminal size={13} />
        </Button>
      </div>
    </header>
  )
}
