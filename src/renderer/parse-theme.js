// src/renderer/parse-theme.js
// Resolves the OOXML theme chain: slide → layout → master → theme.
// Produces a ThemeContext with the colour scheme (honouring the master's
// colour map and any layout/slide overrides), the font scheme, and the
// theme's fill / line style lists used by <p:style> references.
//
// export function parseThemeChain(slideXml, layoutXml, masterXml, themeXml) → ThemeContext

import { child, findFirst, parseXml } from './xml.js';

// ─── Colour scheme ────────────────────────────────────────────────────────────

const COLOR_SLOTS = [
  'dk1', 'lt1', 'dk2', 'lt2',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hlink', 'folHlink',
];

/** <a:clrScheme> → { slot: '#rrggbb' } */
function parseColorScheme(clrSchemeEl) {
  const colors = {};
  if (!clrSchemeEl) return colors;
  for (const slot of COLOR_SLOTS) {
    const slotEl = child(clrSchemeEl, slot);
    const valueEl = slotEl?.firstElementChild;
    if (!valueEl) continue;
    if (valueEl.localName === 'srgbClr') {
      colors[slot] = `#${valueEl.getAttribute('val') || '000000'}`;
    } else if (valueEl.localName === 'sysClr') {
      colors[slot] = `#${valueEl.getAttribute('lastClr') || '000000'}`;
    }
  }
  return colors;
}

/**
 * Colour map: how slide-level names (bg1, tx1, ...) map onto theme slots
 * (lt1, dk1, ...). The master defines it; layouts and slides may override.
 */
function parseColorMap(masterDoc, layoutDoc, slideDoc) {
  const map = {
    bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2',
    accent1: 'accent1', accent2: 'accent2', accent3: 'accent3',
    accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
    hlink: 'hlink', folHlink: 'folHlink',
  };
  const apply = (el) => {
    if (!el) return;
    for (const attr of el.attributes) map[attr.name] = attr.value;
  };
  apply(findFirst(masterDoc, 'clrMap'));
  for (const doc of [layoutDoc, slideDoc]) {
    const ovr = findFirst(doc, 'clrMapOvr');
    apply(child(ovr, 'overrideClrMapping'));
  }
  return map;
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

function parseFontScheme(fontSchemeEl) {
  const latin = (container) =>
    child(container, 'latin')?.getAttribute('typeface') || 'Calibri';
  const major = child(fontSchemeEl, 'majorFont');
  const minor = child(fontSchemeEl, 'minorFont');
  return {
    majorFont: major ? latin(major) : 'Calibri',
    minorFont: minor ? latin(minor) : 'Calibri',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ThemeContext
 * @property {Object<string,string>} colorScheme   slot → #rrggbb
 * @property {string} majorFont
 * @property {string} minorFont
 * @property {{fills: Element[], lines: Element[], bgFills: Element[]}} fmt
 *           the theme's fill, line and background-fill style lists
 * @property {(val: string) => string} resolveColor  scheme name → #rrggbb
 * @property {(typeface: string) => string} resolveFont  "+mn-lt" etc → family
 */
export function parseThemeChain(slideXml, layoutXml, masterXml, themeXml) {
  const slideDoc = parseXml(slideXml);
  const layoutDoc = parseXml(layoutXml);
  const masterDoc = parseXml(masterXml);
  const themeDoc = parseXml(themeXml);

  const colorScheme = parseColorScheme(findFirst(themeDoc || masterDoc, 'clrScheme'));
  const colorMap = parseColorMap(masterDoc, layoutDoc, slideDoc);

  const fonts = themeDoc
    ? parseFontScheme(findFirst(themeDoc, 'fontScheme'))
    : { majorFont: 'Calibri', minorFont: 'Calibri' };

  const fmtScheme = findFirst(themeDoc, 'fmtScheme');
  const fmt = {
    fills: listChildren(child(fmtScheme, 'fillStyleLst')),
    lines: listChildren(child(fmtScheme, 'lnStyleLst')),
    bgFills: listChildren(child(fmtScheme, 'bgFillStyleLst')),
  };

  function resolveColor(val) {
    if (!val) return '#000000';
    const slot = colorMap[val] ?? val;
    if (colorScheme[slot]) return colorScheme[slot];
    if (colorScheme[val]) return colorScheme[val];
    if (/^[0-9a-fA-F]{6}$/.test(val)) return `#${val}`;
    return '#000000';
  }

  function resolveFont(typeface) {
    if (!typeface) return fonts.minorFont;
    if (typeface.startsWith('+mj-')) return fonts.majorFont;
    if (typeface.startsWith('+mn-')) return fonts.minorFont;
    return typeface;
  }

  return {
    colorScheme,
    majorFont: fonts.majorFont,
    minorFont: fonts.minorFont,
    fmt,
    resolveColor,
    resolveFont,
  };
}

function listChildren(el) {
  return el ? Array.from(el.children) : [];
}
