import { useCallback, useEffect, useRef, useState } from 'react'
import type { Slide } from '@/lib/pptx'
import { useSlideRender } from '@/lib/useSlideRender'
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

/**
 * Full-screen slideshow. Plays each slide's animation builds: a click (or
 * arrow / space / enter) reveals the next build, then moves to the next slide.
 */
export default function Presenter({ slides, startIndex, onExit }: Props) {
  const [pos, setPos] = useState<Position>({ index: startIndex, step: 0 })
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': case 'n':
          e.preventDefault(); next(); break
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': case 'p':
          e.preventDefault(); prev(); break
        case 'Home':
          e.preventDefault(); setPos({ index: 0, step: 0 }); break
        case 'End':
          e.preventDefault(); setPos({ index: slides.length - 1, step: animationStepCount(slides[slides.length - 1]) }); break
        case 'Escape':
          exit(); break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [next, prev, exit, slides])

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black"
      onClick={next}
      onContextMenu={(e) => { e.preventDefault(); prev() }}
      role="presentation"
    >
      <canvas ref={canvasRef} aria-label={`Slide ${pos.index + 1}`} style={{ width: slide.width * scale, height: slide.height * scale }} />
      <span className="pointer-events-none absolute bottom-3 right-4 text-xs text-white/40">
        {pos.index + 1} / {slides.length}
      </span>
    </div>
  )
}
