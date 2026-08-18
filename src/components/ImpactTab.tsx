import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, FileCode2, Loader2, Sparkles, TestTube } from 'lucide-react'
import { impact as impactIpc, type ImpactReport } from '../lib/ipc'
import { useStore } from '../lib/store'
import { Button, Empty } from './ui'

/**
 * What depends on a file, answered from the symbol index rather than by asking
 * the model to read the repo.
 *
 * The index is lexical: it matches names, not resolved types. Two unrelated
 * classes with a `run` method look like one symbol, so callers are labelled
 * "possible" and the count is a ceiling, not a certainty.
 */
export function ImpactTab({ path }: { path: string }) {
  const root = useStore((s) => s.root)
  const openFile = useStore((s) => s.openFile)
  const setReveal = useStore((s) => s.setReveal)
  const prompt = useStore((s) => s.prompt)
  const [report, setReport] = useState<ImpactReport | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!root) return
    let alive = true
    setReport(null)
    setError('')
    impactIpc
      .analyze(root, path)
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [root, path])

  const jump = async (rel: string, line: number) => {
    if (!root) return
    const abs = `${root}/${rel}`
    await openFile(abs)
    setReveal({ abs, line })
  }

  if (error) return <Empty icon={<AlertTriangle size={20} className="text-del" />} title="Analysis failed" hint={error} />
  if (!report) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-fg-dim">
        <Loader2 size={13} className="animate-spin" /> Indexing repository…
      </div>
    )
  }

  const risk =
    report.files_affected === 0 ? 'none' : report.files_affected < 4 ? 'low' : report.files_affected < 12 ? 'medium' : 'high'

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="hairline flex h-11 shrink-0 items-center gap-2 px-4">
        <span className="truncate font-mono text-xs text-fg">{report.path}</span>
        <span
          className={clsx(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize',
            risk === 'high' ? 'bg-del-bg text-del' : risk === 'medium' ? 'bg-pending/15 text-pending' : 'bg-add-bg text-add',
          )}
        >
          {risk} impact
        </span>
        <Button
          compact
          variant="outline"
          className="ml-auto"
          onClick={() =>
            void prompt(
              `Review the blast radius of changing \`${report.path}\`. It defines ${report.definitions
                .map((d) => d.name)
                .slice(0, 12)
                .join(', ')} and is referenced by ${report.files_affected} files. What could break, and what should be tested?`,
            )
          }
        >
          <Sparkles size={11} /> Ask Claude
        </Button>
      </header>

      <div className="tnum flex shrink-0 gap-5 border-b border-border px-4 py-2.5 text-[11px]">
        <Stat n={report.definitions.length} label="definitions" />
        <Stat n={report.importers.length} label="imports" />
        <Stat n={report.callers.length} label="possible callers" />
        <Stat n={report.tests.length} label="tests" tone="text-accent" />
        <Stat n={report.files_affected} label="files affected" tone="text-pending" />
        <span className="ml-auto text-fg-dim">{report.scanned} files scanned</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {report.truncated && (
          <p className="border-b border-border bg-pending/10 px-4 py-1 text-[10.5px] text-pending">
            Caller list truncated at 400 matches.
          </p>
        )}

        <Section title="Defined here">
          {report.definitions.map((d, i) => (
            <Row
              key={i}
              onClick={() => void jump(d.path, d.line)}
              left={<span className="w-16 shrink-0 text-[10px] text-fg-dim">{d.kind}</span>}
              main={d.name}
              right={d.exported ? 'exported' : 'local'}
              line={d.line}
            />
          ))}
        </Section>

        <Section title="Imported by" hint="direct dependencies on this module">
          {report.importers.map((r, i) => (
            <Row key={i} onClick={() => void jump(r.path, r.line)} main={r.path} sub={r.text} line={r.line} />
          ))}
        </Section>

        <Section title="Possible callers" hint="name matches — lexical, so some may be unrelated">
          {report.callers.slice(0, 200).map((r, i) => (
            <Row key={i} onClick={() => void jump(r.path, r.line)} main={r.path} sub={r.text} right={r.name} line={r.line} />
          ))}
        </Section>

        {report.tests.length > 0 && (
          <Section title="Tests that touch this">
            {report.tests.map((t) => (
              <Row key={t} onClick={() => void jump(t, 1)} left={<TestTube size={11} className="shrink-0 text-accent" />} main={t} />
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function Stat({ n, label, tone = 'text-fg' }: { n: number; label: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={clsx('font-semibold', n ? tone : 'text-fg-dim')}>{n}</span>
      <span className="text-fg-dim">{label}</span>
    </span>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  const empty = Array.isArray(items) && items.length === 0
  return (
    <section>
      <p className="hairline sticky top-0 z-[5] bg-panel px-4 py-1.5 text-[11px] font-semibold tracking-wide text-fg-dim uppercase">
        {title}
        {hint && <span className="ml-2 font-normal normal-case opacity-70">{hint}</span>}
      </p>
      {empty ? <p className="px-4 py-2 text-[11px] text-fg-dim">None found.</p> : items}
    </section>
  )
}

function Row({
  left,
  main,
  sub,
  right,
  line,
  onClick,
}: {
  left?: React.ReactNode
  main: string
  sub?: string
  right?: string
  line?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="anim flex w-full items-baseline gap-2 border-b border-border-soft px-4 py-1 text-left hover:bg-elevated"
    >
      {left ?? <FileCode2 size={11} className="shrink-0 translate-y-0.5 text-fg-dim" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[11.5px] text-fg">{main}</span>
        {sub && <span className="block truncate font-mono text-[10.5px] text-fg-dim">{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-[10px] text-fg-dim">{right}</span>}
      {line !== undefined && <span className="tnum shrink-0 text-[10px] text-fg-dim">{line}</span>}
    </button>
  )
}
