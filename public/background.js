// background.js — Opendeck Extension Service Worker

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const VIEWER_URL = chrome.runtime.getURL('viewer.html');
const IDB_DB_NAME = 'pptx_viewer';
const IDB_STORE_NAME = 'pptx_store';
// OOXML presentations: presentation, slideshow and template files (and their macro-enabled variants).
const PRESENTATION_EXTENSIONS = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'];
const EXTENSION_RE = new RegExp(`\\.(${PRESENTATION_EXTENSIONS.join('|')})$`, 'i');
const PRESENTATION_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
]);
const STALE_HANDOFF_MS = 60 * 60 * 1000; // 1 hour

// Access to websites is optional: the user turns it on in the viewer's settings.
const hasHostAccess = () => chrome.permissions.contains({ origins: ['<all_urls>'] });
const SETTINGS_URL = `${VIEWER_URL}?mode=manual&settings=1`;
let notifiedNoAccess = false;

/** Tells the user (once per browser session) how to allow opening downloads. */
function notifyNeedsAccess() {
  if (notifiedNoAccess) return;
  notifiedNoAccess = true;
  chrome.notifications.create('pptx-needs-access', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Opendeck — one more step',
    message: 'Click here to allow opening downloaded presentations in the viewer. The file downloads normally until then.',
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  if (id === 'pptx-needs-access') {
    chrome.tabs.create({ url: SETTINGS_URL });
    chrome.notifications.clear(id);
  }
});

// First install: show the settings so access can be granted right away.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.tabs.create({ url: SETTINGS_URL });
});

// Deduplication: prevent processing the same download twice
const processingIds = new Set();
// Downloads whose filename/MIME were not known yet at onCreated time.
const undecidedIds = new Set();

// ─── Toolbar icon click → manual mode ────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${VIEWER_URL}?mode=manual` });
});

// ─── PPTX detection ──────────────────────────────────────────────────────────
function urlPathIsPresentation(url) {
  if (!url) return false;
  try {
    return EXTENSION_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isPptx(item) {
  const byName = !!item.filename && EXTENSION_RE.test(item.filename);
  const byMime = !!item.mime && PRESENTATION_MIMES.has(item.mime.toLowerCase());
  const byUrl = urlPathIsPresentation(item.finalUrl) || urlPathIsPresentation(item.url);
  return byName || byMime || byUrl;
}

/** True when we have no signal either way yet (Chrome fills these in later). */
function isUndecided(item) {
  return !item.filename && !item.mime;
}

/**
 * The service worker can re-fetch network URLs, and local files when the user
 * has turned on "Allow access to file URLs" for the extension (otherwise the
 * fetch fails and the normal download carries on).
 */
function isFetchable(url) {
  return /^(https?|file):\/\//i.test(url || '');
}

function nameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'presentation.pptx';
  } catch {
    return 'presentation.pptx';
  }
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
    console.error('[Opendeck] Could not look up download:', err);
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
    console.warn('[Opendeck] Handoff sweep failed:', err);
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
    // blob:/data: URLs can't be re-fetched from the service worker.
    // Leave the native download untouched.
    console.warn('[Opendeck] Not intercepting download with an unsupported URL:', url);
    return;
  }

  if (!(await hasHostAccess())) {
    // No permission yet: leave the native download alone and explain how to enable this.
    notifyNeedsAccess();
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
      console.warn('[Opendeck] Could not cancel native download:', err);
    }

    await chrome.tabs.create({
      url: `${VIEWER_URL}?mode=intercepted&handoff=${encodeURIComponent(handoffId)}`,
    });
  } catch (err) {
    // Native download keeps going, so the user is never left without the file.
    console.error('[Opendeck] Failed to intercept download:', err);
    chrome.notifications.create(`pptx-error-${item.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Opendeck — Could not open file',
      message: /^file:/i.test(url)
        ? 'To open local files directly, turn on "Allow access to file URLs" for this extension. The file will download normally.'
        : 'The file will download normally. Open it later via the toolbar button.',
      priority: 1,
    });
  } finally {
    processingIds.delete(item.id);
  }
}

// ─── Right-click a link → "Open in Opendeck" ───────────────────────────────
const MENU_ID = 'open-in-viewer';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Open in Opendeck',
    contexts: ['link'],
    targetUrlPatterns: PRESENTATION_EXTENSIONS.flatMap((ext) => [
      `*://*/*.${ext}`, `*://*/*.${ext}?*`, `file:///*.${ext}`,
    ]),
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;
  const url = info.linkUrl;
  if (!(await hasHostAccess())) {
    chrome.tabs.create({ url: SETTINGS_URL });
    return;
  }
  try {
    const handoffId = await fetchAndStore(url, nameFromUrl(url));
    await chrome.tabs.create({
      url: `${VIEWER_URL}?mode=intercepted&handoff=${encodeURIComponent(handoffId)}`,
    });
  } catch (err) {
    console.error('[Opendeck] Could not open link:', err);
    chrome.notifications.create(`pptx-link-error-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Opendeck — Could not open link',
      message: /^file:/i.test(url)
        ? 'Turn on "Allow access to file URLs" for this extension to open local files.'
        : 'The file could not be fetched.',
      priority: 1,
    });
  }
});
