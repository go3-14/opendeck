// Generates public/THIRD_PARTY_LICENSES.txt: the licences of every package that
// ends up in the built extension.
//
//   node scripts/third-party-licenses.mjs
//
// It builds into a temporary folder with source maps, reads which node_modules
// packages the bundle really contains, and collects each one's licence text.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-viewer-licences-'))

execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', tmp, '--emptyOutDir', '--sourcemap'], {
  cwd: root,
  stdio: 'pipe',
})

// Packages that appear in the JavaScript bundle...
const packageDirs = new Set()
const assets = path.join(tmp, 'assets')
for (const file of fs.readdirSync(assets).filter((f) => f.endsWith('.map'))) {
  const map = JSON.parse(fs.readFileSync(path.join(assets, file), 'utf8'))
  for (const source of map.sources) {
    const m = source.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    if (m) packageDirs.add(m[1])
  }
}
// ...plus packages whose CSS or font files are bundled (they have no JavaScript in the map).
for (const name of ['@fontsource-variable/geist', 'tw-animate-css', 'tailwindcss', 'shadcn']) packageDirs.add(name)

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENSE-MIT', 'LICENSE.markdown', 'license', 'license.md']

function describe(name) {
  const dir = path.join(root, 'node_modules', name)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  let license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || (pkg.licenses || []).map((l) => l.type).join(' OR ')
  const file = LICENSE_FILES.map((f) => path.join(dir, f)).find((f) => fs.existsSync(f))
  const text = file ? fs.readFileSync(file, 'utf8').trim() : ''
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage || ''
  return { name, version: pkg.version, license: license || 'UNKNOWN', repo: repo.replace(/^git\+/, '').replace(/\.git$/, ''), text }
}

const entries = [...packageDirs].sort().map(describe)

// Dual-licensed packages are used under their permissive option.
const notes = {
  jszip: 'Used under the MIT licence (JSZip is dual-licensed MIT or GPL-3.0-or-later).',
  shadcn: 'Only its stylesheet and the copied-in component patterns are used (shadcn/ui, MIT).',
}

const out = [
  'PPTX Viewer includes the following third-party software. Each package is used under the licence shown.',
  '',
  ...entries.map((e) => `- ${e.name} ${e.version}: ${e.license}`),
  '',
  ...entries.flatMap((e) => [
    '='.repeat(78),
    `${e.name} ${e.version}  (${e.license})`,
    e.repo ? e.repo : '',
    notes[e.name] || '',
    '-'.repeat(78),
    e.text || `No licence file shipped with the package; licensed under ${e.license}.`,
    '',
  ].filter((line, i, all) => line !== '' || i === all.length - 1)),
].join('\n')

fs.writeFileSync(path.join(root, 'public', 'THIRD_PARTY_LICENSES.txt'), `${out}\n`)
fs.rmSync(tmp, { recursive: true, force: true })

const unknown = entries.filter((e) => e.license === 'UNKNOWN' || !e.text)
console.log(`wrote public/THIRD_PARTY_LICENSES.txt (${entries.length} packages)`)
if (unknown.length) console.log(`check by hand: ${unknown.map((e) => e.name).join(', ')}`)
