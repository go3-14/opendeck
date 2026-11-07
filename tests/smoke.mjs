// tests/smoke.mjs
// End-to-end smoke test: opens the built viewer (dist/) in a real Chrome, loads
// the generated fixture deck, and checks what actually ends up on the canvas.
//
//   npm run build
//   npm test                      # fixture deck only
//   npm test -- path/to/decks     # also open every .pptx/.ppsx in a folder (or single files)
//
// Needs Google Chrome installed (or set CHROME_PATH). Exits non-zero on failure.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
if (!fs.existsSync(path.join(dist, 'viewer.html'))) {
  console.error('dist/ is missing: run "npm run build" first.')
  process.exit(2)
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-viewer-smoke-'))
const fixture = path.join(work, 'rich.pptx')
execFileSync(process.execPath, [path.join(root, 'tests', 'make-fixtures.mjs'), fixture], { stdio: 'pipe' })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/viewer.html`

const chromePaths = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const executablePath = chromePaths.find((p) => fs.existsSync(p))
if (!executablePath) {
  console.error('Chrome not found. Install Google Chrome or set CHROME_PATH.')
  process.exit(2)
}
const browser = await chromium.launch({ executablePath, headless: true })

// ─── Tiny test harness ────────────────────────────────────────────────────────

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`)
  if (!ok) failures++
}

// Console noise that is expected in headless runs.
const IGNORED = [/getImageData/, /requestFullscreen/, /willReadFrequently/]

function watch(page) {
  const problems = []
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return
    if (IGNORED.some((re) => re.test(msg.text()))) return
    problems.push(`${msg.type()}: ${msg.text()}`)
  })
  return problems
}

/** Waits until the main canvas stops changing. */
async function settle(page, selector = 'main canvas') {
  let last = ''
  for (let i = 0; i < 40; i++) {
    const sig = await page.evaluate((sel) => {
      const c = document.querySelector(sel)
      if (!c || c.width === 300) return 'none'
      const g = c.getContext('2d')
      let s = `${c.width}x${c.height}:`
      for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) s += Array.from(g.getImageData((c.width * a) / 8 | 0, (c.height * b) / 8 | 0, 1, 1).data).join(',') + ';'
      return s
    }, selector)
    if (sig !== 'none' && sig === last) return
    last = sig
    await page.waitForTimeout(120)
  }
}

const pixel = (page, x, y, selector = 'main canvas') =>
  page.evaluate(([px, py, sel]) => {
    const c = document.querySelector(sel)
    const k = c.width / 960 // fixture slides are 960 pt wide
    return Array.from(c.getContext('2d').getImageData(Math.round(px * k), Math.round(py * k), 1, 1).data.slice(0, 3))
  }, [x, y, selector])

const near = (got, want, tol = 14) => got.every((v, i) => Math.abs(v - want[i]) <= tol)

async function countColour(page, box, rgb, tol = 14, selector = 'main canvas') {
  return page.evaluate(([b, want, t, sel]) => {
    const c = document.querySelector(sel)
    const k = c.width / 960
    const [x0, y0, x1, y1] = b.map((v) => Math.round(v * k))
    const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - want[0]) < t && Math.abs(d[i + 1] - want[1]) < t && Math.abs(d[i + 2] - want[2]) < t) n++
    return n
  }, [box, rgb, tol, selector])
}

async function openDeck(page, file) {
  await page.goto(base)
  await page.setInputFiles('input[type=file]', file)
  await page.waitForSelector('[aria-label="Slide 1"], [role=alert]', { timeout: 60000 })
}

// ─── 1. The generated fixture deck ────────────────────────────────────────────

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const problems = watch(page)
  await openDeck(page, fixture)
  await page.waitForSelector('[aria-label="Slide 8"]')
  check('fixture opens with 8 slides', (await page.locator('aside button[aria-label^="Slide"]').count()) === 8)

  const slide = async (n) => {
    await page.click(`[aria-label="Slide ${n}"]`)
    await settle(page)
  }
  const expectPixel = async (n, x, y, want, label, tol) => {
    const got = await pixel(page, x, y)
    check(`slide ${n}: ${label}`, near(got, want, tol), `got ${got}, want ${want}`)
  }

  await slide(1)
  await expectPixel(1, 480, 525, [237, 125, 49], 'master strip drawn behind the slide')
  await expectPixel(1, 5, 200, [68, 114, 196], 'layout bar drawn behind the slide')
  await slide(2)
  await expectPixel(2, 180, 252, [68, 114, 196], 'group child scaled 3x (blue square)')
  await expectPixel(2, 396, 252, [112, 173, 71], 'group child scaled 3x (green circle)')
  await slide(3)
  await expectPixel(3, 180, 237, [255, 0, 0], 'picture cropped to its red quadrant', 30)
  await slide(4)
  await expectPixel(4, 10, 200, [17, 17, 17], 'colour-map override gives a dark background')
  await slide(5)
  await expectPixel(5, 205, 187, [220, 60, 60], 'large picture drawn', 45)
  await slide(6)
  await expectPixel(6, 162, 234, [255, 0, 0], 'static view shows every animated shape (red)')
  await expectPixel(6, 666, 234, [0, 112, 192], 'static view shows every animated shape (blue)')
  await slide(7)
  await expectPixel(7, 648, 240, [0, 176, 240], 'freeform shape filled')
  await expectPixel(7, 580, 255, [255, 255, 255], 'freeform corner is cut away')
  await expectPixel(7, 300, 320, [68, 114, 196], 'table style header fill')
  await expectPixel(7, 275, 130, [197, 90, 17], 'SmartArt fallback drawing') // a corner of "Step B", clear of its text
  const shadow = await pixel(page, 130, 427)
  check('slide 7: drop shadow below the rectangle', shadow.every((v) => v < 235), `got ${shadow}`)
  await slide(8)
  check('slide 8: column chart bars drawn', (await countColour(page, [29, 115, 317, 375], [255, 0, 0])) > 1500)
  check('slide 8: pie slices drawn', (await countColour(page, [648, 115, 936, 375], [255, 192, 0])) > 3000)
  check('slide 8: no "not supported" badge', (await countColour(page, [0, 100, 960, 400], [249, 115, 22], 4)) === 0)

  // Search
  await page.keyboard.press('Control+f')
  await page.fill('[role=search] input', 'note')
  await page.waitForSelector('[role=search] li')
  check('search finds speaker notes', (await page.locator('[role=search] li').first().innerText()).includes('Slide 6'))
  await page.keyboard.press('Escape')

  // Slideshow: builds, then speaker notes
  await slide(6)
  await page.click('button:has-text("Present")')
  const show = '.fixed.inset-0.z-50 canvas[aria-label^="Slide"]'
  await page.waitForSelector(show)
  await settle(page, show)
  const redPlace = [162, 234]
  const isBlank = async () => near(await pixel(page, ...redPlace, show), [255, 255, 255], 6)
  check('slideshow starts with animated shapes hidden', await isBlank())
  await page.keyboard.press('ArrowRight')
  await settle(page, show)
  check('first click reveals the red square', near(await pixel(page, ...redPlace, show), [255, 0, 0], 20))
  await page.keyboard.press('ArrowRight')
  await settle(page, show)
  check('second click hides it again (exit effect)', await isBlank())
  await page.keyboard.press('s')
  await page.waitForSelector('aside[aria-label="Speaker view"]')
  check('speaker view shows notes', (await page.locator('aside[aria-label="Speaker view"]').innerText()).includes('First note line'))
  await page.keyboard.press('Escape')

  // Mouse wheel: changes slides in the viewer (Ctrl+wheel still zooms) and in the slideshow
  await slide(6)
  await page.mouse.move(700, 500)
  const counter = async () => (await page.locator('header').innerText()).match(/(\d+) \/ 8/)?.[0]
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(150)
  check('wheel down moves to the next slide', (await counter()) === '7 / 8', String(await counter()))
  await page.waitForTimeout(450)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(150)
  check('wheel up moves to the previous slide', (await counter()) === '6 / 8', String(await counter()))
  await page.waitForTimeout(450)
  const zoomText = async () => (await page.locator('header').innerText()).match(/(\d+)%/)?.[1]
  const zoomBefore = await zoomText()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await page.waitForTimeout(200)
  check('Ctrl+wheel zooms instead of changing slides', (await zoomText()) !== zoomBefore && (await counter()) === '6 / 8')
  await page.keyboard.press('0') // back to fit

  await page.click('button:has-text("Present")')
  await page.waitForSelector(show)
  await settle(page, show)
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, 120)
  await settle(page, show)
  check('slideshow: wheel down plays the next build', near(await pixel(page, ...redPlace, show), [255, 0, 0], 20))
  await page.waitForTimeout(450)
  await page.mouse.wheel(0, -120)
  await settle(page, show)
  check('slideshow: wheel up goes back a build', await isBlank())
  await page.keyboard.press('Escape')

  // Recent files are listed after reload
  await page.goto(base)
  await page.waitForSelector('section[aria-label="Recent files"] li')
  check('recent files listed on the start screen', (await page.locator('section[aria-label="Recent files"] li').count()) >= 1)

  check('no console errors or warnings on the fixture deck', problems.length === 0, problems.slice(0, 3).join(' | '))
  await page.close()
} catch (err) {
  check('fixture deck run', false, err.message)
}

// ─── 1b. Dark mode: slides are colour-inverted, pictures are not ──────────────

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' })
  const problems = watch(page)
  await openDeck(page, fixture)
  await page.waitForSelector('[aria-label="Slide 8"]')
  const slide = async (n) => {
    await page.click(`[aria-label="Slide ${n}"]`)
    await settle(page)
  }
  check('dark: app theme follows the system', await page.evaluate(() => document.documentElement.classList.contains('dark')))
  await slide(1)
  const bg = await pixel(page, 700, 150)
  check('dark: a white slide background is drawn dark', bg.every((v) => v < 45), `got ${bg}`)
  const text = await countColour(page, [60, 120, 700, 200], [235, 235, 235], 40)
  check('dark: slide text is drawn light', text > 50, `light pixels: ${text}`)
  await slide(3)
  check('dark: pictures keep their colours', near(await pixel(page, 180, 237), [255, 0, 0], 30))
  await slide(4)
  const dk = await pixel(page, 10, 200)
  check('dark: a dark slide background becomes light', dk.every((v) => v > 190), `got ${dk}`)

  await slide(1)
  await page.click('button[aria-label="More actions"]')
  await page.click('text=Invert slides in dark mode')
  await page.keyboard.press('Escape')
  await settle(page)
  await page.waitForTimeout(300)
  check('dark: turning inversion off restores the authored colours', near(await pixel(page, 700, 150), [255, 255, 255], 6))

  await page.click('button[aria-label^="Theme"]')
  check('theme button switches away from auto', !(await page.getAttribute('button[aria-label^="Theme"]', 'aria-label')).includes('auto'))
  check('dark mode: no console errors', problems.length === 0, problems.join(' | '))
  await page.close()
} catch (err) {
  check('dark mode checks ran', false, String(err))
}

// ─── 2. Optional: your own decks (every deck must open and draw every slide) ──

const inputs = process.argv.slice(2)
const decks = inputs.flatMap((p) => {
  if (!fs.existsSync(p)) return []
  if (fs.statSync(p).isFile()) return [p]
  return fs.readdirSync(p).filter((f) => /\.(pptx|ppsx|pptm|potx)$/i.test(f)).map((f) => path.join(p, f))
})
for (const deck of decks) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const problems = watch(page)
  try {
    await openDeck(page, deck)
    const alert = await page.locator('[role=alert]').count()
    const slides = await page.locator('aside button[aria-label^="Slide"]').count()
    let blank = 0
    for (let n = 1; n <= Math.min(slides, 40); n++) {
      await page.click(`[aria-label="Slide ${n}"]`)
      await settle(page)
      const inked = await page.evaluate(() => {
        const c = document.querySelector('main canvas')
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let first = null
        for (let i = 0; i < d.length; i += 4 * 97) {
          const p = `${d[i]},${d[i + 1]},${d[i + 2]}`
          if (first === null) first = p
          else if (p !== first) return true
        }
        return false
      })
      if (!inked) blank++
    }
    const ok = !alert && slides > 0 && !problems.some((p) => p.startsWith('pageerror'))
    check(`${path.basename(deck)}: ${slides} slides, ${blank} plain, ${problems.length} console messages`, ok, problems.slice(0, 2).join(' | '))
  } catch (err) {
    check(`${path.basename(deck)}`, false, err.message)
  }
  await page.close()
}

// ─── Done ─────────────────────────────────────────────────────────────────────

await browser.close()
server.close()
fs.rmSync(work, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
