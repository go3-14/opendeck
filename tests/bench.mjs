// tests/bench.mjs
// Load-time benchmark: how long until the slide list appears and until the first
// slide is on screen, for each deck, in real Chrome.
//
//   npm run build
//   npm run bench                        fixture deck + the sample deck
//   npm run bench -- path/to/decks       also every .pptx/.ppsx in a folder (or single files)
//   npm run bench -- --runs 7            (a generated 300-slide deck is always included)
//   npm run bench -- --runs 7            repetitions per deck (default 5, median is reported)

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome } from '../scripts/chrome.mjs'
import { serve } from '../scripts/lib.mjs'
import { makeStressDeck } from './make-stress-deck.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
if (!fs.existsSync(path.join(dist, 'viewer.html'))) {
  console.error('dist/ is missing: run "npm run build" first.')
  process.exit(2)
}

const args = process.argv.slice(2)
const runsIdx = args.indexOf('--runs')
const runs = runsIdx >= 0 ? Math.max(1, parseInt(args[runsIdx + 1], 10) || 5) : 5
const extra = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--runs')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-bench-'))
const fixture = path.join(work, 'rich.pptx')
execFileSync(process.execPath, [path.join(root, 'tests', 'make-fixtures.mjs'), fixture], { stdio: 'pipe' })

const decks = [
  ['fixture (8 slides, 25 MB)', fixture],
  ['sample deck', path.join(root, 'store', 'sample', 'Quarterly Business Review.pptx')],
]
const stress = path.join(work, 'stress.pptx')
fs.writeFileSync(stress, await makeStressDeck(300))
decks.push(['stress (300 slides)', stress])
for (const p of extra) {
  const full = path.resolve(p)
  const files = fs.statSync(full).isDirectory()
    ? fs.readdirSync(full).filter((f) => /\.(pptx|ppsx)$/i.test(f)).map((f) => path.join(full, f))
    : [full]
  for (const f of files) decks.push([path.basename(f), f])
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const server = await serve(dist)
const browser = await launchChrome()
const rows = []

for (const [label, file] of decks) {
  const size = fs.statSync(file).size
  const list = []
  const first = []
  let slides = 0
  for (let i = 0; i < runs; i++) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto(`${server.url}/viewer.html?mode=manual`)
    const input = page.locator('input[type=file]')
    const t0 = Date.now()
    await input.setInputFiles(file)
    await page.waitForSelector('[aria-label="Slide 1"], [role=alert]', { timeout: 120000 })
    list.push(Date.now() - t0)
    await page.waitForFunction(() => {
      const c = document.querySelector('main canvas')
      return !!c && c.width !== 300
    }, null, { timeout: 120000, polling: 10 })
    first.push(Date.now() - t0)
    slides = await page.locator('aside button[aria-label^="Slide"]').count()
    await page.close()
  }
  rows.push({ deck: label.length > 34 ? `${label.slice(0, 31)}...` : label, slides, MB: +(size / 1048576).toFixed(1), 'list ms': median(list), 'first slide ms': median(first) })
}

await browser.close()
server.close()
fs.rmSync(work, { recursive: true, force: true })

console.log(`\nMedian of ${runs} runs (list = slide list shown, first slide = first slide drawn)\n`)
console.table(rows)
