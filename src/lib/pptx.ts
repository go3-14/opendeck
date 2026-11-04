import JSZip from 'jszip'
import { unzipPptx } from '@/renderer/unzip.js'
import { parseThemeChain } from '@/renderer/parse-theme.js'
import { parseSlide, parseSlideSize } from '@/renderer/parse-slide.js'
import { renderSlide } from '@/renderer/render-canvas.js'

export type Slide = ReturnType<typeof parseSlide>

/** unzip → parse theme + slides. Throws on invalid files. */
export async function loadPptx(
  bytes: ArrayBuffer,
  onProgress?: (message: string) => void,
): Promise<Slide[]> {
  onProgress?.('Reading file…')
  const {
    slideXmls, layoutXmls, masterXmls, themeXml, media,
    slideRels, imageRels, presentationXml, slidePaths, layoutPaths, masterPaths,
  } = await unzipPptx(bytes)

  if (!slideXmls.length) throw new Error('No slides found in this file.')

  const slideSize = parseSlideSize(presentationXml)
  const slides: Slide[] = []

  for (let i = 0; i < slideXmls.length; i++) {
    onProgress?.(`Parsing slide ${i + 1} of ${slideXmls.length}…`)
    const rels = slideRels.get(slidePaths[i]) ?? { layoutPath: '', masterPath: '' }
    const layoutIdx = layoutPaths.indexOf(rels.layoutPath)
    const masterIdx = masterPaths.indexOf(rels.masterPath)
    const layoutXml = layoutXmls[layoutIdx >= 0 ? layoutIdx : 0] || null
    const masterXml = masterXmls[masterIdx >= 0 ? masterIdx : 0] || null

    const themeCtx = parseThemeChain(slideXmls[i], layoutXml, masterXml, themeXml)
    slides.push(
      parseSlide(slideXmls[i], themeCtx, media, slideSize, imageRels.get(slidePaths[i]) || new Map()),
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

  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename.replace(/\.pptx$/i, '')}_slides.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
