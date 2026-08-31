// background.js — PPTX Viewer Extension Service Worker

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const VIEWER_URL     = chrome.runtime.getURL('viewer/viewer.html');
const SESSION_KEY    = 'pptx_pending';
const IDB_DB_NAME    = 'pptx_viewer';
const IDB_STORE_NAME = 'pptx_store';
const IDB_KEY        = 'pending_file';
const SIZE_THRESHOLD = 8 * 1024 * 1024; // 8 MB

// Deduplication: track download IDs being processed
const processingIds = new Set();

// ─── Toolbar icon click → manual mode ────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${VIEWER_URL}?mode=manual` });
});

// ─── PPTX detection ──────────────────────────────────────────────────────────
function isPptx(item) {
  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const byExt  = item.filename && item.filename.toLowerCase().endsWith('.pptx');
  const byMime = item.mime     && item.mime.toLowerCase() === PPTX_MIME;
  return byExt || byMime;
}

// ─── Download interception ────────────────────────────────────────────────────
// onDeterminingFilename fires before Chrome saves the file.
// MV3: no filter array allowed — just addListener(callback) with no third arg.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!isPptx(item)) {
    suggest(); // pass through non-PPTX downloads untouched
    return;
  }

  // Suggest a filename so Chrome is satisfied, then immediately cancel.
  suggest({ filename: item.filename || 'presentation.pptx', conflictAction: 'uniquify' });
  chrome.downloads.cancel(item.id);

  // Kick off the fetch + store + open-tab pipeline asynchronously.
  handlePptxDownload(item);
});

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE_NAME);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function writeIdb(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(value, IDB_KEY);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ─── Fetch + store ────────────────────────────────────────────────────────────
async function fetchAndStore(url, filename) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);

  const bytes   = await response.arrayBuffer();
  const payload = { filename, bytes, timestamp: Date.now() };

  if (bytes.byteLength <= SIZE_THRESHOLD) {
    await chrome.storage.session.set({ [SESSION_KEY]: payload });
    await chrome.storage.session.remove('pptx_idb');
  } else {
    const db = await openIdb();
    await writeIdb(db, payload);
    db.close();
    await chrome.storage.session.set({ pptx_idb: true });
    await chrome.storage.session.remove(SESSION_KEY);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handlePptxDownload(item) {
  if (processingIds.has(item.id)) return;
  processingIds.add(item.id);

  try {
    await fetchAndStore(item.url, item.filename || 'presentation.pptx');
    await chrome.tabs.create({ url: `${VIEWER_URL}?mode=intercepted` });
  } catch (err) {
    console.error('[PPTX Viewer] Failed to intercept download:', err);
    chrome.notifications.create(`pptx-error-${item.id}`, {
      type:     'basic',
      iconUrl:  chrome.runtime.getURL('icons/icon128.png'),
      title:    'PPTX Viewer — Could not open file',
      message:  `Could not fetch "${item.filename || 'the file'}". Open it manually via the toolbar button.`,
      priority: 1,
    });
  } finally {
    processingIds.delete(item.id);
  }
}
