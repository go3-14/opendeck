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

  // Hand off to the fetch + storage pipeline
  handlePptxDownload(item);
});
