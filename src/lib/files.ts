/** Presentation files the viewer can open: OOXML presentations, slideshows and templates. */
const EXTENSIONS = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm']

export const ACCEPT = EXTENSIONS.map((e) => `.${e}`).join(',')

const extensionOf = (name: string) => name.toLowerCase().split('.').pop() ?? ''

export const isPresentationFile = (name: string) => EXTENSIONS.includes(extensionOf(name))

/** PowerPoint "Show" files (.ppsx/.ppsm) are meant to open straight into the slideshow. */
export const isSlideshowFile = (name: string) => ['ppsx', 'ppsm'].includes(extensionOf(name))

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
