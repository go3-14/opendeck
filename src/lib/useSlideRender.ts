import { useEffect, useRef, type RefObject } from 'react'
import { renderSlide } from '@/renderer/render-canvas.js'
import type { Slide } from './pptx'
import { thumbnailLimiter } from './renderQueue'
import { useInvert } from './theme'

interface Options {
  /** Keep the finished slide so showing it again is instant (main canvas). */
  cache?: boolean
  /** Wait for a free slot in the shared thumbnail queue before rendering. */
  limited?: boolean
  /** Render nothing until true (e.g. thumbnail not yet scrolled into view). */
  enabled?: boolean
  /** Animation build step to draw; omit to draw every shape. */
  step?: number
  /** Called right after the canvas was updated with a finished slide. */
  onDrawn?: () => void
}

/**
 * Draws a slide onto a canvas whenever the slide or scale changes.
 *
 * Latest request wins: a newer request aborts the previous one, and renderSlide
 * only touches the canvas once a slide is completely ready, so the canvas keeps
 * showing the previous slide until the next one can be shown whole.
 */
export function useSlideRender(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  slide: Slide | undefined,
  scale: number,
  dpr?: number,
  { cache = false, limited = false, enabled = true, step, onDrawn }: Options = {},
) {
  // Dark mode: draw with inverted colours (the canvas redraws when the setting changes).
  const invert = useInvert()
  // Latest callback without re-running the render effect when it changes.
  const onDrawnRef = useRef(onDrawn)
  onDrawnRef.current = onDrawn

  useEffect(() => {
    const canvas = canvasRef.current
    if (!enabled || !slide || !canvas) return

    const controller = new AbortController()
    const task = () =>
      controller.signal.aborted
        ? Promise.resolve(false)
        : renderSlide(slide, canvas, scale, dpr, { signal: controller.signal, cache, step, invert }).then((drawn: boolean) => {
            if (drawn) onDrawnRef.current?.()
            return drawn
          })

    const run = limited ? thumbnailLimiter(task) : task()
    run.catch((err: unknown) => console.warn('[Opendeck] Slide render failed:', err))

    return () => controller.abort()
  }, [canvasRef, slide, scale, dpr, cache, limited, enabled, step, invert])
}
