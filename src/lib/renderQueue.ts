/** Runs at most `max` async tasks at a time; the rest wait in order. */
export function createLimiter(max: number) {
  let active = 0
  const waiting: Array<() => void> = []

  const release = () => {
    active--
    waiting.shift()?.()
  }

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++
        task().then(resolve, reject).finally(release)
      }
      if (active < max) run()
      else waiting.push(run)
    })
  }
}

/** Thumbnails share this so they never starve the main slide of CPU. */
export const thumbnailLimiter = createLimiter(2)
