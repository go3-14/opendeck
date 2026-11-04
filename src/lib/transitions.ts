import type { Slide } from './pptx'

export type Transition = NonNullable<Slide['transition']>

/** Direction the new slide moves, as [x, y] (screen coordinates). */
const MOVES: Record<string, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] }

/** Shown for sizing: whether the user asked the OS for less motion. */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Plays a slide transition between two stacked canvases.
 *
 * `next` already shows the new slide; `old` is a canvas holding a snapshot of
 * the previous one, resting at opacity 0 above `next`. The transition animates
 * them and leaves both in their resting state when it ends.
 */
export function playTransition(next: HTMLElement, old: HTMLElement, t: Transition) {
  const [mx, my] = MOVES[t.dir] ?? MOVES.l
  const timing: KeyframeAnimationOptions = { duration: t.ms, easing: 'ease-in-out' }
  const hold = { opacity: 1 }

  old.style.zIndex = '2'
  next.style.zIndex = '1'

  switch (t.type) {
    case 'push':
      next.animate([{ transform: `translate(${-mx * 100}%, ${-my * 100}%)` }, { transform: 'translate(0, 0)' }], timing)
      old.animate(
        [{ ...hold, transform: 'translate(0, 0)' }, { ...hold, transform: `translate(${mx * 100}%, ${my * 100}%)` }],
        timing,
      )
      break
    case 'cover':
      // The new slide slides over the old one, which stays put underneath.
      old.style.zIndex = '0'
      next.animate([{ transform: `translate(${-mx * 100}%, ${-my * 100}%)` }, { transform: 'translate(0, 0)' }], timing)
      old.animate([hold, hold], timing)
      break
    case 'wipe': {
      // The old slide is wiped away toward the direction of movement.
      const end = mx < 0 ? 'inset(0 100% 0 0)' : mx > 0 ? 'inset(0 0 0 100%)' : my < 0 ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)'
      old.animate([{ ...hold, clipPath: 'inset(0 0 0 0)' }, { ...hold, clipPath: end }], timing)
      break
    }
    default:
      old.animate([{ opacity: 1 }, { opacity: 0 }], timing)
  }
}

/** Copies the pixels of `from` into `to` (used to snapshot the outgoing slide). */
export function snapshotCanvas(from: HTMLCanvasElement, to: HTMLCanvasElement) {
  to.width = from.width
  to.height = from.height
  to.style.width = from.style.width
  to.style.height = from.style.height
  to.getContext('2d')?.drawImage(from, 0, 0)
}
