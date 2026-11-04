/**
 * Every slide as an image, one per printed page. Hidden on screen; the print
 * stylesheet (index.css) shows only this and hides the rest of the app.
 */
export function PrintPages({ pages }: { pages: string[] }) {
  return (
    <div className="print-pages hidden print:block" aria-hidden>
      {pages.map((src, i) => (
        <img key={i} src={src} alt={`Slide ${i + 1}`} />
      ))}
    </div>
  )
}
