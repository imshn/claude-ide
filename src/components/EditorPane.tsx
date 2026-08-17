import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useActiveTask, useStore } from '../lib/store'
import { DiffReview } from './DiffReview'
import { Empty } from './ui'

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown', py: 'python',
  rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php', sh: 'shell', yml: 'yaml',
  yaml: 'yaml', toml: 'ini', sql: 'sql', swift: 'swift', kt: 'kotlin', c: 'c', h: 'c',
  cpp: 'cpp', vue: 'html', svelte: 'html',
}

const langOf = (p: string) => LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'

export function EditorPane() {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const contents = useStore((s) => s.contents)
  const setActive = useStore((s) => s.setActive)
  const closeTab = useStore((s) => s.closeTab)
  const saveFile = useStore((s) => s.saveFile)
  const reveal = useStore((s) => s.reveal)
  const setReveal = useStore((s) => s.setReveal)
  const view = useStore((s) => s.view)
  const { files, selected } = useActiveTask()

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const draft = useRef<string>('')

  // Focus a specific line when the review panel asks for it.
  useEffect(() => {
    if (!reveal || !editorRef.current || active !== reveal.abs) return
    const ed = editorRef.current
    ed.revealLineInCenter(reveal.line)
    ed.setPosition({ lineNumber: reveal.line, column: 1 })
    ed.focus()
    setReveal(null)
  }, [reveal, active, setReveal])

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    monaco.editor.setTheme('claude-dark')
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (active) void saveFile(active, editor.getValue())
    })
  }

  // The Changes workspace takes over the main area — reviewing is a mode, not a sidebar.
  if (view === 'changes') {
    const file = files.find((f) => f.path === selected)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        {file ? (
          <DiffReview key={file.path} file={file} />
        ) : (
          <Empty
            title="Select a change"
            hint="Pick a file from the Changes list to review it line by line."
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      {tabs.length > 0 && (
        <div className="hairline flex h-9 shrink-0 items-stretch overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t}
              className={clsx(
                'anim group flex shrink-0 items-center gap-2 border-r border-border-soft px-3 text-xs',
                active === t ? 'bg-panel text-fg' : 'bg-elevated text-fg-muted hover:text-fg',
              )}
            >
              <button onClick={() => setActive(t)} className="max-w-[180px] truncate">
                {t.split('/').pop()}
              </button>
              <button
                onClick={() => closeTab(t)}
                aria-label={`Close ${t.split('/').pop()}`}
                className="anim rounded p-0.5 text-fg-dim opacity-0 hover:bg-raised hover:text-fg group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {active ? (
        <Editor
          key={active}
          height="100%"
          theme="claude-dark"
          language={langOf(active)}
          value={contents[active] ?? ''}
          onMount={onMount}
          onChange={(v) => (draft.current = v ?? '')}
          options={{
            fontSize: 12.5,
            lineHeight: 19,
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'all',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            padding: { top: 10 },
            guides: { indentation: true },
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          }}
        />
      ) : (
        <Empty
          title="No file open"
          hint="Pick a file from the explorer, or press ⌘K to search commands."
        />
      )}
    </div>
  )
}
