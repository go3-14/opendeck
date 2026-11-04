// src/renderer/parse-slide.js
// Converts a slide (plus its layout and master) into a renderer-neutral
// SlideModel. All coordinates are in points (EMU / 12700).
//
// Inheritance handled here:
//   - placeholder geometry, fill, line, body properties and list styles flow
//     master → layout → slide
//   - master text styles (title / body / other) provide default text formatting
//   - non-placeholder master and layout shapes are drawn behind the slide
//   - theme <p:style> references supply default fills, lines and text colour
//
// SlideModel = { width, height, background: Fill, shapes: Shape[], animation }
// animation = null | { initialHidden: id[], clickSteps: [[{id, show}]] }  (see parseAnimations)
// Fill  = {type:'none'} | {type:'solid', color} |
//         {type:'gradient', stops:[{pos,color}], angle, radial} |
//         {type:'image', loadBlob, crop}
// Line  = { color, width, dash, head, tail }
// Shape = shape | image | table | group | unsupported  (see the parse* functions)

import { resolveColorEl } from './color.js';
import { parseChart } from './parse-chart.js';
import { child, children, findFirst, intAttr, parseXml, path } from './xml.js';

const EMU_PER_PT = 12700;
const DEFAULT_WIDTH_PT = 9144000 / EMU_PER_PT; // 720
const DEFAULT_HEIGHT_PT = 6858000 / EMU_PER_PT; // 540
const NONE = { type: 'none' };

const emu = (v) => (parseInt(v || '0', 10) || 0) / EMU_PER_PT;

// ─── Transforms ───────────────────────────────────────────────────────────────

/** <a:xfrm> / <p:xfrm> → box, or null when absent so callers can inherit. */
function parseXfrm(xfrmEl) {
  if (!xfrmEl) return null;
  const off = child(xfrmEl, 'off');
  const ext = child(xfrmEl, 'ext');
  const chOff = child(xfrmEl, 'chOff');
  const chExt = child(xfrmEl, 'chExt');
  return {
    x: emu(off?.getAttribute('x')),
    y: emu(off?.getAttribute('y')),
    w: emu(ext?.getAttribute('cx')),
    h: emu(ext?.getAttribute('cy')),
    rot: intAttr(xfrmEl, 'rot', 0) / 60000,
    flipH: xfrmEl.getAttribute('flipH') === '1',
    flipV: xfrmEl.getAttribute('flipV') === '1',
    chX: emu(chOff?.getAttribute('x')),
    chY: emu(chOff?.getAttribute('y')),
    chW: emu(chExt?.getAttribute('cx')),
    chH: emu(chExt?.getAttribute('cy')),
  };
}

// ─── Fills and lines ──────────────────────────────────────────────────────────

const FILL_TAGS = ['solidFill', 'gradFill', 'blipFill', 'pattFill', 'noFill', 'grpFill'];

/** The first fill element among an element's children (spPr, bgPr, tcPr...). */
function fillChild(parent) {
  if (!parent) return null;
  for (const c of parent.children) if (FILL_TAGS.includes(c.localName)) return c;
  return null;
}

/** blip r:embed → media loader function (or null). */
function blipLoader(blipEl, pc) {
  const rId = blipEl?.getAttribute('r:embed') ||
    blipEl?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
  const mediaPath = rId ? pc.rels.get(rId) : null;
  return (mediaPath && pc.media.get(mediaPath)) || null;
}

function parseSrcRect(el) {
  const r = child(el, 'srcRect');
  if (!r) return null;
  const f = (n) => intAttr(r, n, 0) / 100000;
  const crop = { l: f('l'), t: f('t'), r: f('r'), b: f('b') };
  return crop.l || crop.t || crop.r || crop.b ? crop : null;
}

/** Parses one fill element. `phClr` is substituted for schemeClr "phClr". */
function parseFillEl(fillEl, pc, phClr) {
  if (!fillEl) return NONE;
  switch (fillEl.localName) {
    case 'solidFill': {
      const color = resolveColorEl(fillEl.firstElementChild, pc.theme, phClr);
      return color ? { type: 'solid', color } : NONE;
    }
    case 'gradFill': {
      const gsLst = child(fillEl, 'gsLst');
      const stops = children(gsLst, 'gs').map((gs) => ({
        pos: intAttr(gs, 'pos', 0) / 100000,
        color: resolveColorEl(gs.firstElementChild, pc.theme, phClr) || '#000000',
      }));
      if (!stops.length) return NONE;
      const lin = child(fillEl, 'lin');
      return {
        type: 'gradient',
        stops,
        angle: lin ? intAttr(lin, 'ang', 0) / 60000 : 90,
        radial: !lin && !!child(fillEl, 'path'),
      };
    }
    case 'blipFill': {
      const loadBlob = blipLoader(child(fillEl, 'blip'), pc);
      return loadBlob ? { type: 'image', loadBlob, crop: parseSrcRect(fillEl) } : NONE;
    }
    case 'pattFill': {
      // Patterns are approximated by their foreground colour.
      const color = resolveColorEl(child(fillEl, 'fgClr')?.firstElementChild, pc.theme, phClr);
      return color ? { type: 'solid', color } : NONE;
    }
    default:
      return NONE;
  }
}

/** <a:ln> → partial line description (only the properties it actually sets). */
function parseLn(lnEl, pc, phClr) {
  const out = {};
  if (!lnEl) return out;
  if (lnEl.hasAttribute('w')) out.width = emu(lnEl.getAttribute('w'));
  const fill = fillChild(lnEl);
  if (fill) {
    if (fill.localName === 'noFill') out.none = true;
    else {
      out.none = false;
      const parsed = parseFillEl(fill, pc, phClr);
      if (parsed.type === 'solid') out.color = parsed.color;
      else if (parsed.type === 'gradient') out.color = parsed.stops[0].color;
    }
  }
  const dash = child(lnEl, 'prstDash')?.getAttribute('val');
  if (dash) out.dash = dash;
  for (const [tag, key] of [['headEnd', 'head'], ['tailEnd', 'tail']]) {
    const end = child(lnEl, tag);
    const type = end?.getAttribute('type');
    if (type && type !== 'none') {
      out[key] = { type, w: end.getAttribute('w') || 'med', len: end.getAttribute('len') || 'med' };
    }
  }
  return out;
}

function finishLine(partial) {
  if (!partial || partial.none || !partial.color) return null;
  return {
    color: partial.color,
    width: partial.width ?? 1,
    dash: partial.dash || null,
    head: partial.head || null,
    tail: partial.tail || null,
  };
}

// ─── <p:style> references ─────────────────────────────────────────────────────

/** Reads a shape's <p:style> into theme-derived defaults. */
function readStyle(spEl, pc) {
  const styleEl = child(spEl, 'style');
  if (!styleEl) return null;
  const refColor = (name) => {
    const ref = child(styleEl, name);
    return { idx: intAttr(ref, 'idx', 0), color: resolveColorEl(ref?.firstElementChild, pc.theme) };
  };
  const fillRef = refColor('fillRef');
  const lnRef = refColor('lnRef');
  const fontRef = refColor('fontRef');

  const fillEl = fillRef.idx > 0 ? pc.theme.fmt.fills[fillRef.idx - 1] : null;
  const lnEl = lnRef.idx > 0 ? pc.theme.fmt.lines[lnRef.idx - 1] : null;
  return {
    fill: fillEl ? parseFillEl(fillEl, pc, fillRef.color) : null,
    line: lnEl ? parseLn(lnEl, pc, lnRef.color) : null,
    fontColor: fontRef.color,
  };
}

// ─── Placeholders ─────────────────────────────────────────────────────────────

/** The <p:ph> info of a shape element, or null for ordinary shapes. */
function getPh(el) {
  const nv = Array.from(el.children).find((c) => c.localName.startsWith('nv'));
  const ph = path(nv, 'nvPr', 'ph');
  if (!ph) return null;
  return { type: ph.getAttribute('type'), idx: ph.getAttribute('idx') };
}

function isHidden(el) {
  const nv = Array.from(el.children).find((c) => c.localName.startsWith('nv'));
  return child(nv, 'cNvPr')?.getAttribute('hidden') === '1';
}

/** The shape's <p:cNvPr id>, which animations refer to (spid). */
function shapeId(el) {
  const nv = Array.from(el.children).find((c) => c.localName.startsWith('nv'));
  const id = parseInt(child(nv, 'cNvPr')?.getAttribute('id') || '', 10);
  return Number.isNaN(id) ? undefined : id;
}

/** Collapses placeholder types that share a master placeholder. */
function normType(type) {
  const t = type || 'obj';
  if (t === 'ctrTitle') return 'title';
  if (['subTitle', 'obj', 'tbl', 'chart', 'dgm', 'media', 'clipArt', 'pic'].includes(t)) return 'body';
  return t;
}

function indexPlaceholders(doc) {
  const list = [];
  const spTree = findFirst(doc, 'spTree');
  if (!spTree) return list;
  for (const el of spTree.children) {
    const ph = getPh(el);
    if (ph) list.push({ ph, el });
  }
  return list;
}

function findPlaceholder(list, ph, useIdx) {
  if (!ph || !list.length) return null;
  if (useIdx && ph.idx != null) {
    const byIdx = list.find((x) => x.ph.idx === ph.idx);
    if (byIdx) return byIdx;
  }
  const type = ph.type || 'obj';
  return (
    list.find((x) => (x.ph.type || 'obj') === type) ||
    list.find((x) => normType(x.ph.type) === normType(type)) ||
    null
  );
}

/** Elements this placeholder inherits from, ordered master → layout. */
function placeholderParents(ph, pc) {
  if (!ph || !pc.placeholders) return [];
  const layoutMatch = findPlaceholder(pc.placeholders.layoutList, ph, true);
  const masterMatch = findPlaceholder(pc.placeholders.masterList, layoutMatch ? layoutMatch.ph : ph, false);
  return [masterMatch?.el, layoutMatch?.el].filter(Boolean);
}

function txStyleKind(ph) {
  const t = normType(ph?.type);
  if (t === 'title') return 'titleStyle';
  if (t === 'body') return 'bodyStyle';
  return 'otherStyle';
}

// ─── Text ─────────────────────────────────────────────────────────────────────

const DEFAULT_FONT_PT = 18;

function readSpacing(el) {
  const pct = child(el, 'spcPct');
  if (pct) return { pct: intAttr(pct, 'val', 100000) / 100000 };
  const pts = child(el, 'spcPts');
  if (pts) return { pts: intAttr(pts, 'val', 0) / 100 };
  return undefined;
}

/** <a:rPr> / <a:defRPr> → partial run properties. */
function readRPr(el, pc) {
  const out = {};
  if (!el) return out;
  if (el.hasAttribute('sz')) out.sz = intAttr(el, 'sz', 1800) / 100;
  const flag = (name) => {
    const v = el.getAttribute(name);
    return v === '1' || v === 'true';
  };
  if (el.hasAttribute('b')) out.b = flag('b');
  if (el.hasAttribute('i')) out.i = flag('i');
  if (el.hasAttribute('u')) out.u = el.getAttribute('u') !== 'none';
  if (el.hasAttribute('strike')) out.strike = el.getAttribute('strike') !== 'noStrike';
  if (el.hasAttribute('baseline')) out.baseline = intAttr(el, 'baseline', 0) / 100000;
  if (el.hasAttribute('cap')) out.cap = el.getAttribute('cap');
  const fill = child(el, 'solidFill');
  if (fill) {
    const color = resolveColorEl(fill.firstElementChild, pc.theme);
    if (color) out.color = color;
  }
  const typeface = child(el, 'latin')?.getAttribute('typeface');
  if (typeface) out.font = pc.theme.resolveFont(typeface);
  return out;
}

/** <a:lvlNpPr> / <a:pPr> → partial paragraph properties. */
function readPProps(el, pc) {
  const p = {};
  if (el.hasAttribute('algn')) p.algn = el.getAttribute('algn');
  if (el.hasAttribute('marL')) p.marL = emu(el.getAttribute('marL'));
  if (el.hasAttribute('indent')) p.indent = emu(el.getAttribute('indent'));
  for (const c of el.children) {
    switch (c.localName) {
      case 'lnSpc': p.lnSpc = readSpacing(c); break;
      case 'spcBef': p.spcBef = readSpacing(c); break;
      case 'spcAft': p.spcAft = readSpacing(c); break;
      case 'buNone': p.buKind = 'none'; break;
      case 'buChar': p.buKind = 'char'; p.buChar = c.getAttribute('char') || '•'; break;
      case 'buAutoNum':
        p.buKind = 'auto';
        p.buType = c.getAttribute('type') || 'arabicPeriod';
        p.buStart = intAttr(c, 'startAt', 1);
        break;
      case 'buFont': p.buFont = c.getAttribute('typeface'); break;
      case 'buClr': p.buColor = resolveColorEl(c.firstElementChild, pc.theme); break;
      case 'buSzPct': p.buSize = intAttr(c, 'val', 100000) / 100000; break;
      case 'defRPr': p.rPr = readRPr(c, pc); break;
      default: break;
    }
  }
  return p;
}

function mergeProps(base, over) {
  return { ...base, ...over, rPr: { ...base.rPr, ...over.rPr } };
}

/** Merged properties for one list level across all style sources (low → high). */
function levelProps(sources, level, pc) {
  let props = {};
  for (const src of sources) {
    const lvl = child(src, `lvl${level + 1}pPr`);
    if (lvl) props = mergeProps(props, readPProps(lvl, pc));
  }
  return props;
}

// Wingdings/Symbol bullet glyphs have no equivalent in system fonts.
const SYMBOL_BULLETS = { '§': '▪', 'Ø': '➢', 'ü': '✓', l: '●', n: '■', v: '❖', q: '❑', '': '•', '·': '•' };

function bulletChar(char, font) {
  if (font && /wingdings|symbol/i.test(font)) return SYMBOL_BULLETS[char] || '•';
  return char || '•';
}

/** <a:bodyPr> chain (low → high) → text box properties in points. */
function readBodyPr(elements, defaults) {
  const out = {
    l: defaults?.l ?? 7.2, t: defaults?.t ?? 3.6, r: defaults?.r ?? 7.2, b: defaults?.b ?? 3.6,
    anchor: defaults?.anchor ?? 't', wrap: true, autofit: 'none', fontScale: 1, lnSpcReduction: 0,
  };
  for (const el of elements) {
    if (el.hasAttribute('lIns')) out.l = emu(el.getAttribute('lIns'));
    if (el.hasAttribute('tIns')) out.t = emu(el.getAttribute('tIns'));
    if (el.hasAttribute('rIns')) out.r = emu(el.getAttribute('rIns'));
    if (el.hasAttribute('bIns')) out.b = emu(el.getAttribute('bIns'));
    if (el.hasAttribute('anchor')) out.anchor = el.getAttribute('anchor');
    if (el.hasAttribute('wrap')) out.wrap = el.getAttribute('wrap') !== 'none';
    for (const c of el.children) {
      if (c.localName === 'normAutofit') {
        out.autofit = 'norm';
        out.fontScale = c.hasAttribute('fontScale') ? intAttr(c, 'fontScale', 100000) / 100000 : null;
        out.lnSpcReduction = intAttr(c, 'lnSpcReduction', 0) / 100000;
      } else if (c.localName === 'spAutoFit') out.autofit = 'shape';
      else if (c.localName === 'noAutofit') out.autofit = 'none';
    }
  }
  return out;
}

/**
 * Builds { bodyPr, paragraphs } from a <p:txBody>/<a:txBody>.
 *
 * @param bodyPrEls  <a:bodyPr> elements, low → high priority
 * @param lstEls     list-style sources (txStyles entry, <a:lstStyle>s), low → high
 * @param defaultColor  text colour used when nothing in the chain sets one
 */
function buildText(txBodyEl, pc, { bodyPrEls = [], lstEls = [], defaultColor, defaultBold, insets }) {
  const bodyPr = readBodyPr(bodyPrEls, insets);
  const baseColor = defaultColor || pc.theme.resolveColor('tx1');
  const paragraphs = [];

  for (const pEl of children(txBodyEl, 'p')) {
    const pPr = child(pEl, 'pPr');
    const level = Math.max(0, Math.min(8, intAttr(pPr, 'lvl', 0)));
    let props = levelProps(lstEls, level, pc);
    if (pPr) props = mergeProps(props, readPProps(pPr, pc));

    const base = {
      sz: DEFAULT_FONT_PT, b: defaultBold ?? false, i: false, u: false, strike: false, baseline: 0,
      color: baseColor, font: pc.theme.minorFont, ...props.rPr,
    };

    const runs = [];
    const pushRun = (text, rPrEl) => {
      const r = { ...base, ...readRPr(rPrEl, pc) };
      runs.push({
        text: r.cap === 'all' ? text.toUpperCase() : text,
        bold: r.b, italic: r.i, underline: r.u, strike: r.strike,
        size: r.sz, color: r.color, font: r.font, baseline: r.baseline,
      });
    };

    for (const c of pEl.children) {
      if (c.localName === 'r') {
        pushRun(child(c, 't')?.textContent ?? '', child(c, 'rPr'));
      } else if (c.localName === 'fld') {
        const isSlideNum = (c.getAttribute('type') || '').startsWith('slidenum');
        pushRun(isSlideNum ? String(pc.slideNumber) : child(c, 't')?.textContent ?? '', child(c, 'rPr'));
      } else if (c.localName === 'br') {
        pushRun('\n', child(c, 'rPr'));
      }
    }

    let bullet = null;
    if (props.buKind === 'char') {
      bullet = { kind: 'char', char: bulletChar(props.buChar, props.buFont), color: props.buColor, size: props.buSize };
    } else if (props.buKind === 'auto') {
      bullet = { kind: 'auto', type: props.buType, start: props.buStart, color: props.buColor, size: props.buSize };
    }

    const endSz = readRPr(child(pEl, 'endParaRPr'), pc).sz;
    paragraphs.push({
      align: props.algn || 'l',
      marL: props.marL || 0,
      indent: props.indent || 0,
      lnSpc: props.lnSpc,
      spcBef: props.spcBef,
      spcAft: props.spcAft,
      bullet,
      level,
      runs,
      endSize: endSz ?? base.sz,
    });
  }
  return { bodyPr, paragraphs };
}

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** First <a:outerShdw> found in the given spPr elements (highest priority last). */
function parseShadow(spPrs, pc) {
  for (const spPr of [...spPrs].reverse()) {
    const sh = child(child(spPr, 'effectLst'), 'outerShdw');
    if (!sh) continue;
    const dist = emu(sh.getAttribute('dist'));
    const dir = (intAttr(sh, 'dir', 0) / 60000) * (Math.PI / 180);
    const color = resolveColorEl(sh.firstElementChild, pc.theme);
    if (!color) continue;
    return { color, blur: emu(sh.getAttribute('blurRad')), dx: dist * Math.cos(dir), dy: dist * Math.sin(dir) };
  }
  return null;
}

/** <a:custGeom> → list of paths in their own coordinate space, or null if unusable. */
function parseCustGeom(custGeom) {
  const paths = [];
  for (const p of children(child(custGeom, 'pathLst'), 'path')) {
    const cmds = [];
    let valid = true;
    const pt = (el) => {
      const x = parseInt(el?.getAttribute('x'), 10);
      const y = parseInt(el?.getAttribute('y'), 10);
      if (Number.isNaN(x) || Number.isNaN(y)) valid = false; // guide-name formulas are not supported
      return [x || 0, y || 0];
    };
    for (const c of p.children) {
      switch (c.localName) {
        case 'moveTo': cmds.push(['M', ...pt(child(c, 'pt'))]); break;
        case 'lnTo': cmds.push(['L', ...pt(child(c, 'pt'))]); break;
        case 'cubicBezTo': { const [a, b, d] = children(c, 'pt').map(pt); cmds.push(['C', ...a, ...b, ...d]); break; }
        case 'quadBezTo': { const [a, b] = children(c, 'pt').map(pt); cmds.push(['Q', ...a, ...b]); break; }
        case 'arcTo':
          cmds.push(['A', intAttr(c, 'wR'), intAttr(c, 'hR'), intAttr(c, 'stAng') / 60000, intAttr(c, 'swAng') / 60000]);
          break;
        case 'close': cmds.push(['Z']); break;
        default: break;
      }
    }
    if (valid && cmds.length) {
      paths.push({
        w: intAttr(p, 'w', 0), h: intAttr(p, 'h', 0),
        fill: p.getAttribute('fill') !== 'none', cmds,
      });
    }
  }
  return paths.length ? paths : null;
}

function parseGeometry(spPrEl) {
  const cust = child(spPrEl, 'custGeom');
  if (cust) {
    const custom = parseCustGeom(cust);
    if (custom) return { geometry: 'custom', adj: undefined, custom };
  }
  const prst = child(spPrEl, 'prstGeom');
  if (!prst) return { geometry: 'rect', adj: undefined, custom: null };
  // First adjust value, as a fraction of 100000 (used by roundRect radius).
  const gd = findFirst(child(prst, 'avLst'), 'gd');
  const m = gd?.getAttribute('fmla')?.match(/val\s+(-?\d+)/);
  return { geometry: prst.getAttribute('prst') || 'rect', adj: m ? parseInt(m[1], 10) / 100000 : undefined, custom: null };
}

/** <p:sp> and <p:cxnSp>. */
function parseSp(el, pc) {
  const ph = pc.placeholders ? getPh(el) : null;
  const chain = [...placeholderParents(ph, pc), el]; // low → high priority
  const high = [...chain].reverse();
  const spPrs = chain.map((e) => child(e, 'spPr'));

  const xf = high.map((e) => parseXfrm(path(e, 'spPr', 'xfrm'))).find(Boolean);
  if (!xf) return null; // nothing gives this shape a position

  const style = readStyle(el, pc);

  let fill = null;
  for (const spPr of [...spPrs].reverse()) {
    const f = fillChild(spPr);
    if (f) { fill = parseFillEl(f, pc); break; }
  }
  fill = fill || style?.fill || NONE;

  let linePartial = { ...(style?.line || {}) };
  for (const spPr of spPrs) linePartial = { ...linePartial, ...parseLn(child(spPr, 'ln'), pc) };

  const geomSource = high.map((e) => child(e, 'spPr')).find((sp) => child(sp, 'prstGeom') || child(sp, 'custGeom'));
  const { geometry, adj, custom } = parseGeometry(geomSource);
  // Paths without their own coordinate size use the shape's size in EMU.
  const customPaths = custom?.map((p) => ({ ...p, w: p.w || xf.w * EMU_PER_PT, h: p.h || xf.h * EMU_PER_PT })) || null;

  let text = null;
  const txBody = child(el, 'txBody');
  if (txBody) {
    const kindEl = ph ? child(pc.placeholders.txStyles, txStyleKind(ph)) : null;
    text = buildText(txBody, pc, {
      bodyPrEls: chain.map((e) => path(e, 'txBody', 'bodyPr')).filter(Boolean),
      lstEls: [kindEl, ...chain.map((e) => path(e, 'txBody', 'lstStyle'))].filter(Boolean),
      defaultColor: style?.fontColor,
    });
  }

  return {
    type: 'shape',
    x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot, flipH: xf.flipH, flipV: xf.flipV,
    geometry, adj, custom: customPaths, fill, line: finishLine(linePartial), text,
    shadow: parseShadow(spPrs, pc),
  };
}

/** <p:pic>. */
function parsePic(el, pc) {
  const ph = pc.placeholders ? getPh(el) : null;
  const chain = [...placeholderParents(ph, pc), el];
  const xf = [...chain].reverse().map((e) => parseXfrm(path(e, 'spPr', 'xfrm'))).find(Boolean);
  if (!xf) return null;

  const blipFill = child(el, 'blipFill');
  const loadBlob = blipLoader(child(blipFill, 'blip'), pc);
  const { geometry, adj } = parseGeometry(child(el, 'spPr'));

  return {
    type: 'image',
    x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot, flipH: xf.flipH, flipV: xf.flipV,
    loadBlob, crop: parseSrcRect(blipFill), geometry, adj,
    line: finishLine(parseLn(path(el, 'spPr', 'ln'), pc)),
    shadow: parseShadow([child(el, 'spPr')], pc),
  };
}

/** <p:graphicFrame>: tables are parsed; charts, SmartArt and OLE become badges. */
function parseGraphicFrame(el, pc) {
  const ph = pc.placeholders ? getPh(el) : null;
  const chain = [...placeholderParents(ph, pc), el];
  const xf = [...chain].reverse().map((e) => parseXfrm(child(e, 'xfrm'))).find(Boolean);
  if (!xf) return null;
  const box = { x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot };

  const graphicData = path(el, 'graphic', 'graphicData');
  const uri = graphicData?.getAttribute('uri') || '';
  if (uri.includes('table')) return parseTable(graphicData, pc, box);
  if (uri.includes('chart')) {
    const chartId = findFirst(graphicData, 'chart')?.getAttribute('r:id');
    const chartXml = chartId ? pc.charts?.get(chartId) : null;
    const chart = chartXml ? parseChart(chartXml, pc.theme) : null;
    if (chart) return { type: 'chart', ...box, chart };
  }
  if (uri.includes('diagram')) {
    const dataModelId = findFirst(graphicData, 'relIds')?.getAttribute('r:dm');
    const drawingXml = dataModelId ? pc.diagrams?.get(dataModelId) : null;
    if (drawingXml) return parseDiagramDrawing(drawingXml, pc, box);
  }

  const label = uri.includes('chart') ? 'Chart' : uri.includes('diagram') ? 'SmartArt' : 'Embedded object';
  return { type: 'unsupported', label, ...box };
}

/**
 * SmartArt: PowerPoint stores a pre-drawn copy of each diagram as ordinary
 * shapes (positions relative to the frame). We draw that copy.
 */
function parseDiagramDrawing(drawingXml, pc, box) {
  const tree = findFirst(parseXml(drawingXml), 'spTree');
  // Not a slide context: no placeholder lookup and no ids (they would clash with the slide's).
  const diagramPc = { ...pc, placeholders: null };
  const shapes = [];
  for (const el of tree?.children || []) shapes.push(...parseShapeList(el, diagramPc));
  const shift = (list) => {
    for (const sh of list) {
      sh.x += box.x;
      sh.y += box.y;
      if (sh.type === 'group') shift(sh.shapes);
    }
  };
  shift(shapes);
  return { type: 'group', x: box.x, y: box.y, w: box.w, h: box.h, rot: 0, flipH: false, flipV: false, shapes };
}

// ─── Table styles ─────────────────────────────────────────────────────────────

const STYLE_PARTS = ['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'lastCol', 'firstCol', 'lastRow', 'firstRow'];
const BORDER_TAGS = [['left', 'l'], ['right', 'r'], ['top', 't'], ['bottom', 'b'], ['insideH', 'insideH'], ['insideV', 'insideV']];

/** Looks up a table style in ppt/tableStyles.xml; returns { part: {fill, color, bold, borders} } or null. */
function readTableStyle(pc, styleId) {
  const doc = parseXml(pc.tableStylesXml);
  if (!doc || !styleId) return null;
  const styleEl = Array.from(doc.getElementsByTagName('*'))
    .find((e) => e.localName === 'tblStyle' && e.getAttribute('styleId') === styleId);
  if (!styleEl) return null;

  const out = {};
  for (const part of STYLE_PARTS) {
    const partEl = child(styleEl, part);
    if (!partEl) continue;
    const o = {};

    const txStyle = child(partEl, 'tcTxStyle');
    if (txStyle) {
      if (txStyle.hasAttribute('b')) o.bold = txStyle.getAttribute('b') === 'on';
      for (const c of txStyle.children) {
        const color = resolveColorEl(c.localName === 'fontRef' ? c.firstElementChild : c, pc.theme);
        if (color) o.color = color;
      }
    }

    const tcStyle = child(partEl, 'tcStyle');
    if (tcStyle) {
      const fill = fillChild(child(tcStyle, 'fill'));
      if (fill) o.fill = parseFillEl(fill, pc);
      const bdr = child(tcStyle, 'tcBdr');
      if (bdr) {
        o.borders = {};
        for (const [tag, key] of BORDER_TAGS) {
          const b = child(bdr, tag);
          if (!b) continue;
          const lnRef = child(b, 'lnRef');
          if (lnRef) {
            const idx = intAttr(lnRef, 'idx', 0);
            const color = resolveColorEl(lnRef.firstElementChild, pc.theme);
            const lnEl = idx > 0 ? pc.theme.fmt.lines[idx - 1] : null;
            o.borders[key] = lnEl ? finishLine(parseLn(lnEl, pc, color)) : null;
          } else {
            o.borders[key] = finishLine(parseLn(child(b, 'ln'), pc));
          }
        }
      }
    }
    out[part] = o;
  }
  return out;
}

/** Combines a table style's layers for one cell (later layers win). */
function styleForCell(style, flags, ri, ci, nRows, nCols) {
  const layers = [style.wholeTbl];
  if (flags.bandRow) {
    const i = ri - (flags.firstRow ? 1 : 0);
    if (i >= 0) layers.push(i % 2 === 0 ? style.band1H : style.band2H);
  }
  if (flags.bandCol) {
    const i = ci - (flags.firstCol ? 1 : 0);
    if (i >= 0) layers.push(i % 2 === 0 ? style.band1V : style.band2V);
  }
  if (flags.lastCol && ci === nCols - 1) layers.push(style.lastCol);
  if (flags.firstCol && ci === 0) layers.push(style.firstCol);
  if (flags.lastRow && ri === nRows - 1) layers.push(style.lastRow);
  if (flags.firstRow && ri === 0) layers.push(style.firstRow);

  const out = {};
  const edges = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.fill) out.fill = layer.fill;
    if (layer.color) out.color = layer.color;
    if (layer.bold !== undefined) out.bold = layer.bold;
    Object.assign(edges, layer.borders);
  }
  out.borders = {
    t: ri === 0 ? edges.t : edges.insideH,
    b: ri === nRows - 1 ? edges.b : edges.insideH,
    l: ci === 0 ? edges.l : edges.insideV,
    r: ci === nCols - 1 ? edges.r : edges.insideV,
  };
  return out;
}

function parseTable(graphicData, pc, box) {
  const tbl = findFirst(graphicData, 'tbl');
  if (!tbl) return { type: 'unsupported', label: 'Table', ...box };

  const colWidths = children(child(tbl, 'tblGrid'), 'gridCol').map((gc) => emu(gc.getAttribute('w')));
  const trs = children(tbl, 'tr');
  const tblPr = child(tbl, 'tblPr');
  const flag = (n) => tblPr?.getAttribute(n) === '1';
  const flags = {
    firstRow: flag('firstRow'), lastRow: flag('lastRow'), firstCol: flag('firstCol'),
    lastCol: flag('lastCol'), bandRow: flag('bandRow'), bandCol: flag('bandCol'),
  };
  const style = readTableStyle(pc, child(tblPr, 'tableStyleId')?.textContent?.trim());

  const rows = trs.map((tr, ri) => ({
    h: emu(tr.getAttribute('h')),
    cells: children(tr, 'tc').map((tc, ci) => {
      const styled = style ? styleForCell(style, flags, ri, ci, trs.length, colWidths.length) : null;
      const tcPr = child(tc, 'tcPr');
      const txBody = child(tc, 'txBody');
      const insets = {
        l: tcPr?.hasAttribute('marL') ? emu(tcPr.getAttribute('marL')) : 7.2,
        r: tcPr?.hasAttribute('marR') ? emu(tcPr.getAttribute('marR')) : 7.2,
        t: tcPr?.hasAttribute('marT') ? emu(tcPr.getAttribute('marT')) : 3.6,
        b: tcPr?.hasAttribute('marB') ? emu(tcPr.getAttribute('marB')) : 3.6,
        anchor: tcPr?.getAttribute('anchor') || 't',
      };
      const explicit = {};
      for (const [tag, key] of [['lnL', 'l'], ['lnR', 'r'], ['lnT', 't'], ['lnB', 'b']]) {
        const ln = child(tcPr, tag);
        if (ln) explicit[key] = finishLine(parseLn(ln, pc));
      }
      // Explicit cell borders win over the table style; with neither, the renderer draws hairlines.
      const hasExplicit = Object.keys(explicit).length > 0;
      const borders = styled ? { ...styled.borders, ...explicit } : hasExplicit ? explicit : null;
      const explicitFill = fillChild(tcPr);
      return {
        text: txBody ? buildText(txBody, pc, { insets, defaultColor: styled?.color, defaultBold: styled?.bold }) : null,
        fill: explicitFill ? parseFillEl(explicitFill, pc) : styled?.fill || NONE,
        borders,
        gridSpan: intAttr(tc, 'gridSpan', 1),
        rowSpan: intAttr(tc, 'rowSpan', 1),
        hMerge: tc.getAttribute('hMerge') === '1',
        vMerge: tc.getAttribute('vMerge') === '1',
      };
    }),
  }));

  return { type: 'table', ...box, rows, colWidths };
}

/**
 * <p:grpSp>. Children live in the group's child coordinate space
 * (chOff/chExt); they are mapped into the parent's space here so the renderer
 * only needs to apply the group's own rotation/flip.
 */
function parseGrpSp(el, pc) {
  const xf = parseXfrm(path(el, 'grpSpPr', 'xfrm'));
  const kids = [];
  for (const c of el.children) {
    if (c.localName === 'grpSpPr' || c.localName.startsWith('nv')) continue;
    kids.push(...parseShapeList(c, pc));
  }
  if (!xf) return { type: 'group', x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false, shapes: kids };

  const sx = xf.chW ? xf.w / xf.chW : 1;
  const sy = xf.chH ? xf.h / xf.chH : 1;
  const mapInto = (shapes) => {
    for (const s of shapes) {
      s.x = xf.x + (s.x - xf.chX) * sx;
      s.y = xf.y + (s.y - xf.chY) * sy;
      s.w *= sx;
      s.h *= sy;
      if (s.type === 'group') mapInto(s.shapes);
    }
  };
  mapInto(kids);

  return {
    type: 'group',
    x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot, flipH: xf.flipH, flipV: xf.flipV,
    shapes: kids,
  };
}

/** Parses one spTree child into zero or more shapes. */
function parseShapeList(el, pc) {
  if (isHidden(el)) return [];
  let shape = null;
  switch (el.localName) {
    case 'sp':
    case 'cxnSp': shape = parseSp(el, pc); break;
    case 'pic': shape = parsePic(el, pc); break;
    case 'graphicFrame': shape = parseGraphicFrame(el, pc); break;
    case 'grpSp': shape = parseGrpSp(el, pc); break;
    case 'AlternateContent': {
      // Prefer the modern <mc:Choice>; fall back to <mc:Fallback>.
      const branch = child(el, 'Choice') || child(el, 'Fallback');
      return branch ? Array.from(branch.children).flatMap((c) => parseShapeList(c, pc)) : [];
    }
    default: break;
  }
  // Only slide shapes get an id: layout/master ids overlap with the slide's own,
  // and animations only ever target the slide's shapes.
  if (shape && pc.placeholders) shape.id = shapeId(el);
  return shape ? [shape] : [];
}

/** Non-placeholder shapes of a layout/master, drawn behind the slide's own. */
function parseDecor(doc, pc) {
  const spTree = findFirst(doc, 'spTree');
  if (!spTree) return [];
  const shapes = [];
  for (const el of spTree.children) {
    if (getPh(el)) continue;
    shapes.push(...parseShapeList(el, pc));
  }
  return shapes;
}

// ─── Background ───────────────────────────────────────────────────────────────

/** The <p:bg> of a document as a Fill, or null if it defines none. */
function parseBackground(doc, pc) {
  const bg = path(doc && findFirst(doc, 'cSld'), 'bg');
  if (!bg) return null;

  const bgPr = child(bg, 'bgPr');
  if (bgPr) {
    const f = fillChild(bgPr);
    return f ? parseFillEl(f, pc) : null;
  }

  const bgRef = child(bg, 'bgRef');
  if (bgRef) {
    const idx = intAttr(bgRef, 'idx', 0);
    const color = resolveColorEl(bgRef.firstElementChild, pc.theme);
    const styleEl = idx >= 1001 ? pc.theme.fmt.bgFills[idx - 1001] : pc.theme.fmt.fills[idx - 1];
    return styleEl ? parseFillEl(styleEl, pc, color) : color ? { type: 'solid', color } : null;
  }
  return null;
}

// ─── Animations ───────────────────────────────────────────────────────────────

/**
 * Reads the main animation sequence (<p:timing>) into build steps.
 *
 * Only what decides whether a shape is visible is modelled: entrance effects
 * show a shape, exit effects hide it, everything else (emphasis, motion,
 * timing, easing) is ignored. Each click starts a new step; effects that play
 * automatically are folded into the step before them.
 *
 * @returns {{ initialHidden: number[], clickSteps: Array<Array<{id:number, show:boolean}>> } | null}
 *   initialHidden: shape ids hidden when the slide first appears.
 *   clickSteps[k]: visibility changes caused by the (k+1)-th click.
 */
function parseAnimations(slideDoc) {
  const timing = findFirst(slideDoc, 'timing');
  const mainSeq = timing && Array.from(timing.getElementsByTagName('*'))
    .find((el) => el.localName === 'cTn' && el.getAttribute('nodeType') === 'mainSeq');
  if (!mainSeq) return null;

  // Effects of one step element, in document order.
  const effectsOf = (stepEl) => {
    const out = [];
    for (const cTn of stepEl.getElementsByTagName('*')) {
      const cls = cTn.localName === 'cTn' ? cTn.getAttribute('presetClass') : null;
      if (cls !== 'entr' && cls !== 'exit') continue;
      const ids = new Set();
      for (const t of cTn.getElementsByTagName('*')) {
        if (t.localName === 'spTgt') ids.add(parseInt(t.getAttribute('spid'), 10));
      }
      for (const id of ids) if (!Number.isNaN(id)) out.push({ id, show: cls === 'entr' });
    }
    return out;
  };
  // A step waits for a click when its start condition is delay="indefinite".
  const isClick = (stepEl) =>
    path(stepEl, 'cTn', 'stCondLst', 'cond')?.getAttribute('delay') === 'indefinite';

  const leadingAuto = [];
  const clickSteps = [];
  const all = [];
  for (const stepEl of children(child(mainSeq, 'childTnLst'), 'par')) {
    const effects = effectsOf(stepEl);
    all.push(...effects);
    if (isClick(stepEl)) clickSteps.push(effects);
    else if (clickSteps.length) clickSteps[clickSteps.length - 1].push(...effects);
    else leadingAuto.push(...effects);
  }

  // A shape whose first effect is an entrance starts hidden.
  const hidden = new Set();
  const seen = new Set();
  for (const { id, show } of all) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (show) hidden.add(id);
  }
  for (const { id, show } of leadingAuto) {
    if (show) hidden.delete(id);
    else hidden.add(id);
  }

  if (!clickSteps.length && !hidden.size) return null;
  return { initialHidden: [...hidden], clickSteps };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads slide dimensions (points) from presentation.xml's <p:sldSz>.
 */
export function parseSlideSize(presentationXml) {
  const sldSz = findFirst(parseXml(presentationXml), 'sldSz');
  if (!sldSz) return { width: DEFAULT_WIDTH_PT, height: DEFAULT_HEIGHT_PT };
  return { width: emu(sldSz.getAttribute('cx')), height: emu(sldSz.getAttribute('cy')) };
}

/**
 * Parses a slide into a SlideModel.
 *
 * @param {string} slideXml
 * @param {ThemeContext} themeCtx           from parse-theme.js
 * @param {Map<string, () => Promise<Blob>>} media   lazy loaders from unzip.js
 * @param {{width:number, height:number}} slideSize  points
 * @param {Map<string,string>} slideImageRels        slide rId → media path
 * @param {Object} [inherit]
 * @param {string|null} [inherit.layoutXml]
 * @param {string|null} [inherit.masterXml]
 * @param {Map<string,string>} [inherit.layoutImageRels]
 * @param {Map<string,string>} [inherit.masterImageRels]
 * @param {number} [inherit.slideNumber]    1-based, for slide-number fields
 * @param {Map<string,string>} [inherit.diagrams]  SmartArt data-model rId → fallback drawing XML
 * @param {Map<string,string>} [inherit.charts]    chart relationship rId → chart part XML
 * @param {string|null} [inherit.tableStylesXml]   ppt/tableStyles.xml
 */
export function parseSlide(slideXml, themeCtx, media, slideSize, slideImageRels = new Map(), inherit = {}) {
  const width = slideSize?.width ?? DEFAULT_WIDTH_PT;
  const height = slideSize?.height ?? DEFAULT_HEIGHT_PT;
  const slideDoc = parseXml(slideXml);
  const layoutDoc = parseXml(inherit.layoutXml);
  const masterDoc = parseXml(inherit.masterXml);

  const fallbackBg = { type: 'solid', color: themeCtx.resolveColor('bg1') };
  if (!slideDoc || slideDoc.documentElement.localName === 'parsererror') {
    return { width, height, background: fallbackBg, shapes: [] };
  }

  const slideNumber = inherit.slideNumber ?? 1;
  const layoutPc = {
    theme: themeCtx, media, rels: inherit.layoutImageRels || new Map(), slideNumber, placeholders: null,
  };
  const masterPc = { ...layoutPc, rels: inherit.masterImageRels || new Map() };
  const slidePc = {
    theme: themeCtx, media, rels: slideImageRels, slideNumber,
    diagrams: inherit.diagrams, charts: inherit.charts, tableStylesXml: inherit.tableStylesXml,
    placeholders: {
      layoutList: indexPlaceholders(layoutDoc),
      masterList: indexPlaceholders(masterDoc),
      txStyles: findFirst(masterDoc, 'txStyles'),
    },
  };

  const background =
    parseBackground(slideDoc, slidePc) ||
    parseBackground(layoutDoc, layoutPc) ||
    parseBackground(masterDoc, masterPc) ||
    fallbackBg;

  // Back to front: master graphics, layout graphics, then the slide itself.
  const shapes = [];
  const root = (doc) => doc?.documentElement;
  const slideShowsMaster = root(slideDoc).getAttribute('showMasterSp') !== '0';
  const layoutShowsMaster = root(layoutDoc)?.getAttribute('showMasterSp') !== '0';
  if (slideShowsMaster) {
    if (layoutShowsMaster && masterDoc) shapes.push(...parseDecor(masterDoc, masterPc));
    if (layoutDoc) shapes.push(...parseDecor(layoutDoc, layoutPc));
  }

  const spTree = findFirst(slideDoc, 'spTree');
  for (const el of spTree?.children || []) shapes.push(...parseShapeList(el, slidePc));

  return { width, height, background, shapes, animation: parseAnimations(slideDoc) };
}
