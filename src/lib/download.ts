/** Saves a Blob as a file download with the given name. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const OOXML = 'application/vnd.openxmlformats-officedocument.presentationml'
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  pptx: `${OOXML}.presentation`,
  ppsx: `${OOXML}.slideshow`,
  potx: `${OOXML}.template`,
  pptm: 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  potm: 'application/vnd.ms-powerpoint.template.macroenabled.12',
}

/** The media type of a file we can open, from its extension. */
export const mimeFor = (filename: string): string =>
  MIME[filename.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream'
