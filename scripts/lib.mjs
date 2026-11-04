// Small helpers shared by the store-asset scripts.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }

/** Serves a folder over http://127.0.0.1 on a free port. */
export async function serve(dir) {
  const server = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

/** Waits until a canvas stops changing between samples. */
export async function settle(page, selector = 'main canvas') {
  let last = ''
  for (let i = 0; i < 50; i++) {
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

/** Waits until every slide-list thumbnail has been drawn. */
export async function thumbnailsReady(page) {
  await page.waitForFunction(() => {
    const canvases = [...document.querySelectorAll('aside canvas')]
    return canvases.length > 0 && canvases.every((c) => c.width !== 300)
  }, null, { timeout: 30000 })
  await page.waitForTimeout(300)
}
