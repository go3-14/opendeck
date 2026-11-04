import { useEffect, useRef, useState } from 'react'
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

/** A small slide preview. Rendered only once it is near the viewport, through a shared queue. */
export function Thumbnail({
  slide, index, active, onSelect,
}: { slide: Slide; index: number; active: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
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
  }, [visible])
  useSlideRender(ref, slide, 144 / slide.width, 1, { enabled: visible, limited: true })

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Slide ${index + 1}`}
      aria-current={active}
      className="flex w-full items-start gap-2 rounded-md p-1 text-left hover:bg-accent"
    >
      <span className="w-4 pt-1 text-right text-xs text-muted-foreground">{index + 1}</span>
      <canvas
        ref={ref}
        className={cn('block border bg-white', active && 'outline-2 outline-offset-1 outline-primary')}
        style={{ width: 144, height: (144 * slide.height) / slide.width }}
      />
    </button>
  )
}
