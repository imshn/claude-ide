import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import clsx from 'clsx'
import { FileText, X } from 'lucide-react'
import { useStore, type Tab } from '../lib/store'
import { DiffReview } from './DiffReview'
import { PlanTab } from './PlanTab'
import { Empty } from './ui'

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown', py: 'python',
  rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php', sh: 'shell', yml: 'yaml',
  yaml: 'yaml', toml: 'ini', sql: 'sql', swift: 'swift', kt: 'kotlin', c: 'c', h: 'c',
  cpp: 'cpp', vue: 'html', svelte: 'html',
}

const langOf = (p: string) => LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'
const sameTab = (a: Tab, b: Tab) =>
  a.kind === b.kind && (a.kind === 'file' ? a.path === (b as any).path : a.id === (b as any).id)

export function EditorPane() {
  const { tabs, activeTab, contents, view, files, selected, plans, reveal } = useStore()
  const setActiveTab = useStore((s) => s.setActiveTab)
  const closeTab = useStore((s) => s.closeTab)
  const saveFile = useStore((s) => s.saveFile)
  const setReveal = useStore((s) => s.setReveal)

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const activePath = activeTab?.kind === 'file' ? activeTab.path : null

  useEffect(() => {
    if (!reveal || !editorRef.current || activePath !== reveal.abs) return
    const ed = editorRef.current
    ed.revealLineInCenter(reveal.line)
    ed.setPosition({ lineNumber: reveal.line, column: 1 })
    ed.focus()
    setReveal(null)
  }, [reveal, activePath, setReveal])

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monaco.editor.setTheme('claude-dark')
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activePath) void saveFile(activePath, editor.getValue())
    })
  }

  // Reviewing changes takes over the main area — it is a mode, not a sidebar.
  if (view === 'changes') {
    const file = files.find((f) => f.path === selected)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        {file ? (
          <DiffReview key={file.path} file={file} />
        ) : (
          <Empty title="Select a change" hint="Pick a file from the Changes list to review it." />
        )}
      </div>
    )
  }

  const plan = activeTab?.kind === 'plan' ? plans.find((p) => p.id === activeTab.id) : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      {tabs.length > 0 && (
        <div className="hairline flex h-9 shrink-0 items-stretch overflow-x-auto">
          {tabs.map((t) => {
            const isPlan = t.kind === 'plan'
            const label = isPlan
              ? (plans.find((p) => p.id === t.id)?.title ?? 'Plan')
              : t.path.split('/').pop()
            const active = activeTab && sameTab(activeTab, t)
            return (
              <div
                key={isPlan ? `plan:${t.id}` : `file:${t.path}`}
                className={clsx(
                  'anim group flex shrink-0 items-center gap-1.5 border-r border-border-soft px-3 text-xs',
                  active ? 'bg-panel text-fg' : 'bg-elevated text-fg-muted hover:text-fg',
                )}
              >
                {isPlan && <FileText size={11} className="shrink-0 text-accent" />}
                <button onClick={() => setActiveTab(t)} className="max-w-[180px] truncate">
                  {label}
                </button>
                <button
                  onClick={() => closeTab(t)}
                  aria-label={`Close ${label}`}
                  className="anim rounded p-0.5 text-fg-dim opacity-0 hover:bg-raised hover:text-fg group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {plan ? (
        <PlanTab key={plan.id} plan={plan} />
      ) : activePath ? (
        <Editor
          key={activePath}
          height="100%"
          theme="claude-dark"
          language={langOf(activePath)}
          value={contents[activePath] ?? ''}
          onMount={onMount}
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
