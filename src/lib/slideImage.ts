import { renderSlide } from '@/renderer/render-canvas.js'
import type { Slide } from './pptx'

/** Renders a slide to a detached canvas (every shape visible, like the normal view). */
async function render(slide: Slide, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  await renderSlide(slide, canvas, scale, 1)
  return canvas
}

/** The slide as a PNG, e.g. for the clipboard. */
export async function slideToPng(slide: Slide, scale = 2): Promise<Blob> {
  const canvas = await render(slide, scale)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), 'image/png'),
  )
}

/** The slide as a JPEG data URL, compact enough to hold a whole deck in memory for printing. */
export async function slideToJpegUrl(slide: Slide, scale = 2): Promise<string> {
  return (await render(slide, scale)).toDataURL('image/jpeg', 0.92)
}
