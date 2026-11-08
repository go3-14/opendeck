import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { Slide } from '@/lib/pptx'
import type { TextBox } from '@/lib/textBoxes'
import { isPdfPage, renderPdfTextLayer } from '@/lib/pdf'

/** More words than this and the layer is skipped, to keep very dense slides responsive. */
const MAX_WORDS = 3000

interface Line {
  id: number
  words: TextBox[]
  top: number
  left: number
}

/** Groups words into lines, sorted top to bottom and then left to right (reading order). */
function toLines(boxes: TextBox[]): Line[] {
  const byLine = new Map<number, Line>()
  for (const b of boxes) {
    const [a, bb, c, d, e, f] = b.m
    const px = e + a * b.x + c * b.y
    const py = f + bb * b.x + d * b.y
    let line = byLine.get(b.line)
    if (!line) {
      line = { id: b.line, words: [], top: py, left: px }
      byLine.set(b.line, line)
    }
    line.words.push(b)
  }
  return [...byLine.values()].sort((p, q) => Math.round(p.top / 4) - Math.round(q.top / 4) || p.left - q.left)
}

/** Places one word where it was painted: the baseline start, moved up by about the ascent. */
function wordStyle(b: TextBox): CSSProperties {
  const [a, bb, c, d, e, f] = b.m
  const y = b.y - b.size * 0.8
  return {
    font: b.font,
    lineHeight: `${b.size}px`,
    // Clip to the painted width so the trailing space does not overlap the next word's highlight.
    width: `${b.w}px`,
    overflow: 'hidden',
    transform: `matrix(${a},${bb},${c},${d},${e + a * b.x + c * y},${f + bb * b.x + d * y})`,
  }
}

/**
 * Invisible, selectable text laid exactly over the slide canvas, so words can be
 * selected with the mouse and copied. PowerPoint slides use the words recorded while
 * drawing; PDF pages use pdf.js's own text layer.
 */
export function SlideTextLayer({ slide, zoom, boxes }: { slide: Slide; zoom: number; boxes: TextBox[] | null }) {
  const size = { width: slide.width * zoom, height: slide.height * zoom }
  const pdfRef = useRef<HTMLDivElement>(null)
  const pdf = isPdfPage(slide)

  useEffect(() => {
    const container = pdfRef.current
    if (!pdf || !container) return
    let cancel: (() => void) | undefined
    let stale = false
    void renderPdfTextLayer(slide.page, container, zoom).then((c) => {
      if (stale) c()
      else cancel = c
    })
    return () => {
      stale = true
      cancel?.()
    }
  }, [pdf, slide, zoom])

  const lines = useMemo(() => (!pdf && boxes && boxes.length <= MAX_WORDS ? toLines(boxes) : []), [pdf, boxes])

  if (pdf) return <div ref={pdfRef} className="absolute left-0 top-0" style={size} data-text-layer="pdf" />
  if (!lines.length) return null
  return (
    <div className="slide-text absolute left-0 top-0 overflow-hidden" style={size} data-text-layer="slide">
      {lines.map((line) => (
        <div key={line.id}>
          {line.words.map((b, i) => (
            <span key={i} style={wordStyle(b)}>
              {b.sp ? `${b.str} ` : b.str}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
