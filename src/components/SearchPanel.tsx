import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CaseSensitive, Loader2, Search, Sparkles } from 'lucide-react'
import { impact, search, type SearchResults, type SymbolDef } from '../lib/ipc'
import { useStore } from '../lib/store'
import { Button, Empty, Panel } from './ui'

type Mode = 'text' | 'regex' | 'symbol' | 'file'

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'text', label: 'Text', hint: 'literal match' },
  { id: 'regex', label: 'Regex', hint: 'regular expression' },
  { id: 'symbol', label: 'Symbol', hint: 'indexed definitions' },
  { id: 'file', label: 'Files', hint: 'match file paths' },
]

export function SearchPanel() {
  const root = useStore((s) => s.root)
  const openFile = useStore((s) => s.openFile)
  const setReveal = useStore((s) => s.setReveal)
  const prompt = useStore((s) => s.prompt)
  const setView = useStore((s) => s.set)

  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('text')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [symbols, setSymbols] = useState<SymbolDef[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<number>()

  const run = useCallback(
    async (q: string, m: Mode, cs: boolean) => {
      if (!root || !q.trim()) {
        setResults(null)
        setSymbols(null)
        return
      }
      setBusy(true)
      setError('')
      try {
        // Symbol mode reads the definition index, so it returns declarations
        // rather than every line that happens to contain the word.
        if (m === 'symbol') {
          setSymbols(await impact.symbols(root, q))
          setResults(null)
        } else {
          setResults(await search.run(root, q, m, cs))
          setSymbols(null)
        }
      } catch (e) {
        setError(String(e))
        setResults(null)
        setSymbols(null)
      } finally {
        setBusy(false)
      }
    },
    [root],
  )

  // Debounced so typing a regex does not scan the repo on every keystroke.
  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void run(query, mode, caseSensitive), 220)
    return () => window.clearTimeout(timer.current)
  }, [query, mode, caseSensitive, run])

  const jump = async (path: string, line?: number) => {
    if (!root) return
    const abs = `${root}/${path}`
    await openFile(abs)
    if (line) setReveal({ abs, line })
  }

  /** Semantic search is genuinely Claude's job — it reads the code we would
   *  otherwise need an embedding index to approximate. */
  const askClaude = () => {
    if (!query.trim()) return
    setView('view', 'explorer')
    void prompt(
      `Search this repository and answer: ${query.trim()}\n` +
        `List every relevant location as \`path:line\` with one line explaining each. Do not modify anything.`,
    )
  }

  const hits = results?.hits ?? []
  const files = results?.files ?? []

  return (
    <Panel title="Search" scroll={false}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 space-y-2 border-b border-border p-2.5">
          <div className="anim flex items-center gap-1.5 rounded-md border border-border bg-elevated px-2 focus-within:border-accent/50">
            <Search size={12} className="shrink-0 text-fg-dim" />
            <input
              autoFocus
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the repository…"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-fg outline-none placeholder:text-fg-dim"
            />
            {busy && <Loader2 size={11} className="shrink-0 animate-spin text-accent" />}
            <button
              onClick={() => setCaseSensitive((v) => !v)}
              title="Match case"
              aria-pressed={caseSensitive}
              className={clsx(
                'anim shrink-0 rounded p-0.5',
                caseSensitive ? 'bg-raised text-fg' : 'text-fg-dim hover:text-fg-muted',
              )}
            >
              <CaseSensitive size={13} />
            </button>
          </div>

          <div className="flex gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.hint}
                className={clsx(
                  'anim flex-1 rounded border px-1 py-0.5 text-[10.5px]',
                  mode === m.id
                    ? 'border-accent/40 bg-accent-soft text-accent'
                    : 'border-border text-fg-dim hover:text-fg-muted',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            compact
            className="w-full justify-center"
            disabled={!query.trim()}
            onClick={askClaude}
            title="Let Claude read the code and answer in its own words"
          >
            <Sparkles size={11} /> Ask Claude instead
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p className="p-3 text-[11px] text-del">{error}</p>}

          {!error && mode === 'symbol' && symbols && (
            <p className="tnum px-3 py-1.5 text-[10.5px] text-fg-dim">
              {symbols.length} definition{symbols.length === 1 ? '' : 's'}
            </p>
          )}

          {mode === 'symbol' &&
            symbols?.map((d, i) => (
              <button
                key={`${d.path}:${d.line}:${i}`}
                onClick={() => void jump(d.path, d.line)}
                className="anim block w-full border-b border-border-soft px-3 py-1.5 text-left hover:bg-elevated"
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="w-14 shrink-0 text-[10px] text-fg-dim">{d.kind}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg">{d.name}</span>
                  {d.exported && <span className="shrink-0 text-[9.5px] text-add">exported</span>}
                </span>
                <span className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="w-14 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg-dim">{d.path}</span>
                  <span className="tnum shrink-0 text-[10px] text-fg-dim">{d.line}</span>
                </span>
              </button>
            ))}

          {!error && mode !== 'symbol' && results && (
            <p className="tnum px-3 py-1.5 text-[10.5px] text-fg-dim">
              {mode === 'file'
                ? `${files.length} file${files.length === 1 ? '' : 's'}`
                : `${hits.length}${results.truncated ? '+' : ''} result${hits.length === 1 ? '' : 's'} in ${results.scanned} files`}
            </p>
          )}

          {mode === 'file' &&
            files.map((f) => (
              <button
                key={f}
                onClick={() => void jump(f)}
                className="anim block w-full truncate px-3 py-1 text-left font-mono text-[11px] text-fg-muted hover:bg-elevated hover:text-fg"
              >
                {f}
              </button>
            ))}

          {mode !== 'file' &&
            hits.map((h, i) => (
              <button
                key={`${h.path}:${h.line}:${i}`}
                onClick={() => void jump(h.path, h.line)}
                className="anim block w-full border-b border-border-soft px-3 py-1.5 text-left hover:bg-elevated"
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg-muted">
                    {h.path}
                  </span>
                  <span className="tnum shrink-0 text-[10px] text-fg-dim">{h.line}</span>
                </span>
                <pre className="mt-0.5 truncate font-mono text-[11px] text-fg">{h.text.trim()}</pre>
              </button>
            ))}

          {((mode !== 'symbol' && results && !hits.length && !files.length) ||
            (mode === 'symbol' && symbols && !symbols.length)) &&
            !busy && (
            <Empty title="No matches" hint="Try another mode, or ask Claude." />
          )}
        </div>
      </div>
    </Panel>
  )
}
