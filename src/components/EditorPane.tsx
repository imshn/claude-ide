import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import clsx from 'clsx'
import { FileText, Network, Send, X } from 'lucide-react'
import { fs } from '../lib/ipc'
import { useStore, type Tab } from '../lib/store'
import { canFormat } from '../lib/format'
import { isMediaPath } from '../lib/media'
import { DiffReview } from './DiffReview'
import { PlanTab } from './PlanTab'
import { MediaViewer } from './MediaViewer'
import { ApiRequestTab } from './ApiRequestTab'
import { ImpactTab } from './ImpactTab'
import { ContextMenu, type MenuState } from './ContextMenu'
import { Empty } from './ui'

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown', py: 'python',
  rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php', sh: 'shell', yml: 'yaml',
  yaml: 'yaml', toml: 'ini', sql: 'sql', swift: 'swift', kt: 'kotlin', c: 'c', h: 'c',
  cpp: 'cpp', vue: 'html', svelte: 'html', svg: 'xml', xml: 'xml',
}

const langOf = (p: string) => LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'
const sameTab = (a: Tab, b: Tab) =>
  a.kind === b.kind &&
  (a.kind === 'file' || a.kind === 'impact'
    ? a.path === (b as any).path
    : (a as any).id === (b as any).id)

export function EditorPane() {
  const { tabs, activeTab, contents, view, files, selected, plans, reveal, requests, root, binaryPaths, focusEditor } =
    useStore()
  const setActiveTab = useStore((s) => s.setActiveTab)
  const closeTab = useStore((s) => s.closeTab)
  const saveFile = useStore((s) => s.saveFile)
  const setReveal = useStore((s) => s.setReveal)
  const formatActive = useStore((s) => s.formatActive)
  const note = useStore((s) => s.note)
  const attachPaths = useStore((s) => s.attachPaths)
  const attachSelection = useStore((s) => s.attachSelection)
  const openAsText = useStore((s) => s.openAsText)
  const openImpact = useStore((s) => s.openImpact)

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** SVGs the user chose to edit as text rather than preview. */
  const [asText, setAsText] = useState<Set<string>>(new Set())

  const activePath = activeTab?.kind === 'file' ? activeTab.path : null

  useEffect(() => {
    if (!reveal || !editorRef.current || activePath !== reveal.abs) return
    const ed = editorRef.current
    ed.revealLineInCenter(reveal.line)
    ed.setPosition({ lineNumber: reveal.line, column: 1 })
    ed.focus()
    setReveal(null)
  }, [reveal, activePath, setReveal])

  useEffect(() => {
    if (focusEditor && editorRef.current) editorRef.current.focus()
  }, [focusEditor])

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monaco.editor.setTheme('claude-dark')

    // Surface how many cursors are live — with multi-cursor editing it is
    // otherwise easy to type into selections you forgot were there.
    const report = () => {
      const sels = editor.getSelections() ?? []
      const chars = sels.reduce(
        (n, s) => n + (editor.getModel()?.getValueInRange(s).length ?? 0),
        0,
      )
      useStore.getState().set('cursors', { count: sels.length, chars })
    }
    // Also focus here: the effect above runs before Monaco has mounted for a
    // freshly opened file, so its ref is still null at that point.
    editor.focus()
    editor.onDidChangeCursorSelection(report)
    editor.onDidBlurEditorText(() => useStore.getState().set('cursors', { count: 0, chars: 0 }))
    report()

    // Monaco's TypeScript worker gives real completions, hovers and signature
    // help. Left at defaults it reports phantom errors for anything it cannot
    // resolve, which in a single-file view is everything imported.
    const ts = monaco.languages.typescript
    for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
      d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
      d.setCompilerOptions({
        target: ts.ScriptTarget.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        jsx: ts.JsxEmit.React,
        allowJs: true,
        allowNonTsExtensions: true,
        esModuleInterop: true,
      })
      d.setEagerModelSync(true)
    }

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activePath) void saveFile(activePath, editor.getValue())
    })

    // ⌘L sends the selection to chat with its file and line range attached.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => {
      const path = activePath
      const sel = editor.getSelection()
      const model = editor.getModel()
      if (!path || !sel || !model) return

      // With no selection, take the caret's line — "ask about this line" is the
      // common case and an empty chip would be useless.
      const range = sel.isEmpty()
        ? { startLineNumber: sel.startLineNumber, endLineNumber: sel.startLineNumber }
        : sel
      const text = model.getValueInRange({
        startLineNumber: range.startLineNumber,
        endLineNumber: range.endLineNumber,
        startColumn: 1,
        endColumn: model.getLineMaxColumn(range.endLineNumber),
      })
      attachSelection({
        path: root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path,
        from: range.startLineNumber,
        to: range.endLineNumber,
        text,
      })
    })
    // Monaco claims ⌘K as a chord prefix while it has focus, so the app-level
    // handler never sees it. Register the same chords here instead of losing
    // them whenever the caret is in the editor.
    editor.addCommand(
      monaco.KeyMod.chord(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      ),
      () => useStore.getState().set('shortcutsOpen', true),
    )

    // ⌥⇧F, the shortcut muscle memory already knows.
    editor.addCommand(
      monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      () => void formatActive(),
    )
  }

  // Every open file is a Monaco model, so cross-file completion works for the
  // files you actually have open.
  const openModels = useMemo(
    () => tabs.filter((t): t is Extract<Tab, { kind: 'file' }> => t.kind === 'file'),
    [tabs],
  )

  /** Media files carry no text until asked for, so load it before switching. */
  const toggleSource = async (path: string) => {
    if (asText.has(path)) {
      return setAsText((s) => {
        const next = new Set(s)
        next.delete(path)
        return next
      })
    }
    if (await openAsText(path)) setAsText((s) => new Set(s).add(path))
  }

  const tabMenu = (t: Tab, x: number, y: number) => {
    const path = t.kind === 'file' ? t.path : null
    const idx = tabs.findIndex((x) => sameTab(x, t))
    const label = t.kind === 'file' ? t.path.split('/').pop() : 'tab'

    setMenu({
      x,
      y,
      items: [
        { id: 'close', label: 'Close', hint: '⌘W', run: () => closeTab(t) },
        {
          id: 'others',
          label: 'Close Others',
          disabled: tabs.length < 2,
          run: () => tabs.filter((x) => !sameTab(x, t)).forEach(closeTab),
        },
        {
          id: 'right',
          label: 'Close to the Right',
          disabled: idx === tabs.length - 1,
          run: () => tabs.slice(idx + 1).forEach(closeTab),
        },
        { id: 'all', label: 'Close All', run: () => [...tabs].forEach(closeTab) },
        { id: 's1', separator: true },
        {
          id: 'copy-path',
          label: 'Copy Path',
          disabled: !path,
          run: () => path && void navigator.clipboard.writeText(path).then(() => note('Path copied')),
        },
        {
          id: 'copy-rel',
          label: 'Copy Relative Path',
          disabled: !path || !root,
          run: () => {
            if (!path || !root) return
            void navigator.clipboard
              .writeText(path.startsWith(root + '/') ? path.slice(root.length + 1) : path)
              .then(() => note('Relative path copied'))
          },
        },
        {
          id: 'reveal',
          label: 'Reveal in Finder',
          disabled: !path,
          run: () => path && void fs.reveal(path).catch((e) => note(String(e))),
        },
        { id: 's2', separator: true },
        {
          id: 'attach',
          label: 'Attach to Claude',
          disabled: !path,
          run: () => path && void attachPaths([path]),
        },
        {
          id: 'impact',
          label: 'Analyze Impact',
          disabled: !path || !root,
          run: () => {
            if (!path || !root) return
            openImpact(path.startsWith(root + '/') ? path.slice(root.length + 1) : path)
          },
        },
        {
          id: 'format',
          label: 'Format Document',
          hint: '⌥⇧F',
          disabled: !path || !canFormat(path),
          run: () => void formatActive(),
        },
        ...(path && /\.svg$/i.test(path)
          ? [
              {
                id: 'toggle-svg',
                label: asText.has(path) ? 'Show Preview' : 'Edit Source',
                run: () => void toggleSource(path),
              },
            ]
          : []),
      ].filter(Boolean) as MenuState['items'],
    })
    void label
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
  const apiId = activeTab?.kind === 'api' ? activeTab.id : null
  const impactPath = activeTab?.kind === 'impact' ? activeTab.path : null
  // Extension match OR "the file could not be read as text" — so a format the
  // list does not know about still opens instead of erroring.
  const showMedia =
    !!activePath &&
    (isMediaPath(activePath) || binaryPaths.includes(activePath)) &&
    !asText.has(activePath)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      {tabs.length > 0 && (
        <div className="hairline flex h-9 shrink-0 items-stretch overflow-x-auto">
          {tabs.map((t) => {
            const label =
              t.kind === 'plan'
                ? (plans.find((p) => p.id === t.id)?.title ?? 'Plan')
                : t.kind === 'api'
                  ? (requests[t.id]?.name ?? 'Request')
                  : t.kind === 'impact'
                    ? `Impact: ${t.path.split('/').pop()}`
                    : t.path.split('/').pop()
            const active = activeTab && sameTab(activeTab, t)
            const key =
              t.kind === 'file' || t.kind === 'impact' ? `${t.kind}:${t.path}` : `${t.kind}:${t.id}`
            return (
              <div
                key={key}
                onContextMenu={(e) => {
                  e.preventDefault()
                  tabMenu(t, e.clientX, e.clientY)
                }}
                className={clsx(
                  'anim group flex shrink-0 items-center gap-1.5 border-r border-border-soft px-3 text-xs',
                  active ? 'bg-panel text-fg' : 'bg-elevated text-fg-muted hover:text-fg',
                )}
              >
                {t.kind === 'plan' && <FileText size={11} className="shrink-0 text-accent" />}
                {t.kind === 'api' && <Send size={11} className="shrink-0 text-add" />}
                {t.kind === 'impact' && <Network size={11} className="shrink-0 text-pending" />}
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
      ) : apiId ? (
        <ApiRequestTab key={apiId} id={apiId} />
      ) : impactPath ? (
        <ImpactTab key={impactPath} path={impactPath} />
      ) : showMedia && activePath ? (
        <MediaViewer
          key={activePath}
          path={activePath}
          onOpenAsText={() => void toggleSource(activePath)}
        />
      ) : activePath ? (
        <Editor
          key={activePath}
          height="100%"
          theme="claude-dark"
          path={activePath}
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
            // VS Code parity for multiple cursors: ⌥click adds one, ⌥⇧drag makes a
            // column selection, and pasting N lines into N cursors spreads them.
            multiCursorModifier: 'alt',
            multiCursorPaste: 'spread',
            multiCursorMergeOverlapping: true,
            occurrencesHighlight: 'singleFile',
            selectionHighlight: true,
            columnSelection: false,
            find: { seedSearchStringFromSelection: 'selection', autoFindInSelection: 'multiline' },
            linkedEditing: true,
            stickyScroll: { enabled: true },
            renderWhitespace: 'selection',
            quickSuggestions: { other: true, comments: false, strings: true },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            tabCompletion: 'on',
            wordBasedSuggestions: 'allDocuments',
            inlineSuggest: { enabled: true },
            parameterHints: { enabled: true },
            bracketPairColorization: { enabled: true },
            formatOnPaste: true,
          }}
        />
      ) : (
        <Empty
          title="No file open"
          hint="Pick a file from the explorer, or press ⌘K to search commands."
        />
      )}

      {/* Keeps every open file in Monaco's model registry for cross-file suggestions. */}
      <div className="hidden">{openModels.length}</div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
