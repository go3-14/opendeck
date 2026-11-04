// background.js — PPTX Viewer Extension Service Worker

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const VIEWER_URL = chrome.runtime.getURL('viewer.html');
const IDB_DB_NAME = 'pptx_viewer';
const IDB_STORE_NAME = 'pptx_store';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const STALE_HANDOFF_MS = 60 * 60 * 1000; // 1 hour

// Deduplication: prevent processing the same download twice
const processingIds = new Set();
// Downloads whose filename/MIME were not known yet at onCreated time.
const undecidedIds = new Set();

// ─── Toolbar icon click → manual mode ────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${VIEWER_URL}?mode=manual` });
});

// ─── PPTX detection ──────────────────────────────────────────────────────────
function urlPathEndsWithPptx(url) {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pptx');
  } catch {
    return false;
  }
}

function isPptx(item) {
  const byName = !!item.filename && item.filename.toLowerCase().endsWith('.pptx');
  const byMime = !!item.mime && item.mime.toLowerCase() === PPTX_MIME;
  const byUrl = urlPathEndsWithPptx(item.finalUrl) || urlPathEndsWithPptx(item.url);
  return byName || byMime || byUrl;
}

/** True when we have no signal either way yet (Chrome fills these in later). */
function isUndecided(item) {
  return !item.filename && !item.mime;
}

/** The service worker can only re-fetch network URLs. */
function isFetchable(url) {
  return /^https?:\/\//i.test(url || '');
}

function displayName(item) {
  const fromPath = (item.filename || '').split(/[\\/]/).pop();
  if (fromPath) return fromPath;
  try {
    return decodeURIComponent(new URL(item.finalUrl || item.url).pathname.split('/').pop()) || 'presentation.pptx';
  } catch {
    return 'presentation.pptx';
  }
}

// ─── Download interception ────────────────────────────────────────────────────
// The native download is left alone until the bytes are safely stored. If
// anything fails, the user still gets their normal download.
chrome.downloads.onCreated.addListener((item) => {
  if (isPptx(item)) {
    handlePptxDownload(item);
  } else if (isUndecided(item)) {
    undecidedIds.add(item.id);
  }
});

// filename / mime are often populated only after onCreated.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!undecidedIds.has(delta.id)) return;
  if (!delta.filename && !delta.mime) return;
  undecidedIds.delete(delta.id);
  try {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item && isPptx(item)) handlePptxDownload(item);
  } catch (err) {
    console.error('[PPTX Viewer] Could not look up download:', err);
  }
});

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE_NAME);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function writeIdb(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
    tx.onabort = (e) => reject(e.target.error);
  });
}

/** Removes handoff records the viewer never consumed (e.g. tab closed early). */
async function sweepStaleHandoffs() {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const req = tx.objectStore(IDB_STORE_NAME).openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const ts = cursor.value?.timestamp;
        if (typeof ts !== 'number' || Date.now() - ts > STALE_HANDOFF_MS) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
    db.close();
  } catch (err) {
    console.warn('[PPTX Viewer] Handoff sweep failed:', err);
  }
}

chrome.runtime.onStartup.addListener(sweepStaleHandoffs);
chrome.runtime.onInstalled.addListener(sweepStaleHandoffs);

// ─── Fetch + store ────────────────────────────────────────────────────────────
async function fetchAndStore(url, filename) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);

  const bytes = await response.arrayBuffer();
  // Keep the bytes in IndexedDB. chrome.storage is intended for JSON-like
  // values; pass only an opaque key in the tab URL.
  const handoffId = crypto.randomUUID();
  const db = await openIdb();
  try {
    await writeIdb(db, handoffId, { filename, bytes, timestamp: Date.now() });
  } finally {
    db.close();
  }
  return handoffId;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handlePptxDownload(item) {
  if (processingIds.has(item.id)) return;

  const url = item.finalUrl || item.url;
  if (!isFetchable(url)) {
    // blob:/data:/file: URLs can't be re-fetched from the service worker.
    // Leave the native download untouched.
    console.warn('[PPTX Viewer] Not intercepting non-http(s) download:', url);
    return;
  }

  processingIds.add(item.id);
  try {
    const name = displayName(item);
    const handoffId = await fetchAndStore(url, name);

    // Bytes are safely stored: now stop the native download and clean up.
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch (err) {
      console.warn('[PPTX Viewer] Could not cancel native download:', err);
    }

    await chrome.tabs.create({
      url: `${VIEWER_URL}?mode=intercepted&handoff=${encodeURIComponent(handoffId)}`,
    });
  } catch (err) {
    // Native download keeps going, so the user is never left without the file.
    console.error('[PPTX Viewer] Failed to intercept download:', err);
    chrome.notifications.create(`pptx-error-${item.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'PPTX Viewer — Could not open file',
      message: 'The file will download normally. Open it later via the toolbar button.',
      priority: 1,
    });
  } finally {
    processingIds.delete(item.id);
  }
}
