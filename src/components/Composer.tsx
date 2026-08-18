import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import clsx from 'clsx'
import { Code2, CornerDownLeft, Loader2, Paperclip, Square, Upload, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { applyCompletion, detectTrigger, rank, type Trigger } from '../lib/mentions'
import { MentionPopup, type Suggestion } from './MentionPopup'
import { Button } from './ui'

/**
 * The chat input: text, attachments, and `@file` / `/skill` completion.
 *
 * Split out of ChatPanel because it now owns real interaction state — a trigger,
 * a highlighted index, drop targets — and burying that in the transcript
 * component made both harder to follow.
 */
export function Composer() {
  const { root, busy, running, attachments, fileIndex, skills, codeSelection } = useStore()
  const prompt = useStore((s) => s.prompt)
  const stop = useStore((s) => s.stop)
  const attachPaths = useStore((s) => s.attachPaths)
  const attachRaw = useStore((s) => s.attachRaw)
  const removeAttachment = useStore((s) => s.removeAttachment)
  const clearSelection = useStore((s) => s.clearSelection)

  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [index, setIndex] = useState(0)
  const [dropping, setDropping] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  const trigger: Trigger | null = useMemo(() => detectTrigger(text, caret), [text, caret])

  const suggestions: Suggestion[] = useMemo(() => {
    if (!trigger) return []
    if (trigger.kind === 'skill') {
      return rank(skills, trigger.query, (s) => s.name).map((s) => ({
        value: s.name,
        label: `/${s.name}`,
        hint: s.description.slice(0, 90),
      }))
    }
    return rank(fileIndex, trigger.query, (f) => f).map((f) => ({ value: f, label: f }))
  }, [trigger, skills, fileIndex])

  useEffect(() => setIndex(0), [trigger?.query, trigger?.kind])

  // Tauri intercepts OS file drops, so HTML5 drop events never fire — but its
  // own event hands us real absolute paths, which is what we want anyway.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'over') setDropping(true)
      else if (e.payload.type === 'drop') {
        setDropping(false)
        void attachPaths(e.payload.paths)
      } else setDropping(false)
    })
    return () => void un.then((f) => f())
  }, [attachPaths])

  const pick = (s: Suggestion) => {
    if (!trigger) return
    const next = applyCompletion(text, trigger, s.value)
    setText(next.text)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  const submit = () => {
    if ((!text.trim() && !attachments.length && !codeSelection) || !root) return
    const body = text
    setText('')
    setCaret(0)
    void prompt(body)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        return setIndex((i) => (i + 1) % suggestions.length)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        return setIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return pick(suggestions[index])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return setCaret(-1)
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  /** Screenshots go straight from the clipboard into the message. */
  const onPaste = (e: React.ClipboardEvent) => {
    const image = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!image) return
    const file = image.getAsFile()
    if (!file) return
    e.preventDefault()
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = String(reader.result).split(',')[1] ?? ''
      attachRaw(`pasted-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`, file.type, b64)
    }
    reader.readAsDataURL(file)
  }

  const browse = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ multiple: true })
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
    if (paths.length) void attachPaths(paths)
  }

  return (
    <div className="relative shrink-0 border-t border-border p-2.5">
      {trigger && <MentionPopup kind={trigger.kind} items={suggestions} index={index} onPick={pick} />}

      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-accent-soft/60 text-[12px] text-accent">
          <Upload size={14} /> Drop files to attach
        </div>
      )}

      {codeSelection && (
        <div className="mb-1.5 overflow-hidden rounded-md border border-accent/35 bg-accent-soft/25">
          <div className="flex items-center gap-1.5 px-2 py-1">
            <Code2 size={11} className="shrink-0 text-accent" />
            <span className="tnum min-w-0 flex-1 truncate font-mono text-[10.5px] text-accent">
              {codeSelection.path}:{codeSelection.from}
              {codeSelection.to !== codeSelection.from && `-${codeSelection.to}`}
            </span>
            <button
              onClick={clearSelection}
              aria-label="Remove selected code"
              className="anim rounded p-0.5 text-fg-dim hover:text-del"
            >
              <X size={10} />
            </button>
          </div>
          <pre className="max-h-24 overflow-auto border-t border-accent/20 px-2 py-1 font-mono text-[10.5px] leading-snug whitespace-pre text-fg-muted">
            {codeSelection.text.slice(0, 800)}
          </pre>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="group/a flex items-center gap-1 rounded border border-border bg-elevated py-0.5 pr-1 pl-1.5 text-[10.5px] text-fg-muted"
              title={a.path ?? a.name}
            >
              {a.kind === 'image' && a.base64 && (
                <img
                  src={`data:${a.mime};base64,${a.base64}`}
                  alt=""
                  className="h-4 w-4 rounded-sm object-cover"
                />
              )}
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
                className="anim rounded p-0.5 text-fg-dim hover:text-del"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="anim rounded-lg border border-border bg-elevated focus-within:border-accent/50">
        <textarea
          ref={box}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart ?? 0)
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={3}
          disabled={!root}
          placeholder={
            root
              ? codeSelection
                ? 'Ask about the selected code…'
                : 'Describe a change…   @ for files, / for skills, ⌘L for selection'
              : 'Open a folder to begin'
          }
          className="w-full resize-none bg-transparent px-2.5 py-2 text-[12.5px] text-fg outline-none placeholder:text-fg-dim disabled:opacity-50"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <span
            className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', running ? 'bg-add' : 'bg-fg-dim/40')}
            title={running ? 'Session running' : 'Idle'}
          />
          <Button compact variant="ghost" title="Attach files" onClick={() => void browse()}>
            <Paperclip size={12} />
          </Button>
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin text-accent" />
              <span className="text-[11px] text-fg-muted">working…</span>
              <Button compact variant="outline" className="ml-auto" onClick={() => void stop()}>
                <Square size={10} /> Stop
              </Button>
            </>
          ) : (
            <Button
              variant="accent"
              compact
              className="ml-auto"
              disabled={(!text.trim() && !attachments.length && !codeSelection) || !root}
              onClick={submit}
            >
              Send <CornerDownLeft size={11} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
