# PPTX Viewer

A Manifest V3 Chrome/Edge extension that opens PowerPoint files (`.pptx`, `.ppsx`, `.potx` and their macro-enabled variants) in the browser, with a slideshow mode. Everything is parsed and drawn on your device; see [PRIVACY.md](PRIVACY.md).

## Build and install

Requires Node 20+.

```bash
npm install
npm run build
```

In `chrome://extensions`: enable **Developer mode**, click **Load unpacked**, select the **`dist/`** folder (not the project root). After each rebuild, click the extension's reload button and open a fresh viewer tab.

On first install a Settings page opens. To have downloads and right-clicked links open in the viewer, turn on **Open downloads and links here** (this grants optional access to websites; you can turn it off again). To open local files directly, also enable **Allow access to file URLs** for the extension on `chrome://extensions`.

Scripts: `npm run build`, `npm test` (see below), `npm run dev` (viewer page only, no service worker), `npm run typecheck`.

## Features

**Opening files**
- Toolbar icon, file picker or drag and drop; right-click a presentation link → *Open in PPTX Viewer*; downloads of presentation files open in the viewer instead (the native download is only cancelled after the file was read; if anything fails it carries on).
- Recent files (up to 5) on the start screen and in the More menu. `.ppsx` shows open straight into the slideshow.

**Viewing**
- Fit-to-window by default, zoom, slide list (toggle with `T`), light/dark following the system, keyboard shortcuts with tooltips.
- Search slide text, tables and speaker notes (`Ctrl+F`); matching slides are marked in the list.
- Copy a slide as an image or as text, copy a text outline of the whole deck (with notes), print or save as PDF, export all slides as PNGs.

**Slideshow** (`Present` button or `F5`)
- Full screen, with animation builds (entrance and exit effects, one click at a time) and slide transitions (fade, push, cover, wipe; others fall back to a fade; skipped when the system asks for reduced motion).
- `S` speaker view (notes, next slide, timer), `L` laser pointer, `D` pen and `E` erase, `G` slide grid, `B`/`W` black/white screen, number + Enter to jump, `?` for the shortcut list.

**Rendering**
- Text with master/layout/slide style inheritance (sizes, colours, bullets and numbering, spacing, alignment, autofit), placeholders that inherit position and formatting, theme colours with colour-map overrides.
- Shapes (many presets and freeform paths), groups, connectors with arrowheads and dashes, solid/gradient/picture fills, shadows, cropped pictures, tables with table styles and merged cells.
- Charts (column, bar, line, area, pie, doughnut) drawn from the data stored in the file, and SmartArt drawn from PowerPoint's saved fallback drawing.

Known limitations:
- Charts other than those above (scatter, bubble, radar, 3D look, secondary axes) and SmartArt without a saved drawing show an orange "not supported" badge; video and audio are ignored.
- Animations are reduced to show/hide: emphasis and motion paths, timing and easing, text builds by paragraph, and triggers are not played. Other transitions fall back to a fade.
- EMF/WMF images are not drawn; pattern fills use their foreground colour; glow, reflection and 3D effects are ignored; text effects, RTL and vertical text are not handled.
- Text metrics depend on installed fonts, so line breaks can differ slightly from PowerPoint.
- The speaker view lives in the same window (it does not mirror to a second screen).

## Project layout

```text
public/               copied as-is into dist/
  manifest.json
  background.js       service worker: download interception, link menu, permission prompts
  icons/
viewer.html           Vite entry for the viewer page
src/
  main.tsx, App.tsx   viewer UI (React + Tailwind + shadcn/ui)
  components/         Presenter, SearchBar, SettingsDialog, SlideCanvas, ... (ui/ = shadcn)
  lib/                pptx.ts (pipeline, export), slideText.ts (search/outline), recent.ts,
                      permissions.ts, transitions.ts, useSlideRender.ts, ...
  renderer/           plain-JS OOXML pipeline
    unzip.js          JSZip: parts, relationships, media (lazy), notes, charts, SmartArt, table styles
    parse-theme.js    theme colours (colour map), fonts, style lists
    parse-slide.js    slide/layout/master → shape model; animations; transitions
    parse-chart.js    chart part → chart model
    render-canvas.js  shape model → canvas (preload images, draw off-screen, show in one step)
    render-chart.js   chart model → canvas
tests/
  make-fixtures.mjs   generates an 8-slide test deck
  smoke.mjs           end-to-end test in real Chrome
```

## How it works

```text
Manual / drop / recent ─ File.arrayBuffer() ─┐
Download or link ─ service worker fetches the URL ─ IndexedDB (one-time key) ─ viewer reads it ─┤
                                                                                                v
                                           loadPptx(bytes) → slides[] → canvas, thumbnails, slideshow, search, export
```

Slides are drawn atomically: a slide's images are decoded first, the slide is drawn off-screen, and the result replaces the canvas in one step, so slides never appear piece by piece. The latest render request wins when navigating quickly, and neighbouring slides are prefetched.

## Tests

```bash
npm run build
npm test                    # generated fixture deck
npm test -- path/to/decks   # also opens every .pptx/.ppsx in a folder and checks each slide draws
```

`npm test` drives a real Chrome (playwright-core; set `CHROME_PATH` if Chrome is not in a standard location). See [tests/README.md](tests/README.md) for what the fixture deck covers.

## License

MIT. See [LICENSE](LICENSE).
