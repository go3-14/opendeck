import { useCallback, useEffect, useRef, useState } from 'react'
import { SlidePreview } from '@/components/SlideCanvas'
import type { Slide } from '@/lib/pptx'
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

const SHORTCUTS: Array<[string, string]> = [
  ['→ ↓ Space Enter Click', 'Next build / slide'],
  ['← ↑ Backspace Right-click', 'Previous build / slide'],
  ['Home / End', 'First / last slide'],
  ['Number + Enter', 'Go to slide'],
  ['G', 'Slide grid'],
  ['B / W', 'Black / white screen'],
  ['?', 'This help'],
  ['Esc', 'Close panel, then exit'],
]

/**
 * Full-screen slideshow. Plays each slide's animation builds: a click (or
 * arrow / space / enter) reveals the next build, then moves to the next slide.
 */
export default function Presenter({ slides, startIndex, onExit }: Props) {
  const [pos, setPos] = useState<Position>({ index: startIndex, step: 0 })
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [blank, setBlank] = useState<'black' | 'white' | null>(null)
  const [grid, setGrid] = useState(false)
  const [help, setHelp] = useState(false)
  const [typed, setTyped] = useState('')
  const [cursorHidden, setCursorHidden] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const posRef = useRef(pos)
  posRef.current = pos
  // Keep the latest onExit without re-running effects when the parent re-renders.
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const exit = useCallback(() => onExitRef.current(posRef.current.index), [])

  const slide = slides[pos.index]
  const scale = Math.min(size.w / slide.width, size.h / slide.height)
  useSlideRender(canvasRef, slide, scale, undefined, { cache: true, step: pos.step })

  const next = useCallback(() => {
    setPos((p) => {
      if (p.step < animationStepCount(slides[p.index])) return { index: p.index, step: p.step + 1 }
      if (p.index < slides.length - 1) return { index: p.index + 1, step: 0 }
      return p
    })
  }, [slides])

  const prev = useCallback(() => {
    setPos((p) => {
      if (p.step > 0) return { index: p.index, step: p.step - 1 }
      // Going back lands on the finished state of the previous slide.
      if (p.index > 0) return { index: p.index - 1, step: animationStepCount(slides[p.index - 1]) }
      return p
    })
  }, [slides])

  const jumpTo = useCallback((index: number) => {
    setPos({ index: Math.max(0, Math.min(slides.length - 1, index)), step: 0 })
  }, [slides.length])

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

  // Hide the mouse cursor after a moment of inactivity.
  useEffect(() => {
    let timer: number
    const onMove = () => {
      setCursorHidden(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setCursorHidden(true), CURSOR_HIDE_MS)
    }
    onMove()
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
          e.preventDefault(); setPos({ index: 0, step: 0 }); break
        case 'End':
          e.preventDefault(); setPos({ index: slides.length - 1, step: animationStepCount(slides[slides.length - 1]) }); break
        case 'b': case 'B':
          setBlank((v) => (v === 'black' ? null : 'black')); break
        case 'w': case 'W':
          setBlank((v) => (v === 'white' ? null : 'white')); break
        case 'g': case 'G':
          setGrid((v) => !v); break
        case '?':
          setHelp((v) => !v); break
        case 'Escape':
          // Close the innermost thing first: typed number, help, grid, then the slideshow.
          if (typed) setTyped('')
          else if (help) setHelp(false)
          else if (grid) setGrid(false)
          else exit()
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [blank, typed, help, grid, next, prev, jumpTo, exit, slides])

  const onClick = () => {
    if (blank) setBlank(null)
    else if (!grid) next()
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black',
        cursorHidden && !grid ? 'cursor-none' : 'cursor-pointer',
      )}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); prev() }}
      role="presentation"
    >
      <canvas ref={canvasRef} aria-label={`Slide ${pos.index + 1}`} style={{ width: slide.width * scale, height: slide.height * scale }} />

      {blank && <div className={cn('absolute inset-0', blank === 'black' ? 'bg-black' : 'bg-white')} />}

      <span className="pointer-events-none absolute bottom-3 right-4 text-xs text-white/40">
        {pos.index + 1} / {slides.length}
      </span>
      {typed && (
        <span className="pointer-events-none absolute bottom-3 left-4 rounded bg-white/15 px-2 py-1 text-sm text-white">
          Go to slide {typed}
        </span>
      )}

      {grid && (
        <div
          className="absolute inset-0 cursor-default overflow-auto bg-black/90 p-8"
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
          className="absolute right-4 top-4 cursor-default rounded-md bg-black/80 p-4 text-sm text-white"
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
