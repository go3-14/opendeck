// Loads the built extension in a real browser and checks the service worker's PDF take-over:
// a .pdf URL (with a query string) is redirected to the viewer, which draws both pages.
// Host access is forced on in a copy of the manifest, because the optional permission needs a click.
// Needs a browser that still allows --load-extension (Microsoft Edge, or Chromium via CHROME_PATH);
// branded Chrome 137+ does not, and the test is skipped when none is found.
// Run: npm run build && node tests/extension.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright-core')

const candidates = [process.env.CHROME_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = candidates.find((p) => p && fs.existsSync(p))
if (!browserPath) {
  console.log('SKIP  no browser that can load unpacked extensions was found')
  process.exit(0)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-ext-'))
const ext = path.join(tmp, 'ext')
fs.cpSync(path.join(root, 'dist'), ext, { recursive: true })
const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'))
mf.host_permissions = ['<all_urls>'] // stand-in for the user granting the optional permission
delete mf.optional_host_permissions
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf))

const pdf = path.join(tmp, 'test.pdf')
execFileSync(process.execPath, [path.join(root, 'tests', 'make-pdf.mjs'), pdf])

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/files/test.pdf')) {
    res.writeHead(200, { 'content-type': 'application/pdf' })
    res.end(fs.readFileSync(pdf))
  } else res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  executablePath: browserPath,
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', '--headless=new'],
})
let sw = ctx.serviceWorkers()[0]
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null)
if (!sw) {
  console.log('SKIP  this browser did not load the extension')
  await ctx.close()
  process.exit(0)
}
let failures = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok || !detail ? '' : '  (' + detail + ')'))
  if (!ok) failures++
}
{
  await new Promise((r) => setTimeout(r, 1500))
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())
  check('the PDF redirect rule is installed when website access exists', rules.length === 1)
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:' + port + '/files/test.pdf?x=1&y=2').catch(() => undefined)
  await page.waitForSelector('aside button[aria-label^=Slide]', { timeout: 15000 }).catch(() => undefined)
  check('opening a .pdf URL redirects to the viewer', page.url().startsWith('chrome-extension://') && page.url().includes('mode=url'), page.url())
  check('the query string of the link is kept', page.url().includes('?x=1&y=2'), page.url())
  check('the viewer draws the PDF pages', (await page.locator('aside button[aria-label^=Slide]').count()) === 2)

  // A PDF opened from the computer (a file:// address): redirected too.
  const local = await ctx.newPage()
  await local.goto(pathToFileURL(pdf).href).catch(() => undefined)
  await local.waitForSelector('aside button[aria-label^=Slide]', { timeout: 15000 }).catch(() => undefined)
  check('a local .pdf (file://) opens in the viewer', local.url().startsWith('chrome-extension://') && (await local.locator('aside button[aria-label^=Slide]').count()) === 2, local.url())

  // A PowerPoint file opened from the computer is a download in the browser: the extension catches it.
  const sample = path.join(root, 'store', 'sample', 'Quarterly Business Review.pptx')
  if (fs.existsSync(sample)) {
    const nav = await ctx.newPage()
    await nav.goto(pathToFileURL(sample).href).catch(() => undefined)
    let viewer = null
    for (let i = 0; i < 60 && !viewer; i++) {
      viewer = ctx.pages().find((p) => p.url().includes('mode=intercepted')) ?? null
      if (!viewer) await new Promise((r) => setTimeout(r, 250))
    }
    await viewer?.waitForSelector('aside button[aria-label^=Slide]', { timeout: 20000 }).catch(() => undefined)
    check('a local .pptx (file://) opens in the viewer', !!viewer && viewer.url().includes('mode=intercepted') && (await viewer.locator('aside button[aria-label^=Slide]').count()) > 0, viewer ? viewer.url() : 'no viewer tab')
  }
}
await ctx.close()
server.close()
fs.rmSync(tmp, { recursive: true, force: true })
if (failures) process.exit(1)
console.log('All extension checks passed')
