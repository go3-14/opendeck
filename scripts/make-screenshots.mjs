// Produces the Chrome Web Store images from the built viewer and a demo deck:
//   store/screenshots/*.jpg   five 1280x800 screenshots
//   store/promo/*.jpg         small tile (440x280) and marquee (1400x560)
//
//   npm run build && node scripts/make-screenshots.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome } from './chrome.mjs'
import { serve, settle, thumbnailsReady } from './lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
if (!fs.existsSync(path.join(dist, 'viewer.html'))) {
  console.error('dist/ is missing: run "npm run build" first.')
  process.exit(2)
}

const shots = path.join(root, 'store', 'screenshots')
const promo = path.join(root, 'store', 'promo')
fs.mkdirSync(shots, { recursive: true })
fs.mkdirSync(promo, { recursive: true })

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-viewer-shots-'))
const deck = path.join(work, 'Quarterly Business Review.pptx')
execFileSync(process.execPath, [path.join(root, 'scripts', 'make-demo-deck.mjs'), deck], { stdio: 'pipe' })

const server = await serve(dist)
const browser = await launchChrome()

async function open(colorScheme) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme,
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  await page.goto(`${server.url}/viewer.html`)
  await page.setInputFiles('input[type=file]', deck)
  await page.waitForSelector('[aria-label="Slide 6"]')
  return page
}

// Park the mouse in an empty corner so no control shows a hover highlight.
const save = async (page, name) => {
  await page.mouse.move(640, 790)
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(shots, name), type: 'jpeg', quality: 92 })
}

async function showSlide(page, n) {
  await page.click(`[aria-label="Slide ${n}"]`)
  await settle(page)
  await thumbnailsReady(page)
}

// 1. Light theme, a chart slide
let page = await open('light')
await showSlide(page, 3)
await save(page, '1-view.jpg')

// 2. Search
await page.keyboard.press('Control+f')
await page.fill('[role=search] input', 'growth')
await page.waitForSelector('[role=search] li')
await page.waitForTimeout(400)
await settle(page)
await save(page, '2-search.jpg')

// 3. The More menu (copy, print, export)
await page.keyboard.press('Escape')
await showSlide(page, 4)
await page.click('button:has-text("More")')
await page.waitForSelector('[role=menuitem]')
await page.waitForTimeout(300)
await save(page, '3-more-menu.jpg')
await page.context().close()

// 4. Dark theme, roadmap
page = await open('dark')
await showSlide(page, 5)
await save(page, '4-dark.jpg')
await page.context().close()

// 5. Slideshow with speaker view
page = await open('dark')
await showSlide(page, 3)
await page.click('button:has-text("Present")')
const show = '.fixed.inset-0.z-50 canvas[aria-label^="Slide"]'
await page.waitForSelector(show)
await page.keyboard.press('s')
await page.waitForSelector('aside[aria-label="Speaker view"]')
await settle(page, show)
await settle(page, '.fixed.inset-0.z-50 aside canvas')
await page.waitForTimeout(1500) // let the timer move off 0:00
await save(page, '5-speaker-view.jpg')
await page.context().close()

// ─── Promo images ─────────────────────────────────────────────────────────────
const icon = fs.readFileSync(path.join(root, 'store', 'icon.svg'), 'utf8')
const screenshot = `data:image/jpeg;base64,${fs.readFileSync(path.join(shots, '1-view.jpg')).toString('base64')}`

const tile = ({ w, h, big }) => `
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${w}px; height: ${h}px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #fff;
         font-family: "Segoe UI", system-ui, sans-serif; display: flex; align-items: center; overflow: hidden; }
  .copy { padding: 0 ${big ? 90 : 36}px; flex: 1; }
  .icon svg { width: ${big ? 96 : 56}px; height: ${big ? 96 : 56}px; display: block; }
  h1 { font-size: ${big ? 68 : 34}px; font-weight: 700; margin-top: ${big ? 22 : 14}px; letter-spacing: -0.02em; }
  p { font-size: ${big ? 28 : 16}px; color: #cbd5e1; margin-top: ${big ? 14 : 8}px; line-height: 1.35; }
  .shot { width: ${big ? 640 : 0}px; margin-right: ${big ? -60 : 0}px; display: ${big ? 'block' : 'none'}; }
  .shot img { width: 100%; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.5); display: block; }
</style>
<div class="copy">
  <div class="icon">${icon}</div>
  <h1>Opendeck</h1>
  <p>${big ? 'Open PowerPoint files in your browser.<br>Private by design.' : 'Open presentations in your browser.'}</p>
</div>
<div class="shot"><img src="${screenshot}" alt=""></div>`

for (const [name, w, h, big] of [['small-tile.jpg', 440, 280, false], ['marquee.jpg', 1400, 560, true]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const p = await context.newPage()
  await p.setContent(tile({ w, h, big }))
  await p.waitForTimeout(200)
  await p.screenshot({ path: path.join(promo, name), type: 'jpeg', quality: 92 })
  await context.close()
}

await browser.close()
server.close()
fs.rmSync(work, { recursive: true, force: true })
console.log('wrote store/screenshots/*.jpg and store/promo/*.jpg')
