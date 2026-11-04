// viewer/renderer/parse-theme.js
// Resolves OOXML theme chain: slide → layout → master → theme
// Extracts color scheme and font scheme into a ThemeContext object.
//
// export function parseThemeChain(slideXml, layoutXml, masterXml, themeXml) → ThemeContext

'use strict';

// ─── XML Helpers ─────────────────────────────────────────────────────────────
const parser = new DOMParser();

function parseXml(xmlStr) {
  if (!xmlStr) return null;
  return parser.parseFromString(xmlStr, 'application/xml');
}

/**
 * Finds the first element matching a namespace-local-name pair,
 * searching across all namespace prefixes (robust to varied OOXML exports).
 * @param {Element|Document} root
 * @param {string} localName
 * @returns {Element|null}
 */
function findFirst(root, localName) {
  const els = (root.getElementsByTagNameNS
    ? root.getElementsByTagName('*')
    : []);
  for (const el of els) {
    if (el.localName === localName) return el;
  }
  return null;
}

function findAll(root, localName) {
  const results = [];
  const els = root.getElementsByTagName('*');
  for (const el of els) {
    if (el.localName === localName) results.push(el);
  }
  return results;
}

// ─── Color Resolution ─────────────────────────────────────────────────────────

/**
 * Standard OOXML color scheme slot names → index in the theme clrScheme.
 */
const COLOR_SCHEME_ORDER = [
  'dk1', 'lt1', 'dk2', 'lt2',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hlink', 'folHlink',
];

/**
 * Parses a <a:clrScheme> element and returns a map of slot → hex color string.
 * @param {Element} clrSchemeEl
 * @returns {Object<string, string>}
 */
function parseColorScheme(clrSchemeEl) {
  if (!clrSchemeEl) return {};
  const colors = {};
  for (const slot of COLOR_SCHEME_ORDER) {
    const slotEl = findFirst(clrSchemeEl, slot) || clrSchemeEl.querySelector(`*[*|name="${slot}"]`);
    if (!slotEl) continue;
    const srgbEl = findFirst(slotEl, 'srgbClr');
    const sysEl  = findFirst(slotEl, 'sysClr');
    if (srgbEl) {
      colors[slot] = `#${srgbEl.getAttribute('val') || '000000'}`;
    } else if (sysEl) {
      // sysClr lastClr is the fallback hex value
      colors[slot] = `#${sysEl.getAttribute('lastClr') || '000000'}`;
    }
  }
  return colors;
}

/**
 * Parses a <a:fontScheme> element and returns { majorFont, minorFont }.
 * @param {Element} fontSchemeEl
 * @returns {{ majorFont: string, minorFont: string }}
 */
function parseFontScheme(fontSchemeEl) {
  if (!fontSchemeEl) return { majorFont: 'Calibri', minorFont: 'Calibri' };

  function getLatinFont(container) {
    const latinEl = findFirst(container, 'latin');
    return latinEl?.getAttribute('typeface') || 'Calibri';
  }

  const majorEl = findFirst(fontSchemeEl, 'majorFont');
  const minorEl = findFirst(fontSchemeEl, 'minorFont');

  return {
    majorFont: majorEl ? getLatinFont(majorEl) : 'Calibri',
    minorFont: minorEl ? getLatinFont(minorEl) : 'Calibri',
  };
}

// ─── Background / Fill Resolution ─────────────────────────────────────────────

/**
 * Resolves a background fill color for a slide document.
 * Checks: slide bg → layout bg → master bg → white fallback.
 * @param {Document|null} slideDoc
 * @param {Document|null} layoutDoc
 * @param {Document|null} masterDoc
 * @param {Object} colorScheme
 * @returns {string} CSS color string
 */
function resolveBackground(slideDoc, layoutDoc, masterDoc, colorScheme) {
  const docs = [slideDoc, layoutDoc, masterDoc];
  for (const doc of docs) {
    if (!doc) continue;
    const bgEl = findFirst(doc, 'bg');
    if (!bgEl) continue;
    const solidFill = findFirst(bgEl, 'solidFill');
    if (!solidFill) continue;

    const srgb = findFirst(solidFill, 'srgbClr');
    if (srgb) return `#${srgb.getAttribute('val') || 'ffffff'}`;

    const schemeClr = findFirst(solidFill, 'schemeClr');
    if (schemeClr) {
      const slot = schemeClr.getAttribute('val');
      if (colorScheme[slot]) return colorScheme[slot];
    }
  }
  return '#ffffff';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a ThemeContext by parsing the full theme chain.
 *
 * ThemeContext is used downstream by parse-slide.js to resolve:
 *   - scheme color references (e.g. <a:schemeClr val="accent1"/>)
 *   - font theme references (e.g. <a:latin typeface="+mj-lt"/>)
 *   - slide background color
 *
 * @param {string|null} slideXml
 * @param {string|null} layoutXml
 * @param {string|null} masterXml
 * @param {string|null} themeXml
 * @returns {ThemeContext}
 *
 * @typedef {Object} ThemeContext
 * @property {Object<string, string>} colorScheme  - slot → #rrggbb
 * @property {string} majorFont
 * @property {string} minorFont
 * @property {string} background  - CSS color for slide background
 * @property {Function} resolveColor  - (val: string) => string
 * @property {Function} resolveFont   - (typeface: string) => string
 */
export function parseThemeChain(slideXml, layoutXml, masterXml, themeXml) {
  const slideDoc  = parseXml(slideXml);
  const layoutDoc = parseXml(layoutXml);
  const masterDoc = parseXml(masterXml);
  const themeDoc  = parseXml(themeXml);

  // Color scheme comes from the theme XML primarily; master as fallback
  let colorScheme = {};
  if (themeDoc) {
    const clrSchemeEl = findFirst(themeDoc, 'clrScheme');
    colorScheme = parseColorScheme(clrSchemeEl);
  } else if (masterDoc) {
    const clrSchemeEl = findFirst(masterDoc, 'clrScheme');
    colorScheme = parseColorScheme(clrSchemeEl);
  }

  // Font scheme
  let fonts = { majorFont: 'Calibri', minorFont: 'Calibri' };
  if (themeDoc) {
    const fontSchemeEl = findFirst(themeDoc, 'fontScheme');
    fonts = parseFontScheme(fontSchemeEl);
  }

  // Background
  const background = resolveBackground(slideDoc, layoutDoc, masterDoc, colorScheme);

  /**
   * Resolves a schemeClr val attribute or a raw hex sRGB value to a CSS color.
   * @param {string} val - either a scheme slot name (e.g. "accent1") or a hex value
   * @returns {string} CSS hex color
   */
  function resolveColor(val) {
    if (!val) return '#000000';
    if (colorScheme[val]) return colorScheme[val];
    // If it looks like a 6-char hex value, prefix with #
    if (/^[0-9a-fA-F]{6}$/.test(val)) return `#${val}`;
    return '#000000';
  }

  /**
   * Resolves a typeface attribute that might be a theme reference.
   * "+mj-lt" → majorFont, "+mn-lt" → minorFont, else use as-is.
   * @param {string} typeface
   * @returns {string} actual font-family name
   */
  function resolveFont(typeface) {
    if (!typeface) return fonts.minorFont;
    if (typeface === '+mj-lt' || typeface === '+mj-ea' || typeface === '+mj-cs') return fonts.majorFont;
    if (typeface === '+mn-lt' || typeface === '+mn-ea' || typeface === '+mn-cs') return fonts.minorFont;
    return typeface;
  }

  return {
    colorScheme,
    majorFont: fonts.majorFont,
    minorFont: fonts.minorFont,
    background,
    resolveColor,
    resolveFont,
  };
}
