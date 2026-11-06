// Builds a large deck for benchmarking by repeating the sample deck's slides.
//   node tests/make-stress-deck.mjs out.pptx [slides=300]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

export async function makeStressDeck(count = 300) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(root, 'store', 'sample', 'Quarterly Business Review.pptx')))
  const originals = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort()

  const slideRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
  let ids = ''
  let rels = ''
  for (let i = 0; i < count; i++) {
    const src = originals[i % originals.length]
    const n = i + 1
    const name = `ppt/slides/slide${n}.xml`
    if (name !== src) {
      zip.file(name, await zip.file(src).async('string'))
      zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, await zip.file(src.replace('slides/', 'slides/_rels/') + '.rels').async('string'))
    }
    ids += `<p:sldId id="${256 + i}" r:id="rId${100 + i}"/>`
    rels += `<Relationship Id="rId${100 + i}" Type="${slideRel}" Target="slides/slide${n}.xml"/>`
  }
  let pres = await zip.file('ppt/presentation.xml').async('string')
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`)
  zip.file('ppt/presentation.xml', pres)
  let prels = await zip.file('ppt/_rels/presentation.xml.rels').async('string')
  prels = prels.replace(/<Relationship [^>]*Target="slides\/[^>]*\/>/g, '').replace('</Relationships>', `${rels}</Relationships>`)
  zip.file('ppt/_rels/presentation.xml.rels', prels)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, count] = process.argv.slice(2)
  fs.writeFileSync(out, await makeStressDeck(count ? parseInt(count, 10) : 300))
}
