import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Code2, FileQuestion, Image as ImageIcon, Loader2 } from 'lucide-react'
import { media, type Blob } from '../lib/ipc'
import { Button, Empty } from './ui'

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

/**
 * Preview for anything that is not source code: raster and vector images, video,
 * audio, PDF. SVG gets both views, because it is equally a picture and a file you
 * edit — the toggle is the point, not a nicety.
 */
export function MediaViewer({ path, onOpenAsText }: { path: string; onOpenAsText: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [checker, setChecker] = useState(true)

  useEffect(() => {
    let alive = true
    setBlob(null)
    setError('')
    media
      .read(path)
      .then((b) => alive && setBlob(b))
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [path])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Empty
          icon={<AlertTriangle size={20} className="text-del" />}
          title="Cannot preview this file"
          hint={error}
        />
      </div>
    )
  }
  if (!blob) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-fg-dim">
        <Loader2 size={13} className="animate-spin" /> Loading…
      </div>
    )
  }

  const src = `data:${blob.mime};base64,${blob.base64}`
  const name = path.split('/').pop()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="hairline flex h-9 shrink-0 items-center gap-2 px-3">
        <span className="truncate font-mono text-[11px] text-fg-muted">{name}</span>
        <span className="tnum shrink-0 text-[10.5px] text-fg-dim">
          {blob.mime} · {kb(blob.size)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(blob.kind === 'image' || blob.kind === 'svg') && (
            <Button
              compact
              variant="ghost"
              aria-pressed={checker}
              title="Checkerboard behind transparency"
              onClick={() => setChecker((v) => !v)}
            >
              <ImageIcon size={11} />
            </Button>
          )}
          {blob.kind === 'svg' && (
            <Button compact variant="outline" onClick={onOpenAsText}>
              <Code2 size={11} /> Edit source
            </Button>
          )}
        </div>
      </header>

      <div
        className={clsx(
          'flex min-h-0 flex-1 items-center justify-center overflow-auto p-6',
          checker && (blob.kind === 'image' || blob.kind === 'svg') && 'checker',
        )}
      >
        {blob.kind === 'image' || blob.kind === 'svg' ? (
          <img src={src} alt={name} className="max-h-full max-w-full object-contain" />
        ) : blob.kind === 'video' ? (
          <video src={src} controls className="max-h-full max-w-full rounded-lg" />
        ) : blob.kind === 'audio' ? (
          <div className="w-full max-w-md">
            <p className="mb-3 truncate text-center text-xs text-fg-muted">{name}</p>
            <audio src={src} controls className="w-full" />
          </div>
        ) : blob.kind === 'pdf' ? (
          <iframe src={src} title={name} className="h-full w-full rounded-lg border border-border" />
        ) : (
          <Empty
            icon={<FileQuestion size={20} />}
            title="No preview for this file type"
            hint={`${blob.mime} · ${kb(blob.size)}`}
          />
        )}
      </div>
    </div>
  )
}
