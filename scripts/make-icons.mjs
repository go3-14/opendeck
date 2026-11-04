// Renders store/icon.svg to the PNG sizes the extension ships (transparent background).
//   node scripts/make-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome } from './chrome.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = fs.readFileSync(path.join(root, 'store', 'icon.svg'), 'utf8')
const outDir = path.join(root, 'public', 'icons')
const sizes = [16, 48, 128]

const browser = await launchChrome()
const page = await browser.newPage()
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  await page.screenshot({ path: path.join(outDir, `icon${size}.png`), omitBackground: true })
  console.log(`wrote icons/icon${size}.png`)
}
await browser.close()
