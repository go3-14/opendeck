// PDF support: pdf.js is loaded on demand, so PowerPoint users never download it.
// Each PDF page becomes a "slide-like" object (width, height, no shapes, no notes)
// so the slide list, zoom, search, slideshow, print and export work unchanged.

import type { Slide } from './pptx'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A PDF page, shaped like a slide so the rest of the viewer can treat it as one. */
export interface PdfPage {
  kind: 'pdf'
  width: number
  height: number
  shapes: never[]
  notes: string
  animation: null
  transition: null
  /** Visible text in reading order, one entry per line (for search and copy). */
  lines: string[]
  /** The pdf.js page proxy used by the renderer. */
  page: any
}

export const isPdfPage = (slide: unknown): slide is PdfPage => (slide as PdfPage | undefined)?.kind === 'pdf'

/** True when the bytes start with the PDF header (the first KB may hold a few stray bytes). */
export function looksLikePdf(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength))
  const text = String.fromCharCode(...head)
  return text.includes('%PDF-')
}

/** Raised when the user cancels the password prompt. */
export class PdfCancelled extends Error {
  constructor() {
    super('Password required')
    this.name = 'PdfCancelled'
  }
}

const dataUrl = (name: string) => new URL(`./pdfjs/${name}/`, window.location.href).href

async function loadLibrary() {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  return pdfjs
}

/** Collects the text of a page as lines, in the order pdf.js reports it. */
async function pageLines(page: any): Promise<string[]> {
  const content = await page.getTextContent()
  const lines: string[] = []
  let line = ''
  for (const item of content.items as any[]) {
    if (typeof item.str !== 'string') continue
    line += item.str
    if (item.hasEOL) {
      if (line.trim()) lines.push(line.trim())
      line = ''
    }
  }
  if (line.trim()) lines.push(line.trim())
  return lines
}

/**
 * Opens a PDF and returns one slide-like object per page.
 * `askPassword(wrong)` is called for protected files; return null to cancel.
 */
export async function loadPdf(
  bytes: ArrayBuffer,
  onProgress?: (message: string) => void,
  askPassword: (wrong: boolean) => Promise<string | null> = async () => null,
): Promise<Slide[]> {
  onProgress?.('Loading the PDF reader…')
  const pdfjs = await loadLibrary()

  onProgress?.('Reading file…')
  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    data: new Uint8Array(bytes.slice(0)),
    cMapUrl: dataUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dataUrl('standard_fonts'),
    wasmUrl: dataUrl('wasm'),
    iccUrl: dataUrl('iccs'),
  })
  let cancelled = false
  task.onPassword = (update: (password: string) => void, reason: number) => {
    // reason 1 = password needed, 2 = the one given was wrong
    askPassword(reason === 2).then((pw) => {
      if (pw === null) {
        cancelled = true
        void task.destroy()
      } else update(pw)
    })
  }

  let doc: any
  try {
    doc = await task.promise
  } catch (err) {
    if (cancelled) throw new PdfCancelled()
    throw err
  }

  const pages: PdfPage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress?.(`Reading page ${n} of ${doc.numPages}…`)
    const page = await doc.getPage(n)
    const view = page.getViewport({ scale: 1 })
    pages.push({
      kind: 'pdf',
      width: view.width,
      height: view.height,
      shapes: [],
      notes: '',
      animation: null,
      transition: null,
      lines: await pageLines(page),
      page,
    })
  }
  if (!pages.length) throw new Error('This PDF has no pages.')
  return pages as unknown as Slide[]
}
