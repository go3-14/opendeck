// src/renderer/render-canvas.js
// Draws a SlideModel (from parse-slide.js) onto an HTML <canvas>.
//
// export async function renderSlide(slideModel, canvas, scale, dpr) → void
//
// `scale` is CSS pixels per point. All model coordinates are in points.

import { drawFallbackBadge } from './fallback-notice.js';

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

const imageCache = new WeakMap(); // loadBlob function → Promise<HTMLImageElement|null>

/** Decodes the image behind a lazy media loader (cached per loader). */
function loadImage(loadBlob) {
  if (!loadBlob) return Promise.resolve(null);
  if (imageCache.has(loadBlob)) return imageCache.get(loadBlob);

  const pending = loadBlob()
    .then(
      (blob) =>
        new Promise((resolve) => {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolve(value);
          };
          const timer = setTimeout(() => finish(null), 10000); // never hang a render
          img.onload = () => finish(img);
          img.onerror = () => finish(null);
          img.src = url;
        }),
    )
    .catch(() => null);
  imageCache.set(loadBlob, pending);
  return pending;
}

/** Draws an image into (x, y, w, h), optionally cropping with fractions {l,t,r,b}. */
function blit(ctx, img, crop, x, y, w, h) {
  if (!crop) {
    ctx.drawImage(img, x, y, w, h);
    return;
  }
  const sx = crop.l * img.naturalWidth;
  const sy = crop.t * img.naturalHeight;
  const sw = img.naturalWidth * (1 - crop.l - crop.r);
  const sh = img.naturalHeight * (1 - crop.t - crop.b);
  if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
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

/**
 * Builds the path for a preset geometry.
 * @returns {{ open: boolean, points?: number[][] }}  open = line-like (no fill);
 *          points = polyline used to orient arrowheads.
 */
function buildPath(ctx, geometry, x, y, w, h, adj) {
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

async function drawShape(ctx, s, K) {
  const w = s.w * K;
  const h = s.h * K;
  ctx.save();
  ctx.translate(s.x * K + w / 2, s.y * K + h / 2);
  if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);

  // Geometry is flipped; text is not (PowerPoint doesn't mirror text on flipH).
  ctx.save();
  if (s.flipH) ctx.scale(-1, 1);
  if (s.flipV) ctx.scale(1, -1);

  const path = buildPath(ctx, s.geometry, -w / 2, -h / 2, w, h, s.adj);
  if (!path.open) {
    const style = fillStyleFor(ctx, s.fill, -w / 2, -h / 2, w, h);
    if (style) {
      ctx.fillStyle = style;
      ctx.fill();
    } else if (s.fill?.type === 'image') {
      const img = await loadImage(s.fill.loadBlob);
      if (img) {
        ctx.save();
        ctx.clip();
        blit(ctx, img, s.fill.crop, -w / 2, -h / 2, w, h);
        ctx.restore();
        buildPath(ctx, s.geometry, -w / 2, -h / 2, w, h, s.adj);
      }
    }
  }
  if (s.line) strokeLine(ctx, s.line, path.points, K);
  ctx.restore();

  if (s.text) drawTextBlock(ctx, s.text, -w / 2, -h / 2, w, h, K);
  ctx.restore();
}

async function drawImageShape(ctx, s, K) {
  const w = s.w * K;
  const h = s.h * K;
  const img = await loadImage(s.loadBlob);
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
  blit(ctx, img, s.crop, -w / 2, -h / 2, w, h);

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

async function drawGroup(ctx, s, K) {
  ctx.save();
  const cx = (s.x + s.w / 2) * K;
  const cy = (s.y + s.h / 2) * K;
  ctx.translate(cx, cy);
  if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
  if (s.flipH) ctx.scale(-1, 1);
  if (s.flipV) ctx.scale(1, -1);
  ctx.translate(-cx, -cy);
  for (const child of s.shapes || []) await drawShapeDispatch(ctx, child, K);
  ctx.restore();
}

async function drawShapeDispatch(ctx, s, K) {
  if (!s) return;
  try {
    switch (s.type) {
      case 'shape': await drawShape(ctx, s, K); break;
      case 'image': await drawImageShape(ctx, s, K); break;
      case 'table': drawTable(ctx, s, K); break;
      case 'group': await drawGroup(ctx, s, K); break;
      case 'unsupported':
        drawFallbackBadge(ctx, s.x * K, s.y * K, s.w * K, s.h * K, s.label || 'Unknown');
        break;
      default: break;
    }
  } catch (err) {
    // One bad shape must never take down the whole slide.
    console.warn('[PPTX Viewer] Shape render error:', err, s);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a SlideModel onto a canvas at the given scale and device pixel ratio.
 *
 * @param {SlideModel} slideModel
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale  CSS pixels per point (1 = 1pt = 1px)
 * @param {number} [dpr]  defaults to window.devicePixelRatio
 */
export async function renderSlide(slideModel, canvas, scale = 1, dpr = window.devicePixelRatio || 1) {
  const { width, height, background, shapes } = slideModel;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid slide dimensions: ${width}×${height}`);
  }
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(dpr) || dpr <= 0) {
    throw new Error(`Invalid canvas scale: ${scale} (DPR ${dpr})`);
  }

  const cssW = width * scale;
  const cssH = height * scale;
  if (cssW > 32767 || cssH > 32767 || cssW * dpr > 268000000 || cssH * dpr > 268000000) {
    throw new Error(`Slide canvas is too large: ${Math.round(cssW)}×${Math.round(cssH)}px`);
  }
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');
  ctx.scale(dpr, dpr); // all drawing below is in CSS pixels

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  const bgStyle = fillStyleFor(ctx, background, 0, 0, cssW, cssH);
  if (bgStyle) {
    ctx.fillStyle = bgStyle;
    ctx.fillRect(0, 0, cssW, cssH);
  } else if (background?.type === 'image') {
    const img = await loadImage(background.loadBlob);
    if (img) blit(ctx, img, background.crop, 0, 0, cssW, cssH);
  }

  // Shapes in z-order (array order)
  for (const shape of shapes || []) await drawShapeDispatch(ctx, shape, scale);
}
