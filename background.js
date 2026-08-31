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
