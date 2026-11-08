// "Export as PDF": writes a real PDF file, one page per slide. Every page has the
// slide's own size and orientation and shows the slide as a JPEG picture, so the
// file looks the same in any PDF viewer. No print dialog and no libraries.

import { renderSlide } from '@/renderer/render-canvas.js'
import { saveBlob } from './download'
import type { Slide } from './pptx'

const encoder = new TextEncoder()

/** A PDF text string in UTF-16 with a byte-order mark, written as hex (safe for any title). */
function pdfText(value: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex}>`
}

const num = (n: number) => String(Math.round(n * 100) / 100)

async function renderJpeg(slide: Slide, longestSidePx: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const scale = Math.min(2, longestSidePx / Math.max(slide.width, slide.height))
  const canvas = document.createElement('canvas')
  await renderSlide(slide, canvas, scale, 1) // authored colours: never the dark-mode inversion
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('Could not encode a page as an image')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
}

/** Builds the PDF for the slides (one page each, in order). */
export async function slidesToPdf(
  slides: Slide[],
  title: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let pos = 0
  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    chunks.push(bytes)
    pos += bytes.length
  }
  const beginObject = (id: number) => {
    offsets[id] = pos
    write(`${id} 0 obj\n`)
  }

  const n = slides.length
  const pageId = (i: number) => 3 + i * 3
  const infoId = 3 + n * 3

  write('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
  beginObject(1)
  write('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  beginObject(2)
  write(`<< /Type /Pages /Count ${n} /Kids [${slides.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>\nendobj\n`)

  for (let i = 0; i < n; i++) {
    onProgress?.(i, n)
    const slide = slides[i]
    const image = await renderJpeg(slide, 3000)
    const w = num(slide.width)
    const h = num(slide.height)
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`

    beginObject(pageId(i))
    write(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${pageId(i) + 1} 0 R ` +
        `/Resources << /XObject << /Im0 ${pageId(i) + 2} 0 R >> >> >>\nendobj\n`,
    )
    beginObject(pageId(i) + 1)
    write(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
    beginObject(pageId(i) + 2)
    write(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
    )
    write(image.bytes)
    write('\nendstream\nendobj\n')
    await new Promise((r) => setTimeout(r, 0)) // let the UI breathe
  }
  onProgress?.(n, n)

  beginObject(infoId)
  write(`<< /Title ${pdfText(title)} /Producer (Opendeck) >>\nendobj\n`)

  const xref = pos
  write(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`)
  for (let id = 1; id <= infoId; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  write(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

/** Renders every slide into a PDF and saves it next to the original name (.pdf). */
export async function exportPdf(
  slides: Slide[],
  filename: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const base = filename.replace(/\.[^.]+$/, '') || 'presentation'
  saveBlob(await slidesToPdf(slides, base, onProgress), `${base}.pdf`)
}
