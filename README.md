# PPTX Viewer — Chrome Extension

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)
![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge-lightgrey)

> Open `.pptx` files directly in your browser — no upload, no server, 100% client-side.

---

## What It Does

**PPTX Viewer** is a Chrome/Edge extension that intercepts `.pptx` file downloads and renders them in a beautiful in-browser viewer — instantly, privately, and without sending your files anywhere.

**Features:**
- 🚫 **Zero upload** — your files never leave your device
- ⚡ **Automatic interception** — PPTX downloads open in the viewer instead of saving
- 🖼️ **Canvas-based rendering** — text, shapes, images, and tables rendered via `<canvas>`
- 🔎 **Zoom & navigation** — keyboard shortcuts, scroll-to-zoom, thumbnail strip
- 📦 **Export** — save all slides as a ZIP of PNG images
- 🗂️ **Manual mode** — open any PPTX via the toolbar icon or drag-and-drop

**Rendering fidelity (v1):** See the [Fidelity Scope](#fidelity-scope) section below.

---

## Install from Source

1. Clone or download this repository:
   ```sh
   git clone https://github.com/yourusername/pptx_extension.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **"Load unpacked"** and select the `pptx_extension/` directory
5. The PPTX Viewer icon will appear in your toolbar

> **No build step required.** Point Chrome directly at the source directory.

**To update:** Pull the latest changes and click the refresh icon on the extension card in `chrome://extensions`.

---

## How It Works

When you click a `.pptx` link or trigger a PPTX download:
1. The background service worker detects the download via `chrome.downloads.onCreated`
2. The native save is cancelled immediately
3. The file bytes are fetched (with your session cookies, so auth-walled downloads work)
4. Bytes are stored in the extension's IndexedDB under a one-time handoff ID
5. A new tab opens with that ID in its URL; the viewer reads the bytes and renders the slides

**Manual mode:** Click the toolbar icon to open the viewer and choose a local `.pptx` file, or drag-and-drop a file onto the viewer page.

---

## Security Model

| Concern | Answer |
|---------|--------|
| Is the file uploaded anywhere? | **No.** Bytes never leave the browser process. |
| Does the extension make network requests? | Only to re-fetch the PPTX URL you already triggered. |
| Why does it need `<all_urls>` permission? | To `fetch()` PPTX files from any origin. This is unavoidable for a general-purpose download interceptor. |
| Is there analytics or telemetry? | **None.** |
| Is the code auditable? | Yes — no bundler, no obfuscation. Load unpacked from source. |

The `<all_urls>` host permission appears in Chrome's install prompt. This is a known tradeoff for general-purpose download interception. If you are concerned, you can restrict `host_permissions` in `manifest.json` to specific domains.

---

## Fidelity Scope (v1)

### ✅ Supported

| Element | Notes |
|---------|-------|
| Text boxes | Per-run bold, italic, underline, strikethrough, color, font size, font family |
| Theme colors | Full accent1–6, dk1/2, lt1/2 resolution with lumMod/tint/shade modifiers |
| Solid fills | Shapes, text boxes, table cells |
| Gradient fills | Linear gradients with stop positions |
| Shapes | Rectangle, ellipse, rounded rect, triangle, parallelogram, trapezoid, diamond, pentagon, hexagon, stars |
| Images | PNG, JPEG, GIF, BMP (embedded in the PPTX) |
| Tables | Cell borders, fills, text content |
| Slide backgrounds | Solid color from slide/layout/master theme chain |
| Slide layout/master | Theme chain resolved (color + font scheme) |
| Zoom | 25% – 300% |
| Export | All slides → PNG images at 2× resolution, downloaded as a ZIP |
| Keyboard nav | ←/→/Home/End, +/− zoom |

### ⚠️ Not Supported (v1)

| Element | Fallback |
|---------|----------|
| SmartArt | Orange "⚠ SmartArt — not supported" badge |
| Charts | Orange "⚠ Chart — not supported" badge |
| Animations / transitions | Ignored (static snapshot) |
| Video / audio | Ignored |
| 3D effects | Rendered as flat shape |
| Complex path geometries | Rendered as rectangle |
| SVG / EMF images | Skipped (no blob rendered) |
| Non-embedded fonts | Falls back to Calibri |
| RTL text | May display incorrectly |

---

## Dependency Verification

The extension vendors a single third-party library:

| Library | Version | File | SHA-256 |
|---------|---------|------|---------|
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | `lib/jszip.min.js` | `ACC7E41455A80765B5FD9C7EE1B8078A6D160BBBCA455AEAE854DE65C947D59E` |

To verify:
```powershell
(Get-FileHash "lib\jszip.min.js" -Algorithm SHA256).Hash
```
```sh
sha256sum lib/jszip.min.js
```

---

## Building

**No build step is required.** The extension uses plain ES modules loaded directly by Chrome. Load the source directory as an unpacked extension.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / Next slide |
| `↑` / `↓` | Previous / Next slide |
| `Home` | First slide |
| `End` | Last slide |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `Ctrl+0` | Reset zoom to 100% |
| `Ctrl+Scroll` | Zoom in/out |

---

## Contributing

1. Fork the repository
2. Make your changes (no build step needed — edit source directly)
3. Load the unpacked extension to test
4. Open a pull request

Please keep commits focused and conventional (`feat:`, `fix:`, `docs:`, `chore:`).

---

## License

MIT — see [LICENSE](./LICENSE).
