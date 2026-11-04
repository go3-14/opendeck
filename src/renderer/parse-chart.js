// src/renderer/parse-chart.js
// Reads a DrawingML chart part (ppt/charts/chartN.xml) into a small model that
// render-chart.js can draw. Values come from the cached data stored in the
// chart itself, so the embedded workbook is never needed.
//
// Supported: clustered/stacked/percent bar and column, line, area, pie and
// doughnut charts (several of these can be combined on one set of axes).
//
// ChartModel = {
//   palette: string[] (accent colours, for pie slices),
//   title: string|null, legend: 'r'|'b'|'t'|'l'|null, fontPt: number,
//   valueMin: number|null, valueMax: number|null, showValueAxis, showCategoryAxis,
//   groups: [{ kind, barDir, grouping, gapWidth, overlap, holeSize, firstAngle,
//              series: [{ name, color, pointColors, categories, values, labels, marker }] }]
// }

import { resolveColorEl } from './color.js';
import { child, children, findFirst, intAttr, parseXml } from './xml.js';

const KINDS = {
  barChart: 'bar', bar3DChart: 'bar',
  lineChart: 'line', line3DChart: 'line',
  areaChart: 'area', area3DChart: 'area',
  pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie',
  doughnutChart: 'doughnut',
};

const valAttr = (el, fallback = null) => el?.getAttribute('val') ?? fallback;
const isOn = (el) => el != null && ['1', 'true'].includes(el.getAttribute('val') ?? '1');

/** Text of a <c:tx> / <c:title>: all <a:t> runs joined, or the cached string. */
function textOf(el) {
  if (!el) return '';
  const runs = [];
  for (const t of el.getElementsByTagName('*')) if (t.localName === 't') runs.push(t.textContent);
  if (runs.length) return runs.join('');
  return findFirst(el, 'v')?.textContent ?? '';
}

/** Cached points of a <c:cat> / <c:val> as an array (null for missing points). */
function cachedPoints(refEl, numeric) {
  const cache = ['numCache', 'strCache', 'numLit', 'strLit'].map((t) => findFirst(refEl, t)).find(Boolean);
  if (!cache) return [];
  const count = intAttr(child(cache, 'ptCount'), 'val', 0);
  const out = new Array(count).fill(null);
  for (const pt of children(cache, 'pt')) {
    const idx = intAttr(pt, 'idx', -1);
    const raw = child(pt, 'v')?.textContent ?? '';
    if (idx < 0) continue;
    if (idx >= out.length) out.length = idx + 1;
    out[idx] = numeric ? (Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : null) : raw;
  }
  return out;
}

/** First solid colour of a <c:spPr>: the fill, or the line when `useLine`. */
function spPrColor(spPr, theme, useLine) {
  if (!spPr) return null;
  const holder = useLine ? child(spPr, 'ln') : spPr;
  const fill = child(holder, 'solidFill');
  return fill ? resolveColorEl(fill.firstElementChild, theme) : null;
}

function labelFlags(dLbls) {
  if (!dLbls) return null;
  const flags = {
    value: isOn(child(dLbls, 'showVal')),
    percent: isOn(child(dLbls, 'showPercent')),
    category: isOn(child(dLbls, 'showCatName')),
  };
  return flags.value || flags.percent || flags.category ? flags : null;
}

function parseGroup(el, kind, theme, firstSeriesIndex) {
  const group = {
    kind,
    barDir: valAttr(child(el, 'barDir'), 'col'),
    grouping: valAttr(child(el, 'grouping'), kind === 'bar' ? 'clustered' : 'standard'),
    gapWidth: intAttr(child(el, 'gapWidth'), 'val', 150),
    overlap: intAttr(child(el, 'overlap'), 'val', 0),
    holeSize: intAttr(child(el, 'holeSize'), 'val', 50),
    firstAngle: intAttr(child(el, 'firstSliceAng'), 'val', 0),
    varyColors: isOn(child(el, 'varyColors')),
    series: [],
  };
  const groupLabels = labelFlags(child(el, 'dLbls'));

  children(el, 'ser').forEach((ser, i) => {
    const spPr = child(ser, 'spPr');
    const accent = theme.resolveColor(`accent${((firstSeriesIndex + i) % 6) + 1}`);
    const color = spPrColor(spPr, theme, kind === 'line') || accent;

    const pointColors = {};
    for (const dPt of children(ser, 'dPt')) {
      const c = spPrColor(child(dPt, 'spPr'), theme, false);
      if (c) pointColors[intAttr(child(dPt, 'idx'), 'val', -1)] = c;
    }

    const marker = valAttr(child(child(ser, 'marker'), 'symbol'), 'circle') !== 'none';
    group.series.push({
      name: textOf(child(ser, 'tx')),
      color,
      pointColors,
      categories: cachedPoints(child(ser, 'cat'), false),
      values: cachedPoints(child(ser, 'val'), true),
      labels: labelFlags(child(ser, 'dLbls')) || groupLabels,
      marker,
    });
  });
  return group;
}

/**
 * @param {string} chartXml
 * @param {ThemeContext} theme
 * @returns {ChartModel|null}  null when there is nothing we can draw
 */
export function parseChart(chartXml, theme) {
  const doc = parseXml(chartXml);
  const chartEl = findFirst(doc, 'chart');
  const plot = child(chartEl, 'plotArea');
  if (!plot) return null;

  const groups = [];
  let seriesIndex = 0;
  for (const el of plot.children) {
    const kind = KINDS[el.localName];
    if (!kind) continue;
    const group = parseGroup(el, kind, theme, seriesIndex);
    seriesIndex += group.series.length;
    if (group.series.length) groups.push(group);
  }
  if (!groups.length) return null;

  // A <c:title> without text of its own shows the series name for single-series charts.
  let title = null;
  const titleEl = child(chartEl, 'title');
  if (titleEl && !isOn(child(chartEl, 'autoTitleDeleted'))) {
    title = textOf(child(titleEl, 'tx')) || (groups.length === 1 && groups[0].series.length === 1 ? groups[0].series[0].name : null);
  } else if (titleEl) {
    title = textOf(child(titleEl, 'tx')) || null;
  }

  const valAx = child(plot, 'valAx');
  const scaling = child(valAx, 'scaling');
  const num = (el) => (el ? parseFloat(valAttr(el)) : null);

  const defRPr = findFirst(child(doc.documentElement, 'txPr'), 'defRPr');
  return {
    title: title || null,
    legend: child(chartEl, 'legend') ? valAttr(child(child(chartEl, 'legend'), 'legendPos'), 'r') : null,
    fontPt: defRPr?.hasAttribute('sz') ? intAttr(defRPr, 'sz', 1000) / 100 : 10,
    valueMin: num(child(scaling, 'min')),
    valueMax: num(child(scaling, 'max')),
    showValueAxis: !isOn(child(valAx, 'delete')),
    showCategoryAxis: !isOn(child(child(plot, 'catAx'), 'delete')),
    palette: [1, 2, 3, 4, 5, 6].map((i) => theme.resolveColor(`accent${i}`)),
    groups,
  };
}
