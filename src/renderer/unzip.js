// src/renderer/unzip.js
// Extracts the parts of a PPTX (a ZIP of XML + media) that the renderer needs,
// and resolves the relationships between them.
//
// export async function unzipPptx(arrayBuffer) → see the @returns below

import JSZip from 'jszip';
import { parseXml } from './xml.js';

// Only raster/SVG images the browser can decode. PPTX files commonly contain
// large video/audio parts under ppt/media that must never be read.
const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** Sorts names by their trailing number: slide2.xml < slide10.xml. */
function sortByIndex(names) {
  const num = (s) => parseInt(s.match(/(\d+)\.xml$/)?.[1] ?? '0', 10);
  return [...names].sort((a, b) => num(a) - num(b));
}

const readText = (entry) => entry.async('text');

/** Resolves a relationship Target against the part that owns it. */
function resolveTarget(partPath, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = partPath.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** "ppt/slides/slide1.xml" → "ppt/slides/_rels/slide1.xml.rels" */
function relsPathFor(partPath) {
  const i = partPath.lastIndexOf('/');
  return `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`;
}

/**
 * Reads a part's relationships as [{ id, type, target }] with resolved targets.
 * Returns [] when the part has no .rels file.
 */
async function readRels(zip, partPath) {
  const entry = zip.file(relsPathFor(partPath));
  if (!entry) return [];
  const doc = parseXml(await readText(entry));
  const out = [];
  for (const rel of doc.getElementsByTagName('*')) {
    if (rel.localName !== 'Relationship') continue;
    if (rel.getAttribute('TargetMode') === 'External') continue;
    out.push({
      id: rel.getAttribute('Id'),
      type: rel.getAttribute('Type') || '',
      target: resolveTarget(partPath, rel.getAttribute('Target') || ''),
    });
  }
  return out;
}

/** Slide paths in presentation order (<p:sldIdLst>), or null if unavailable. */
async function orderedSlidePaths(zip, existingSlidePaths) {
  const presEntry = zip.file('ppt/presentation.xml');
  if (!presEntry) return null;

  const rels = await readRels(zip, 'ppt/presentation.xml');
  const targets = new Map(rels.filter((r) => r.type.endsWith('/slide')).map((r) => [r.id, r.target]));
  const existing = new Set(existingSlidePaths);

  const presDoc = parseXml(await readText(presEntry));
  const ordered = [];
  for (const el of presDoc.getElementsByTagName('*')) {
    if (el.localName !== 'sldId') continue;
    const rId = el.getAttribute('r:id') ||
      el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = targets.get(rId);
    if (path && existing.has(path)) ordered.push(path);
  }
  return ordered.length ? ordered : null;
}

/**
 * Main entry point.
 *
 * @param {ArrayBuffer} arrayBuffer raw PPTX bytes
 * @returns {Promise<{
 *   slideXmls: string[],
 *   layoutXmls: string[],
 *   masterXmls: string[],
 *   themeXml: string|null,
 *   themeXmls: Map<string, string>,
 *   media: Map<string, () => Promise<Blob>>,
 *   slideRels: Map<string, {layoutPath: string, masterPath: string}>,
 *   imageRels: Map<string, Map<string, string>>,
 *   diagrams: Map<string, Map<string, string>>,
 *   charts: Map<string, Map<string, string>>,
 *   tableStylesXml: string|null,
 *   presentationXml: string|null,
 *   slidePaths: string[],
 *   layoutPaths: string[],
 *   masterPaths: string[]
 * }>}
 *   - themeXml: first theme (fallback); themeXmls: theme of each master, by master path
 *   - media: lazy loaders keyed by zip path; each reads and caches its Blob on first call
 *   - imageRels: rId → media path for every slide, layout and master
 *   - diagrams: per slide, the SmartArt data-model rId → the pre-drawn fallback
 *     drawing XML PowerPoint stores next to it (what we render instead of the badge)
 *   - charts: per slide, chart relationship rId → chart part XML
 *   - tableStylesXml: ppt/tableStyles.xml, if present
 */
export async function unzipPptx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const allFiles = Object.keys(zip.files);
  const select = (re) => sortByIndex(allFiles.filter((p) => re.test(p)));

  const fileSortedSlides = select(/^ppt\/slides\/slide\d+\.xml$/);
  const slidePaths = (await orderedSlidePaths(zip, fileSortedSlides)) || fileSortedSlides;
  const layoutPaths = select(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/);
  const masterPaths = select(/^ppt\/slideMasters\/slideMaster\d+\.xml$/);
  const themePath = allFiles.find((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p)) || null;

  const text = (p) => readText(zip.file(p));
  const [slideXmls, layoutXmls, masterXmls, themeXml, presentationXml] = await Promise.all([
    Promise.all(slidePaths.map(text)),
    Promise.all(layoutPaths.map(text)),
    Promise.all(masterPaths.map(text)),
    themePath ? text(themePath) : null,
    zip.file('ppt/presentation.xml') ? text('ppt/presentation.xml') : null,
  ]);

  // ── Relationships ─────────────────────────────────────────────────────────
  const relsByPart = new Map();
  await Promise.all(
    [...slidePaths, ...layoutPaths, ...masterPaths].map(async (p) => {
      relsByPart.set(p, await readRels(zip, p));
    }),
  );
  const firstTarget = (part, typeSuffix) =>
    relsByPart.get(part)?.find((r) => r.type.endsWith(typeSuffix))?.target || null;

  const slideRels = new Map();
  for (const slidePath of slidePaths) {
    const layoutPath = firstTarget(slidePath, '/slideLayout');
    const masterPath = layoutPath ? firstTarget(layoutPath, '/slideMaster') : null;
    slideRels.set(slidePath, { layoutPath, masterPath });
  }

  const themeXmls = new Map();
  for (const masterPath of masterPaths) {
    const themeTarget = firstTarget(masterPath, '/theme');
    if (themeTarget && zip.file(themeTarget)) themeXmls.set(masterPath, await text(themeTarget));
  }

  const imageRels = new Map();
  for (const [part, rels] of relsByPart) {
    const images = new Map();
    for (const rel of rels) {
      if (rel.type.endsWith('/image')) images.set(rel.id, rel.target);
    }
    imageRels.set(part, images);
  }

  // ── SmartArt: PowerPoint saves a pre-rendered drawing for every diagram ─────
  const diagrams = new Map();
  for (const slidePath of slidePaths) {
    const rels = relsByPart.get(slidePath) || [];
    const byDataModel = new Map();
    for (const dm of rels.filter((r) => r.type.endsWith('/diagramData'))) {
      if (!zip.file(dm.target)) continue;
      // The data model names the slide relationship that holds its drawing.
      const link = (await text(dm.target)).match(/dataModelExt[^>]*relId="([^"]+)"/);
      const drawing = link && rels.find((r) => r.id === link[1] && r.type.endsWith('/diagramDrawing'));
      if (drawing && zip.file(drawing.target)) byDataModel.set(dm.id, await text(drawing.target));
    }
    if (byDataModel.size) diagrams.set(slidePath, byDataModel);
  }
  const charts = new Map();
  for (const slidePath of slidePaths) {
    const byRel = new Map();
    for (const rel of (relsByPart.get(slidePath) || []).filter((r) => r.type.endsWith('/chart'))) {
      if (zip.file(rel.target)) byRel.set(rel.id, await text(rel.target));
    }
    if (byRel.size) charts.set(slidePath, byRel);
  }
  const tableStylesXml = zip.file('ppt/tableStyles.xml') ? await text('ppt/tableStyles.xml') : null;

  // ── Media: loaded lazily, only when a shape actually draws it ──────────────
  const media = new Map();
  for (const p of allFiles) {
    const ext = p.split('.').pop()?.toLowerCase();
    if (!p.startsWith('ppt/media/') || !MIME_BY_EXT[ext]) continue;
    let pending = null;
    media.set(p, () => {
      pending ??= zip.file(p).async('arraybuffer').then((buf) => new Blob([buf], { type: MIME_BY_EXT[ext] }));
      return pending;
    });
  }

  return {
    slideXmls, layoutXmls, masterXmls, themeXml, themeXmls, media,
    slideRels, imageRels, diagrams, charts, tableStylesXml, presentationXml, slidePaths, layoutPaths, masterPaths,
  };
}
