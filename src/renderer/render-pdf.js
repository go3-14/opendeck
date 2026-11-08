// Draws one PDF page (a pdf.js page proxy) into an off-screen canvas, the same
// way render-canvas.js draws a slide: the result is only ever shown complete.

/**
 * @param {{ page: any, width: number, height: number }} pdfPage
 * @param {number} scale  CSS pixels per point
 * @param {number} dpr
 * @param {boolean} invert  dark mode: invert lightness, keep hues
 * @param {AbortSignal} [signal]
 * @returns {Promise<HTMLCanvasElement | null>} null if aborted
 */
export async function drawPdfOffscreen(pdfPage, scale, dpr, invert, signal) {
  const cssW = pdfPage.width * scale;
  const cssH = pdfPage.height * scale;
  if (cssW > 32767 || cssH > 32767 || cssW * dpr > 268000000 || cssH * dpr > 268000000) {
    throw new Error(`Page canvas is too large: ${Math.round(cssW)}×${Math.round(cssH)}px`);
  }

  // pdf.js draws on a plain white canvas.
  const page = document.createElement('canvas');
  page.width = Math.max(1, Math.round(cssW * dpr));
  page.height = Math.max(1, Math.round(cssH * dpr));
  const task = pdfPage.page.render({
    canvas: page,
    viewport: pdfPage.page.getViewport({ scale: scale * dpr }),
    background: '#ffffff',
  });
  const onAbort = () => task.cancel();
  signal?.addEventListener('abort', onAbort);
  try {
    await task.promise;
  } catch (err) {
    if (signal?.aborted || err?.name === 'RenderingCancelledException') return null;
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) return null;
  if (!invert) return page;

  // Dark mode: a white page turns near-black and black text near-white; the
  // hue rotation puts colours back close to where they were.
  const out = document.createElement('canvas');
  out.width = page.width;
  out.height = page.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');
  ctx.filter = 'invert(0.92) hue-rotate(180deg)';
  ctx.drawImage(page, 0, 0);
  return out;
}
