// viewer/renderer/parse-slide.js
// Walks the OOXML <p:spTree> shape tree and converts to a SlideModel
// with all coordinates in points (pt = emu / 12700).
//
// export function parseSlide(slideXml, themeCtx, layoutXml, masterXml, media) → SlideModel

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const EMU_PER_PT = 12700;
const DEFAULT_SLIDE_WIDTH_EMU  = 9144000; // 720pt / 10 inches
const DEFAULT_SLIDE_HEIGHT_EMU = 6858000; // 540pt / 7.5 inches

// ─── XML Helpers ─────────────────────────────────────────────────────────────
const _parser = new DOMParser();

function parseXml(xmlStr) {
  if (!xmlStr) return null;
  return _parser.parseFromString(xmlStr, 'application/xml');
}

/** Returns all child elements with the given localName (any namespace). */
function children(el, localName) {
  if (!el) return [];
  const out = [];
  for (const child of el.children) {
    if (child.localName === localName) out.push(child);
  }
  return out;
}

/** Returns the first child element with the given localName. */
function child(el, localName) {
  if (!el) return null;
  for (const c of el.children) {
    if (c.localName === localName) return c;
  }
  return null;
}

/** Searches the whole subtree for the first element with localName. */
function findFirst(root, localName) {
  if (!root) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.localName === localName) return node;
    node = walker.nextNode();
  }
  return null;
}

function emu(attrValue) {
  const n = parseInt(attrValue || '0', 10);
  return isNaN(n) ? 0 : n / EMU_PER_PT;
}

function halfPt(attrValue) {
  // Line widths in OOXML are in half-points
  const n = parseInt(attrValue || '0', 10);
  return isNaN(n) ? 0 : n / 2;
}

// ─── Color Resolution ─────────────────────────────────────────────────────────

/**
 * Resolves an <a:*Clr> element to a CSS hex color string.
 * Handles: srgbClr, schemeClr (with luminance/tint mods), prstClr, sysClr.
 */
function resolveColorEl(colorEl, themeCtx) {
  if (!colorEl) return null;
  const tag = colorEl.localName;

  if (tag === 'srgbClr') {
    return `#${colorEl.getAttribute('val') || '000000'}`;
  }

  if (tag === 'schemeClr') {
    const slot = colorEl.getAttribute('val');
    let hex = themeCtx.resolveColor(slot);
    // Apply lumMod / lumOff / tint / shade modifiers
    hex = applyColorMods(hex, colorEl);
    return hex;
  }

  if (tag === 'sysClr') {
    return `#${colorEl.getAttribute('lastClr') || '000000'}`;
  }

  if (tag === 'prstClr') {
    // Named CSS colors — OOXML preset names are CSS color names
    return colorEl.getAttribute('val') || '#000000';
  }

  return null;
}

/**
 * Applies lumMod, lumOff, tint, shade modifiers to a hex color.
 * All modifier values in OOXML are expressed in 1/100000ths (100000 = 100%).
 */
function applyColorMods(hex, colorEl) {
  let [r, g, b] = hexToRgb(hex);

  const lumMod  = colorEl.querySelector('lumMod');
  const lumOff  = colorEl.querySelector('lumOff');
  const tint    = colorEl.querySelector('tint');
  const shade   = colorEl.querySelector('shade');

  if (lumMod || lumOff) {
    let [h, s, l] = rgbToHsl(r, g, b);
    if (lumMod) l = l * (parseInt(lumMod.getAttribute('val'), 10) / 100000);
    if (lumOff) l = l + (parseInt(lumOff.getAttribute('val'), 10) / 100000);
    l = Math.max(0, Math.min(1, l));
    [r, g, b] = hslToRgb(h, s, l);
  }

  if (tint) {
    const t = parseInt(tint.getAttribute('val'), 10) / 100000;
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  }

  if (shade) {
    const s = parseInt(shade.getAttribute('val'), 10) / 100000;
    r = Math.round(r * s);
    g = Math.round(g * s);
    b = Math.round(b * s);
  }

  return rgbToHex(r, g, b);
}

// ─── Color Math Utilities ─────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2,'0')}${clamp(g).toString(16).padStart(2,'0')}${clamp(b).toString(16).padStart(2,'0')}`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

// ─── Fill Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a fill element (<p:spPr> child) and returns a Fill descriptor.
 * @typedef {{ type: 'solid'|'gradient'|'none', color?: string, stops?: Array<{pos:number,color:string}> }} Fill
 */
function parseFill(spPrEl, themeCtx) {
  if (!spPrEl) return { type: 'none' };

  const solidFill = child(spPrEl, 'solidFill');
  if (solidFill) {
    const colorEl = solidFill.children[0];
    const color = resolveColorEl(colorEl, themeCtx);
    return { type: 'solid', color: color || 'transparent' };
  }

  const gradFill = child(spPrEl, 'gradFill');
  if (gradFill) {
    const gsLst = child(gradFill, 'gsLst');
    const stops = gsLst ? children(gsLst, 'gs').map(gs => {
      const pos = parseInt(gs.getAttribute('pos') || '0', 10) / 100000;
      const colorEl = gs.children[0];
      return { pos, color: resolveColorEl(colorEl, themeCtx) || '#000000' };
    }) : [];
    const lin = child(gradFill, 'lin');
    const angle = lin ? parseInt(lin.getAttribute('ang') || '0', 10) / 60000 : 0;
    return { type: 'gradient', stops, angle };
  }

  const noFill = child(spPrEl, 'noFill');
  if (noFill) return { type: 'none' };

  return { type: 'none' };
}

// ─── Line/Border Parsing ──────────────────────────────────────────────────────

function parseLine(spPrEl, themeCtx) {
  if (!spPrEl) return null;
  const lnEl = child(spPrEl, 'ln');
  if (!lnEl) return null;

  const noFill = child(lnEl, 'noFill');
  if (noFill) return null;

  const solidFill = child(lnEl, 'solidFill');
  if (!solidFill) return null;

  const colorEl = solidFill.children[0];
  const color = resolveColorEl(colorEl, themeCtx) || '#000000';
  // ln w attribute is in EMUs (English Metric Units for line width = 12700 per pt)
  const wEmu = parseInt(lnEl.getAttribute('w') || '12700', 10);
  const width = wEmu / 12700;

  return { color, width };
}

// ─── Transform Parsing ────────────────────────────────────────────────────────

function parseXfrm(xfrmEl) {
  if (!xfrmEl) return { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false };
  const offEl = child(xfrmEl, 'off');
  const extEl = child(xfrmEl, 'ext');
  return {
    x:     offEl ? emu(offEl.getAttribute('x')) : 0,
    y:     offEl ? emu(offEl.getAttribute('y')) : 0,
    w:     extEl ? emu(extEl.getAttribute('cx')) : 0,
    h:     extEl ? emu(extEl.getAttribute('cy')) : 0,
    rot:   parseInt(xfrmEl.getAttribute('rot') || '0', 10) / 60000, // degrees
    flipH: xfrmEl.getAttribute('flipH') === '1',
    flipV: xfrmEl.getAttribute('flipV') === '1',
  };
}

// ─── Text Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a <p:txBody> into an array of paragraphs, each with styled runs.
 * @typedef {{ text: string, bold: boolean, italic: boolean, underline: boolean,
 *             fontSize: number, color: string, fontFamily: string, strike: boolean }} Run
 * @typedef {{ runs: Run[], align: string, indent: number, bullet: boolean }} Paragraph
 */
function parseTextBody(txBodyEl, themeCtx) {
  if (!txBodyEl) return [];
  const paragraphs = [];

  for (const pEl of children(txBodyEl, 'p')) {
    const pPrEl = child(pEl, 'pPr');
    const align = pPrEl?.getAttribute('algn') || 'l';
    const indent = parseInt(pPrEl?.getAttribute('indent') || '0', 10) / EMU_PER_PT;
    const bullet  = !!child(pPrEl, 'buChar') || !!child(pPrEl, 'buAutoNum');

    const runs = [];
    for (const rEl of children(pEl, 'r')) {
      const rPrEl = child(rEl, 'rPr');
      const tEl   = child(rEl, 't');
      const text  = tEl?.textContent ?? '';

      const bold      = rPrEl?.getAttribute('b') === '1';
      const italic    = rPrEl?.getAttribute('i') === '1';
      const underline = rPrEl?.getAttribute('u') && rPrEl.getAttribute('u') !== 'none';
      const strike    = rPrEl?.getAttribute('strike') && rPrEl.getAttribute('strike') !== 'noStrike';
      const szHundPt  = parseInt(rPrEl?.getAttribute('sz') || '0', 10);
      const fontSize  = szHundPt > 0 ? szHundPt / 100 : 18; // 100 hundredths = 1pt

      // Color: check rPr solidFill → schemeClr chain
      let color = '#000000';
      if (rPrEl) {
        const solidFill = child(rPrEl, 'solidFill');
        if (solidFill) {
          const colorEl = solidFill.children[0];
          color = resolveColorEl(colorEl, themeCtx) || '#000000';
        }
      }

      // Font
      let fontFamily = themeCtx.minorFont;
      if (rPrEl) {
        const latinEl = child(rPrEl, 'latin');
        if (latinEl) fontFamily = themeCtx.resolveFont(latinEl.getAttribute('typeface'));
      }

      runs.push({ text, bold, italic, underline, strike, fontSize, color, fontFamily });
    }

    // Handle <a:br> (line breaks) as synthetic runs
    for (const brEl of children(pEl, 'br')) {
      runs.push({ text: '\n', bold: false, italic: false, underline: false,
                  strike: false, fontSize: 18, color: '#000000', fontFamily: themeCtx.minorFont });
    }

    paragraphs.push({ runs, align, indent, bullet });
  }

  return paragraphs;
}

// ─── Shape Geometry ──────────────────────────────────────────────────────────

function parseGeometry(spPrEl) {
  if (!spPrEl) return 'rect';
  const prstGeom = child(spPrEl, 'prstGeom');
  if (!prstGeom) return 'rect';
  return prstGeom.getAttribute('prst') || 'rect';
}

// ─── Image Reference ─────────────────────────────────────────────────────────

/**
 * Resolves a blip r:embed reference to a media Blob from the media map.
 * @param {string} rId - relationship ID (r:embed attribute)
 * @param {Document} slideDoc
 * @param {Map<string,Blob>} media
 * @returns {Blob|null}
 */
function resolveImage(rId, slideDoc, media) {
  if (!rId || !slideDoc) return null;

  // Find the slide's _rels to look up the media path
  // The _rels data was pre-built into the slideDoc's baseURI context;
  // we embed a <Relationships> in the document or use the media map directly.
  // Since we pass the full media Map with zip paths as keys, we need
  // to find the relationship target. We embed rels inline via the slideDoc.
  const relsNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
  // The rels doc should be available via the slideDoc processing instructions
  // or injected. For now, search all media keys by rId pattern.
  // (Actual rels resolution is done in viewer.js which passes pre-resolved blob)
  for (const [path, blob] of media) {
    if (path.includes(rId)) return blob;
  }
  return null;
}

// ─── Shape Parsers ────────────────────────────────────────────────────────────

/** Parses a <p:sp> shape (text box or auto-shape). */
function parseSp(spEl, themeCtx, media, slideDoc) {
  const spPrEl  = child(spEl, 'spPr');
  const txBodyEl = child(spEl, 'txBody');
  const nvSpPrEl = child(spEl, 'nvSpPr');

  const xfrmEl = child(spPrEl, 'xfrm');
  const { x, y, w, h, rot, flipH, flipV } = parseXfrm(xfrmEl);

  const fill = parseFill(spPrEl, themeCtx);
  const line = parseLine(spPrEl, themeCtx);
  const geometry = parseGeometry(spPrEl);
  const paragraphs = txBodyEl ? parseTextBody(txBodyEl, themeCtx) : [];

  // Determine if this is purely a text box with no visible fill
  const isTextBox = nvSpPrEl &&
    child(child(nvSpPrEl, 'nvPr'), 'ph') === null &&
    paragraphs.length > 0 &&
    fill.type === 'none';

  return {
    type: paragraphs.length > 0 ? 'text' : 'shape',
    geometry,
    x, y, w, h, rot, flipH, flipV,
    fill,
    line,
    paragraphs,
  };
}

/** Parses a <p:pic> picture shape. */
function parsePic(picEl, themeCtx, media, slideRelsDoc) {
  const spPrEl  = child(picEl, 'spPr');
  const blipFillEl = child(picEl, 'blipFill');
  const nvPicPrEl  = child(picEl, 'nvPicPr');

  const xfrmEl = child(spPrEl, 'xfrm');
  const { x, y, w, h, rot, flipH, flipV } = parseXfrm(xfrmEl);

  // Get the relationship ID for the image
  const blipEl = blipFillEl ? child(blipFillEl, 'blip') : null;
  const rEmbed = blipEl?.getAttributeNS(
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed'
  ) || blipEl?.getAttribute('r:embed') || null;

  return {
    type: 'image',
    x, y, w, h, rot, flipH, flipV,
    rEmbed,    // resolved to blob by viewer.js
    blob: null, // filled in later
  };
}

/** Parses a <p:graphicFrame> — usually contains a table or chart. */
function parseGraphicFrame(frameEl, themeCtx) {
  const xfrmEl = child(frameEl, 'xfrm');
  const { x, y, w, h, rot } = parseXfrm(xfrmEl);

  const graphicEl = child(frameEl, 'graphic');
  const graphicDataEl = graphicEl ? child(graphicEl, 'graphicData') : null;
  const uri = graphicDataEl?.getAttribute('uri') || '';

  // Table
  if (uri.includes('table')) {
    return parseTable(frameEl, graphicDataEl, themeCtx, { x, y, w, h, rot });
  }

  // Chart, SmartArt, or other embedded content → unsupported badge
  const label = uri.includes('chart')   ? 'Chart'
    : uri.includes('diagram') ? 'SmartArt'
    : 'Embedded Object';

  return { type: 'unsupported', label, x, y, w, h, rot };
}

/** Parses an OOXML table (<a:tbl>) inside a graphicFrame. */
function parseTable(frameEl, graphicDataEl, themeCtx, pos) {
  const tblEl = findFirst(graphicDataEl, 'tbl');
  if (!tblEl) return { type: 'unsupported', label: 'Table (parse error)', ...pos };

  const rows = [];
  for (const trEl of children(tblEl, 'tr')) {
    const h = emu(trEl.getAttribute('h'));
    const cells = [];
    for (const tcEl of children(trEl, 'tc')) {
      const txBodyEl = child(tcEl, 'txBody');
      const tcPrEl   = child(tcEl, 'tcPr');
      const paragraphs = txBodyEl ? parseTextBody(txBodyEl, themeCtx) : [];
      const fill = parseFill(tcPrEl, themeCtx);
      const gridSpan = parseInt(tcEl.getAttribute('gridSpan') || '1', 10);
      const rowSpan  = parseInt(tcEl.getAttribute('rowSpan')  || '1', 10);
      cells.push({ paragraphs, fill, gridSpan, rowSpan });
    }
    rows.push({ h, cells });
  }

  // Column widths
  const tblGridEl = child(tblEl, 'tblGrid');
  const colWidths = tblGridEl
    ? children(tblGridEl, 'gridCol').map(gc => emu(gc.getAttribute('w')))
    : [];

  return {
    type: 'table',
    ...pos,
    rows,
    colWidths,
  };
}

/** Parses a <p:grpSp> group shape — recursively extracts children. */
function parseGrpSp(grpSpEl, themeCtx, media, slideDoc) {
  const shapes = [];
  for (const child_ of grpSpEl.children) {
    const shape = parseShape(child_, themeCtx, media, slideDoc);
    if (shape) shapes.push(shape);
  }
  return { type: 'group', shapes };
}

/** Dispatches to the correct shape parser based on element localName. */
function parseShape(el, themeCtx, media, slideDoc) {
  switch (el.localName) {
    case 'sp':           return parseSp(el, themeCtx, media, slideDoc);
    case 'pic':          return parsePic(el, themeCtx, media, slideDoc);
    case 'graphicFrame': return parseGraphicFrame(el, themeCtx);
    case 'grpSp':        return parseGrpSp(el, themeCtx, media, slideDoc);
    case 'cxnSp':        return parseSp(el, themeCtx, media, slideDoc); // connector
    default:             return null;
  }
}

// ─── Slide Dimensions ─────────────────────────────────────────────────────────

/**
 * Reads slide dimensions from ppt/presentation.xml-style sldSz.
 * Since we don't have direct access to presentation.xml here, we use
 * a convention: the widescreen 16:9 default (10" × 5.625").
 * Viewers can override by passing explicit dimensions.
 */
function parseSlideSize(presentationXml) {
  if (!presentationXml) return {
    width:  DEFAULT_SLIDE_WIDTH_EMU  / EMU_PER_PT,
    height: DEFAULT_SLIDE_HEIGHT_EMU / EMU_PER_PT,
  };
  const doc = parseXml(presentationXml);
  const sldSz = findFirst(doc, 'sldSz');
  if (!sldSz) return {
    width:  DEFAULT_SLIDE_WIDTH_EMU  / EMU_PER_PT,
    height: DEFAULT_SLIDE_HEIGHT_EMU / EMU_PER_PT,
  };
  return {
    width:  emu(sldSz.getAttribute('cx')),
    height: emu(sldSz.getAttribute('cy')),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a single slide XML into a SlideModel.
 *
 * @param {string} slideXml
 * @param {ThemeContext} themeCtx  - from parse-theme.js
 * @param {Map<string, Blob>} media - from unzip.js
 * @param {{ width: number, height: number }} slideSize - in points
 * @param {Map<string, string>} slideImageRels - rId → zip media path
 * @returns {SlideModel}
 *
 * @typedef {Object} SlideModel
 * @property {number} width   - in points
 * @property {number} height  - in points
 * @property {string} background - CSS color
 * @property {Shape[]} shapes
 */
export function parseSlide(slideXml, themeCtx, media, slideSize, slideImageRels = new Map()) {
  const slideDoc = parseXml(slideXml);
  if (!slideDoc) return { width: 720, height: 540, background: '#ffffff', shapes: [] };

  const spTree = findFirst(slideDoc, 'spTree');
  const shapes = [];

  if (spTree) {
    for (const el of spTree.children) {
      const shape = parseShape(el, themeCtx, media, slideDoc);
      if (!shape) continue;

      // Resolve image blobs for pic shapes
      if (shape.type === 'image' && shape.rEmbed) {
        const zipPath = slideImageRels.get(shape.rEmbed);
        shape.blob = zipPath ? (media.get(zipPath) || null) : null;
      }

      shapes.push(shape);
    }
  }

  return {
    width:      slideSize?.width  ?? DEFAULT_SLIDE_WIDTH_EMU  / EMU_PER_PT,
    height:     slideSize?.height ?? DEFAULT_SLIDE_HEIGHT_EMU / EMU_PER_PT,
    background: themeCtx.background,
    shapes,
  };
}

/**
 * Parses slide dimensions from presentation.xml content.
 * Re-exported so viewer.js can call it once.
 */
export { parseSlideSize };
