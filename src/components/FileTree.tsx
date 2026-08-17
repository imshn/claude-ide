import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
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
      <div className="py-1">
        <Node path={root} depth={0} />
      </div>
    </Panel>
  )
}

function Node({ path, depth }: { path: string; depth: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const openFile = useStore((s) => s.openFile)
  const active = useStore((s) => s.active)

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
                active === e.path ? 'bg-raised text-fg' : 'text-fg-muted hover:bg-elevated hover:text-fg',
              )}
              aria-expanded={e.is_dir ? isOpen : undefined}
            >
              {e.is_dir ? (
                <>
                  {isOpen ? <ChevronDown size={11} className="shrink-0 text-fg-dim" /> : <ChevronRight size={11} className="shrink-0 text-fg-dim" />}
                  {isOpen ? <FolderOpen size={13} className="shrink-0 text-accent/70" /> : <Folder size={13} className="shrink-0 text-fg-dim" />}
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
