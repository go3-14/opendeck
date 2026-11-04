// viewer/renderer/render-canvas.js
// Renders a SlideModel onto an HTML <canvas> element.
// Handles: background, text runs, images, shapes, tables, fallback badges.
// High-DPI aware: uses devicePixelRatio for crisp rendering.
//
// export async function renderSlide(slideModel, canvas, scale, dpr) → void

'use strict';

import { drawFallbackBadge } from './fallback-notice.js';

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Wraps text to fit within maxWidth, returning an array of lines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapText(ctx, text, maxWidth) {
  if (!text) return [''];
  if (maxWidth <= 0) return [text];

  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * Maps OOXML paragraph alignment to canvas textAlign.
 * @param {string} algn - 'l', 'r', 'ctr', 'just', 'dist'
 * @returns {CanvasTextAlign}
 */
function algToAlign(algn) {
  switch (algn) {
    case 'r':    return 'right';
    case 'ctr':  return 'center';
    case 'just': return 'left';
    default:     return 'left';
  }
}

// ─── Fill & Stroke Helpers ────────────────────────────────────────────────────

/**
 * Applies a Fill descriptor to the canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Fill} fill
 * @param {number} x, y, w, h - bounding box in canvas pixels
 * @returns {boolean} true if fill was applied
 */
function applyFill(ctx, fill, x, y, w, h) {
  if (!fill || fill.type === 'none') return false;

  if (fill.type === 'solid') {
    ctx.fillStyle = fill.color || 'transparent';
    return true;
  }

  if (fill.type === 'gradient' && fill.stops?.length) {
    const angleRad = ((fill.angle || 0) * Math.PI) / 180;
    const cx = x + w / 2, cy = y + h / 2;
    const len = Math.sqrt(w * w + h * h) / 2;
    const grd = ctx.createLinearGradient(
      cx - Math.cos(angleRad) * len,
      cy - Math.sin(angleRad) * len,
      cx + Math.cos(angleRad) * len,
      cy + Math.sin(angleRad) * len,
    );
    for (const stop of fill.stops) {
      grd.addColorStop(Math.max(0, Math.min(1, stop.pos)), stop.color || '#000000');
    }
    ctx.fillStyle = grd;
    return true;
  }

  return false;
}

// ─── Shape Drawing ────────────────────────────────────────────────────────────

/**
 * Draws a preset geometry path.
 * Handles: rect, ellipse, roundRect, triangle, parallelogram,
 * trapezoid, diamond, pentagon, hexagon, star, arrow shapes.
 */
function drawGeometryPath(ctx, geometry, x, y, w, h) {
  ctx.beginPath();
  switch (geometry) {
    case 'ellipse':
    case 'oval':
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;

    case 'roundRect':
    case 'roundRectangle': {
      const r = Math.min(w, h) * 0.1;
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      break;
    }

    case 'triangle':
    case 'isoceles':
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;

    case 'rtTriangle':
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;

    case 'parallelogram': {
      const skew = w * 0.2;
      ctx.moveTo(x + skew, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w - skew, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    }

    case 'trapezoid': {
      const inset = w * 0.15;
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + w - inset, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    }

    case 'diamond':
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
      break;

    case 'pentagon': {
      const angle0 = -Math.PI / 2;
      const sides = 5;
      for (let i = 0; i < sides; i++) {
        const a = angle0 + (i * 2 * Math.PI) / sides;
        const px = x + w/2 + (w/2) * Math.cos(a);
        const py = y + h/2 + (h/2) * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case 'hexagon': {
      const sides = 6;
      for (let i = 0; i < sides; i++) {
        const a = (i * 2 * Math.PI) / sides;
        const px = x + w/2 + (w/2) * Math.cos(a);
        const py = y + h/2 + (h/2) * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    case 'star4': case 'star5': case 'star6': case 'star8': {
      const points = parseInt(geometry.replace('star', ''), 10) || 5;
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.45;
      const cx2 = x + w / 2, cy2 = y + h / 2;
      for (let i = 0; i < points * 2; i++) {
        const a = (i * Math.PI) / points - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        const px = cx2 + r * Math.cos(a);
        const py = cy2 + r * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    default:
      // rect and all unknown shapes → rectangle
      ctx.rect(x, y, w, h);
  }
}

// ─── Text Renderer ────────────────────────────────────────────────────────────

/**
 * Renders a text shape's paragraphs onto the canvas.
 * Handles bold/italic/color/size per run, paragraph alignment, wrapping.
 */
function drawText(ctx, shape, scale) {
  const { x, y, w, h, paragraphs } = shape;
  const px = x * scale, py = y * scale, pw = w * scale, ph = h * scale;

  const LINE_SPACING = 1.25; // line-height multiplier
  const PADDING = 4 * scale;

  ctx.save();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  let cursorY = py + PADDING;

  for (const para of paragraphs) {
    if (!para.runs.length) {
      cursorY += 16 * scale * LINE_SPACING;
      continue;
    }

    const align = algToAlign(para.align);
    const anchorX = align === 'right'  ? px + pw - PADDING
      : align === 'center' ? px + pw / 2
      : px + PADDING;

    // Group runs into wrapped lines
    // Simple approach: process each run sequentially, wrapping by word
    for (const run of para.runs) {
      if (run.text === '\n') {
        cursorY += (run.fontSize || 18) * scale * LINE_SPACING;
        continue;
      }

      const fs = (run.fontSize || 18) * scale;
      const weight = run.bold ? '700' : '400';
      const style  = run.italic ? 'italic' : 'normal';
      ctx.font = `${style} ${weight} ${fs}px "${run.fontFamily || 'Calibri'}", Calibri, sans-serif`;
      ctx.fillStyle = run.color || '#000000';
      ctx.textAlign = align;
      ctx.textBaseline = 'top';

      const maxW = pw - PADDING * 2;
      const lines = wrapText(ctx, run.text, maxW);

      for (const line of lines) {
        if (cursorY + fs > py + ph + 2) break; // clip overflow
        ctx.fillText(line, anchorX, cursorY, maxW);

        if (run.underline || run.strike) {
          const metrics = ctx.measureText(line);
          const tw = metrics.width;
          let lineX = anchorX;
          if (align === 'right')  lineX = anchorX - tw;
          if (align === 'center') lineX = anchorX - tw / 2;
          const lineY = run.underline ? cursorY + fs + 1 : cursorY + fs * 0.55;
          ctx.strokeStyle = run.color || '#000000';
          ctx.lineWidth = Math.max(0.5, fs / 20);
          ctx.beginPath();
          ctx.moveTo(lineX, lineY);
          ctx.lineTo(lineX + tw, lineY);
          ctx.stroke();
        }

        cursorY += fs * LINE_SPACING;
      }
    }
  }

  ctx.restore();
}

// ─── Image Renderer ───────────────────────────────────────────────────────────

/** Loads a Blob into an HTMLImageElement (cached by object URL). */
const _imageCache = new Map();

async function loadBlobImage(blob) {
  if (_imageCache.has(blob)) return _imageCache.get(blob);
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      callback(value);
    };
    const timeoutId = setTimeout(() => {
      finish(reject, new Error('Image decode timed out'));
    }, 10000);
    img.onload = () => {
      _imageCache.set(blob, img);
      finish(resolve, img);
    };
    img.onerror = () => finish(reject, new Error('Image decode failed'));
    img.src = url;
  });
}

async function drawImage(ctx, shape, scale) {
  const { x, y, w, h, blob, flipH, flipV, rot } = shape;
  if (!blob) return;

  let img;
  try { img = await loadBlobImage(blob); } catch { return; }

  const px = x * scale, py = y * scale, pw = w * scale, ph = h * scale;

  ctx.save();
  ctx.translate(px + pw / 2, py + ph / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  if (flipH) ctx.scale(-1, 1);
  if (flipV) ctx.scale(1, -1);
  ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
  ctx.restore();
}

// ─── Shape Renderer ───────────────────────────────────────────────────────────

function drawShape(ctx, shape, scale) {
  const { x, y, w, h, rot, flipH, flipV, fill, line, geometry } = shape;
  const px = x * scale, py = y * scale, pw = w * scale, ph = h * scale;

  ctx.save();
  ctx.translate(px + pw / 2, py + ph / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  if (flipH) ctx.scale(-1, 1);
  if (flipV) ctx.scale(1, -1);

  const gx = -pw / 2, gy = -ph / 2;

  drawGeometryPath(ctx, geometry || 'rect', gx, gy, pw, ph);

  if (applyFill(ctx, fill, gx, gy, pw, ph)) {
    ctx.fill();
  }

  if (line) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width * scale;
    ctx.stroke();
  }

  ctx.restore();

  // Draw text on top if this shape also has text
  if (shape.paragraphs?.length) {
    drawText(ctx, shape, scale);
  }
}

// ─── Table Renderer ───────────────────────────────────────────────────────────

function drawTable(ctx, shape, scale) {
  const { x, y, w, h, rows, colWidths } = shape;
  const px = x * scale, py = y * scale;

  let rowY = py;
  for (const row of rows) {
    const rowH = row.h * scale;
    let colX = px;

    for (let ci = 0; ci < row.cells.length; ci++) {
      const cell = row.cells[ci];
      const colW = (colWidths[ci] || (w / row.cells.length)) * scale;

      // Cell fill
      if (applyFill(ctx, cell.fill, colX, rowY, colW, rowH)) {
        ctx.fillRect(colX, rowY, colW, rowH);
      }

      // Cell border
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(colX, rowY, colW, rowH);

      // Cell text
      if (cell.paragraphs?.length) {
        const pseudoShape = {
          x: colX / scale, y: rowY / scale,
          w: colW / scale, h: rowH / scale,
          paragraphs: cell.paragraphs,
        };
        drawText(ctx, pseudoShape, scale);
      }

      colX += colW;
    }
    rowY += rowH;
  }
}

// ─── Group Renderer ───────────────────────────────────────────────────────────

async function drawGroup(ctx, shape, scale) {
  for (const child of shape.shapes || []) {
    await drawShapeDispatch(ctx, child, scale);
  }
}

// ─── Main Dispatch ────────────────────────────────────────────────────────────

async function drawShapeDispatch(ctx, shape, scale) {
  if (!shape) return;
  switch (shape.type) {
    case 'text':
    case 'shape':
      // drawShape paints fill/outline first, then any text on top, so shapes
      // that contain text keep their background.
      drawShape(ctx, shape, scale);
      break;

    case 'image':
      await drawImage(ctx, shape, scale);
      break;

    case 'table':
      drawTable(ctx, shape, scale);
      break;

    case 'group':
      await drawGroup(ctx, shape, scale);
      break;

    case 'unsupported':
      drawFallbackBadge(
        ctx,
        shape.x * scale, shape.y * scale,
        shape.w * scale, shape.h * scale,
        shape.label || 'Unknown'
      );
      break;

    default:
      break;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a SlideModel onto a <canvas> element at the given scale and DPR.
 *
 * @param {SlideModel} slideModel - from parse-slide.js
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale  - points-to-CSS-pixel multiplier (e.g. 1.0 = 1pt = 1px)
 * @param {number} [dpr]  - device pixel ratio (defaults to window.devicePixelRatio)
 * @returns {Promise<void>}
 */
export async function renderSlide(slideModel, canvas, scale = 1, dpr = window.devicePixelRatio || 1) {
  const { width, height, background, shapes } = slideModel;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid slide dimensions: ${width}×${height}`);
  }
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(dpr) || dpr <= 0) {
    throw new Error(`Invalid canvas scale: ${scale} (DPR ${dpr})`);
  }

  // ── High-DPI canvas setup ─────────────────────────────────────────────────
  const cssW = width  * scale;
  const cssH = height * scale;
  // Chromium refuses oversized canvases. Keep the error in the viewer so it
  // can fall back to a thumbnail placeholder instead of killing the tab.
  if (cssW > 32767 || cssH > 32767 || cssW * dpr > 268000000 || cssH * dpr > 268000000) {
    throw new Error(`Slide canvas is too large: ${Math.round(cssW)}×${Math.round(cssH)}px`);
  }
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width  = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');
  ctx.scale(dpr, dpr); // All subsequent draws are in CSS pixels

  // ── Background fill ───────────────────────────────────────────────────────
  ctx.fillStyle = background || '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  // ── Draw shapes in z-order (array order = z-order from OOXML) ────────────
  for (const shape of shapes || []) {
    try {
      await drawShapeDispatch(ctx, shape, scale);
    } catch (err) {
      // Never let a single shape crash the whole slide
      console.warn('[PPTX Viewer] Shape render error:', err, shape);
    }
  }
}
