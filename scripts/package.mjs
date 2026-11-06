// Builds the extension and zips it for upload to the Chrome Web Store / Edge Add-ons.
//
//   npm run package        ->  release/pptx-viewer-<version>.zip
//
// The zip holds the contents of dist/ with manifest.json at the top level.
//
//   npm run package:firefox  ->  release/pptx-viewer-firefox-<version>.zip
//
// Same code, with a manifest adjusted for Firefox and Zen (event-page background
// script instead of a service worker, an add-on id, no Chrome-only keys).

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

// Fresh production build (also type-checks).
execSync('npm run build', { cwd: root, stdio: 'inherit' })

const firefox = process.argv.includes('--firefox')
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'))
if (firefox) {
  delete manifest.minimum_chrome_version
  manifest.background = { scripts: [manifest.background.service_worker] }
  manifest.browser_specific_settings = {
    gecko: {
      id: 'pptx-viewer@go3-14.github.io',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    },
  }
}

/** Every file under a folder, as paths relative to it (forward slashes). */
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')]
  })
}
const files = walk(dist)

// ─── Checks: fail loudly instead of shipping a broken package ─────────────────
const problems = []
for (const required of ['manifest.json', 'background.js', 'viewer.html', 'THIRD_PARTY_LICENSES.txt', ...Object.values(manifest.icons || {})]) {
  if (!files.includes(required)) problems.push(`missing ${required}`)
}
for (const f of files) {
  if (/\.(pptx|ppsx|pptm|potx|map|log)$/i.test(f)) problems.push(`unexpected file in dist: ${f}`)
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) problems.push(`odd version "${manifest.version}"`)
if ((manifest.description || '').length > 132) problems.push('description is longer than 132 characters (store limit)')
if (problems.length) {
  console.error(`Not packaging:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}

// ─── Zip ──────────────────────────────────────────────────────────────────────
const zip = new JSZip()
for (const f of files.sort()) {
  zip.file(f, f === 'manifest.json' && firefox ? JSON.stringify(manifest, null, 2) : fs.readFileSync(path.join(dist, f)))
}
const out = path.join(root, 'release', `pptx-viewer-${firefox ? 'firefox-' : ''}${manifest.version}.zip`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }))

const kb = (fs.statSync(out).size / 1024).toFixed(0)
console.log(`\nwrote ${path.relative(root, out)}  (${files.length} files, ${kb} KB)`)
console.log(`version ${manifest.version}; upload this file in the store dashboard.`)
