import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Boxes, ChevronDown, ChevronRight, Database, File, Folder, FolderOpen, Loader2,
  ScrollText, TerminalSquare, TestTube,
} from 'lucide-react'
import { fs, type Entry } from '../lib/ipc'
import { useStore } from '../lib/store'
import { Button, Empty, Panel } from './ui'

export function FileTree({ onPickFolder }: { onPickFolder: () => void }) {
  const root = useStore((s) => s.root)
  if (!root) {
    return (
      <Panel title="Explorer">
        <Empty
          title="No folder open"
          hint="Open a repository to browse it, edit it, and let Claude Code work in it."
        />
        <div className="px-6 pb-6">
          <Button variant="accent" className="w-full justify-center" onClick={onPickFolder}>
            Open folder…
          </Button>
        </div>
      </Panel>
    )
  }
  return (
    <Panel title={root.split('/').pop()}>
      <ProjectIntel />
      <div className="py-1">
        <Node path={root} depth={0} />
      </div>
    </Panel>
  )
}

/**
 * Project Intelligence: what the repo *is*, scanned deterministically on open.
 * Kept from Phase A because it is the part Claude visibly uses — it stops the
 * agent spending a turn rediscovering the package manager and test command.
 */
function ProjectIntel() {
  const intel = useStore((s) => s.intel)
  const loading = useStore((s) => s.intelLoading)
  const repo = useStore((s) => s.repo)
  const openFile = useStore((s) => s.openFile)
  const root = useStore((s) => s.root)
  const [open, setOpen] = useState(false)

  if (loading) {
    return (
      <p className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-fg-dim">
        <Loader2 size={11} className="animate-spin" /> Scanning project…
      </p>
    )
  }
  if (!intel) return null

  const summary = [intel.languages[0], intel.frameworks[0], intel.package_manager]
    .filter(Boolean)
    .join(' · ')

  const rows: [typeof Boxes, string, string][] = [
    [Boxes, 'Stack', [intel.languages.join(', '), intel.frameworks.slice(0, 3).join(', ')].filter(Boolean).join(' · ')],
    [TerminalSquare, 'Package manager', intel.package_manager],
    [TestTube, 'Tests', intel.test_framework],
    [Database, 'Database', intel.database],
  ]

  return (
    <section className="border-b border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="anim flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-elevated"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-fg-dim" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-fg-dim" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
          {summary || 'Project'}
        </span>
        <span className="tnum shrink-0 text-[10px] text-fg-dim">
          {intel.file_count.toLocaleString()} files
        </span>
      </button>

      {open && (
        <div className="space-y-1 px-3 pb-2.5">
          {rows.filter(([, , v]) => v).map(([Icon, label, value]) => (
            <div key={label} className="flex items-baseline gap-2 text-[11px]">
              <Icon size={10} className="shrink-0 translate-y-0.5 text-fg-dim" />
              <span className="w-[86px] shrink-0 text-fg-dim">{label}</span>
              <span className="min-w-0 flex-1 truncate text-fg-muted" title={value}>
                {value}
              </span>
            </div>
          ))}

          {(intel.test_cmd || intel.build_cmd || intel.dev_cmd) && (
            <div className="flex flex-wrap gap-1 pt-1">
              {[intel.test_cmd, intel.build_cmd, intel.dev_cmd].filter(Boolean).map((c) => (
                <code
                  key={c}
                  className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
                >
                  {c}
                </code>
              ))}
            </div>
          )}

          <div className="tnum flex items-baseline gap-2 pt-1 text-[11px]">
            <span className="w-[96px] shrink-0 text-fg-dim">Size</span>
            <span className="text-fg-muted">{intel.line_count.toLocaleString()} lines</span>
          </div>
          {repo?.is_repo && (
            <div className="tnum flex items-baseline gap-2 text-[11px]">
              <span className="w-[96px] shrink-0 text-fg-dim">Working tree</span>
              <span className="text-fg-muted">
                {repo.branch} · {repo.entries.length} changed
              </span>
            </div>
          )}

          {intel.instruction_files.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <ScrollText size={10} className="shrink-0 text-accent" />
              {intel.instruction_files.map((f) => (
                <button
                  key={f}
                  onClick={() => root && void openFile(`${root}/${f}`)}
                  className="anim rounded border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:border-accent/60"
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Node({ path, depth }: { path: string; depth: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const openFile = useStore((s) => s.openFile)
  const activeTab = useStore((s) => s.activeTab)
  const activePath = activeTab?.kind === 'file' ? activeTab.path : null

  useEffect(() => {
    let alive = true
    fs.listDir(path)
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [path])

  if (!entries) return null

  return (
    <>
      {entries.map((e) => {
        const isOpen = !!open[e.path]
        return (
          <div key={e.path}>
            <button
              onClick={() =>
                e.is_dir ? setOpen((o) => ({ ...o, [e.path]: !o[e.path] })) : void openFile(e.path)
              }
              style={{ paddingLeft: 8 + depth * 12 }}
              className={clsx(
                'anim flex h-[26px] w-full items-center gap-1.5 pr-2 text-left text-xs',
                activePath === e.path
                  ? 'bg-raised text-fg'
                  : 'text-fg-muted hover:bg-elevated hover:text-fg',
              )}
              aria-expanded={e.is_dir ? isOpen : undefined}
            >
              {e.is_dir ? (
                <>
                  {isOpen ? (
                    <ChevronDown size={11} className="shrink-0 text-fg-dim" />
                  ) : (
                    <ChevronRight size={11} className="shrink-0 text-fg-dim" />
                  )}
                  {isOpen ? (
                    <FolderOpen size={13} className="shrink-0 text-accent/70" />
                  ) : (
                    <Folder size={13} className="shrink-0 text-fg-dim" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-[11px] shrink-0" />
                  <File size={13} className="shrink-0 text-fg-dim" />
                </>
              )}
              <span className="truncate">{e.name}</span>
            </button>
            {e.is_dir && isOpen && <Node path={e.path} depth={depth + 1} />}
          </div>
        )
      })}
    </>
  )
}
