import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { X } from 'lucide-react'
import { onPty, pty } from '../lib/ipc'
import { useStore } from '../lib/store'
import { Button } from './ui'

const ID = 'main'

export function TerminalPanel() {
  const root = useStore((s) => s.root)
  const setOpen = useStore((s) => s.set)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current || !root) return

    const term = new Terminal({
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0b0b0d',
        foreground: '#e9e9ec',
        cursor: '#d97757',
        selectionBackground: '#2c2c36',
        black: '#0b0b0d', red: '#f85149', green: '#3fb950', yellow: '#d0a215',
        blue: '#79a9d1', magenta: '#c39ac9', cyan: '#7fc7c7', white: '#e9e9ec',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    fit.fit()

    void pty.open(ID, root, term.rows, term.cols)
    const off = onPty((e) => e.id === ID && term.write(e.data))
    term.onData((d) => void pty.write(ID, d))

    const ro = new ResizeObserver(() => {
      fit.fit()
      void pty.resize(ID, term.rows, term.cols)
    })
    ro.observe(host.current)

    return () => {
      ro.disconnect()
      void off.then((f) => f())
      void pty.close(ID)
      term.dispose()
    }
  }, [root])

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <header className="hairline flex h-8 shrink-0 items-center px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-dim">
          Terminal
        </h2>
        <Button
          compact
          variant="ghost"
          className="ml-auto"
          aria-label="Close terminal"
          onClick={() => setOpen('terminalOpen', false)}
        >
          <X size={12} />
        </Button>
      </header>
      <div ref={host} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  )
}
