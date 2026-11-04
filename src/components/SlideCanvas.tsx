import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Slide } from '@/lib/pptx'
import { useSlideRender } from '@/lib/useSlideRender'
import { cn } from '@/lib/utils'

/** The main, full-size slide. */
export function SlideCanvas({ slide, zoom }: { slide: Slide; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useSlideRender(ref, slide, zoom, undefined, { cache: true })
  return (
    <canvas
      ref={ref}
      className="block border bg-white"
      style={{ width: slide.width * zoom, height: slide.height * zoom }}
      aria-label="Current slide"
    />
  )
}

/** True once the element has come near the viewport (and stays true). */
export function useNearViewport(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, visible])
  return visible
}

/** A small slide preview, drawn lazily through the shared thumbnail queue. */
export function SlidePreview({ slide, width, className }: { slide: Slide; width: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const visible = useNearViewport(ref)
  useSlideRender(ref, slide, width / slide.width, 1, { enabled: visible, limited: true })
  return (
    <canvas
      ref={ref}
      className={cn('block border bg-white', className)}
      style={{ width, height: (width * slide.height) / slide.width }}
    />
  )
}

/** One row of the slide list. */
export function Thumbnail({
  slide, index, active, match, onSelect,
}: { slide: Slide; index: number; active: boolean; match?: boolean; onSelect: () => void }) {
  const rowRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onSelect}
      aria-label={`Slide ${index + 1}`}
      aria-current={active}
      className="flex w-full items-start gap-2 rounded-md p-1 text-left hover:bg-accent"
    >
      <span className="flex w-4 flex-col items-end gap-1 pt-1 text-xs text-muted-foreground">
        {index + 1}
        {match && <span className="size-1.5 rounded-full bg-primary" aria-label="Matches the search" />}
      </span>
      <SlidePreview slide={slide} width={144} className={active ? 'outline-2 outline-offset-1 outline-primary' : undefined} />
    </button>
  )
}
