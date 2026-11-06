// tests/visual.mjs
// Visual regression test: renders every slide of a few decks in real Chrome and
// compares the canvas pixels with stored reference images.
//
//   npm run build
//   npm run test:visual                    compare with tests/baseline/<platform>/
//   npm run test:visual -- --update        (re)write the reference images
//   npm run test:visual -- --allow-missing don't fail when a reference is missing
//                                          (new images go to tests/output/new/ instead)
//
// Fonts differ between operating systems, so references are kept per platform
// (tests/baseline/win32, linux, darwin). A slide fails when more than 1% of its
// pixels differ; a diff image is written to tests/output/diff/ for inspection.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { launchChrome } from '../scripts/chrome.mjs'
import { serve, settle } from '../scripts/lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
if (!fs.existsSync(path.join(dist, 'viewer.html'))) {
  console.error('dist/ is missing: run "npm run build" first.')
  process.exit(2)
}

const update = process.argv.includes('--update')
const allowMissing = process.argv.includes('--allow-missing')
const MAX_DIFF = 0.01 // fraction of pixels allowed to differ

const baselineDir = path.join(root, 'tests', 'baseline', process.platform)
const outDir = path.join(root, 'tests', 'output')
fs.rmSync(outDir, { recursive: true, force: true })

// ─── Decks under test ─────────────────────────────────────────────────────────

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-visual-'))
const fixture = path.join(work, 'rich.pptx')
execFileSync(process.execPath, [path.join(root, 'tests', 'make-fixtures.mjs'), fixture], { stdio: 'pipe' })
const decks = [
  ['fixture', fixture],
  ['demo', path.join(root, 'store', 'sample', 'Quarterly Business Review.pptx')],
]

// ─── Run ──────────────────────────────────────────────────────────────────────

const server = await serve(dist)
const browser = await launchChrome()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })

const decode = (buf) => PNG.sync.read(buf)
let failed = 0
let missing = 0
let passed = 0

for (const [name, file] of decks) {
  await page.goto(`${server.url}/viewer.html?mode=manual`)
  await page.setInputFiles('input[type=file]', file)
  await page.waitForSelector('[aria-label="Slide 1"]', { timeout: 60000 })
  const count = await page.locator('aside button[aria-label^="Slide"]').count()

  for (let n = 1; n <= count; n++) {
    await page.click(`[aria-label="Slide ${n}"]`)
    await settle(page)
    await page.waitForTimeout(150)
    const dataUrl = await page.evaluate(() => document.querySelector('main canvas').toDataURL('image/png'))
    const actual = Buffer.from(dataUrl.split(',')[1], 'base64')
    const id = `${name}-${String(n).padStart(2, '0')}`
    const ref = path.join(baselineDir, `${id}.png`)

    if (update) {
      fs.mkdirSync(baselineDir, { recursive: true })
      fs.writeFileSync(ref, actual)
      console.log(`wrote  ${id}`)
      continue
    }
    if (!fs.existsSync(ref)) {
      missing++
      fs.mkdirSync(path.join(outDir, 'new'), { recursive: true })
      fs.writeFileSync(path.join(outDir, 'new', `${id}.png`), actual)
      console.log(`${allowMissing ? 'NEW ' : 'FAIL'}  ${id}  (no reference image)`)
      if (!allowMissing) failed++
      continue
    }

    const a = decode(actual)
    const b = decode(fs.readFileSync(ref))
    if (a.width !== b.width || a.height !== b.height) {
      console.log(`FAIL  ${id}  (size ${a.width}x${a.height}, expected ${b.width}x${b.height})`)
      failed++
      continue
    }
    const diff = new PNG({ width: a.width, height: a.height })
    const bad = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
    const ratio = bad / (a.width * a.height)
    if (ratio > MAX_DIFF) {
      fs.mkdirSync(path.join(outDir, 'diff'), { recursive: true })
      fs.writeFileSync(path.join(outDir, 'diff', `${id}.png`), PNG.sync.write(diff))
      fs.writeFileSync(path.join(outDir, 'diff', `${id}-actual.png`), actual)
      console.log(`FAIL  ${id}  (${(ratio * 100).toFixed(2)}% of pixels differ)`)
      failed++
    } else {
      passed++
      console.log(`PASS  ${id}  (${(ratio * 100).toFixed(2)}%)`)
    }
  }
}

await browser.close()
server.close()
fs.rmSync(work, { recursive: true, force: true })

if (update) {
  console.log(`\nreferences written to ${path.relative(root, baselineDir)}`)
} else {
  console.log(`\n${passed} passed, ${failed} failed${missing ? `, ${missing} without a reference` : ''}`)
  if (failed) {
    console.log('Differences: tests/output/diff/. If the change is intended, run: npm run test:visual -- --update')
    process.exit(1)
  }
}
