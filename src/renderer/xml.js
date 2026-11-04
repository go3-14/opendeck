// src/renderer/xml.js
// Small DOM helpers shared by the OOXML parsers. Elements are matched by
// localName so namespace prefixes (a:, p:, r:) never matter.

const parser = new DOMParser();
const cache = new Map();

/** Parses an XML string once; repeated calls with the same string reuse the document. */
export function parseXml(xmlStr) {
  if (!xmlStr) return null;
  let doc = cache.get(xmlStr);
  if (!doc) {
    doc = parser.parseFromString(xmlStr, 'application/xml');
    cache.set(xmlStr, doc);
  }
  return doc;
}

/** Call when a new presentation is opened so old documents can be collected. */
export function clearXmlCache() {
  cache.clear();
}

/** Direct child with the given localName, or null. */
export function child(el, localName) {
  if (!el) return null;
  for (const c of el.children) if (c.localName === localName) return c;
  return null;
}

/** All direct children with the given localName. */
export function children(el, localName) {
  if (!el) return [];
  const out = [];
  for (const c of el.children) if (c.localName === localName) out.push(c);
  return out;
}

/** First descendant (document order) with the given localName, or null. */
export function findFirst(root, localName) {
  if (!root) return null;
  for (const el of root.getElementsByTagName('*')) {
    if (el.localName === localName) return el;
  }
  return null;
}

/** Walks a chain of direct children: path(el, 'a', 'b') = child(child(el,'a'),'b'). */
export function path(el, ...names) {
  let cur = el;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return null;
  }
  return cur;
}

/** Integer attribute with a default. */
export function intAttr(el, name, fallback = 0) {
  const raw = el?.getAttribute(name);
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}
