import { preloadSlideImages } from '@/renderer/render-canvas.js'
import type { Slide } from './pptx'

let generation = 0

/**
 * Decodes the images of the slides next to `index` in the background so that
 * paging to them is instant. A newer call cancels the remaining work of an
 * older one. Only a few neighbours are kept warm to bound memory use.
 */
export function prefetchAround(slides: Slide[], index: number) {
  const mine = ++generation
  const order = [index + 1, index - 1, index + 2, index - 2].filter((i) => i >= 0 && i < slides.length)

  void (async () => {
    for (const i of order) {
      if (mine !== generation) return
      await preloadSlideImages(slides[i])
      await new Promise((resolve) => setTimeout(resolve, 0)) // yield between slides
    }
  })()
}
