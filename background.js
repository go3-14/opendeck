// background.js — PPTX Viewer Extension Service Worker
// Milestone 3: Download interception + file handoff to viewer

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const VIEWER_URL = chrome.runtime.getURL('viewer/viewer.html');
const SESSION_KEY = 'pptx_pending';
const IDB_DB_NAME = 'pptx_viewer';
const IDB_STORE_NAME = 'pptx_store';
const IDB_KEY = 'pending_file';
const SIZE_THRESHOLD = 8 * 1024 * 1024; // 8 MB

// ─── Deduplication guard ─────────────────────────────────────────────────────
// Tracks download IDs currently being processed to prevent double-opening
const processingIds = new Set();

// ─── Toolbar icon click → manual mode ────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${VIEWER_URL}?mode=manual` });
});

// ─── Download interception ────────────────────────────────────────────────────
/**
 * Determines if a download item is a PPTX file by checking:
 *   1. The filename extension (most reliable)
 *   2. The MIME type (fallback for extensionless URLs)
 */
function isPptx(item) {
  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const byExt = item.filename && item.filename.toLowerCase().endsWith('.pptx');
  const byMime = item.mime && item.mime.toLowerCase() === PPTX_MIME;
  return byExt || byMime;
}

// onDeterminingFilename fires before the file is saved; cancelling here
// prevents the native save dialog / auto-save from completing.
// 'blocking' is required so our suggest() call controls the filename dialog.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!isPptx(item)) {
    // Not a PPTX — let it through untouched
    suggest();
    return;
  }

  // Cancel the native download immediately (synchronous)
  chrome.downloads.cancel(item.id);
  // Signal we handled suggestion (required by the API)
  suggest({ filename: item.filename, conflictAction: 'uniquify' });

  // Note: Service Workers may suspend during long fetches. 
  // In a production app, keep-alive pinging or Alarm API would be used here.
  // Hand off to the fetch + storage pipeline
  handlePptxDownload(item);
}, ['blocking']);

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE_NAME);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function writeIdb(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(value, IDB_KEY);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ─── Fetch + storage routing ──────────────────────────────────────────────────
/**
 * Fetches the PPTX bytes (with credentials for auth-walled downloads),
 * stores them in session storage or IndexedDB depending on size,
 * then opens the viewer tab.
 */
async function fetchAndStore(url, filename) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }
  const bytes = await response.arrayBuffer();

  const payload = { filename, bytes, timestamp: Date.now() };

  if (bytes.byteLength <= SIZE_THRESHOLD) {
    // Small file → chrome.storage.session (structured-clone, no base64 overhead)
    await chrome.storage.session.set({ [SESSION_KEY]: payload });
    await chrome.storage.session.remove('pptx_idb'); // clear any stale IDB flag
  } else {
    // Large file → IndexedDB (unlimited size)
    const db = await openIdb();
    await writeIdb(db, payload);
    db.close();
    // Write a flag to session so viewer knows to read from IDB
    await chrome.storage.session.set({ pptx_idb: true });
    await chrome.storage.session.remove(SESSION_KEY);
  }
}

// ─── Main handler: tab creation, dedup, error notification ───────────────────
/**
 * Orchestrates the full PPTX interception flow:
 *   1. Dedup guard — skip if this download ID is already being processed
 *   2. Fetch + store bytes
 *   3. Open viewer tab
 *   4. On error: show notification guiding user to open file manually
 */
async function handlePptxDownload(item) {
  // Deduplication: prevent double-processing if the event fires multiple times
  if (processingIds.has(item.id)) return;
  processingIds.add(item.id);

  try {
    await fetchAndStore(item.url, item.filename || 'presentation.pptx');
    await chrome.tabs.create({ url: `${VIEWER_URL}?mode=intercepted` });
  } catch (err) {
    console.error('[PPTX Viewer] Failed to intercept download:', err);

    // Show a user-facing notification explaining what happened
    chrome.notifications.create(`pptx-error-${item.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'PPTX Viewer — Could not open file',
      message:
        `Could not fetch "${item.filename || 'the file'}". ` +
        'You can open the downloaded file manually via the extension toolbar button.',
      priority: 1,
    });
  } finally {
    // Always clean up the dedup set, even on error
    processingIds.delete(item.id);
  }
}
