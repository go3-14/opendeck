// src/renderer/dark.js
// "Smart invert" for dark mode: every colour the renderer draws with is mapped so
// light things become dark and dark things become light, while the hue is kept
// (a white page turns near-black, black text turns near-white, blue stays blue-ish).
// Pictures are not touched, because drawImage carries no colour of its own.
//
// Instead of editing every place that sets a colour, the 2D context is wrapped in a
// Proxy that maps colour assignments and gradient stops on the way through.

import { hslToRgb, rgbToHsl } from './color.js';

const cache = new Map();

/** Lightness mapping: 1 (white) → 0.08, 0 (black) → 0.92. */
const invertLightness = (l) => 0.08 + 0.84 * (1 - l);

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Maps one CSS colour string; anything it does not understand is returned as is. */
export function invertColor(css) {
  if (typeof css !== 'string') return css;
  const hit = cache.get(css);
  if (hit !== undefined) return hit;

  let r;
  let g;
  let b;
  let a = 1;
  const hex = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const fn = css.trim().match(/^rgba?\(([^)]+)\)$/i);
    if (!fn) return css;
    const nums = fn[1].match(/[\d.]+/g)?.map(Number);
    if (!nums || nums.length < 3) return css;
    [r, g, b] = nums;
    if (nums.length > 3) a = nums[3];
  }

  const [h, s, l] = rgbToHsl(r, g, b);
  const [r2, g2, b2] = hslToRgb(h, s, invertLightness(l));
  const out = a < 1 ? `rgba(${r2}, ${g2}, ${b2}, ${a})` : `#${hex2(r2)}${hex2(g2)}${hex2(b2)}`;
  if (cache.size > 2000) cache.clear();
  cache.set(css, out);
  return out;
}

// Shadows keep their colour: a dark shadow still reads as a shadow on a dark page.
const COLOUR_PROPS = new Set(['fillStyle', 'strokeStyle']);
const GRADIENTS = new Set(['createLinearGradient', 'createRadialGradient', 'createConicGradient']);

/** Returns a 2D context that draws every colour inverted. */
export function wrapContext(ctx) {
  return new Proxy(ctx, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (GRADIENTS.has(prop)) {
        return (...args) => {
          const gradient = value.apply(target, args);
          const addStop = gradient.addColorStop.bind(gradient);
          gradient.addColorStop = (offset, colour) => addStop(offset, invertColor(colour));
          return gradient;
        };
      }
      return value.bind(target);
    },
    set(target, prop, value) {
      target[prop] = COLOUR_PROPS.has(prop) && typeof value === 'string' ? invertColor(value) : value;
      return true;
    },
  });
}
