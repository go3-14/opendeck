# Renderer test deck

`make-fixtures.mjs` generates a 4-slide deck that exercises the renderer's inheritance and drawing features. There is no automated runner yet; check it in a browser.

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
