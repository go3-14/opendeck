// viewer/viewer.js
// Main orchestrator for the PPTX Viewer page.
// Handles: mode detection, file loading, render pipeline, thumbnails,
//          keyboard nav, zoom, drag-drop, and PNG export.

'use strict';

// Load renderer modules after the viewer shell has started. This keeps the
// manual picker usable even if a renderer module fails to import in a browser
// with a stale extension cache or an incompatible module error.
let unzipPptx;
let parseThemeChain;
let parseSlide;
let parseSlideSize;
let renderSlide;
const rendererReady = Promise.all([
  import('./renderer/unzip.js'),
  import('./renderer/parse-theme.js'),
  import('./renderer/parse-slide.js'),
  import('./renderer/render-canvas.js'),
]).then(([unzipModule, themeModule, slideModule, canvasModule]) => {
  unzipPptx = unzipModule.unzipPptx;
  parseThemeChain = themeModule.parseThemeChain;
  parseSlide = slideModule.parseSlide;
  parseSlideSize = slideModule.parseSlideSize;
  renderSlide = canvasModule.renderSlide;
});

// ─── Constants ────────────────────────────────────────────────────────────────
const IDB_DB_NAME = 'pptx_viewer';
const IDB_STORE_NAME = 'pptx_store';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.15;
const THUMBNAIL_SCALE = 156 / 720; // ~0.217 — thumbnail canvas is 156px wide

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  slides: [],   // SlideModel[]
  currentIndex: 0,
  zoom: 1.0,
  filename: 'presentation.pptx',
};

// ─── DOM References ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const overlay = $('overlay');
const overlayMsg = $('overlay-message');
const overlaySpinner = $('overlay-spinner');
const app = $('app');
const manualPicker = $('manual-picker');
const pickerError = $('picker-error');
const fileInput = $('file-input');
const slideCanvas = $('slide-canvas');
const thumbnailList = $('thumbnail-list');
const slideCurrentEl = $('slide-current');
const slideTotalEl = $('slide-total');
const zoomLabel = $('zoom-label');
const toolbarFilename = $('toolbar-filename');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const btnZoomIn = $('btn-zoom-in');
const btnZoomOut = $('btn-zoom-out');
const btnExport = $('btn-export');
const btnOpenFile = $('btn-open-file');
const exportProgress = $('export-progress');
const exportFill = $('export-progress-fill');
const exportLabel = $('export-progress-label');

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE_NAME);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function readIdb(db, key, consume = true) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = e => {
      if (consume) store.delete(key);
      resolve(e.target.result);
    };
    req.onerror = e => reject(e.target.error);
  });
}

// ─── Overlay helpers ──────────────────────────────────────────────────────────
let overlayHideTimer = null;

function showOverlay(message, spinner = true) {
  // A pending hide from an earlier hideOverlay() must not re-hide this overlay.
  clearTimeout(overlayHideTimer);
  overlayMsg.textContent = message;
  overlaySpinner.style.display = spinner ? 'block' : 'none';
  overlay.classList.remove('hidden');
  overlay.removeAttribute('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  clearTimeout(overlayHideTimer);
  overlayHideTimer = setTimeout(() => overlay.setAttribute('hidden', ''), 350);
}

/** Blocking error with no way forward (only for fatal startup problems). */
function showError(message) {
  showOverlay(`⚠ ${message}`, false);
}

/**
 * Non-fatal failure: hide the overlay and the app, show the file picker with
 * the error message so the user can immediately try another file.
 */
function failToPicker(message) {
  hideOverlay();
  app.setAttribute('hidden', '');
  manualPicker.removeAttribute('hidden');
  pickerError.textContent = `⚠ ${message}`;
  pickerError.removeAttribute('hidden');
}

// Surface anything that escapes a try/catch instead of leaving a stuck spinner.
window.addEventListener('error', e => {
  console.error('[PPTX Viewer] Uncaught error:', e.error || e.message);
  failToPicker(`Unexpected error: ${e.message || 'see console'}`);
});
window.addEventListener('unhandledrejection', e => {
  console.error('[PPTX Viewer] Unhandled rejection:', e.reason);
  failToPicker(`Unexpected error: ${e.reason?.message || e.reason || 'see console'}`);
});

// ─── Mode Detection ───────────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'manual';

  // Wire the UI first so buttons/drop work even if the renderer fails to load.
  wireUI();

  try {
    await rendererReady;
  } catch (err) {
    console.error('[PPTX Viewer] Renderer failed to load:', err);
    failToPicker(`Renderer failed to load: ${err.message || err}`);
    return;
  }

  if (mode === 'intercepted') {
    showOverlay('Loading presentation…');
    await loadFromStorage();
  } else {
    showManualPicker();
  }
}

// ─── File Loading: from storage ───────────────────────────────────────────────

/**
 * Reads the PPTX payload from IndexedDB using the one-time URL handoff ID,
 * then kicks off the render pipeline.
 */
async function loadFromStorage() {
  try {
    const params = new URLSearchParams(location.search);
    let handoffId = params.get('handoff');

    if (!handoffId) {
      failToPicker('No presentation was handed to the viewer. Please choose a file.');
      return;
    }

    const db = await openIdb();
    const payload = await readIdb(db, handoffId);
    db.close();

    if (!payload?.bytes) {
      failToPicker('The downloaded presentation is no longer available (already opened or expired). Please choose the file.');
      return;
    }

    await loadBytes(payload.bytes, payload.filename || 'presentation.pptx');
  } catch (err) {
    console.error('[PPTX Viewer] Storage read error:', err);
    failToPicker(`Could not load the presentation: ${err.message || err}`);
  }
}

// ─── File Loading: from file picker / drop ────────────────────────────────────

function showManualPicker() {
  hideOverlay();
  app.setAttribute('hidden', '');
  pickerError.setAttribute('hidden', '');
  manualPicker.removeAttribute('hidden');
}

async function loadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pptx')) {
    failToPicker('Please choose a .pptx file.');
    return;
  }
  pickerError.setAttribute('hidden', '');
  manualPicker.setAttribute('hidden', '');
  showOverlay(`Loading "${file.name}"…`);
  try {
    const bytes = await file.arrayBuffer();
    await loadBytes(bytes, file.name);
  } catch (err) {
    console.error('[PPTX Viewer] File read error:', err);
    failToPicker(`Could not read the file: ${err.message || err}`);
  }
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
    await rendererReady;

    // 1. Unzip
    const {
      slideXmls, layoutXmls, masterXmls, themeXml,
      media, slideRels, imageRels, presentationXml, slidePaths, layoutPaths, masterPaths,
    } = await unzipPptx(bytes);

    if (!slideXmls.length) {
      failToPicker('No slides found in this file.');
      return;
    }

    showOverlay(`Parsing ${slideXmls.length} slides…`);

    // 2. Parse slide size from the already-extracted presentation.xml
    const slideSize = parseSlideSize(presentationXml);

    // 3. Parse each slide
    state.slides = [];
    for (let i = 0; i < slideXmls.length; i++) {
      showOverlay(`Parsing slide ${i + 1} of ${slideXmls.length}…`);

      const slidePath = slidePaths[i];
      const rels = slideRels.get(slidePath) || {};
      const layoutIdx = layoutPaths.indexOf(rels.layoutPath);
      const masterIdx = masterPaths.indexOf(rels.masterPath);

      const layoutXml = layoutXmls[layoutIdx >= 0 ? layoutIdx : 0] || null;
      const masterXml = masterXmls[masterIdx >= 0 ? masterIdx : 0] || null;

      const themeCtx = parseThemeChain(slideXmls[i], layoutXml, masterXml, themeXml);
      const slideModel = parseSlide(
        slideXmls[i], themeCtx, media, slideSize,
         imageRels.get(slidePaths[i]) || new Map()
      );

      state.slides.push(slideModel);
    }

    // 5. Show the first slide immediately. Thumbnail generation can be slow
    // for large decks and must never block the actual viewer.
    state.currentIndex = 0;
    slideTotalEl.textContent = state.slides.length;
    app.removeAttribute('hidden');
    hideOverlay();
    await goToSlide(0);

    // 6. Populate thumbnails in the background after the viewer is usable.
    renderThumbnails()
      .then(() => updateThumbnailActive(state.currentIndex))
      .catch(err => console.warn('[PPTX Viewer] Thumbnail generation failed:', err));

  } catch (err) {
    console.error('[PPTX Viewer] Pipeline error:', err);
    failToPicker(`Failed to render presentation: ${err.message || err}`);
  }
}

// ─── Thumbnail Strip ──────────────────────────────────────────────────────────

async function renderThumbnails() {
  thumbnailList.innerHTML = '';

  for (let i = 0; i < state.slides.length; i++) {
    const slide = state.slides[i];
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Slide ${i + 1}`);
    item.dataset.index = i;

    const wrap = document.createElement('div');
    wrap.className = 'thumbnail-item__canvas-wrap';

    const tnCanvas = document.createElement('canvas');
    try {
      await renderSlide(slide, tnCanvas, THUMBNAIL_SCALE, 1); // no DPR for thumbnails
    } catch (err) {
      // A malformed/unsupported slide must not prevent the rest of the deck
      // from opening. Leave a visible placeholder thumbnail and continue.
      console.warn(`[PPTX Viewer] Thumbnail ${i + 1} failed:`, err);
      tnCanvas.width = 156;
      tnCanvas.height = 88;
      tnCanvas.style.width = '156px';
      tnCanvas.style.height = '88px';
      const fallbackCtx = tnCanvas.getContext('2d');
      if (fallbackCtx) {
        fallbackCtx.fillStyle = '#1e293b';
        fallbackCtx.fillRect(0, 0, 156, 88);
        fallbackCtx.fillStyle = '#94a3b8';
        fallbackCtx.font = '12px sans-serif';
        fallbackCtx.textAlign = 'center';
        fallbackCtx.fillText('Preview unavailable', 78, 46);
      }
    }
    wrap.appendChild(tnCanvas);

    const label = document.createElement('span');
    label.className = 'thumbnail-item__label';
    label.textContent = i + 1;

    item.appendChild(wrap);
    item.appendChild(label);
    thumbnailList.appendChild(item);

    item.addEventListener('click', () => goToSlide(i));
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') goToSlide(i); });

    // Yield between slides so the browser can paint progress and service
    // input while a large presentation is being prepared.
    if (i < state.slides.length - 1) {
      // setTimeout, not requestAnimationFrame: rAF is paused in background tabs,
      // which would stall thumbnail generation for intercepted (new-tab) opens.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
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
  const a = document.createElement('a');
  const baseName = state.filename.replace(/\.pptx$/i, '');
  a.href = url;
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
  btnZoomIn.addEventListener('click', () => setZoom(state.zoom + ZOOM_STEP));
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
