// Plain-text views of slides: for search, copying text, and the outline.
// Works on the slide model produced by the parser (shapes, tables, groups, charts).

import type { Slide } from './pptx'
import { isPdfPage } from './pdf'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Piece = { y: number; x: number; lines: string[] }

const paragraphText = (p: any): string => (p.runs as any[]).map((r) => r.text).join('')

const textLines = (text: any): string[] =>
  text?.paragraphs ? (text.paragraphs as any[]).flatMap((p) => paragraphText(p).split('\n')).filter((l) => l.trim()) : []

function collect(shapes: any[], out: Piece[]) {
  for (const s of shapes) {
    switch (s.type) {
      case 'shape':
        out.push({ y: s.y, x: s.x, lines: textLines(s.text) })
        break
      case 'table': {
        const lines = (s.rows as any[]).map((row) =>
          (row.cells as any[])
            .filter((c) => !c.hMerge && !c.vMerge)
            .map((c) => textLines(c.text).join(' '))
            .join('\t'),
        )
        out.push({ y: s.y, x: s.x, lines })
        break
      }
      case 'chart':
        out.push({ y: s.y, x: s.x, lines: s.chart?.title ? [s.chart.title] : [] })
        break
      case 'group':
        collect(s.shapes, out)
        break
      default:
        break
    }
  }
}

const cache = new WeakMap<Slide, string[]>()

/** The visible text of a slide in reading order (top to bottom, then left to right). */
export function slideLines(slide: Slide): string[] {
  const cached = cache.get(slide)
  if (cached) return cached
  if (isPdfPage(slide)) return slide.lines
  const pieces: Piece[] = []
  collect(slide.shapes as any[], pieces)
  pieces.sort((a, b) => Math.round(a.y / 10) - Math.round(b.y / 10) || a.x - b.x)
  const lines = pieces.flatMap((p) => p.lines).filter((l) => l.trim())
  cache.set(slide, lines)
  return lines
}

/** Text of one slide, one line per paragraph. */
export const slideText = (slide: Slide) => slideLines(slide).join('\n')

/** All slides as an outline: a heading per slide, its text, and its speaker notes. */
export function outline(slides: Slide[], includeNotes = true): string {
  return slides
    .map((slide, i) => {
      const parts = [`Slide ${i + 1}`, ...slideLines(slide)]
      if (includeNotes && slide.notes) parts.push('', 'Notes:', slide.notes)
      return parts.join('\n')
    })
    .join('\n\n')
}

export interface SearchHit {
  /** Slide index. */
  index: number
  /** Number of matches on the slide (slide text and notes). */
  count: number
  /** A short piece of text around the first match. */
  snippet: string
  /** True when the match is only in the speaker notes. */
  inNotes: boolean
}

/** Case-insensitive search over slide text and speaker notes; one hit per matching slide. */
export function searchSlides(slides: Slide[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const hits: SearchHit[] = []
  slides.forEach((slide, index) => {
    const countIn = (s: string) => s.toLowerCase().split(q).length - 1
    const lines = slideLines(slide)
    const inSlide = lines.reduce((n, l) => n + countIn(l), 0)
    const inNotes = countIn(slide.notes || '')
    if (!inSlide && !inNotes) return

    const source = inSlide ? lines.find((l) => l.toLowerCase().includes(q))! : (slide.notes ?? '').split('\n').find((l) => l.toLowerCase().includes(q))!
    const at = source.toLowerCase().indexOf(q)
    const start = Math.max(0, at - 24)
    const snippet = `${start > 0 ? '…' : ''}${source.slice(start, at + q.length + 40)}${source.length > at + q.length + 40 ? '…' : ''}`
    hits.push({ index, count: inSlide + inNotes, snippet, inNotes: !inSlide })
  })
  return hits
}
