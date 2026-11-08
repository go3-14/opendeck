/** Files the viewer can open: OOXML presentations, slideshows and templates, and PDFs. */
const PRESENTATION_EXTENSIONS = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm']
const EXTENSIONS = [...PRESENTATION_EXTENSIONS, 'pdf']

export const ACCEPT = EXTENSIONS.map((e) => `.${e}`).join(',')

const extensionOf = (name: string) => name.toLowerCase().split('.').pop() ?? ''

export const isPresentationFile = (name: string) => EXTENSIONS.includes(extensionOf(name))

export const isPdfFile = (name: string) => extensionOf(name) === 'pdf'

/** PowerPoint "Show" files (.ppsx/.ppsm) are meant to open straight into the slideshow. */
export const isSlideshowFile = (name: string) => ['ppsx', 'ppsm'].includes(extensionOf(name))

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
