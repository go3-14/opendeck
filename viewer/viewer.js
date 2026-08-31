// viewer/viewer.js
// Main orchestrator for the PPTX Viewer page.
// Handles: mode detection, file loading, render pipeline, thumbnails,
//          keyboard nav, zoom, drag-drop, and PNG export.

'use strict';

import { unzipPptx } from './renderer/unzip.js';
import { parseThemeChain } from './renderer/parse-theme.js';
import { parseSlide, parseSlideSize } from './renderer/parse-slide.js';
import { renderSlide } from './renderer/render-canvas.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const SESSION_KEY   = 'pptx_pending';
const IDB_DB_NAME   = 'pptx_viewer';
const IDB_STORE_NAME = 'pptx_store';
const IDB_KEY       = 'pending_file';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.15;
const THUMBNAIL_SCALE = 156 / 720; // ~0.217 — thumbnail canvas is 156px wide

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  slides:       [],   // SlideModel[]
  currentIndex: 0,
  zoom:         1.0,
  filename:     'presentation.pptx',
};

// ─── DOM References ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const overlay          = $('overlay');
const overlayMsg       = $('overlay-message');
const overlaySpinner   = $('overlay-spinner');
const app              = $('app');
const manualPicker     = $('manual-picker');
const fileInput        = $('file-input');
const slideCanvas      = $('slide-canvas');
const thumbnailList    = $('thumbnail-list');
const slideCurrentEl   = $('slide-current');
const slideTotalEl     = $('slide-total');
const zoomLabel        = $('zoom-label');
const toolbarFilename  = $('toolbar-filename');
const btnPrev          = $('btn-prev');
const btnNext          = $('btn-next');
const btnZoomIn        = $('btn-zoom-in');
const btnZoomOut       = $('btn-zoom-out');
const btnExport        = $('btn-export');
const btnOpenFile      = $('btn-open-file');
const exportProgress   = $('export-progress');
const exportFill       = $('export-progress-fill');
const exportLabel      = $('export-progress-label');

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE_NAME);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror  = e => reject(e.target.error);
  });
}

function readIdb(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.get(IDB_KEY);
    req.onsuccess = e => {
      store.delete(IDB_KEY); // consume it
      resolve(e.target.result);
    };
    req.onerror = e => reject(e.target.error);
  });
}

// ─── Overlay helpers ──────────────────────────────────────────────────────────
function showOverlay(message, spinner = true) {
  overlayMsg.textContent = message;
  overlaySpinner.style.display = spinner ? 'block' : 'none';
  overlay.classList.remove('hidden');
  overlay.removeAttribute('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  setTimeout(() => overlay.setAttribute('hidden', ''), 350);
}

function showError(message) {
  showOverlay(`⚠ ${message}`, false);
}

// ─── Mode Detection ───────────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  const mode   = params.get('mode') || 'manual';

  if (mode === 'intercepted') {
    showOverlay('Loading presentation…');
    await loadFromStorage();
  } else {
    showManualPicker();
  }

  wireUI();
}

// ─── File Loading: from storage ───────────────────────────────────────────────

/**
 * Reads the PPTX payload from chrome.storage.session or IndexedDB,
 * then kicks off the render pipeline.
 */
async function loadFromStorage() {
  try {
    // Check if the file was stored in session storage (small file)
    const session = await chrome.storage.session.get([SESSION_KEY, 'pptx_idb']);

    let payload;
    if (session[SESSION_KEY]) {
      payload = session[SESSION_KEY];
      await chrome.storage.session.remove(SESSION_KEY);
    } else if (session.pptx_idb) {
      const db = await openIdb();
      payload = await readIdb(db);
      db.close();
      await chrome.storage.session.remove('pptx_idb');
    } else {
      // Nothing in storage — fall back to manual picker
      showManualPicker();
      return;
    }

    await loadBytes(payload.bytes, payload.filename || 'presentation.pptx');
  } catch (err) {
    console.error('[PPTX Viewer] Storage read error:', err);
    showError('Could not load the presentation. Please open it manually.');
    showManualPicker();
  }
}

// ─── File Loading: from file picker / drop ────────────────────────────────────

function showManualPicker() {
  hideOverlay();
  app.setAttribute('hidden', '');
  manualPicker.removeAttribute('hidden');
}

async function loadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pptx')) {
    showError('Please choose a .pptx file.');
    return;
  }
  manualPicker.setAttribute('hidden', '');
  showOverlay(`Loading "${file.name}"…`);
  const bytes = await file.arrayBuffer();
  await loadBytes(bytes, file.name);
}

// ─── Core Render Pipeline ─────────────────────────────────────────────────────

/**
 * Main pipeline: unzip → parse theme → parse all slides → render → show UI
 * @param {ArrayBuffer} bytes
 * @param {string} filename
 */
async function loadBytes(bytes, filename) {
  showOverlay('Extracting PPTX…');
  state.filename = filename;
  toolbarFilename.textContent = filename;

  try {
    // 1. Unzip
    const {
      slideXmls, layoutXmls, masterXmls, themeXml,
      media, slideRels, slidePaths, layoutPaths, masterPaths,
    } = await unzipPptx(bytes);

    if (!slideXmls.length) {
      showError('No slides found in this file.');
      return;
    }

    showOverlay(`Parsing ${slideXmls.length} slides…`);

    // 2. Build slide→layout→master lookup
    // slideRels maps slidePath → { layoutPath, masterPath }
    // We also need to build image rels for each slide from the ZIP
    const imageRelsMap = await buildImageRels(bytes, slidePaths);

    // 3. Parse slide size from presentation.xml
    const presentationXml = await extractPresentationXml(bytes);
    const slideSize = parseSlideSize(presentationXml);

    // 4. Parse each slide
    state.slides = [];
    for (let i = 0; i < slideXmls.length; i++) {
      showOverlay(`Parsing slide ${i + 1} of ${slideXmls.length}…`);

      const slidePath  = slidePaths[i];
      const rels       = slideRels.get(slidePath) || {};
      const layoutIdx  = layoutPaths.indexOf(rels.layoutPath);
      const masterIdx  = masterPaths.indexOf(rels.masterPath);

      const layoutXml = layoutXmls[layoutIdx >= 0 ? layoutIdx : 0] || null;
      const masterXml = masterXmls[masterIdx >= 0 ? masterIdx : 0] || null;

      const themeCtx = parseThemeChain(slideXmls[i], layoutXml, masterXml, themeXml);
      const slideModel = parseSlide(
        slideXmls[i], themeCtx, media, slideSize,
        imageRelsMap.get(slidePaths[i]) || new Map()
      );

      state.slides.push(slideModel);
    }

    // 5. Render all thumbnails
    showOverlay('Rendering thumbnails…');
    await renderThumbnails();

    // 6. Show first slide
    state.currentIndex = 0;
    await goToSlide(0);

    // 7. Show UI
    slideTotalEl.textContent = state.slides.length;
    app.removeAttribute('hidden');
    hideOverlay();

  } catch (err) {
    console.error('[PPTX Viewer] Pipeline error:', err);
    showError(`Failed to render presentation: ${err.message}`);
  }
}

/**
 * Extracts ppt/presentation.xml from the PPTX archive.
 */
async function extractPresentationXml(bytes) {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const entry = zip.file('ppt/presentation.xml');
    return entry ? entry.async('text') : null;
  } catch {
    return null;
  }
}

/**
 * Builds a Map<slidePath, Map<rId, zipMediaPath>> for image relationships.
 */
async function buildImageRels(bytes, slidePaths) {
  const result = new Map();
  try {
    const zip = await JSZip.loadAsync(bytes);
    const REL_TYPE_IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

    for (const slidePath of slidePaths) {
      const dir  = slidePath.substring(0, slidePath.lastIndexOf('/'));
      const base = slidePath.substring(slidePath.lastIndexOf('/') + 1);
      const relsPath = `${dir}/_rels/${base}.rels`;
      const relsEntry = zip.file(relsPath);
      if (!relsEntry) continue;

      const relsXml = await relsEntry.async('text');
      const parser  = new DOMParser();
      const relsDoc = parser.parseFromString(relsXml, 'application/xml');
      const rIdMap  = new Map();

      for (const rel of relsDoc.querySelectorAll('Relationship')) {
        if ((rel.getAttribute('Type') || '') === REL_TYPE_IMG) {
          const rId    = rel.getAttribute('Id');
          const target = rel.getAttribute('Target');
          // Resolve relative target to absolute zip path
          const resolved = new URL(target, `https://x/${slidePath}`).pathname.slice(1);
          rIdMap.set(rId, resolved);
        }
      }

      result.set(slidePath, rIdMap);
    }
  } catch (err) {
    console.warn('[PPTX Viewer] buildImageRels error:', err);
  }
  return result;
}

// ─── Thumbnail Strip ──────────────────────────────────────────────────────────

async function renderThumbnails() {
  thumbnailList.innerHTML = '';

  for (let i = 0; i < state.slides.length; i++) {
    const slide = state.slides[i];
    const item  = document.createElement('div');
    item.className = 'thumbnail-item';
    item.tabIndex  = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Slide ${i + 1}`);
    item.dataset.index = i;

    const wrap   = document.createElement('div');
    wrap.className = 'thumbnail-item__canvas-wrap';

    const tnCanvas = document.createElement('canvas');
    await renderSlide(slide, tnCanvas, THUMBNAIL_SCALE, 1); // no DPR for thumbnails
    wrap.appendChild(tnCanvas);

    const label = document.createElement('span');
    label.className = 'thumbnail-item__label';
    label.textContent = i + 1;

    item.appendChild(wrap);
    item.appendChild(label);
    thumbnailList.appendChild(item);

    item.addEventListener('click',  () => goToSlide(i));
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') goToSlide(i); });
  }
}

function updateThumbnailActive(index) {
  for (const item of thumbnailList.querySelectorAll('.thumbnail-item')) {
    const active = parseInt(item.dataset.index) === index;
    item.classList.toggle('active', active);
  }
  // Scroll active thumbnail into view
  const active = thumbnailList.querySelector('.thumbnail-item.active');
  active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── Slide Navigation ─────────────────────────────────────────────────────────

async function goToSlide(index) {
  if (!state.slides.length) return;
  index = Math.max(0, Math.min(state.slides.length - 1, index));
  state.currentIndex = index;

  slideCurrentEl.textContent = index + 1;
  btnPrev.disabled = index === 0;
  btnNext.disabled = index === state.slides.length - 1;

  updateThumbnailActive(index);
  await renderSlide(state.slides[index], slideCanvas, state.zoom);
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

async function setZoom(newZoom) {
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  if (state.slides.length) {
    await renderSlide(state.slides[state.currentIndex], slideCanvas, state.zoom);
  }
}

// ─── Export (ZIP of PNGs) ─────────────────────────────────────────────────────

async function exportSlides() {
  if (!state.slides.length) return;
  btnExport.disabled = true;
  exportProgress.removeAttribute('hidden');

  const EXPORT_SCALE = 2.0; // 2× resolution for crisp export
  const zip = new JSZip();

  for (let i = 0; i < state.slides.length; i++) {
    const progress = (i + 1) / state.slides.length;
    exportFill.style.width = `${progress * 100}%`;
    exportLabel.textContent = `Exporting slide ${i + 1} of ${state.slides.length}…`;

    const offscreen = document.createElement('canvas');
    await renderSlide(state.slides[i], offscreen, EXPORT_SCALE, 1);

    const pngBlob = await new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
    const num = String(i + 1).padStart(String(state.slides.length).length, '0');
    zip.file(`slide_${num}.png`, pngBlob);

    // yield to UI
    await new Promise(r => setTimeout(r, 0));
  }

  exportLabel.textContent = 'Generating ZIP…';
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a   = document.createElement('a');
  const baseName = state.filename.replace(/\.pptx$/i, '');
  a.href     = url;
  a.download = `${baseName}_slides.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  exportProgress.setAttribute('hidden', '');
  btnExport.disabled = false;
}

// ─── UI Wiring ────────────────────────────────────────────────────────────────

function wireUI() {
  // Navigation
  btnPrev.addEventListener('click', () => goToSlide(state.currentIndex - 1));
  btnNext.addEventListener('click', () => goToSlide(state.currentIndex + 1));

  // Zoom
  btnZoomIn.addEventListener('click',  () => setZoom(state.zoom + ZOOM_STEP));
  btnZoomOut.addEventListener('click', () => setZoom(state.zoom - ZOOM_STEP));

  // Export
  btnExport.addEventListener('click', exportSlides);

  // Open file button in toolbar
  btnOpenFile.addEventListener('click', () => {
    app.setAttribute('hidden', '');
    showManualPicker();
  });

  // File picker
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) loadFile(file);
    fileInput.value = ''; // allow re-selecting same file
  });

  // Keyboard navigation
  document.addEventListener('keydown', onKeyDown);

  // Scroll-to-zoom on canvas area
  document.querySelector('.canvas-area')?.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(state.zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }
  }, { passive: false });

  // Drag-and-drop anywhere on the page
  document.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('drag-over');
  });
  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) document.body.classList.remove('drag-over');
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
}

// ─── Keyboard Navigation ──────────────────────────────────────────────────────

function onKeyDown(e) {
  // Don't intercept if focus is in an input
  if (e.target.tagName === 'INPUT') return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      goToSlide(state.currentIndex - 1);
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      goToSlide(state.currentIndex + 1);
      break;
    case 'Home':
      e.preventDefault();
      goToSlide(0);
      break;
    case 'End':
      e.preventDefault();
      goToSlide(state.slides.length - 1);
      break;
    case '+':
    case '=':
      setZoom(state.zoom + ZOOM_STEP);
      break;
    case '-':
      setZoom(state.zoom - ZOOM_STEP);
      break;
    case '0':
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(1.0); }
      break;
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
