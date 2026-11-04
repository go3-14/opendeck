import { useEffect, useRef, type RefObject } from 'react'
import { renderSlide } from '@/renderer/render-canvas.js'
import type { Slide } from './pptx'

/**
 * Draws a slide onto a canvas whenever the slide or scale changes.
 * Draws are queued per canvas: renderSlide resizes the canvas and awaits image
 * decoding, so overlapping draws on the same canvas would interleave.
 */
export function useSlideRender(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  slide: Slide | undefined,
  scale: number,
  dpr?: number,
) {
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    queue.current = queue.current.then(async () => {
      const canvas = canvasRef.current
      if (cancelled || !canvas || !slide) return
      try {
        await renderSlide(slide, canvas, scale, dpr)
      } catch (err) {
        console.warn('[PPTX Viewer] Slide render failed:', err)
      }
    })
    return () => {
      cancelled = true
    }
  }, [canvasRef, slide, scale, dpr])
}
