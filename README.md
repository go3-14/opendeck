# PPTX Viewer Chrome Extension

A Manifest V3 Chrome/Edge extension prototype for opening PowerPoint `.pptx` files in a browser without uploading them to a server.

The project is primarily an architecture and rendering prototype. The current codebase contains the intended flow, but PPTX loading is not yet reliable for a live demonstration. This README explains the architecture and the current limitations honestly.

## Project goal

The extension is intended to support two ways of opening a presentation:

1. **Manual mode** — click the extension icon, choose a local `.pptx`, and render it.
2. **Intercepted-download mode** — click a `.pptx` download link, cancel the native download, fetch the bytes, and open the presentation in the extension viewer.

The viewer is designed to work entirely on the client. PPTX bytes are processed inside the browser and are not sent to an application server.

## High-level architecture

```text
                         Manual mode
                    ┌──────────────────┐
                    │ Local file picker│
                    └────────┬─────────┘
                             │ File.arrayBuffer()
                             ▼
┌──────────────┐       ┌───────────────┐       ┌───────────────────┐
│ PPTX download│──────▶│ Service worker│──────▶│ IndexedDB handoff │
└──────────────┘       └───────┬───────┘       └─────────┬─────────┘
       onCreated               │                         │ handoff ID
       cancel + fetch          │ opens viewer tab        │
                               ▼                         ▼
                         ┌─────────────────────────────────┐
                         │       viewer/viewer.html        │
                         │          viewer/viewer.js       │
                         └────────────────┬────────────────┘
                                          │ ArrayBuffer
                                          ▼
                         ┌─────────────────────────────────┐
                         │ JSZip / OOXML parsing pipeline   │
                         └────────────────┬────────────────┘
                                          │ SlideModel objects
                                          ▼
                         ┌─────────────────────────────────┐
                         │ Canvas renderer + viewer controls │
                         └─────────────────────────────────┘
```

## End-to-end data flow

### Manual file flow

```text
Toolbar icon
  → viewer/viewer.html?mode=manual
  → user selects a .pptx
  → File.arrayBuffer()
  → loadBytes(arrayBuffer, filename)
  → unzipPptx()
  → parse slides
  → render first slide to canvas
  → render thumbnails in the background
```

The manual path does not use the service worker or IndexedDB. It is the simplest path for debugging the parser and renderer.

### Intercepted download flow

```text
User clicks a .pptx link
  → Chrome creates a download item
  → background.js receives chrome.downloads.onCreated
  → extension checks filename and MIME type
  → chrome.downloads.cancel(item.id)
  → service worker fetches item.url with credentials included
  → bytes are written to IndexedDB
  → a UUID is generated for the stored record
  → viewer tab opens with:
       viewer/viewer.html?mode=intercepted&handoff=<uuid>
  → viewer reads the UUID from the URL
  → viewer reads and consumes the IndexedDB record
  → loadBytes(arrayBuffer, filename)
```

The handoff ID is used instead of placing file bytes directly in the URL or passing a large `ArrayBuffer` through a runtime message.

## Extension components

### `manifest.json`

The extension uses Manifest V3 with these important permissions:

- `downloads` — observe and cancel PPTX downloads;
- `tabs` — open the viewer tab;
- `storage` — declared for extension storage compatibility;
- `notifications` — report interception/fetch failures;
- `<all_urls>` — allow the service worker to fetch PPTX URLs from arbitrary websites.

The `<all_urls>` permission is a significant security and review consideration. A production extension should consider restricting supported domains or using a different interception strategy.

### `background.js`

The service worker owns download interception and temporary file storage.

Main responsibilities:

- open the manual viewer when the toolbar icon is clicked;
- identify PPTX downloads in `isPptx()`;
- intercept downloads through `chrome.downloads.onCreated`;
- cancel the native download;
- fetch the original URL using the user's cookies;
- store the bytes in IndexedDB;
- create the viewer tab with a handoff ID;
- display a notification if fetching or storage fails.

Important detail: `onCreated` may fire before Chrome has populated every download property. In particular, `filename` and `mime` can be incomplete. The current detector accepts either a `.pptx` filename or the official PPTX MIME type.

### `viewer/viewer.html`

This extension page provides the viewer shell:

- loading/error overlay;
- toolbar;
- slide counter and navigation buttons;
- thumbnail sidebar;
- slide canvas;
- file picker;
- drag-and-drop surface;
- export progress indicator.

It loads JSZip locally and loads `viewer.js` as an ES module:

```html
<script src="../lib/jszip.min.js"></script>
<script type="module" src="viewer.js"></script>
```

If the module fails before initialization, the static loading overlay can remain visible because that overlay is part of the initial HTML.

### `viewer/viewer.js`

This is the orchestration layer. It:

1. detects manual or intercepted mode;
2. reads local files or IndexedDB payloads;
3. loads the renderer modules;
4. extracts PPTX parts;
5. parses theme and slide XML;
6. creates slide models;
7. renders the first slide;
8. generates thumbnails;
9. handles navigation, zoom, drag-and-drop, and export.

The main function is:

```js
loadBytes(bytes, filename)
```

Its intended stages are:

```text
loadBytes
  → await rendererReady
  → unzipPptx(bytes)
  → parseSlideSize(presentationXml)
  → parseThemeChain(...)
  → parseSlide(...)
  → renderSlide(firstSlide, slideCanvas)
  → renderThumbnails()
```

The viewer attempts to show the main viewer before background thumbnail generation finishes. This prevents thumbnail rendering from blocking the first slide, but the first-slide render can still fail if the parser produces invalid dimensions or unsupported data.

### `viewer/renderer/unzip.js`

A PPTX file is a ZIP archive containing XML and media files. This module uses JSZip to extract the parts needed by the custom renderer.

It discovers:

- `ppt/slides/slideN.xml` — slide content;
- `ppt/slideLayouts/slideLayoutN.xml` — layout definitions;
- `ppt/slideMasters/slideMasterN.xml` — master definitions;
- `ppt/theme/themeN.xml` — theme colors and fonts;
- `ppt/presentation.xml` — slide size;
- `ppt/slides/_rels/*.rels` — relationships;
- supported raster files under `ppt/media/`.

The returned structure is approximately:

```js
{
  slideXmls,
  layoutXmls,
  masterXmls,
  themeXml,
  presentationXml,
  media,
  slideRels,
  imageRels,
  slidePaths,
  layoutPaths,
  masterPaths
}
```

Only PNG, JPEG, GIF, and BMP media are currently decoded. Video and audio are intentionally skipped because they are not rendered by the canvas renderer.

### `viewer/renderer/parse-theme.js`

This module converts theme XML into a `ThemeContext`:

```js
{
  colorScheme,
  majorFont,
  minorFont,
  background,
  resolveColor,
  resolveFont
}
```

It resolves common OOXML theme references such as `accent1` through `accent6`, `dk1`, `dk2`, `lt1`, `lt2`, `+mj-lt`, and `+mn-lt`.

### `viewer/renderer/parse-slide.js`

This is the OOXML-to-intermediate-model layer. It walks a slide's shape tree and creates plain JavaScript objects.

Example shape types:

```js
{ type: "text", ... }
{ type: "shape", ... }
{ type: "image", ... }
{ type: "table", ... }
{ type: "group", ... }
{ type: "unsupported", label: "Chart", ... }
```

Coordinates are converted from EMUs to points:

```text
1 point = 12,700 EMUs
```

The parser handles basic text, shapes, images, tables, groups, fills, borders, and theme colors. PowerPoint is a large format, so this parser is intentionally incomplete.

### `viewer/renderer/render-canvas.js`

The canvas renderer consumes a `SlideModel` and draws it in z-order.

It supports:

- solid and gradient fills;
- rectangles, ellipses, stars, triangles, and other basic preset shapes;
- text runs with approximate font, weight, italic, color, and underline handling;
- raster images using `Blob` object URLs;
- tables;
- unsupported-element fallback badges.

It also applies device-pixel-ratio scaling for sharper text and images.

### `viewer/renderer/fallback-notice.js`

Draws an orange fallback badge for content the custom renderer does not understand, such as charts or SmartArt.

### `lib/jszip.min.js`

Vendored JSZip is used to read the PPTX ZIP container. It is loaded locally rather than from a CDN.

## Rendering scope

### Intended support

- text boxes;
- basic text formatting;
- theme colors and fonts;
- solid and gradient fills;
- basic shapes;
- embedded PNG/JPEG/GIF/BMP images;
- simple tables;
- slide background colors;
- thumbnail navigation;
- zoom;
- export of rendered slides as PNG files in a ZIP.

### Known limitations

- SmartArt is not rendered as native PowerPoint content;
- charts are represented by a fallback marker;
- animations and transitions are ignored;
- video and audio are ignored;
- SVG, EMF, and WMF rendering is incomplete or unsupported;
- complex path geometry is approximated;
- placeholder inheritance is incomplete;
- text wrapping and typography are approximate;
- RTL text and custom font substitution may be incorrect;
- the custom parser has not been validated against a broad sample set of PowerPoint files.

## Current status

This repository should currently be presented as a working architectural prototype, not as a finished PPTX viewer.

Known user-visible behavior:

- manual local PPTX upload does not reliably render;
- intercepted PPTX downloads do not reliably render;
- the viewer may remain on the initial loading overlay;
- previous versions reached thumbnail rendering and then fell back to the upload page.

The most important missing validation is a browser-console trace from a fresh extension reload. Node syntax checks only prove that the JavaScript parses; they do not prove that Chrome can load the extension modules, read IndexedDB, unzip a real presentation, or render its XML.

## Debugging checklist

### 1. Reload the extension

Open `chrome://extensions`, enable Developer mode, and click the extension's reload button. Existing viewer tabs can still contain old JavaScript, so open a new viewer tab after reloading.

### 2. Test manual mode first

Manual mode avoids download interception and IndexedDB handoff. If manual mode fails, focus on the viewer and renderer before debugging `background.js`.

Open the viewer, select a small simple PPTX, and inspect the viewer DevTools console. Record the first red error, especially errors mentioning:

- `Failed to fetch dynamically imported module`;
- `JSZip is not defined`;
- `DOMParser`;
- `Invalid slide dimensions`;
- `Cannot read properties of undefined`;
- canvas size or image decode errors.

### 3. Check the viewer page state

In the viewer DevTools console:

```js
location.href
typeof JSZip
document.getElementById('overlay-message').textContent
document.getElementById('manual-picker').hidden
```

The first red console error is more useful than the final visible UI state.

### 4. Debug interception separately

In `chrome://extensions`, open the service worker inspection console and test a download. Confirm:

- `onCreated` fires;
- the item is classified as PPTX;
- `fetch(item.url)` succeeds;
- IndexedDB write completes;
- the new viewer URL contains `mode=intercepted&handoff=<uuid>`.

Then inspect the viewer's IndexedDB database:

```text
Database: pptx_viewer
Object store: pptx_store
```

The handoff key should contain an object with `filename`, `bytes`, and `timestamp`.

## Security considerations

- The viewer does not upload presentation bytes to a server.
- Interception re-fetches the original download URL, which is still a network request.
- The service worker uses the user's cookies when re-fetching the URL.
- `<all_urls>` is broad and should be reviewed before publishing.
- A production implementation should add stronger size limits, cleanup for abandoned IndexedDB records, and better handling for failed fetches.

## Installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project directory.
5. Click the extension toolbar icon to open manual mode.

There is no build step. The source files are loaded directly by Chrome.

## Interview explanation

This project demonstrates:

- Manifest V3 extension architecture;
- service-worker-based download interception;
- IndexedDB handoff of binary data between extension contexts;
- client-side ZIP processing;
- parsing a subset of Office Open XML;
- conversion to an intermediate slide model;
- canvas-based rendering;
- graceful fallback markers for unsupported PowerPoint features;
- separation between acquisition, parsing, rendering, and UI orchestration.

A concise explanation is:

> “A PPTX is a ZIP package of XML and media. The extension either reads a local file or intercepts a download, obtains an ArrayBuffer, extracts the OOXML parts with JSZip, converts slides into a renderer-neutral model, and draws that model onto an HTML canvas. IndexedDB is used as a temporary handoff store because the service worker and viewer page are separate extension contexts.”

## License

MIT. See [LICENSE](LICENSE).
