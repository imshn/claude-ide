import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { GitBranch, GitCommit, Minus, Plus } from 'lucide-react'
import { git, type Commit } from '../lib/ipc'
import { useStore } from '../lib/store'
import { Button, Empty, Panel } from './ui'

const LABEL: Record<string, string> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'untracked', U: 'conflicted',
}

export function GitPanel() {
  const root = useStore((s) => s.root)
  const repo = useStore((s) => s.repo)
  const refreshRepo = useStore((s) => s.refreshRepo)
  const openFile = useStore((s) => s.openFile)
  const note = useStore((s) => s.note)
  const [message, setMessage] = useState('')
  const [log, setLog] = useState<Commit[]>([])
  const [branches, setBranches] = useState<string[]>([])

  useEffect(() => {
    if (!root || !repo?.is_repo) return
    void git.log(root, 15).then(setLog).catch(() => setLog([]))
    void git.branches(root).then(setBranches).catch(() => setBranches([]))
  }, [root, repo?.is_repo, repo?.branch, repo?.entries.length])

  if (!root) return <Panel title="Source control"><Empty title="No folder open" /></Panel>

  if (!repo?.is_repo) {
    return (
      <Panel title="Source control">
        <Empty
          title="Not a git repository"
          hint="Checkpoints and change review need git. Initialise one here to enable them."
        />
        <div className="px-6 pb-6">
          <Button
            variant="accent"
            className="w-full justify-center"
            onClick={async () => {
              await git.init(root)
              await refreshRepo()
            }}
          >
            Initialise repository
          </Button>
        </div>
      </Panel>
    )
  }

  const staged = repo.entries.filter((e) => e.index !== ' ' && e.index !== '?')
  const unstaged = repo.entries.filter((e) => e.index === ' ' || e.index === '?')

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      await refreshRepo()
      note(msg)
    } catch (e) {
      note(String(e))
    }
  }

  return (
    <Panel
      title="Source control"
      actions={
        <Button compact variant="ghost" onClick={() => void refreshRepo()}>
          Refresh
        </Button>
      }
    >
      <div className="hairline flex h-8 items-center gap-2 px-3">
        <GitBranch size={12} className="shrink-0 text-accent" />
        <select
          value={repo.branch}
          onChange={(e) => void act(() => git.checkout(root, e.target.value), `On ${e.target.value}`)}
          className="min-w-0 flex-1 truncate bg-transparent text-xs text-fg outline-none"
        >
          {(branches.length ? branches : [repo.branch]).map((b) => (
            <option key={b} value={b} className="bg-elevated">{b}</option>
          ))}
        </select>
        {(repo.ahead > 0 || repo.behind > 0) && (
          <span className="tnum text-[11px] text-fg-dim">↑{repo.ahead} ↓{repo.behind}</span>
        )}
      </div>

      <div className="border-b border-border p-2.5">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="Commit message"
          className="w-full resize-none rounded-md border border-border bg-elevated px-2 py-1.5 text-xs text-fg outline-none anim placeholder:text-fg-dim focus:border-accent/50"
        />
        <Button
          variant="accent"
          compact
          className="mt-1.5 w-full justify-center"
          disabled={!message.trim() || !staged.length}
          onClick={() =>
            void act(async () => {
              await git.commit(root, message)
              setMessage('')
            }, 'Committed')
          }
        >
          <GitCommit size={12} /> Commit {staged.length ? `${staged.length} file${staged.length > 1 ? 's' : ''}` : ''}
        </Button>
        <p className="mt-1.5 text-[10.5px] leading-snug text-fg-dim">
          Claude's changes are never committed for you.
        </p>
      </div>

      <Section
        title="Staged"
        entries={staged}
        root={root}
        onOpen={openFile}
        action={{
          icon: <Minus size={11} />,
          label: 'Unstage',
          run: (paths) => act(() => git.unstage(root, paths), 'Unstaged'),
        }}
      />
      <Section
        title="Changes"
        entries={unstaged}
        root={root}
        onOpen={openFile}
        action={{
          icon: <Plus size={11} />,
          label: 'Stage',
          run: (paths) => act(() => git.stage(root, paths), 'Staged'),
        }}
      />

      {log.length > 0 && (
        <div className="mt-2 border-t border-border pt-1">
          <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-dim">
            History
          </p>
          {log.map((c) => (
            <div key={c.hash} className="flex h-7 items-center gap-2 px-3 text-[11px]">
              <span className="tnum shrink-0 font-mono text-fg-dim">{c.short}</span>
              <span className="min-w-0 flex-1 truncate text-fg-muted" title={c.subject}>
                {c.subject}
              </span>
              <span className="shrink-0 text-fg-dim">{c.date}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function Section({
  title,
  entries,
  root,
  onOpen,
  action,
}: {
  title: string
  entries: { path: string; index: string; worktree: string }[]
  root: string
  onOpen: (abs: string) => void
  action: { icon: ReactNode; label: string; run: (paths: string[]) => void }
}) {
  if (!entries.length) return null
  return (
    <section className="mt-1">
      <div className="group/s flex h-6 items-center gap-2 px-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-dim">{title}</p>
        <span className="tnum text-[11px] text-fg-dim">{entries.length}</span>
        <Button
          compact
          variant="ghost"
          className="ml-auto opacity-0 anim group-hover/s:opacity-100 focus-within:opacity-100"
          onClick={() => action.run(entries.map((e) => e.path))}
        >
          {action.icon} All
        </Button>
      </div>
      {entries.map((e) => {
        const code = e.index !== ' ' && e.index !== '?' ? e.index : e.worktree === '?' ? '?' : e.worktree
        return (
          <div key={e.path} className="group/e anim flex h-7 items-center gap-2 px-3 hover:bg-elevated">
            <span
              title={LABEL[code] ?? code}
              className={clsx(
                'w-3 shrink-0 text-center font-mono text-[11px]',
                code === 'A' && 'text-add',
                code === 'D' && 'text-del',
                code === 'M' && 'text-pending',
                code === '?' && 'text-fg-dim',
              )}
            >
              {code}
            </span>
            <button
              onClick={() => onOpen(`${root}/${e.path}`)}
              className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-fg-muted group-hover/e:text-fg"
              title={e.path}
            >
              {e.path}
            </button>
            <Button
              compact
              variant="ghost"
              title={action.label}
              className="opacity-0 anim group-hover/e:opacity-100 focus-within:opacity-100"
              onClick={() => action.run([e.path])}
            >
              {action.icon}
            </Button>
          </div>
        )
      })}
    </section>
  )
}
