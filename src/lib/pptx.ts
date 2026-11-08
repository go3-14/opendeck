import JSZip from 'jszip'
import { unzipPptx } from '@/renderer/unzip.js'
import { parseThemeChain } from '@/renderer/parse-theme.js'
import { parseSlide, parseSlideSize } from '@/renderer/parse-slide.js'
import { renderSlide } from '@/renderer/render-canvas.js'
import { clearXmlCache } from '@/renderer/xml.js'
import { saveBlob } from './download'

export type Slide = ReturnType<typeof parseSlide>

/** unzip → parse theme + slides. Throws on invalid files. */
export async function loadPptx(
  bytes: ArrayBuffer,
  onProgress?: (message: string) => void,
): Promise<Slide[]> {
  clearXmlCache()
  onProgress?.('Reading file…')
  const {
    slideXmls, layoutXmls, masterXmls, themeXml, themeXmls, media,
    slideRels, imageRels, diagrams, charts, notes, tableStylesXml, presentationXml, slidePaths, layoutPaths, masterPaths,
  } = await unzipPptx(bytes)

  if (!slideXmls.length) throw new Error('No slides found in this file.')

  const slideSize = parseSlideSize(presentationXml)
  const slides: Slide[] = []

  for (let i = 0; i < slideXmls.length; i++) {
    onProgress?.(`Parsing slide ${i + 1} of ${slideXmls.length}…`)
    const rels = slideRels.get(slidePaths[i]) ?? { layoutPath: null, masterPath: null }
    const layoutIdx = layoutPaths.indexOf(rels.layoutPath ?? '')
    const masterIdx = masterPaths.indexOf(rels.masterPath ?? '')
    const layoutXml = layoutXmls[layoutIdx >= 0 ? layoutIdx : 0] || null
    const masterXml = masterXmls[masterIdx >= 0 ? masterIdx : 0] || null
    const slideTheme = (rels.masterPath && themeXmls.get(rels.masterPath)) || themeXml

    const themeCtx = parseThemeChain(slideXmls[i], layoutXml, masterXml, slideTheme)
    slides.push(
      parseSlide(slideXmls[i], themeCtx, media, slideSize, imageRels.get(slidePaths[i]) || new Map(), {
        layoutXml,
        masterXml,
        layoutImageRels: imageRels.get(layoutPaths[layoutIdx >= 0 ? layoutIdx : 0]) || new Map(),
        masterImageRels: imageRels.get(masterPaths[masterIdx >= 0 ? masterIdx : 0]) || new Map(),
        slideNumber: i + 1,
        diagrams: diagrams.get(slidePaths[i]),
        charts: charts.get(slidePaths[i]),
        notes: notes.get(slidePaths[i]),
        tableStylesXml,
      }),
    )
  }
  return slides
}

/** Renders every slide at 2x and downloads them as a ZIP of PNGs. */
export async function exportSlidesAsZip(
  slides: Slide[],
  filename: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const zip = new JSZip()
  const pad = String(slides.length).length

  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i, slides.length)
    const canvas = document.createElement('canvas')
    await renderSlide(slides[i], canvas, 2, 1)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) zip.file(`slide_${String(i + 1).padStart(pad, '0')}.png`, blob)
    await new Promise((r) => setTimeout(r, 0)) // let the UI breathe
  }
  onProgress?.(slides.length, slides.length)

  saveBlob(await zip.generateAsync({ type: 'blob' }), `${filename.replace(/\.[^.]+$/, '')}_slides.zip`)
}
