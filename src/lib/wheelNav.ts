/**
 * Turns mouse-wheel / trackpad scrolling into "one step per flick".
 *
 * Feed it wheel deltas; it returns 1 (next), -1 (previous) or 0 (nothing yet).
 * Tiny deltas are accumulated until they pass a threshold, and after a step it ignores
 * further wheel input for a short cooldown, so a trackpad's momentum scrolling does
 * not skip over several slides.
 */
export function createWheelNav({ threshold = 40, cooldownMs = 320, idleResetMs = 200 } = {}) {
  let acc = 0
  let lastEvent = 0
  let lockedUntil = 0

  return (deltaY: number, now = performance.now()): 1 | -1 | 0 => {
    if (now < lockedUntil) {
      lastEvent = now
      return 0
    }
    // A pause, or a change of direction, starts a fresh gesture.
    if (now - lastEvent > idleResetMs || Math.sign(deltaY) !== Math.sign(acc)) acc = 0
    lastEvent = now
    acc += deltaY
    if (Math.abs(acc) < threshold) return 0
    const direction = acc > 0 ? 1 : -1
    acc = 0
    lockedUntil = now + cooldownMs
    return direction
  }
}
