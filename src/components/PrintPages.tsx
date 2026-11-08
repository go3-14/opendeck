/** One printed page: the slide image and whether the slide is taller than wide. */
export interface PrintPage {
  src: string
  portrait: boolean
}

/**
 * Every slide as an image, one per printed page. Hidden on screen; the print
 * stylesheet (index.css) shows only this and hides the rest of the app. Portrait
 * pages print on portrait sheets and landscape ones on landscape sheets.
 */
export function PrintPages({ pages }: { pages: PrintPage[] }) {
  return (
    <div className="print-pages hidden print:block" aria-hidden>
      {pages.map((p, i) => (
        <img key={i} src={p.src} alt={`Slide ${i + 1}`} className={p.portrait ? 'portrait' : 'landscape'} />
      ))}
    </div>
  )
}
