// background.js — PPTX Viewer Extension Service Worker

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const VIEWER_URL = chrome.runtime.getURL('viewer/viewer.html');
const IDB_DB_NAME = 'pptx_viewer';
const IDB_STORE_NAME = 'pptx_store';

// Deduplication: prevent processing the same download twice
const processingIds = new Set();

// ─── Toolbar icon click → manual mode ────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${VIEWER_URL}?mode=manual` });
});

// ─── PPTX detection ──────────────────────────────────────────────────────────
function isPptx(item) {
  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const byExt = item.filename && item.filename.toLowerCase().endsWith('.pptx');
  const byMime = item.mime && item.mime.toLowerCase() === PPTX_MIME;
  return byExt || byMime;
}

// ─── Download interception via onCreated ──────────────────────────────────────
// onCreated fires as soon as Chrome registers the download.
// We cancel it immediately, then fetch+store+open the viewer ourselves.
// This avoids relying on onDeterminingFilename's suggest() flow in MV3.
chrome.downloads.onCreated.addListener((item) => {
  if (!isPptx(item)) return;
  chrome.downloads.cancel(item.id);
  handlePptxDownload(item);
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
  });
}

// ─── Fetch + store ────────────────────────────────────────────────────────────
async function fetchAndStore(url, filename) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);

  const bytes = await response.arrayBuffer();
  // Keep the bytes in IndexedDB. chrome.storage is intended for JSON-like
  // values; storing an ArrayBuffer there is browser/version dependent and can
  // result in the viewer seeing no usable payload. Pass only an opaque key in
  // the tab URL and keep the file bytes in the extension's local database.
  const handoffId = crypto.randomUUID();
  const db = await openIdb();
  await writeIdb(db, handoffId, { filename, bytes, timestamp: Date.now() });
  db.close();
  return handoffId;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handlePptxDownload(item) {
  if (processingIds.has(item.id)) return;
  processingIds.add(item.id);

  try {
    const handoffId = await fetchAndStore(item.url, item.filename || 'presentation.pptx');
    await chrome.tabs.create({
      url: `${VIEWER_URL}?mode=intercepted&handoff=${encodeURIComponent(handoffId)}`,
    });
  } catch (err) {
    console.error('[PPTX Viewer] Failed to intercept download:', err);
    chrome.notifications.create(`pptx-error-${item.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'PPTX Viewer — Could not open file',
      message: `Could not fetch "${item.filename || 'the file'}". Open it manually via the toolbar button.`,
      priority: 1,
    });
  } finally {
    processingIds.delete(item.id);
  }
}
