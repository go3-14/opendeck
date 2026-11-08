// Copies the data files pdf.js loads at run time (fonts, CMaps, wasm decoders,
// colour profiles) from node_modules into public/pdfjs/, so they ship inside the
// extension. Runs before every build; the output folder is not committed.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const from = path.join(root, 'node_modules', 'pdfjs-dist')
const to = path.join(root, 'public', 'pdfjs')

if (!existsSync(from)) {
  console.error('pdfjs-dist is not installed. Run npm install first.')
  process.exit(1)
}
rmSync(to, { recursive: true, force: true })
mkdirSync(to, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(path.join(from, dir), path.join(to, dir), { recursive: true })
}
console.log('pdf.js data files copied to public/pdfjs/')
