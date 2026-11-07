// src/renderer/color.js
// Resolves DrawingML colour elements (<a:srgbClr>, <a:schemeClr>, ...) with
// their modifiers (lumMod, tint, alpha, ...) to CSS colour strings.

// ─── Colour math ──────────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  if (typeof hex === 'string' && hex.startsWith('rgba')) {
    const [r, g, b] = hex.match(/[\d.]+/g).map(Number);
    return [r, g, b];
  }
  const h =String(hex || '#000000').replace('#', '').padEnd(6, '0');
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

function toCss([r, g, b], alpha) {
  if (alpha != null && alpha < 1) {
    return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${Math.max(0, alpha).toFixed(3)})`;
  }
  const hex = (v) => clamp255(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// A handful of <a:prstClr> names that differ from or aren't common CSS names.
const PRESET_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080',
  dkBlue: '00008B', dkGreen: '006400', dkRed: '8B0000', ltGray: 'D3D3D3', dkGray: 'A9A9A9',
  ltBlue: 'ADD8E6', ltGreen: '90EE90', cyan: '00FFFF', magenta: 'FF00FF',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolves a colour element to a CSS colour string, or null if unrecognised.
 *
 * @param {Element|null} colorEl  an <a:srgbClr>/<a:schemeClr>/... element
 * @param {{ resolveColor: (slot: string) => string }} themeCtx
 * @param {string} [phClr]  colour substituted for schemeClr val="phClr"
 *                          (used by theme style lists)
 */
export function resolveColorEl(colorEl, themeCtx, phClr) {
  if (!colorEl) return null;

  let rgb;
  switch (colorEl.localName) {
    case 'srgbClr':
      rgb = hexToRgb(colorEl.getAttribute('val'));
      break;
    case 'schemeClr': {
      const slot = colorEl.getAttribute('val');
      rgb = hexToRgb(slot === 'phClr' ? phClr : themeCtx.resolveColor(slot));
      break;
    }
    case 'sysClr':
      rgb = hexToRgb(colorEl.getAttribute('lastClr') || '000000');
      break;
    case 'prstClr':
      rgb = hexToRgb(PRESET_COLORS[colorEl.getAttribute('val')] || '000000');
      break;
    case 'hslClr':
      rgb = hslToRgb(
        (parseInt(colorEl.getAttribute('hue') || '0', 10) / 60000 % 360) / 360,
        parseInt(colorEl.getAttribute('sat') || '0', 10) / 100000,
        parseInt(colorEl.getAttribute('lum') || '0', 10) / 100000,
      );
      break;
    case 'scrgbClr':
      rgb = ['r', 'g', 'b'].map((k) => (parseInt(colorEl.getAttribute(k) || '0', 10) / 100000) * 255);
      break;
    default:
      return null;
  }

  let alpha = 1;
  // Modifiers apply in document order.
  for (const mod of colorEl.children) {
    const val = parseInt(mod.getAttribute('val') || '0', 10) / 100000;
    switch (mod.localName) {
      case 'tint': // keep `val` of the colour, rest white
        rgb = rgb.map((c) => 255 - (255 - c) * val);
        break;
      case 'shade': // keep `val` of the colour, rest black
        rgb = rgb.map((c) => c * val);
        break;
      case 'lumMod':
      case 'lumOff':
      case 'satMod':
      case 'satOff': {
        let [h, s, l] = rgbToHsl(...rgb);
        if (mod.localName === 'lumMod') l *= val;
        else if (mod.localName === 'lumOff') l += val;
        else if (mod.localName === 'satMod') s *= val;
        else s += val;
        rgb = hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
        break;
      }
      case 'alpha':
        alpha = val;
        break;
      case 'alphaMod':
        alpha *= val;
        break;
      case 'alphaOff':
        alpha += val;
        break;
      default:
        break;
    }
  }
  return toCss(rgb, alpha);
}
