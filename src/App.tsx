import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Presenter from '@/components/Presenter'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { consumeHandoff } from '@/lib/idb'
import { prefetchAround } from '@/lib/prefetch'
import { exportSlidesAsZip, loadPptx, type Slide } from '@/lib/pptx'
import { useSlideRender } from '@/lib/useSlideRender'
import { cn } from '@/lib/utils'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25

type Status = 'empty' | 'loading' | 'ready'

function SlideCanvas({ slide, zoom }: { slide: Slide; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useSlideRender(ref, slide, zoom, undefined, { cache: true })
  return (
    <canvas
      ref={ref}
      className="block border bg-white"
      style={{ width: slide.width * zoom, height: slide.height * zoom }}
      aria-label="Current slide"
    />
  )
}

function Thumbnail({
  slide, index, active, onSelect,
}: { slide: Slide; index: number; active: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Render only once the thumbnail is near the viewport, through a shared queue.
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])
  useSlideRender(ref, slide, 144 / slide.width, 1, { enabled: visible, limited: true })

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Slide ${index + 1}`}
      aria-current={active}
      className="flex w-full items-start gap-2 rounded-md p-1 text-left hover:bg-accent"
    >
      <span className="w-4 pt-1 text-right text-xs text-muted-foreground">{index + 1}</span>
      <canvas
        ref={ref}
        className={cn('block border bg-white', active && 'outline-2 outline-offset-1 outline-primary')}
        style={{ width: 144, height: (144 * slide.height) / slide.width }}
      />
    </button>
  )
}

export default function App() {
  const [status, setStatus] = useState<Status>('empty')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [slides, setSlides] = useState<Slide[]>([])
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [exporting, setExporting] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const openBytes = useCallback(async (bytes: ArrayBuffer, name: string) => {
    setError(null)
    setStatus('loading')
    setMessage('Opening…')
    try {
      const loaded = await loadPptx(bytes, setMessage)
      setSlides(loaded)
      setFilename(name)
      setIndex(0)
      setStatus('ready')
    } catch (err) {
      console.error('[PPTX Viewer] Failed to open presentation:', err)
      setError(`Could not open the presentation: ${err instanceof Error ? err.message : err}`)
      setStatus(slides.length ? 'ready' : 'empty')
    }
  }, [slides.length])

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      if (!file.name.toLowerCase().endsWith('.pptx')) {
        setError('Please choose a .pptx file.')
        return
      }
      await openBytes(await file.arrayBuffer(), file.name)
    },
    [openBytes],
  )

  // Opened from an intercepted download: the service worker stored the bytes.
  const handoffStarted = useRef(false)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('mode') !== 'intercepted' || handoffStarted.current) return
    handoffStarted.current = true

    const key = params.get('handoff')
    if (!key) {
      setError('No presentation was handed to the viewer. Please choose a file.')
      return
    }
    setStatus('loading')
    setMessage('Opening…')
    consumeHandoff(key)
      .then((payload) => {
        if (!payload?.bytes) {
          setStatus('empty')
          setError('This download is no longer available (already opened or expired). Please choose the file.')
          return
        }
        return openBytes(payload.bytes, payload.filename || 'presentation.pptx')
      })
      .catch((err) => {
        console.error('[PPTX Viewer] Handoff read failed:', err)
        setStatus('empty')
        setError(`Could not load the presentation: ${err?.message || err}`)
      })
  }, [openBytes])

  const go = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(slides.length - 1, i))),
    [slides.length],
  )
  const changeZoom = useCallback(
    (delta: number) => setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round((z + delta) * 100) / 100))),
    [],
  )

  // Keep the neighbouring slides' images decoded so paging is instant.
  useEffect(() => {
    if (status === 'ready') prefetchAround(slides, index)
  }, [status, slides, index])

  // Keyboard shortcuts
  useEffect(() => {
    if (status !== 'ready' || presenting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'F5') { e.preventDefault(); setPresenting(true); return }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(index - 1) }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(index + 1) }
      else if (e.key === 'Home') { e.preventDefault(); go(0) }
      else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1) }
      else if (e.key === '+' || e.key === '=') changeZoom(ZOOM_STEP)
      else if (e.key === '-') changeZoom(-ZOOM_STEP)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [status, presenting, index, slides.length, go, changeZoom])

  // Drag and drop anywhere on the page
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); setDragging(true) }
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false) }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void openFile(e.dataTransfer?.files?.[0])
    }
    document.addEventListener('dragover', over)
    document.addEventListener('dragleave', leave)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('dragover', over)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('drop', drop)
    }
  }, [openFile])

  const exportAll = async () => {
    setExporting('Exporting…')
    try {
      await exportSlidesAsZip(slides, filename, (done, total) => setExporting(`Exporting ${done}/${total}`))
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setExporting(null)
    }
  }

  const fileInputEl = (
    <input
      ref={fileInput}
      type="file"
      accept=".pptx"
      className="hidden"
      onChange={(e) => {
        void openFile(e.target.files?.[0])
        e.target.value = '' // allow re-selecting the same file
      }}
    />
  )

  if (status !== 'ready') {
    return (
      <div className={cn('flex h-screen flex-col items-center justify-center gap-4 p-6', dragging && 'bg-accent')}>
        {fileInputEl}
        {status === 'loading' ? (
          <p className="text-sm text-muted-foreground" role="status">{message}</p>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-lg font-medium">Open a presentation</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Files stay on your device. Drop a .pptx anywhere on this page.
              </p>
            </div>
            {error && (
              <Alert variant="destructive" className="max-w-md">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button onClick={() => fileInput.current?.click()}>Choose file</Button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex h-screen flex-col', dragging && 'bg-accent')}>
      {fileInputEl}
      {presenting && (
        <Presenter
          slides={slides}
          startIndex={index}
          onExit={(i) => {
            setIndex(i)
            setPresenting(false)
          }}
        />
      )}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="min-w-0 truncate text-sm font-medium">{filename}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => go(index - 1)}>
            Prev
          </Button>
          <span className="min-w-14 text-center text-sm tabular-nums">
            {index + 1} / {slides.length}
          </span>
          <Button variant="ghost" size="sm" disabled={index === slides.length - 1} onClick={() => go(index + 1)}>
            Next
          </Button>
          <Separator orientation="vertical" className="mx-2 h-5" />
          <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => changeZoom(-ZOOM_STEP)}>
            −
          </Button>
          <span className="min-w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => changeZoom(ZOOM_STEP)}>
            +
          </Button>
          <Separator orientation="vertical" className="mx-2 h-5" />
          <Button variant="outline" size="sm" onClick={() => setPresenting(true)}>
            Present
          </Button>
          <Button variant="outline" size="sm" disabled={!!exporting} onClick={exportAll}>
            {exporting ?? 'Export PNGs'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            Open
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-44 shrink-0 border-r">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-1 p-2">
              {slides.map((slide, i) => (
                <Thumbnail key={i} slide={slide} index={i} active={i === index} onSelect={() => go(i)} />
              ))}
            </div>
          </ScrollArea>
        </aside>
        <main
          className="flex min-w-0 flex-1 overflow-auto bg-muted p-6"
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) changeZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
          }}
        >
          <div className="m-auto">
            <SlideCanvas slide={slides[index]} zoom={zoom} />
          </div>
        </main>
      </div>
    </div>
  )
}
