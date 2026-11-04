import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SlidePreview } from '@/components/SlideCanvas'
import type { Slide } from '@/lib/pptx'
import { playTransition, prefersReducedMotion, snapshotCanvas } from '@/lib/transitions'
import { useSlideRender } from '@/lib/useSlideRender'
import { cn } from '@/lib/utils'
import { animationStepCount } from '@/renderer/render-canvas.js'

interface Props {
  slides: Slide[]
  startIndex: number
  /** Called when the slideshow ends, with the slide that was showing. */
  onExit: (index: number) => void
}

interface Position {
  index: number
  /** Number of animation clicks already played on this slide. */
  step: number
}

const CURSOR_HIDE_MS = 2000
const GOTO_TIMEOUT_MS = 3000
const PEN_COLOR = '#ef4444'

const SHORTCUTS: Array<[string, string]> = [
  ['→ ↓ Space Enter Click', 'Next build / slide'],
  ['← ↑ Backspace Right-click', 'Previous build / slide'],
  ['Home / End', 'First / last slide'],
  ['Number + Enter', 'Go to slide'],
  ['S', 'Speaker view (notes, next slide, timer)'],
  ['L', 'Laser pointer'],
  ['D / E', 'Pen / erase drawings'],
  ['G', 'Slide grid'],
  ['B / W', 'Black / white screen'],
  ['?', 'This help'],
  ['Esc', 'Close panel or tool, then exit'],
]

const pad = (n: number) => String(n).padStart(2, '0')

/** Elapsed time since the slideshow started, as m:ss (or h:mm:ss). */
function Timer() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return <span className="tabular-nums">{h ? `${h}:${pad(m)}` : m}:{pad(seconds % 60)}</span>
}

/** Preview of the slide that follows, as it will first appear. */
function NextSlide({ slide, width }: { slide: Slide; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useSlideRender(ref, slide, width / slide.width, undefined, { cache: true, step: 0 })
  return <canvas ref={ref} style={{ width, height: (width * slide.height) / slide.width }} className="border border-white/20" />
}

/**
 * Full-screen slideshow. Plays each slide's animation builds and transitions:
 * a click (or arrow / space / enter) reveals the next build, then moves on.
 * Also offers a speaker view, laser pointer and pen.
 */
export default function Presenter({ slides, startIndex, onExit }: Props) {
  const [pos, setPos] = useState<Position>({ index: startIndex, step: 0 })
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [blank, setBlank] = useState<'black' | 'white' | null>(null)
  const [grid, setGrid] = useState(false)
  const [help, setHelp] = useState(false)
  const [speaker, setSpeaker] = useState(false)
  const [laser, setLaser] = useState(false)
  const [pen, setPen] = useState(false)
  const [typed, setTyped] = useState('')
  const [cursorHidden, setCursorHidden] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null) // snapshot of the outgoing slide
  const penRef = useRef<HTMLCanvasElement>(null)
  const laserRef = useRef<HTMLDivElement>(null)
  const pendingTransition = useRef<Slide['transition']>(null)

  const posRef = useRef(pos)
  posRef.current = pos
  // Keep the latest onExit without re-running effects when the parent re-renders.
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const exit = useCallback(() => onExitRef.current(posRef.current.index), [])

  const slide = slides[pos.index]
  const nextSlide = slides[pos.index + 1]
  // In speaker view the slide shares the screen with a side panel.
  const stage = speaker ? { w: size.w * 0.64, h: size.h * 0.94 } : size
  const scale = Math.min(stage.w / slide.width, stage.h / slide.height)
  const stageW = slide.width * scale
  const stageH = slide.height * scale

  useSlideRender(canvasRef, slide, scale, undefined, {
    cache: true,
    step: pos.step,
    onDrawn: () => {
      const t = pendingTransition.current
      pendingTransition.current = null
      if (t && canvasRef.current && overlayRef.current) playTransition(canvasRef.current, overlayRef.current, t)
    },
  })

  const goTo = useCallback((p: Position, animate = false) => {
    const target = slides[p.index]
    if (animate && target.transition && !prefersReducedMotion() && canvasRef.current && overlayRef.current) {
      // Snapshot what is on screen now; the transition plays once the new slide is drawn.
      snapshotCanvas(canvasRef.current, overlayRef.current)
      pendingTransition.current = target.transition
    } else {
      pendingTransition.current = null
    }
    posRef.current = p
    setPos(p)
  }, [slides])

  const next = useCallback(() => {
    const p = posRef.current
    if (p.step < animationStepCount(slides[p.index])) goTo({ index: p.index, step: p.step + 1 })
    else if (p.index < slides.length - 1) goTo({ index: p.index + 1, step: 0 }, true)
  }, [slides, goTo])

  const prev = useCallback(() => {
    const p = posRef.current
    if (p.step > 0) goTo({ index: p.index, step: p.step - 1 })
    // Going back lands on the finished state of the previous slide.
    else if (p.index > 0) goTo({ index: p.index - 1, step: animationStepCount(slides[p.index - 1]) })
  }, [slides, goTo])

  const jumpTo = useCallback((index: number) => {
    goTo({ index: Math.max(0, Math.min(slides.length - 1, index)), step: 0 })
  }, [slides.length, goTo])

  // Enter full screen, and leave the slideshow when the user leaves full screen (Esc).
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) exit()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    void document.documentElement.requestFullscreen?.().catch(() => {
      // Full screen can be refused (for example inside an embedded pane);
      // the slideshow still works as a window-sized overlay.
    })
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (document.fullscreenElement) void document.exitFullscreen()
    }
  }, [exit])

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Hide the mouse cursor after a moment of inactivity; move the laser dot.
  useEffect(() => {
    let timer: number
    const onMove = (e: MouseEvent) => {
      setCursorHidden(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setCursorHidden(true), CURSOR_HIDE_MS)
      if (laserRef.current) laserRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    }
    timer = window.setTimeout(() => setCursorHidden(true), CURSOR_HIDE_MS)
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.clearTimeout(timer)
    }
  }, [])

  // Typing digits builds a slide number; it clears itself if you stop.
  useEffect(() => {
    if (!typed) return
    const timer = window.setTimeout(() => setTyped(''), GOTO_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [typed])

  // Drawings belong to a slide: clear them when the slide changes or the stage resizes.
  const clearPen = useCallback(() => {
    const c = penRef.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
  }, [])
  useEffect(() => { clearPen() }, [pos.index, stageW, stageH, clearPen])

  const drawing = useRef<{ x: number; y: number } | null>(null)
  const penPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const onPenDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId) // keeps the stroke going outside the canvas
    } catch {
      // not fatal: the stroke just stops if the pointer leaves the canvas
    }
    drawing.current = penPoint(e)
  }
  const onPenMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = e.currentTarget.getContext('2d')
    const to = penPoint(e)
    if (ctx) {
      const dpr = window.devicePixelRatio || 1
      ctx.strokeStyle = PEN_COLOR
      ctx.lineWidth = 3 * dpr
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(drawing.current.x * dpr, drawing.current.y * dpr)
      ctx.lineTo(to.x * dpr, to.y * dpr)
      ctx.stroke()
    }
    drawing.current = to
  }
  const onPenUp = () => { drawing.current = null }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key

      // A blank screen is dismissed by any key (B / W toggle it).
      if (blank && key !== 'b' && key !== 'B' && key !== 'w' && key !== 'W') {
        e.preventDefault()
        setBlank(null)
        return
      }

      if (/^[0-9]$/.test(key)) { setTyped((t) => (t + key).slice(0, 4)); return }
      if (key === 'Enter' && typed) {
        e.preventDefault()
        jumpTo(parseInt(typed, 10) - 1)
        setTyped('')
        return
      }

      switch (key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': case 'n':
          e.preventDefault(); next(); break
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': case 'p':
          e.preventDefault(); prev(); break
        case 'Home':
          e.preventDefault(); goTo({ index: 0, step: 0 }); break
        case 'End':
          e.preventDefault(); goTo({ index: slides.length - 1, step: animationStepCount(slides[slides.length - 1]) }); break
        case 'b': case 'B':
          setBlank((v) => (v === 'black' ? null : 'black')); break
        case 'w': case 'W':
          setBlank((v) => (v === 'white' ? null : 'white')); break
        case 'g': case 'G':
          setGrid((v) => !v); break
        case 's': case 'S':
          setSpeaker((v) => !v); break
        case 'l': case 'L':
          setLaser((v) => !v); setPen(false); break
        case 'd': case 'D':
          setPen((v) => !v); setLaser(false); break
        case 'e': case 'E':
          clearPen(); break
        case '?':
          setHelp((v) => !v); break
        case 'Escape':
          // Close the innermost thing first.
          if (typed) setTyped('')
          else if (help) setHelp(false)
          else if (grid) setGrid(false)
          else if (pen || laser) { setPen(false); setLaser(false) }
          else exit()
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [blank, typed, help, grid, pen, laser, next, prev, jumpTo, goTo, clearPen, exit, slides])

  const onClick = () => {
    // Full screen needs a user gesture; a slideshow that started on its own gets it from the first click.
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined)
    if (blank) setBlank(null)
    else if (!grid && !pen) next()
  }

  const dpr = window.devicePixelRatio || 1
  const hideCursor = laser || (cursorHidden && !grid && !pen)

  return (
    <div
      className={cn('fixed inset-0 z-50 flex items-center justify-center bg-black', hideCursor ? 'cursor-none' : pen ? 'cursor-crosshair' : 'cursor-pointer')}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); prev() }}
      role="presentation"
    >
      <div className={cn('flex items-center justify-center', speaker ? 'w-[66%]' : 'w-full')} style={{ height: '100%' }}>
        <div className="relative overflow-hidden" style={{ width: stageW, height: stageH }}>
          <canvas ref={canvasRef} aria-label={`Slide ${pos.index + 1}`} className="absolute left-0 top-0" style={{ width: stageW, height: stageH }} />
          <canvas ref={overlayRef} aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0" style={{ width: stageW, height: stageH }} />
          <canvas
            ref={penRef}
            aria-label="Drawing layer"
            width={Math.round(stageW * dpr)}
            height={Math.round(stageH * dpr)}
            className={cn('absolute left-0 top-0 z-10', pen ? 'pointer-events-auto' : 'pointer-events-none')}
            style={{ width: stageW, height: stageH, touchAction: 'none' }}
            onPointerDown={onPenDown}
            onPointerMove={onPenMove}
            onPointerUp={onPenUp}
            onPointerCancel={onPenUp}
          />
        </div>
      </div>

      {speaker && (
        <aside
          className="flex h-full w-[34%] cursor-default flex-col gap-3 overflow-hidden bg-zinc-900 p-4 text-white"
          onClick={(e) => e.stopPropagation()}
          aria-label="Speaker view"
        >
          <div className="flex items-baseline justify-between text-sm text-white/70">
            <span>Slide {pos.index + 1} of {slides.length}</span>
            <span className="text-xl font-medium text-white"><Timer /></span>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-white/50">Next</p>
            {nextSlide
              ? <NextSlide slide={nextSlide} width={Math.max(160, Math.round(size.w * 0.34 - 32))} />
              : <p className="text-sm text-white/60">End of slideshow</p>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <p className="mb-1 text-xs uppercase tracking-wide text-white/50">Notes</p>
            <p className="whitespace-pre-wrap text-lg leading-snug">{slide.notes || <span className="text-white/40">No notes for this slide.</span>}</p>
          </div>
        </aside>
      )}

      {blank && <div className={cn('absolute inset-0 z-20', blank === 'black' ? 'bg-black' : 'bg-white')} />}

      {laser && (
        <div ref={laserRef} className="pointer-events-none fixed left-0 top-0 z-30">
          <div className="-ml-2.5 -mt-2.5 size-5 rounded-full bg-red-500 shadow-[0_0_14px_6px_rgba(239,68,68,0.55)]" />
        </div>
      )}

      {!speaker && (
        <span className="pointer-events-none absolute bottom-3 right-4 text-xs text-white/40">
          {pos.index + 1} / {slides.length}
        </span>
      )}
      {typed && (
        <span className="pointer-events-none absolute bottom-3 left-4 z-30 rounded bg-white/15 px-2 py-1 text-sm text-white">
          Go to slide {typed}
        </span>
      )}

      {grid && (
        <div
          className="absolute inset-0 z-30 cursor-default overflow-auto bg-black/90 p-8"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="All slides"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {slides.map((s, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                className={cn(
                  'flex flex-col items-start gap-1 rounded p-1 text-left text-xs text-white/70 hover:bg-white/10',
                  i === pos.index && 'bg-white/15',
                )}
                onClick={() => { jumpTo(i); setGrid(false) }}
              >
                <SlidePreview slide={s} width={200} />
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {help && (
        <div
          className="absolute right-4 top-4 z-30 cursor-default rounded-md bg-black/80 p-4 text-sm text-white"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="contents">
                <dt className="text-white/60">{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
