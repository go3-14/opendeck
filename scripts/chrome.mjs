// Shared helper for the build scripts: finds the installed Chrome and launches it.
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

export function launchChrome(options = {}) {
  const executablePath = candidates.find((p) => fs.existsSync(p))
  if (!executablePath) throw new Error('Chrome not found. Install Google Chrome or set CHROME_PATH.')
  return chromium.launch({ executablePath, headless: true, ...options })
}
