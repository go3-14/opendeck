// src/renderer/render-chart.js
// Draws a ChartModel (see parse-chart.js) inside a slide shape's box.
//
// export function drawChart(ctx, shape, scale)

const FONT = 'Calibri, Arial, sans-serif';
const TEXT = '#595959';
const TITLE = '#262626';
const GRID = '#d9d9d9';
const AXIS = '#bfbfbf';

/** "Nice" axis limits and step covering [min, max] with about `target` ticks. */
function niceScale(min, max, target = 5) {
  if (min === max) max = min + 1;
  const rough = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const frac = rough / pow;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

function formatNumber(n) {
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return String(+n.toFixed(2));
}

const font = (px, bold = false) => `${bold ? '700 ' : ''}${px}px ${FONT}`;

/** Value range across all cartesian groups, honouring stacking. */
function valueRange(groups, chart) {
  let lo = 0;
  let hi = 0;
  let seenAny = false;
  for (const g of groups) {
    const n = Math.max(...g.series.map((s) => s.values.length), 0);
    if (g.grouping === 'percentStacked') {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 1);
      seenAny = true;
    } else if (g.grouping === 'stacked' && g.kind !== 'line') {
      for (let i = 0; i < n; i++) {
        let pos = 0;
        let neg = 0;
        for (const s of g.series) {
          const v = s.values[i];
          if (v == null) continue;
          if (v >= 0) pos += v; else neg += v;
        }
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
        seenAny = true;
      }
    } else {
      for (const s of g.series) {
        for (const v of s.values) {
          if (v == null) continue;
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
          seenAny = true;
        }
      }
    }
  }
  if (!seenAny) hi = 1;
  return {
    min: chart.valueMin ?? lo,
    max: chart.valueMax ?? hi,
  };
}

// ─── Pie / doughnut ───────────────────────────────────────────────────────────

function drawPie(ctx, chart, group, area, fs) {
  const series = group.series[0];
  const values = series.values.map((v) => (v != null && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return;

  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const radius = Math.max(1, Math.min(area.w, area.h) / 2 * 0.92);
  const hole = group.kind === 'doughnut' ? radius * (group.holeSize / 100) : 0;
  let angle = ((group.firstAngle - 90) * Math.PI) / 180;

  values.forEach((v, i) => {
    if (v <= 0) return;
    const sweep = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * hole, cy + Math.sin(angle) * hole);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    if (hole) ctx.arc(cx, cy, hole, angle + sweep, angle, true);
    else ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fillStyle = series.pointColors[i] || chart.palette[i % chart.palette.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, fs / 8);
    ctx.stroke();

    const labels = series.labels;
    if (labels) {
      const parts = [];
      if (labels.category && series.categories[i] != null) parts.push(series.categories[i]);
      if (labels.value) parts.push(formatNumber(v));
      if (labels.percent) parts.push(`${Math.round((v / total) * 100)}%`);
      if (parts.length && sweep > 0.15) {
        const mid = angle + sweep / 2;
        const r = hole ? (radius + hole) / 2 : radius * 0.65;
        ctx.fillStyle = '#ffffff';
        ctx.font = font(fs, true);
        ctx.textAlign = 'center';
        ctx.fillText(parts.join(' '), cx + Math.cos(mid) * r, cy + Math.sin(mid) * r);
      }
    }
    angle += sweep;
  });
}

// ─── Bar / line / area ────────────────────────────────────────────────────────

function drawCartesian(ctx, chart, groups, area, fs) {
  const categories = groups.flatMap((g) => g.series.map((s) => s.categories)).reduce((a, b) => (b.length > a.length ? b : a), []);
  const n = Math.max(categories.length, ...groups.flatMap((g) => g.series.map((s) => s.values.length)));
  if (!n) return;

  const horizontal = groups.some((g) => g.kind === 'bar' && g.barDir === 'bar');
  const range = valueRange(groups, chart);
  const scale = niceScale(range.min, range.max);
  const lo = chart.valueMin ?? scale.min;
  const hi = chart.valueMax ?? scale.max;
  const ticks = [];
  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) ticks.push(+v.toFixed(10));

  const fmt = (v) => (groups.some((g) => g.grouping === 'percentStacked') ? `${Math.round(v * 100)}%` : formatNumber(v));

  // Reserve room for axis labels.
  ctx.font = font(fs);
  const valueLabelW = chart.showValueAxis ? Math.max(...ticks.map((t) => ctx.measureText(fmt(t)).width)) + fs * 0.8 : 0;
  const catLabelH = chart.showCategoryAxis ? fs * 1.9 : 0;
  const catLabelW = chart.showCategoryAxis ? Math.min(area.w * 0.3, Math.max(...categories.map((c) => ctx.measureText(String(c ?? '')).width), 0) + fs * 0.8) : 0;

  const plot = horizontal
    ? { x: area.x + catLabelW, y: area.y, w: area.w - catLabelW, h: area.h - (chart.showValueAxis ? fs * 1.9 : 0) }
    : { x: area.x + valueLabelW, y: area.y, w: area.w - valueLabelW, h: area.h - catLabelH };
  if (plot.w <= 0 || plot.h <= 0) return;

  const valueToPx = (v) => (horizontal
    ? plot.x + ((v - lo) / (hi - lo)) * plot.w
    : plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h);
  const slot = (horizontal ? plot.h : plot.w) / n;
  const catCenter = (i) => (horizontal ? plot.y + plot.h - (i + 0.5) * slot : plot.x + (i + 0.5) * slot);

  // Grid lines and value labels
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    if (t < lo - 1e-9 || t > hi + 1e-9) continue;
    const p = valueToPx(t);
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); }
    else { ctx.moveTo(plot.x, p); ctx.lineTo(plot.x + plot.w, p); }
    ctx.stroke();
    if (chart.showValueAxis) {
      ctx.fillStyle = TEXT;
      ctx.font = font(fs);
      if (horizontal) { ctx.textAlign = 'center'; ctx.fillText(fmt(t), p, plot.y + plot.h + fs * 1.1); }
      else { ctx.textAlign = 'right'; ctx.fillText(fmt(t), plot.x - fs * 0.4, p); }
    }
  }

  // Category axis line and labels
  const baseline = valueToPx(Math.max(lo, Math.min(0, hi)));
  ctx.strokeStyle = AXIS;
  ctx.beginPath();
  if (horizontal) { ctx.moveTo(baseline, plot.y); ctx.lineTo(baseline, plot.y + plot.h); }
  else { ctx.moveTo(plot.x, baseline); ctx.lineTo(plot.x + plot.w, baseline); }
  ctx.stroke();
  if (chart.showCategoryAxis) {
    ctx.fillStyle = TEXT;
    ctx.font = font(fs);
    const crowded = !horizontal && categories.some((c) => ctx.measureText(String(c ?? '')).width > slot * 0.95);
    categories.forEach((c, i) => {
      const label = String(c ?? '');
      if (horizontal) {
        ctx.textAlign = 'right';
        ctx.fillText(label, plot.x - fs * 0.4, catCenter(i));
      } else if (crowded) {
        ctx.save();
        ctx.translate(catCenter(i), plot.y + plot.h + fs * 0.6);
        ctx.rotate(-Math.PI / 6);
        ctx.textAlign = 'right';
        ctx.fillText(label, 0, fs * 0.5);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(label, catCenter(i), plot.y + plot.h + fs * 1.1);
      }
    });
  }

  // Series
  const barGroups = groups.filter((g) => g.kind === 'bar');
  const barSeriesCount = barGroups.reduce((a, g) => a + (g.grouping === 'clustered' || g.grouping === 'standard' ? g.series.length : 1), 0) || 1;
  let barIndex = 0;

  for (const g of groups) {
    const stacked = g.grouping === 'stacked' || g.grouping === 'percentStacked';
    const gap = g.gapWidth / 100;
    const cluster = slot / (1 + gap);

    if (g.kind === 'bar') {
      const barW = cluster / barSeriesCount;
      g.series.forEach((s, si) => {
        // Stacked groups share one position in the cluster; clustered ones take one per series.
        const k = stacked ? barIndex : barIndex + si;
        for (let i = 0; i < n; i++) {
          const v = s.values[i];
          if (v == null) continue;

          let start = 0;
          let end = v;
          if (stacked) {
            let before = 0;
            let total = 0;
            g.series.forEach((other, oi) => {
              const ov = other.values[i] ?? 0;
              total += Math.abs(ov);
              if (oi < si) before += ov;
            });
            if (g.grouping === 'percentStacked' && total) { start = before / total; end = (before + v) / total; }
            else { start = before; end = before + v; }
          }
          const a = valueToPx(start);
          const b = valueToPx(end);
          const centre = catCenter(i);

          ctx.fillStyle = s.pointColors[i] || (g.varyColors && g.series.length === 1 ? chart.palette[i % chart.palette.length] : s.color);
          if (horizontal) {
            const bottom = centre + cluster / 2 - k * barW; // first series sits lowest
            ctx.fillRect(Math.min(a, b), bottom - barW, Math.abs(b - a), barW);
            if (s.labels?.value) {
              ctx.fillStyle = TEXT;
              ctx.font = font(fs);
              ctx.textAlign = 'left';
              ctx.fillText(fmt(v), Math.max(a, b) + fs * 0.3, bottom - barW / 2);
            }
          } else {
            const left = centre - cluster / 2 + k * barW;
            ctx.fillRect(left, Math.min(a, b), barW, Math.abs(b - a));
            if (s.labels?.value) {
              ctx.fillStyle = TEXT;
              ctx.font = font(fs);
              ctx.textAlign = 'center';
              ctx.fillText(fmt(v), left + barW / 2, Math.min(a, b) - fs * 0.7);
            }
          }
        }
      });
      barIndex += stacked ? 1 : g.series.length;
    } else {
      // line / area
      g.series.forEach((s) => {
        const pts = [];
        for (let i = 0; i < n; i++) {
          const v = s.values[i];
          if (v != null) pts.push([catCenter(i), valueToPx(v), v]);
        }
        if (!pts.length) return;
        const at = (p) => (horizontal ? [p[1], p[0]] : [p[0], p[1]]);
        if (g.kind === 'area') {
          ctx.beginPath();
          ctx.moveTo(at([pts[0][0], baseline])[0], at([pts[0][0], baseline])[1]);
          for (const p of pts) ctx.lineTo(...at(p));
          ctx.lineTo(...at([pts[pts.length - 1][0], baseline]));
          ctx.closePath();
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = s.color;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(...at(p)) : ctx.moveTo(...at(p))));
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1.5, fs / 5);
        ctx.lineJoin = 'round';
        ctx.stroke();
        if (g.kind === 'line' && s.marker) {
          ctx.fillStyle = s.color;
          for (const p of pts) {
            ctx.beginPath();
            ctx.arc(...at(p), Math.max(2, fs / 4), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (s.labels?.value) {
          ctx.fillStyle = TEXT;
          ctx.font = font(fs);
          ctx.textAlign = 'center';
          for (const p of pts) ctx.fillText(fmt(p[2]), at(p)[0], at(p)[1] - fs * 0.8);
        }
      });
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function drawChart(ctx, shape, K) {
  const { chart } = shape;
  const x = shape.x * K;
  const y = shape.y * K;
  const w = shape.w * K;
  const h = shape.h * K;
  if (w <= 0 || h <= 0) return;

  const fs = Math.max(6 * K, Math.min(chart.fontPt * K, h / 12));
  const pad = fs * 0.6;
  const area = { x: x + pad, y: y + pad, w: w - 2 * pad, h: h - 2 * pad };

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.textBaseline = 'middle';

  // Title
  if (chart.title) {
    ctx.font = font(fs * 1.4);
    ctx.fillStyle = TITLE;
    ctx.textAlign = 'center';
    ctx.fillText(chart.title, x + w / 2, area.y + fs * 0.9, w - 2 * pad);
    area.y += fs * 2.2;
    area.h -= fs * 2.2;
  }

  const pie = chart.groups.find((g) => g.kind === 'pie' || g.kind === 'doughnut');

  // Legend: series names, or slice names for pie charts
  if (chart.legend) {
    const entries = pie
      ? pie.series[0].categories.map((c, i) => ({ label: String(c ?? ''), color: pie.series[0].pointColors[i] || chart.palette[i % chart.palette.length] }))
      : chart.groups.flatMap((g) => g.series).map((s) => ({ label: s.name, color: s.color }));
    ctx.font = font(fs);
    const swatch = fs * 0.9;
    const rowH = fs * 1.5;
    const textW = Math.max(0, ...entries.map((e) => ctx.measureText(e.label).width));
    const drawEntry = (e, ex, ey) => {
      ctx.fillStyle = e.color;
      ctx.fillRect(ex, ey - swatch / 2, swatch, swatch);
      ctx.fillStyle = TEXT;
      ctx.textAlign = 'left';
      ctx.fillText(e.label, ex + swatch + fs * 0.4, ey);
    };
    if (chart.legend === 'r' || chart.legend === 'l') {
      const boxW = swatch + fs * 0.4 + textW + fs;
      const lx = chart.legend === 'r' ? area.x + area.w - boxW : area.x;
      const top = area.y + (area.h - entries.length * rowH) / 2;
      entries.forEach((e, i) => drawEntry(e, lx, top + i * rowH + rowH / 2));
      if (chart.legend === 'r') area.w -= boxW + fs * 0.5;
      else { area.x += boxW + fs * 0.5; area.w -= boxW + fs * 0.5; }
    } else {
      const widths = entries.map((e) => swatch + fs * 0.4 + ctx.measureText(e.label).width + fs);
      const rowW = widths.reduce((a, b) => a + b, 0);
      let lx = area.x + (area.w - rowW) / 2;
      const ly = chart.legend === 'b' ? area.y + area.h - rowH / 2 : area.y + rowH / 2;
      entries.forEach((e, i) => { drawEntry(e, lx, ly); lx += widths[i]; });
      if (chart.legend === 'b') area.h -= rowH + fs * 0.3;
      else { area.y += rowH + fs * 0.3; area.h -= rowH + fs * 0.3; }
    }
  }

  if (pie) drawPie(ctx, chart, pie, area, fs);
  else drawCartesian(ctx, chart, chart.groups.filter((g) => g.kind === 'bar' || g.kind === 'line' || g.kind === 'area'), area, fs);

  ctx.restore();
}
