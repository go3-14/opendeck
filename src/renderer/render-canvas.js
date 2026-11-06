// src/renderer/render-canvas.js
// Draws a SlideModel (from parse-slide.js) onto an HTML <canvas>.
//
// export async function renderSlide(slideModel, canvas, scale, dpr, options) → boolean
// export async function preloadSlideImages(slideModel) → void
// export function animationStepCount(slideModel) → number
//
// `scale` is CSS pixels per point. All model coordinates are in points.

import { drawFallbackBadge } from './fallback-notice.js';
import { drawChart } from './render-chart.js';

const LINE_HEIGHT = 1.2; // line box = font size × 1.2 (typical for Calibri/Arial)
const DESCENT = 0.25; // baseline sits this many em above the line box bottom
const SCRIPT_SCALE = 0.65; // super/subscript size

// ─── Fills ────────────────────────────────────────────────────────────────────

/** Returns a canvas fillStyle for solid/gradient fills, or null (none/image). */
function fillStyleFor(ctx, fill, x, y, w, h) {
  if (!fill) return null;
  if (fill.type === 'solid') return fill.color;
  if (fill.type !== 'gradient' || !fill.stops?.length) return null;

  const cx = x + w / 2;
  const cy = y + h / 2;
  let grd;
  if (fill.radial) {
    grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2 || 1);
  } else {
    const a = ((fill.angle || 0) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    grd = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  for (const stop of fill.stops) {
    grd.addColorStop(Math.max(0, Math.min(1, stop.pos)), stop.color);
  }
  return grd;
}

// ─── Images ───────────────────────────────────────────────────────────────────
//
// Images are decoded *before* a slide is drawn (see preloadSlideImages), so the
// draw phase is fully synchronous and a slide can be painted in one step.

const IMAGE_CACHE_LIMIT = 128; // decoded images kept; oldest are dropped (and re-decoded on demand)
const IMAGE_TIMEOUT_MS = 30000; // never hang a render on a broken image

// loadBlob function → { promise, img } ; insertion order doubles as LRU order
const imageCache = new Map();

function touch(loadBlob, entry) {
  imageCache.delete(loadBlob);
  imageCache.set(loadBlob, entry);
  while (imageCache.size > IMAGE_CACHE_LIMIT) {
    imageCache.delete(imageCache.keys().next().value);
  }
}

/** Decodes a Blob, preferring createImageBitmap (off the main thread). */
async function decodeBlob(blob) {
  if (typeof createImageBitmap === 'function' && blob.type !== 'image/svg+xml') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fall through to <img>, which handles more formats
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes the image behind a lazy media loader. Resolves to null on failure. */
export function loadImage(loadBlob) {
  if (!loadBlob) return Promise.resolve(null);
  const cached = imageCache.get(loadBlob);
  if (cached) {
    touch(loadBlob, cached);
    return cached.promise;
  }

  const entry = { img: null, promise: null };
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timed out after ${IMAGE_TIMEOUT_MS / 1000}s`)), IMAGE_TIMEOUT_MS));
  entry.promise = Promise.race([loadBlob().then(decodeBlob), timeout])
    .then((img) => {
      entry.img = img;
      return img;
    })
    .catch((err) => {
      console.warn('[Opendeck] Image failed to load:', err);
      return null;
    });
  touch(loadBlob, entry);
  return entry.promise;
}

/** The already-decoded image for a loader, or null (not loaded or failed). */
function loadedImage(loadBlob) {
  return (loadBlob && imageCache.get(loadBlob)?.img) || null;
}

/** Every image loader a slide needs: background, shapes, fills, group children. */
function collectImageLoaders(slide) {
  const loaders = new Set();
  const visit = (shape) => {
    if (!shape) return;
    if (shape.type === 'image' && shape.loadBlob) loaders.add(shape.loadBlob);
    if (shape.fill?.type === 'image' && shape.fill.loadBlob) loaders.add(shape.fill.loadBlob);
    for (const child of shape.shapes || []) visit(child);
  };
  if (slide.background?.type === 'image' && slide.background.loadBlob) loaders.add(slide.background.loadBlob);
  for (const shape of slide.shapes || []) visit(shape);
  return [...loaders];
}

/** Starts decoding every image of a slide in parallel; resolves when all are ready. */
export async function preloadSlideImages(slide) {
  await Promise.all(collectImageLoaders(slide).map(loadImage));
}

const naturalSize = (img) => [img.naturalWidth ?? img.width, img.naturalHeight ?? img.height];

/** Draws an image into (x, y, w, h), optionally cropping with fractions {l,t,r,b}. */
function blit(ctx, img, crop, x, y, w, h) {
  if (!crop) {
    ctx.drawImage(img, x, y, w, h);
    return;
  }
  const [iw, ih] = naturalSize(img);
  const sw = iw * (1 - crop.l - crop.r);
  const sh = ih * (1 - crop.t - crop.b);
  if (sw > 0 && sh > 0) ctx.drawImage(img, crop.l * iw, crop.t * ih, sw, sh, x, y, w, h);
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function regularPolygon(ctx, sides, x, y, w, h, startAngle) {
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i * 2 * Math.PI) / sides;
    const px = x + w / 2 + (w / 2) * Math.cos(a);
    const py = y + h / 2 + (h / 2) * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function polygon(ctx, points) {
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
}

/** Builds a freeform (<a:custGeom>) path scaled into the box (x, y, w, h). */
function buildCustomPath(ctx, paths, x, y, w, h) {
  ctx.beginPath();
  let anyFill = false;
  for (const p of paths) {
    const sx = p.w ? w / p.w : 1;
    const sy = p.h ? h / p.h : 1;
    let cx = 0; // current point, in the path's own units
    let cy = 0;
    let startX = 0;
    let startY = 0;
    for (const cmd of p.cmds) {
      switch (cmd[0]) {
        case 'M':
          ctx.moveTo(x + cmd[1] * sx, y + cmd[2] * sy);
          [, cx, cy] = cmd;
          [startX, startY] = [cx, cy];
          break;
        case 'L':
          ctx.lineTo(x + cmd[1] * sx, y + cmd[2] * sy);
          [, cx, cy] = cmd;
          break;
        case 'C':
          ctx.bezierCurveTo(x + cmd[1] * sx, y + cmd[2] * sy, x + cmd[3] * sx, y + cmd[4] * sy, x + cmd[5] * sx, y + cmd[6] * sy);
          [cx, cy] = [cmd[5], cmd[6]];
          break;
        case 'Q':
          ctx.quadraticCurveTo(x + cmd[1] * sx, y + cmd[2] * sy, x + cmd[3] * sx, y + cmd[4] * sy);
          [cx, cy] = [cmd[3], cmd[4]];
          break;
        case 'A': {
          // Arc continuing from the current point: it starts at angle stAng on an ellipse (wR, hR).
          const [, wR, hR, st, sw] = cmd;
          const start = (st * Math.PI) / 180;
          const end = start + (sw * Math.PI) / 180;
          const centerX = cx - wR * Math.cos(start);
          const centerY = cy - hR * Math.sin(start);
          ctx.ellipse(x + centerX * sx, y + centerY * sy, Math.abs(wR * sx), Math.abs(hR * sy), 0, start, end, sw < 0);
          cx = centerX + wR * Math.cos(end);
          cy = centerY + hR * Math.sin(end);
          break;
        }
        case 'Z':
          ctx.closePath();
          [cx, cy] = [startX, startY];
          break;
        default: break;
      }
    }
    if (p.fill) anyFill = true;
  }
  return { open: !anyFill };
}

/**
 * Builds the path for a preset geometry.
 * @returns {{ open: boolean, points?: number[][] }}  open = line-like (no fill);
 *          points = polyline used to orient arrowheads.
 */
function buildPath(ctx, geometry, x, y, w, h, adj, custom) {
  if (geometry === 'custom' && custom) return buildCustomPath(ctx, custom, x, y, w, h);
  ctx.beginPath();
  switch (geometry) {
    case 'line':
    case 'straightConnector1': {
      const points = [[x, y], [x + w, y + h]];
      ctx.moveTo(...points[0]);
      ctx.lineTo(...points[1]);
      return { open: true, points };
    }
    case 'bentConnector2': {
      const points = [[x, y], [x + w, y], [x + w, y + h]];
      points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      return { open: true, points };
    }
    case 'bentConnector3':
    case 'bentConnector4':
    case 'bentConnector5': {
      const mid = x + w * (adj ?? 0.5);
      const points = [[x, y], [mid, y], [mid, y + h], [x + w, y + h]];
      points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      return { open: true, points };
    }
    case 'curvedConnector2':
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5': {
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + w / 2, y, x + w / 2, y + h, x + w, y + h);
      return { open: true, points: [[x, y], [x + w, y + h]] };
    }

    case 'ellipse':
    case 'oval':
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      break;

    case 'roundRect':
    case 'flowChartAlternateProcess': {
      const r = Math.min(Math.abs(w), Math.abs(h)) * Math.min(0.5, adj ?? 0.16667);
      ctx.roundRect(x, y, w, h, r);
      break;
    }
    case 'flowChartTerminator':
      ctx.roundRect(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) / 2);
      break;

    case 'triangle':
    case 'isosTriangle':
      polygon(ctx, [[x + w * (adj ?? 0.5), y], [x + w, y + h], [x, y + h]]);
      break;
    case 'rtTriangle':
      polygon(ctx, [[x, y], [x + w, y + h], [x, y + h]]);
      break;
    case 'parallelogram': {
      const skew = w * Math.min(0.5, adj ?? 0.25);
      polygon(ctx, [[x + skew, y], [x + w, y], [x + w - skew, y + h], [x, y + h]]);
      break;
    }
    case 'trapezoid': {
      const inset = Math.min(w, h) * Math.min(0.5, adj ?? 0.25);
      polygon(ctx, [[x + inset, y], [x + w - inset, y], [x + w, y + h], [x, y + h]]);
      break;
    }
    case 'diamond':
    case 'flowChartDecision':
      polygon(ctx, [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);
      break;
    case 'pentagon':
      regularPolygon(ctx, 5, x, y, w, h, -Math.PI / 2);
      break;
    case 'hexagon': {
      const inset = w * Math.min(0.5, adj ?? 0.25);
      polygon(ctx, [[x + inset, y], [x + w - inset, y], [x + w, y + h / 2], [x + w - inset, y + h], [x + inset, y + h], [x, y + h / 2]]);
      break;
    }
    case 'octagon': {
      const c = Math.min(w, h) * Math.min(0.5, adj ?? 0.29289);
      polygon(ctx, [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]]);
      break;
    }
    case 'homePlate': {
      const tip = Math.min(w, h) * (adj ?? 0.5);
      polygon(ctx, [[x, y], [x + w - tip, y], [x + w, y + h / 2], [x + w - tip, y + h], [x, y + h]]);
      break;
    }
    case 'chevron': {
      const tip = Math.min(w, h) * (adj ?? 0.5);
      polygon(ctx, [[x, y], [x + w - tip, y], [x + w, y + h / 2], [x + w - tip, y + h], [x, y + h], [x + tip, y + h / 2]]);
      break;
    }
    case 'rightArrow':
    case 'leftArrow': {
      const body = (adj ?? 0.5) * h; // shaft thickness
      const head = Math.min(h, w) * 0.5;
      const top = y + (h - body) / 2;
      const pts = [[x, top], [x + w - head, top], [x + w - head, y], [x + w, y + h / 2], [x + w - head, y + h], [x + w - head, top + body], [x, top + body]];
      polygon(ctx, geometry === 'leftArrow' ? pts.map(([px, py]) => [x + w - (px - x), py]) : pts);
      break;
    }
    case 'upArrow':
    case 'downArrow': {
      const body = (adj ?? 0.5) * w;
      const head = Math.min(h, w) * 0.5;
      const left = x + (w - body) / 2;
      const pts = [[left, y + h], [left, y + head], [x, y + head], [x + w / 2, y], [x + w, y + head], [left + body, y + head], [left + body, y + h]];
      polygon(ctx, geometry === 'downArrow' ? pts.map(([px, py]) => [px, y + h - (py - y)]) : pts);
      break;
    }
    case 'plus': {
      const c = Math.min(w, h) * (adj ?? 0.25);
      polygon(ctx, [[x + c, y], [x + w - c, y], [x + w - c, y + c], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h - c], [x + w - c, y + h], [x + c, y + h], [x + c, y + h - c], [x, y + h - c], [x, y + c], [x + c, y + c]]);
      break;
    }
    case 'star4': case 'star5': case 'star6': case 'star8': case 'star10': case 'star12': {
      const points = parseInt(geometry.replace('star', ''), 10);
      const outer = Math.min(w, h) / 2;
      const inner = outer * (points === 4 ? 0.38 : 0.45);
      for (let i = 0; i < points * 2; i++) {
        const a = (i * Math.PI) / points - Math.PI / 2;
        const r = i % 2 === 0 ? outer : inner;
        const px = x + w / 2 + r * Math.cos(a);
        const py = y + h / 2 + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      // rect and any geometry we don't know → rectangle
      ctx.rect(x, y, w, h);
  }
  return { open: false };
}

const DASHES = {
  dash: [4, 3], sysDash: [3, 1], dot: [1, 2], sysDot: [1, 1], lgDash: [8, 3],
  dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], sysDashDot: [3, 1, 1, 1],
  lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

/** Strokes the current path with a model Line and draws arrowheads. */
function strokeLine(ctx, line, points, K) {
  const lw = Math.max(0.5, line.width * K);
  ctx.strokeStyle = line.color;
  ctx.lineWidth = lw;
  ctx.setLineDash((DASHES[line.dash] || []).map((d) => d * Math.max(lw, 1)));
  ctx.stroke();
  ctx.setLineDash([]);

  if (!points || points.length < 2) return;
  const sizeOf = (v) => ({ sm: 2, med: 3, lg: 5 }[v] || 3) * Math.max(lw, 1.5);
  const arrow = (end, from, to) => {
    if (!end) return;
    const len = sizeOf(end.len);
    const wid = sizeOf(end.w);
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    ctx.save();
    ctx.translate(to[0], to[1]);
    ctx.rotate(angle);
    ctx.fillStyle = line.color;
    ctx.beginPath();
    if (end.type === 'oval') {
      ctx.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
    } else if (end.type === 'diamond') {
      ctx.moveTo(len / 2, 0); ctx.lineTo(0, wid / 2); ctx.lineTo(-len / 2, 0); ctx.lineTo(0, -wid / 2); ctx.closePath();
    } else {
      ctx.moveTo(0, 0); ctx.lineTo(-len, wid / 2); ctx.lineTo(-len, -wid / 2); ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };
  const n = points.length;
  arrow(line.head, points[1], points[0]);
  arrow(line.tail, points[n - 2], points[n - 1]);
}

// ─── Text layout ──────────────────────────────────────────────────────────────

function fontString(sizePx, bold, italic, family) {
  return `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${sizePx}px "${family || 'Calibri'}", Calibri, Arial, sans-serif`;
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

function formatAutoNumber(n, type) {
  const alpha = (v) => {
    let s = '';
    for (let k = v; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return s;
  };
  const roman = (v) => {
    let s = '';
    for (const [val, sym] of ROMAN) while (v >= val) { s += sym; v -= val; }
    return s;
  };
  const t = type || 'arabicPeriod';
  let body;
  if (t.startsWith('alphaUc')) body = alpha(n).toUpperCase();
  else if (t.startsWith('alphaLc')) body = alpha(n);
  else if (t.startsWith('romanUc')) body = roman(n).toUpperCase();
  else if (t.startsWith('romanLc')) body = roman(n);
  else body = String(n);
  if (t.endsWith('ParenBoth')) return `(${body})`;
  if (t.endsWith('ParenR')) return `${body})`;
  if (t.endsWith('Plain')) return body;
  return `${body}.`;
}

/**
 * Lays out the paragraphs of a text block.
 * Returns lines positioned relative to the top of the text area.
 */
function layoutText(ctx, text, innerW, K, fontScale, lnReduction) {
  const lines = [];
  const counters = [];
  let y = 0;

  const spacingPx = (spc, sizePx) => {
    if (!spc) return 0;
    return spc.pts != null ? spc.pts * K : spc.pct * sizePx * LINE_HEIGHT;
  };

  text.paragraphs.forEach((p, pi) => {
    const marL = p.marL * K;
    const indent = p.indent * K;
    const visible = p.runs.some((r) => r.text.trim() !== '');

    // Auto-number bookkeeping: deeper levels restart after a shallower paragraph.
    for (let l = p.level + 1; l < counters.length; l++) counters[l] = undefined;
    let bulletLabel = null;
    if (p.bullet && visible) {
      if (p.bullet.kind === 'auto') {
        counters[p.level] = (counters[p.level] ?? (p.bullet.start || 1) - 1) + 1;
        bulletLabel = formatAutoNumber(counters[p.level], p.bullet.type);
      } else {
        counters[p.level] = undefined;
        bulletLabel = p.bullet.char;
      }
    } else {
      counters[p.level] = undefined;
    }

    // Tokenize runs into words / spaces / forced breaks.
    const tokens = [];
    for (const run of p.runs) {
      const scripted = run.baseline !== 0;
      const sizePx = run.size * fontScale * K * (scripted ? SCRIPT_SCALE : 1);
      const font = fontString(sizePx, run.bold, run.italic, run.font);
      ctx.font = font;
      run.text.split('\n').forEach((part, i) => {
        if (i > 0) tokens.push({ br: true, size: sizePx });
        for (const piece of part.split(/(\s+)/)) {
          if (!piece) continue;
          tokens.push({
            str: piece, space: /^\s+$/.test(piece), w: ctx.measureText(piece).width,
            font, size: sizePx, color: run.color, underline: run.underline, strike: run.strike,
            dy: scripted ? -run.baseline * run.size * fontScale * K : 0,
          });
        }
      });
    }

    const firstSize = (tokens.find((t) => !t.br) || { size: p.endSize * fontScale * K }).size;
    const bulletW = bulletLabel ? firstSize * 0.9 : 0;
    const bulletX = marL + indent;
    const textStartFirst = bulletLabel ? Math.max(marL, bulletX + bulletW) : marL + indent;

    if (pi > 0) y += spacingPx(p.spcBef, firstSize);

    const paraLines = [];
    const newLine = () => ({ tokens: [], w: 0, size: 0, hasWord: false });
    let cur = newLine();
    const availFor = (isFirst) => Math.max(1, innerW - (isFirst ? textStartFirst : marL));
    for (const tok of tokens) {
      if (tok.br) {
        cur.size = Math.max(cur.size, tok.size);
        paraLines.push(cur);
        cur = newLine();
        continue;
      }
      if (tok.space) {
        if (cur.hasWord || paraLines.length === 0) {
          cur.tokens.push(tok);
          cur.w += tok.w;
        }
        continue;
      }
      const wraps = text.bodyPr.wrap !== false;
      if (wraps && cur.hasWord && cur.w + tok.w > availFor(paraLines.length === 0)) {
        while (cur.tokens.length && cur.tokens[cur.tokens.length - 1].space) cur.w -= cur.tokens.pop().w;
        paraLines.push(cur);
        cur = newLine();
      }
      cur.tokens.push(tok);
      cur.w += tok.w;
      cur.hasWord = true;
      cur.size = Math.max(cur.size, tok.size);
    }
    paraLines.push(cur);

    paraLines.forEach((line, li) => {
      const size = line.size || p.endSize * fontScale * K;
      let box;
      if (p.lnSpc?.pts != null) box = p.lnSpc.pts * K;
      else box = size * LINE_HEIGHT * Math.max(0.3, (p.lnSpc?.pct ?? 1) - lnReduction);
      const isFirst = li === 0;
      lines.push({
        tokens: line.tokens, w: line.w, size, top: y, box,
        baseline: y + box - size * DESCENT,
        x0: isFirst ? textStartFirst : marL,
        avail: availFor(isFirst),
        align: p.align,
        last: li === paraLines.length - 1,
        bullet: isFirst && bulletLabel ? { label: bulletLabel, x: bulletX, def: p.bullet, run: p.runs[0], size: firstSize } : null,
      });
      y += box;
    });
    y += spacingPx(p.spcAft, firstSize);
  });

  return { lines, height: y };
}

/** Draws a text block inside the box (x, y, w, h) in current-transform pixels. */
function drawTextBlock(ctx, text, x, y, w, h, K) {
  if (!text?.paragraphs?.length || w <= 0) return;
  const { l, t, r, b, anchor, autofit, fontScale: given, lnSpcReduction } = text.bodyPr;
  const innerW = Math.max(1, w - (l + r) * K);
  const innerH = h - (t + b) * K;

  let layout;
  if (autofit === 'norm' && given == null) {
    // No stored scale: shrink until the text fits (down to 50%).
    let scale = 1;
    layout = layoutText(ctx, text, innerW, K, scale, 0);
    while (layout.height > innerH && scale > 0.5) {
      scale -= 0.1;
      layout = layoutText(ctx, text, innerW, K, scale, scale < 0.9 ? 0.1 : 0);
    }
  } else {
    layout = layoutText(ctx, text, innerW, K, autofit === 'norm' ? given : 1, autofit === 'norm' ? lnSpcReduction : 0);
  }

  const offsetY = anchor === 'ctr' ? (innerH - layout.height) / 2 : anchor === 'b' ? innerH - layout.height : 0;
  const left = x + l * K;
  const top = y + t * K + offsetY;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  for (const line of layout.lines) {
    const base = top + line.baseline;

    if (line.bullet) {
      const { run, def, label, size } = line.bullet;
      const bSize = size * (def.size || 1);
      ctx.font = fontString(bSize, false, false, def.kind === 'auto' ? run?.font : 'Arial');
      ctx.fillStyle = def.color || run?.color || '#000000';
      ctx.fillText(label, left + line.bullet.x, base);
    }
    if (!line.tokens.length) continue;

    const spaces = line.tokens.filter((tk) => tk.space).length;
    const justify = (line.align === 'just' || line.align === 'dist') && !line.last && spaces > 0;
    const extra = justify ? Math.max(0, (line.avail - line.w) / spaces) : 0;

    let cx = left + line.x0;
    if (line.align === 'ctr') cx += (line.avail - line.w) / 2;
    else if (line.align === 'r') cx += line.avail - line.w;

    for (const tok of line.tokens) {
      if (!tok.space) {
        ctx.font = tok.font;
        ctx.fillStyle = tok.color;
        ctx.fillText(tok.str, cx, base + tok.dy);
        if (tok.underline || tok.strike) {
          ctx.strokeStyle = tok.color;
          ctx.lineWidth = Math.max(0.5, tok.size / 18);
          const ly = tok.underline ? base + tok.dy + tok.size * 0.1 : base + tok.dy - tok.size * 0.3;
          ctx.beginPath();
          ctx.moveTo(cx, ly);
          ctx.lineTo(cx + tok.w, ly);
          ctx.stroke();
        }
      }
      cx += tok.w + (tok.space ? extra : 0);
    }
  }
  ctx.restore();
}

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** Sets canvas shadow state from a model shadow (restored by the caller's ctx.restore()). */
function applyShadow(ctx, shadow, K, hasContent) {
  if (!shadow || !hasContent) return;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * K;
  ctx.shadowOffsetX = shadow.dx * K;
  ctx.shadowOffsetY = shadow.dy * K;
}

function drawShape(ctx, s, K) {
  const w = s.w * K;
  const h = s.h * K;
  ctx.save();
  ctx.translate(s.x * K + w / 2, s.y * K + h / 2);
  if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);

  // Geometry is flipped; text is not (PowerPoint doesn't mirror text on flipH).
  ctx.save();
  if (s.flipH) ctx.scale(-1, 1);
  if (s.flipV) ctx.scale(1, -1);

  const path = buildPath(ctx, s.geometry, -w / 2, -h / 2, w, h, s.adj, s.custom);
  applyShadow(ctx, s.shadow, K, (!path.open && s.fill?.type !== 'none') || !!s.line);
  if (!path.open) {
    const style = fillStyleFor(ctx, s.fill, -w / 2, -h / 2, w, h);
    if (style) {
      ctx.fillStyle = style;
      ctx.fill();
    } else if (s.fill?.type === 'image') {
      const img = loadedImage(s.fill.loadBlob);
      if (img) {
        ctx.save();
        ctx.clip();
        blit(ctx, img, s.fill.crop, -w / 2, -h / 2, w, h);
        ctx.restore();
        buildPath(ctx, s.geometry, -w / 2, -h / 2, w, h, s.adj, s.custom);
      }
    }
  }
  if (s.line) strokeLine(ctx, s.line, path.points, K);
  ctx.restore();

  if (s.text) drawTextBlock(ctx, s.text, -w / 2, -h / 2, w, h, K);
  ctx.restore();
}

function drawImageShape(ctx, s, K) {
  const w = s.w * K;
  const h = s.h * K;
  const img = loadedImage(s.loadBlob);
  if (!img) return;

  ctx.save();
  ctx.translate(s.x * K + w / 2, s.y * K + h / 2);
  if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
  if (s.flipH) ctx.scale(-1, 1);
  if (s.flipV) ctx.scale(1, -1);

  if (s.geometry && s.geometry !== 'rect') {
    buildPath(ctx, s.geometry, -w / 2, -h / 2, w, h, s.adj);
    ctx.clip();
  }
  applyShadow(ctx, s.shadow, K, true);
  blit(ctx, img, s.crop, -w / 2, -h / 2, w, h);
  ctx.shadowColor = 'transparent'; // the outline should not cast its own shadow

  if (s.line) {
    buildPath(ctx, s.geometry || 'rect', -w / 2, -h / 2, w, h, s.adj);
    strokeLine(ctx, s.line, null, K);
  }
  ctx.restore();
}

function drawTable(ctx, s, K) {
  const { rows, colWidths } = s;
  const total = colWidths.reduce((a, b) => a + b, 0);
  const colScale = total > 0 && s.w > 0 ? s.w / total : 1;
  const colW = colWidths.map((cw) => cw * colScale * K);
  const rowH = rows.map((r) => r.h * K);
  const sum = (arr, from, count) => arr.slice(from, from + count).reduce((a, b) => a + b, 0);

  let rowY = s.y * K;
  rows.forEach((row, ri) => {
    let colX = s.x * K;
    row.cells.forEach((cell, ci) => {
      const cw = sum(colW, ci, cell.gridSpan);
      const ch = sum(rowH, ri, cell.rowSpan);
      if (!cell.hMerge && !cell.vMerge) {
        const style = fillStyleFor(ctx, cell.fill, colX, rowY, cw, ch);
        if (style) {
          ctx.fillStyle = style;
          ctx.fillRect(colX, rowY, cw, ch);
        }

        if (cell.borders) {
          const sides = {
            l: [colX, rowY, colX, rowY + ch], r: [colX + cw, rowY, colX + cw, rowY + ch],
            t: [colX, rowY, colX + cw, rowY], b: [colX, rowY + ch, colX + cw, rowY + ch],
          };
          for (const [side, [x1, y1, x2, y2]] of Object.entries(sides)) {
            const line = cell.borders[side];
            if (!line) continue;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            strokeLine(ctx, line, null, K);
          }
        } else {
          ctx.strokeStyle = '#d0d0d0';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(colX, rowY, cw, ch);
        }

        drawTextBlock(ctx, cell.text, colX, rowY, cw, ch, K);
      }
      colX += colW[ci] || 0;
    });
    rowY += rowH[ri];
  });
}

function drawGroup(ctx, s, K) {
  ctx.save();
  const cx = (s.x + s.w / 2) * K;
  const cy = (s.y + s.h / 2) * K;
  ctx.translate(cx, cy);
  if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
  if (s.flipH) ctx.scale(-1, 1);
  if (s.flipV) ctx.scale(1, -1);
  ctx.translate(-cx, -cy);
  for (const child of s.shapes || []) drawShapeDispatch(ctx, child, K);
  ctx.restore();
}

// Ids of animated shapes that are hidden in the build step being drawn.
// Set only for the duration of one (synchronous) slide draw.
let hiddenNow = null;

function drawShapeDispatch(ctx, s, K) {
  if (!s) return;
  if (s.id != null && hiddenNow?.has(s.id)) return;
  try {
    switch (s.type) {
      case 'shape': drawShape(ctx, s, K); break;
      case 'image': drawImageShape(ctx, s, K); break;
      case 'table': drawTable(ctx, s, K); break;
      case 'chart': drawChart(ctx, s, K); break;
      case 'group': drawGroup(ctx, s, K); break;
      case 'unsupported':
        drawFallbackBadge(ctx, s.x * K, s.y * K, s.w * K, s.h * K, s.label || 'Unknown');
        break;
      default: break;
    }
  } catch (err) {
    // One bad shape must never take down the whole slide.
    console.warn('[Opendeck] Shape render error:', err, s);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Number of clicks needed to play all of a slide's builds (0 = not animated). */
export function animationStepCount(slide) {
  return slide.animation?.clickSteps.length ?? 0;
}

/**
 * Ids of the shapes hidden after `step` clicks (0 = slide just appeared).
 * `step` undefined means "no animation": everything is shown, like a static view.
 */
function hiddenIdsFor(slide, step) {
  const anim = slide.animation;
  if (!anim || step === undefined) return null;
  const hidden = new Set(anim.initialHidden);
  for (const effects of anim.clickSteps.slice(0, step)) {
    for (const { id, show } of effects) {
      if (show) hidden.delete(id);
      else hidden.add(id);
    }
  }
  return hidden;
}

const RENDER_CACHE_LIMIT = 8;
const renderCache = new Map(); // key → finished off-screen canvas (insertion order = LRU)
const slideIds = new WeakMap();
let nextSlideId = 1;

function cacheKey(slide, scale, dpr, step) {
  if (!slideIds.has(slide)) slideIds.set(slide, nextSlideId++);
  return `${slideIds.get(slide)}|${scale}|${dpr}|${step ?? 'all'}`;
}

/** Draws a whole slide into a new off-screen canvas. Synchronous: images must be preloaded. */
function drawSlideOffscreen(slide, scale, dpr, step) {
  const { width, height, background, shapes } = slide;
  const cssW = width * scale;
  const cssH = height * scale;
  if (cssW > 32767 || cssH > 32767 || cssW * dpr > 268000000 || cssH * dpr > 268000000) {
    throw new Error(`Slide canvas is too large: ${Math.round(cssW)}×${Math.round(cssH)}px`);
  }

  const off = document.createElement('canvas');
  off.width = Math.round(cssW * dpr);
  off.height = Math.round(cssH * dpr);
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');
  ctx.scale(dpr, dpr); // all drawing below is in CSS pixels

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  const bgStyle = fillStyleFor(ctx, background, 0, 0, cssW, cssH);
  if (bgStyle) {
    ctx.fillStyle = bgStyle;
    ctx.fillRect(0, 0, cssW, cssH);
  } else if (background?.type === 'image') {
    const img = loadedImage(background.loadBlob);
    if (img) blit(ctx, img, background.crop, 0, 0, cssW, cssH);
  }

  hiddenNow = hiddenIdsFor(slide, step);
  try {
    for (const shape of shapes || []) drawShapeDispatch(ctx, shape, scale); // z-order = array order
  } finally {
    hiddenNow = null;
  }
  return off;
}

/** Copies a finished off-screen slide onto the visible canvas in one step. */
function commit(canvas, off, scale, slide) {
  canvas.width = off.width; // resizing clears the canvas, but we redraw in the same task,
  canvas.height = off.height; // so the browser never paints the blank state
  canvas.style.width = `${slide.width * scale}px`;
  canvas.style.height = `${slide.height * scale}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');
  ctx.drawImage(off, 0, 0);
}

/**
 * Renders a SlideModel onto a canvas at the given scale and device pixel ratio.
 *
 * The slide is only ever shown complete: all images are decoded first, the slide
 * is drawn off-screen, and the result replaces the canvas contents in one step.
 * Until then the canvas keeps showing whatever it showed before.
 *
 * @param {SlideModel} slideModel
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale  CSS pixels per point (1 = 1pt = 1px)
 * @param {number} [dpr]  defaults to window.devicePixelRatio
 * @param {{ signal?: AbortSignal, cache?: boolean, step?: number }} [options]
 *        signal: abandon the render (canvas untouched) if aborted;
 *        cache: keep the finished slide so showing it again is instant;
 *        step: draw the slide after this many animation clicks (0 = as it first
 *        appears); omit to draw every shape, as a static view does
 * @returns {Promise<boolean>} true if the canvas was updated, false if aborted
 */
export async function renderSlide(
  slideModel, canvas, scale = 1, dpr = window.devicePixelRatio || 1, { signal, cache = false, step } = {},
) {
  const { width, height } = slideModel;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid slide dimensions: ${width}×${height}`);
  }
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(dpr) || dpr <= 0) {
    throw new Error(`Invalid canvas scale: ${scale} (DPR ${dpr})`);
  }

  const key = cache ? cacheKey(slideModel, scale, dpr, step) : null;
  let off = key ? renderCache.get(key) : null;

  if (!off) {
    if (signal?.aborted) return false;
    await preloadSlideImages(slideModel);
    if (signal?.aborted) return false;
    off = drawSlideOffscreen(slideModel, scale, dpr, step);
    if (key) {
      renderCache.set(key, off);
      while (renderCache.size > RENDER_CACHE_LIMIT) renderCache.delete(renderCache.keys().next().value);
    }
  } else if (key) {
    renderCache.delete(key); // refresh LRU position
    renderCache.set(key, off);
  }

  if (signal?.aborted) return false;
  commit(canvas, off, scale, slideModel);
  return true;
}
