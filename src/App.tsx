import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Presenter from '@/components/Presenter'
import { PrintPages } from '@/components/PrintPages'
import { SearchBar } from '@/components/SearchBar'
import { SettingsDialog } from '@/components/SettingsDialog'
import { SlideCanvas, Thumbnail } from '@/components/SlideCanvas'
import { Tip } from '@/components/Tip'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { ACCEPT, formatSize, isPresentationFile, isSlideshowFile } from '@/lib/files'
import { consumeHandoff } from '@/lib/idb'
import { permissionsSupported } from '@/lib/permissions'
import { prefetchAround } from '@/lib/prefetch'
import { exportSlidesAsZip, loadPptx, type Slide } from '@/lib/pptx'
import { slideToJpegUrl, slideToPng } from '@/lib/slideImage'
import { outline, searchSlides, slideText } from '@/lib/slideText'
import { addRecent, clearRecent, listRecent, loadRecent, type RecentEntry } from '@/lib/recent'
import { cn } from '@/lib/utils'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25

type Status = 'empty' | 'loading' | 'ready'

export default function App() {
  const [status, setStatus] = useState<Status>('empty')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [slides, setSlides] = useState<Slide[]>([])
  const [index, setIndex] = useState(0)
  // null = fit the slide to the window
  const [zoom, setZoom] = useState<number | null>(null)
  const [showThumbs, setShowThumbs] = useState(true)
  const mainRef = useRef<HTMLElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [exporting, setExporting] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  // ?settings=1 is used by the first-run page and the "allow downloads" notification
  const [settingsOpen, setSettingsOpen] = useState(() => new URLSearchParams(location.search).has('settings'))
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [printPages, setPrintPages] = useState<string[] | null>(null)

  const refreshRecent = useCallback(() => {
    listRecent().then(setRecent).catch(() => setRecent([]))
  }, [])
  useEffect(refreshRecent, [refreshRecent])

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
      // PowerPoint Show files (.ppsx) are meant to open straight into the slideshow.
      if (isSlideshowFile(name)) setPresenting(true)
      void addRecent(name, bytes).then(refreshRecent).catch(() => undefined)
    } catch (err) {
      console.error('[PPTX Viewer] Failed to open presentation:', err)
      setError(`Could not open the presentation: ${err instanceof Error ? err.message : err}`)
      setStatus(slides.length ? 'ready' : 'empty')
    }
  }, [slides.length, refreshRecent])

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      if (!isPresentationFile(file.name)) {
        setError('Please choose a PowerPoint file (.pptx, .ppsx, .potx, …).')
        return
      }
      await openBytes(await file.arrayBuffer(), file.name)
    },
    [openBytes],
  )

  const openRecent = useCallback(
    async (entry: RecentEntry) => {
      const bytes = await loadRecent(entry.id)
      if (!bytes) {
        setError(`"${entry.name}" is no longer stored. Please choose the file again.`)
        refreshRecent()
        return
      }
      await openBytes(bytes, entry.name)
    },
    [openBytes, refreshRecent],
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

  // Track the slide area so "fit" always matches the window.
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const update = () => setArea({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [status, showThumbs])

  const go = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(slides.length - 1, i))),
    [slides.length],
  )
  const current = slides[index]
  const PAD = 48 // matches the p-6 padding around the slide
  const fitZoom = current && area.w > 0
    ? Math.max(0.1, Math.min((area.w - PAD) / current.width, (area.h - PAD) / current.height))
    : 1
  const effectiveZoom = zoom ?? fitZoom
  const changeZoom = useCallback(
    (delta: number) =>
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round((effectiveZoom + delta) * 100) / 100))),
    [effectiveZoom],
  )

  // Keep the neighbouring slides' images decoded so paging is instant.
  useEffect(() => {
    if (status === 'ready') prefetchAround(slides, index)
  }, [status, slides, index])

  // ── Search ────────────────────────────────────────────────────────────────
  const deferredQuery = useDeferredValue(query)
  const hits = useMemo(() => searchSlides(slides, deferredQuery), [slides, deferredQuery])
  const hitSlides = useMemo(() => new Set(hits.map((h) => h.index)), [hits])
  const indexRef = useRef(index)
  indexRef.current = index

  // A new result set jumps to the first match at or after the current slide.
  useEffect(() => {
    if (!hits.length) return
    const first = Math.max(0, hits.findIndex((h) => h.index >= indexRef.current))
    setCursor(first)
    setIndex(hits[first].index)
  }, [hits])

  const goToHit = useCallback((i: number) => {
    setCursor(i)
    if (hits[i]) setIndex(hits[i].index)
  }, [hits])

  // ── Copy and print ────────────────────────────────────────────────────────
  const noticeTimer = useRef<number>(0)
  const showNotice = useCallback((message: string | null, forMs = 2500) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(message)
    if (message && forMs) noticeTimer.current = window.setTimeout(() => setNotice(null), forMs)
  }, [])

  const copyImage = async () => {
    try {
      const blob = await slideToPng(slides[index])
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      showNotice('Slide copied as an image')
    } catch (err) {
      setError(`Could not copy the slide: ${err instanceof Error ? err.message : err}`)
    }
  }

  const copyText = async (what: 'slide' | 'all') => {
    const text = what === 'all' ? outline(slides) : [slideText(slides[index]), slides[index].notes].filter(Boolean).join('\n\n')
    try {
      await navigator.clipboard.writeText(text || '')
      showNotice(text ? (what === 'all' ? 'Text of all slides copied' : 'Slide text copied') : 'This slide has no text')
    } catch (err) {
      setError(`Could not copy the text: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Printing / Save as PDF: render every slide, show them as pages, then open the print dialog.
  const printDeck = async () => {
    try {
      const urls: string[] = []
      for (let i = 0; i < slides.length; i++) {
        showNotice(`Preparing pages ${i + 1}/${slides.length}…`, 0)
        urls.push(await slideToJpegUrl(slides[i]))
        await new Promise((r) => setTimeout(r, 0))
      }
      showNotice(null)
      setPrintPages(urls)
    } catch (err) {
      showNotice(null)
      setError(`Could not prepare the pages: ${err instanceof Error ? err.message : err}`)
    }
  }
  useEffect(() => {
    if (!printPages) return
    const finish = () => setPrintPages(null)
    window.addEventListener('afterprint', finish, { once: true })
    void (async () => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>('.print-pages img'))
      await Promise.all(images.map((img) => img.decode().catch(() => undefined)))
      window.print()
    })()
    return () => window.removeEventListener('afterprint', finish)
  }, [printPages])

  // Keyboard shortcuts
  useEffect(() => {
    if (status !== 'ready' || presenting) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setSearchOpen(true); return }
      if (e.target instanceof HTMLInputElement) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'F5') { e.preventDefault(); setPresenting(true); return }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(index - 1) }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(index + 1) }
      else if (e.key === 'Home') { e.preventDefault(); go(0) }
      else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1) }
      else if (e.key === '+' || e.key === '=') changeZoom(ZOOM_STEP)
      else if (e.key === '-') changeZoom(-ZOOM_STEP)
      else if (e.key === '0') setZoom(null)
      else if (e.key === 't') setShowThumbs((v) => !v)
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

  const settingsEl = (
    <SettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      onClearRecent={() => void clearRecent().then(refreshRecent)}
    />
  )

  const fileInputEl = (
    <input
      ref={fileInput}
      type="file"
      accept={ACCEPT}
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
        {settingsEl}
        {status === 'loading' ? (
          <p className="text-sm text-muted-foreground" role="status">{message}</p>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-lg font-medium">Open a presentation</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Files stay on your device. Drop a .pptx file anywhere on this page.
              </p>
            </div>
            {error && (
              <Alert variant="destructive" className="max-w-md">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button onClick={() => fileInput.current?.click()}>Choose file</Button>
            {permissionsSupported && (
              <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
                Settings
              </Button>
            )}
            {recent.length > 0 && (
              <section className="mt-4 w-full max-w-sm" aria-label="Recent files">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Recent</span>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => void clearRecent().then(refreshRecent)}
                  >
                    Clear
                  </button>
                </div>
                <ul className="divide-y rounded-md border">
                  {recent.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => void openRecent(entry)}
                      >
                        <span className="truncate">{entry.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatSize(entry.size)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <>
    {printPages && <PrintPages pages={printPages} />}
    <div className={cn('flex h-screen flex-col print:hidden', dragging && 'bg-accent')}>
      {fileInputEl}
      {settingsEl}
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
        <Tip label="Show or hide slides (T)">
          <Button variant={showThumbs ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowThumbs((v) => !v)}>
            Slides
          </Button>
        </Tip>
        <span className="min-w-0 truncate text-sm font-medium">{filename}</span>
        <span className="shrink-0 text-xs text-muted-foreground" role="status">{notice}</span>
        <div className="ml-auto flex items-center gap-1">
          <Tip label="Previous slide (←)">
            <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => go(index - 1)}>
              Prev
            </Button>
          </Tip>
          <span className="min-w-14 text-center text-sm tabular-nums">
            {index + 1} / {slides.length}
          </span>
          <Tip label="Next slide (→)">
            <Button variant="ghost" size="sm" disabled={index === slides.length - 1} onClick={() => go(index + 1)}>
              Next
            </Button>
          </Tip>
          <Separator orientation="vertical" className="mx-2 h-5" />
          <Tip label="Zoom out (−)">
            <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => changeZoom(-ZOOM_STEP)}>
              −
            </Button>
          </Tip>
          <span className="min-w-12 text-center text-sm tabular-nums">{Math.round(effectiveZoom * 100)}%</span>
          <Tip label="Zoom in (+)">
            <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => changeZoom(ZOOM_STEP)}>
              +
            </Button>
          </Tip>
          <Tip label="Fit slide to window (0)">
            <Button variant={zoom === null ? 'secondary' : 'ghost'} size="sm" onClick={() => setZoom(null)}>
              Fit
            </Button>
          </Tip>
          <Separator orientation="vertical" className="mx-2 h-5" />
          <Tip label="Search slides (Ctrl+F)">
            <Button variant={searchOpen ? 'secondary' : 'ghost'} size="sm" onClick={() => setSearchOpen((v) => !v)}>
              Search
            </Button>
          </Tip>
          <Tip label="Start slideshow (F5)">
            <Button variant="outline" size="sm" onClick={() => setPresenting(true)}>
              Present
            </Button>
          </Tip>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="More actions" />}>
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
              <DropdownMenuItem onClick={() => fileInput.current?.click()}>Open another file…</DropdownMenuItem>
              {recent.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Recent</DropdownMenuLabel>
                    {recent.map((entry) => (
                      <DropdownMenuItem key={entry.id} onClick={() => void openRecent(entry)}>
                        <span className="max-w-64 truncate">{entry.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>This slide</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => void copyImage()}>Copy as image</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void copyText('slide')}>Copy text</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Whole presentation</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => void copyText('all')}>Copy text outline</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void printDeck()}>Print or save as PDF…</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!!exporting} onClick={exportAll}>
                {exporting ?? 'Export slides as PNGs'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>Settings…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {searchOpen && (
        <SearchBar
          query={query}
          onQueryChange={setQuery}
          hits={hits}
          cursor={cursor}
          onCursor={goToHit}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1">
        {showThumbs && (
          <aside className="w-44 shrink-0 border-r">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-1 p-2">
                {slides.map((slide, i) => (
                  <Thumbnail key={i} slide={slide} index={i} active={i === index} match={searchOpen && hitSlides.has(i)} onSelect={() => go(i)} />
                ))}
              </div>
            </ScrollArea>
          </aside>
        )}
        <main
          ref={mainRef}
          className="flex min-w-0 flex-1 overflow-auto bg-muted p-6"
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) changeZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
          }}
        >
          <div className="m-auto">
            <SlideCanvas slide={current} zoom={effectiveZoom} />
          </div>
        </main>
      </div>
    </div>
    </>
  )
}
