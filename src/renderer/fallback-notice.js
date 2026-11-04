// viewer/renderer/fallback-notice.js
// Draws a warning badge on canvas for unsupported OOXML shape types.
// Used by render-canvas.js for any shape with type === 'unsupported'.
//
// export function drawFallbackBadge(ctx, x, y, w, h, label)

'use strict';

/**
 * Draws a semi-transparent orange dashed-border rectangle with a
 * warning icon (⚠) and a label describing the unsupported element.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x      - top-left x in canvas pixels (pre-scaled by caller)
 * @param {number} y      - top-left y in canvas pixels
 * @param {number} w      - width in canvas pixels
 * @param {number} h      - height in canvas pixels
 * @param {string} label  - human-readable label e.g. "SmartArt", "Chart"
 */
export function drawFallbackBadge(ctx, x, y, w, h, label) {
  ctx.save();

  const minDim = Math.min(w, h);
  const fontSize = Math.max(10, Math.min(14, minDim * 0.12));

  // ── Background fill ───────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(249, 115, 22, 0.08)'; // orange-500 at 8% opacity
  ctx.fillRect(x, y, w, h);

  // ── Dashed border ─────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]); // reset

  // ── Warning icon ─────────────────────────────────────────────────────────
  const iconSize = Math.min(24, minDim * 0.22);
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const iconY = centerY - iconSize * 0.6;

  ctx.font = `${iconSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(249, 115, 22, 0.85)';
  ctx.fillText('⚠', centerX, iconY);

  // ── Label text ────────────────────────────────────────────────────────────
  ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(249, 115, 22, 0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${label} — not supported`, centerX, iconY + iconSize * 0.7, w - 16);

  ctx.restore();
}
