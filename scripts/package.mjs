// Builds the extension and zips it for upload to the Chrome Web Store / Edge Add-ons.
//
//   npm run package        ->  release/pptx-viewer-<version>.zip
//
// The zip holds the contents of dist/ with manifest.json at the top level.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

// Fresh production build (also type-checks).
execSync('npm run build', { cwd: root, stdio: 'inherit' })

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'))

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
for (const f of files.sort()) zip.file(f, fs.readFileSync(path.join(dist, f)))
const out = path.join(root, 'release', `pptx-viewer-${manifest.version}.zip`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }))

const kb = (fs.statSync(out).size / 1024).toFixed(0)
console.log(`\nwrote ${path.relative(root, out)}  (${files.length} files, ${kb} KB)`)
console.log(`version ${manifest.version}; upload this file in the store dashboard.`)
