import { useEffect, useState } from 'react'

/**
 * Tracks page scroll. Returns progress 0..100 for the progress bar, and also writes
 * --scroll-y (pixels) on <html> so CSS can drive small parallax effects without
 * re-rendering React on every frame.
 */
export function useScroll() {
  const [progress, setProgress] = useState(0)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const y = window.scrollY
      document.documentElement.style.setProperty('--scroll-y', String(Math.round(y)))
      setProgress(max > 0 ? Math.min(100, (y / max) * 100) : 0)
      setScrolled(y > 8)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return { progress, scrolled }
}
