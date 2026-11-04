# PPTX Viewer Chrome Extension

A Manifest V3 Chrome/Edge extension that opens PowerPoint `.pptx` files in the browser without uploading them anywhere. Everything is parsed and drawn client-side.

There are two ways to open a file:

1. **Manual** – click the toolbar icon, then choose or drop a `.pptx`.
2. **Intercepted download** – click a `.pptx` link; the extension fetches the file, stores it temporarily, and opens it in the viewer instead of saving it.

## Build and install

Requires Node 20+.

```bash
npm install
npm run build
```

Then in `chrome://extensions`: enable **Developer mode**, click **Load unpacked**, and select the **`dist/`** folder (not the project root). After each rebuild, click the extension's reload button and open a fresh viewer tab.

Other scripts: `npm run dev` (Vite dev server for the viewer page only; no service worker) and `npm run typecheck`.

## Project layout

```text
public/               copied as-is into dist/
  manifest.json
  background.js       service worker: download interception
  icons/
viewer.html           Vite entry for the viewer page
src/
  main.tsx, App.tsx   viewer UI (React + Tailwind + shadcn/ui)
  components/ui/      shadcn components
  lib/
    pptx.ts           loadPptx() pipeline and PNG-ZIP export
    useSlideRender.ts hook that draws a slide onto a canvas
    idb.ts            IndexedDB handoff reader
  renderer/           plain-JS OOXML pipeline
    unzip.js          JSZip: slides, layouts, masters, theme, media, relationships
    parse-theme.js    theme colours, fonts, background
    parse-slide.js    slide XML -> shape model
    render-canvas.js  shape model -> canvas
    fallback-notice.js badge for unsupported content (charts, SmartArt)
```

## How it works

```text
Manual:        file picker -> File.arrayBuffer() ------------------------+
                                                                         v
Intercepted:   downloads.onCreated/onChanged                       loadPptx(bytes)
                 -> fetch(url) -> IndexedDB (key = UUID)                 |
                 -> cancel native download                               v
                 -> open viewer.html?mode=intercepted&handoff=<UUID>   slides[]
                 -> viewer reads + deletes the record -> loadPptx        |
                                                                         v
                                                          canvas + thumbnails
```

`loadPptx` = `unzipPptx` -> `parseSlideSize` -> per slide `parseThemeChain` + `parseSlide`. Rendering is done by `renderSlide` on a canvas at the requested zoom.

### Download interception (`public/background.js`)

- A download is treated as PPTX if its filename, MIME type, or URL path says so. If Chrome hasn't filled in the filename/MIME yet, the decision is made in `downloads.onChanged`.
- The bytes are fetched (with cookies) and stored in IndexedDB first. Only then is the native download cancelled and erased. If anything fails, the normal download continues and a notification is shown.
- `blob:`, `data:` and `file:` downloads are not intercepted.
- Handoff records not consumed within an hour are removed on browser startup.

### Permissions

- `downloads` – observe, cancel and erase PPTX downloads.
- `notifications` – report a failed interception.
- `<all_urls>` host permission – re-fetch the download URL from the service worker. This is broad and should be reviewed before publishing.

## Rendering scope

Supported:

- text with master/layout/slide style inheritance (sizes, bold/italic, colours, alignment, bullets and auto-numbering, spacing, indents, super/subscript, slide-number fields), wrapping, vertical anchoring and shrink-on-overflow;
- placeholders that inherit position, fill, line and text properties from their layout and master, plus non-placeholder layout/master graphics drawn behind the slide;
- theme colours with colour-map overrides (for example dark layouts), per-master themes, and `<p:style>` fill/line/font references;
- solid, gradient (linear and radial) and picture backgrounds and fills;
- preset shapes (common rectangles, polygons, arrows, stars, connectors), groups with child scaling, rotation and flips, dashed lines and arrowheads;
- PNG/JPEG/GIF/BMP/WebP/SVG pictures with cropping, loaded lazily;
- tables with merged cells and explicit fills/borders;
- zoom, thumbnails, and export as a ZIP of PNGs;
- **Present** (button or F5): full-screen slideshow that plays animation builds. Entrance effects reveal shapes and exit effects hide them, one click at a time (click, arrow, space or enter = next; left arrow, backspace or right-click = back; Esc = exit). The normal view shows every shape, like PowerPoint's editing view.

Known limitations:

- charts and SmartArt show a fallback badge; video and audio are ignored;
- animations are reduced to show/hide: only entrance and exit effects of whole shapes are played, instantly. Emphasis and motion paths, timing, easing, per-paragraph text builds, triggers and slide transitions are ignored;
- EMF/WMF images are not rendered;
- custom (freeform) geometry is drawn as a rectangle, and less common preset shapes fall back to rectangles;
- table styles from `tableStyles.xml` (banding, header fills) are not applied; only explicit cell fills and borders are;
- pattern fills are approximated by their foreground colour; shadows, glow and other effects are ignored;
- text metrics depend on installed fonts, so line breaks can differ slightly from PowerPoint;
- RTL text, vertical text and WordArt are not handled.

## Status

Verified with generated test decks in a browser against the built viewer (manual open, intercepted handoff, slide order, placeholder and text-style inheritance, groups, connectors, crops, tables, colour-map overrides, error messages). See `tests/README.md`. The service worker's download interception has not been exercised in a real Chrome session yet. The renderer has not been validated against a broad set of real-world decks.

## Troubleshooting

- Reload the extension and open a new viewer tab after every build.
- If a file fails to open, the viewer shows the reason on the start screen; the first console error in the viewer DevTools is the most useful detail.
- For interception problems, open the service worker console from `chrome://extensions` and check what `onCreated` / `onChanged` report for the download, and whether the IndexedDB database `pptx_viewer` (store `pptx_store`) receives a record.

## License

MIT. See [LICENSE](LICENSE).
