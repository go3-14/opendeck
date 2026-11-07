import { useSyncExternalStore } from 'react'

// Light / dark theme for the app, plus whether slides are colour-inverted in dark mode.
// Kept in a tiny external store so any component (and the slide renderer hook) can read it
// without prop drilling or a provider.

export type Theme = 'auto' | 'light' | 'dark'

interface ThemeState {
  theme: Theme
  invertSlides: boolean
  /** The resolved appearance: auto follows the system setting. */
  dark: boolean
}

const THEME_KEY = 'opendeck-theme'
const INVERT_KEY = 'opendeck-invert-slides'
const query = window.matchMedia('(prefers-color-scheme: dark)')

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable: the setting just won't persist
  }
}

let theme: Theme = ((): Theme => {
  const saved = read(THEME_KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'auto'
})()
let invertSlides = read(INVERT_KEY) !== '0'

const compute = (): ThemeState => ({
  theme,
  invertSlides,
  dark: theme === 'auto' ? query.matches : theme === 'dark',
})

let snapshot = compute()
const listeners = new Set<() => void>()

function apply() {
  snapshot = compute()
  document.documentElement.classList.toggle('dark', snapshot.dark)
  listeners.forEach((listener) => listener())
}

query.addEventListener('change', apply)
apply()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTheme(next: Theme) {
  theme = next
  write(THEME_KEY, next)
  apply()
}

export function setInvertSlides(next: boolean) {
  invertSlides = next
  write(INVERT_KEY, next ? '1' : '0')
  apply()
}

/** Auto → Light → Dark → Auto. */
export const nextTheme = (current: Theme): Theme => (current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto')

export const useTheme = () => useSyncExternalStore(subscribe, () => snapshot)

/** True when slides should be drawn colour-inverted. */
export function useInvert(): boolean {
  const state = useTheme()
  return state.dark && state.invertSlides
}
