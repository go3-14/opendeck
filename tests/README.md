# Renderer test deck

`make-fixtures.mjs` generates an 8-slide deck that exercises the renderer's inheritance and drawing features. `npm test` (see `smoke.mjs`) checks most of the table below automatically; the list is also the manual checklist.

```bash
npm run build
node tests/make-fixtures.mjs dist/rich.pptx
cd dist && python -m http.server 8767
```

Open `http://127.0.0.1:8767/viewer.html`, choose `dist/rich.pptx` (or feed it to the file input), and compare against the list below. Delete `dist/rich.pptx` afterwards; `npm run build` also clears it.

| Slide | What to check |
| --- | --- |
| 1 | Title is bold navy, left-aligned, with **no** geometry on the slide itself (inherited from master). Body has `•` and `–` bullets, a wrapped first bullet, a bold run, and `1.` / `2.` numbering. Blue bar at the left (layout) and orange strip at the bottom (master). A small slide number at the bottom right. |
| 2 | White → light-blue gradient background. Blue square and green circle, each 3in (group child space scaled 3×). Orange rounded rectangle, rotated, with white "Style fill" text (fill and font colour come from `<p:style>`). Dashed red arrow and a blue elbow connector with an arrowhead. Title centred (layout list style). No blue bar (layout 2). |
| 3 | Picture shows only the red quadrant of the 4-colour image (crop). Table with a merged "Merged header" cell spanning two columns. |
| 4 | Dark `#111111` background and white text: the slide's colour-map override maps `bg1`→`dk1` and `tx1`→`lt1`. |
| 5 | Four large noisy pictures (red, green, blue, yellow tint) over a picture background. Used for the progressive-paint check below; the file is about 25 MB. |
| 6 | Animation builds. In the normal view all three squares (red, green, blue) are visible. In **Present**: start shows none; click 1 shows red; click 2 shows green and hides red; click 3 shows blue (green stays). Going back (left arrow) undoes the last build. |
| 7 | SmartArt (two rounded boxes, "Step A" purple and "Step B" orange) drawn from the saved fallback drawing; a table styled by `tableStyles.xml` (blue header, banded rows); a freeform shape with a half-ellipse bottom; a rectangle with a soft drop shadow. |
| 8 | Three charts from cached data: clustered columns (red/blue), a line chart with markers (green/orange) and a pie with percent labels (first slice yellow). |

## Progressive-paint check (slides must appear whole)

A slide must never be visible half-drawn. With the deck loaded in the viewer, record the main canvas as it changes while navigating:

1. Visit slides 1–5 once and save a coarse signature of each finished slide (sample a 6×6 grid of pixels from `main canvas`).
2. Reload the page, open the deck again, and jump between slides quickly (for example 5, 2, 5, 3, 4, 5, 1, 5, 60 ms apart) while sampling the canvas every few ms.
3. Every distinct state seen must equal one of the saved finished-slide signatures (plus the initial empty canvas), and the last one must be slide 5. Any other state is a half-drawn slide.

Before the preload/atomic-draw fix, jumping to slide 5 on a cold page produced six states (blank, background only, then each picture arriving). Now it produces the empty canvas followed by the complete slide.

Speaker notes are on slide 6 ("First note line"/"Second note line"). Slide 2 has a fade and slide 3 a push transition (visible in the slideshow only; skipped when the OS asks for reduced motion).
