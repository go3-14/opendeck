# Opendeck 1.4.0

## New

- **Select and copy text.** Drag over words on a slide or a PDF page and press `Ctrl+C`. Slides are drawn on a canvas, so Opendeck lays an invisible text layer exactly over the picture (positions come from the drawing itself, including rotated text and table cells). PDF pages use pdf.js's text layer. Selection is in the normal view, not in the slideshow. Chart labels are not selectable.
- **Local PDFs.** A PDF opened from your computer in the browser (right-click, Open with, Edge or Chrome, or the browser as your PDF app) now opens in Opendeck. Needs *Open downloads and links here* on and "Allow access to file URLs" for the extension.

## Good to know

- Double-clicking a `.pptx` or `.pdf` still opens the app Windows has chosen: an extension cannot register as a file handler. Use the toolbar button, drag the file onto the viewer or a browser tab, or (PDFs) Open with the browser. The Settings page and README list the routes.

## Also

- Smoke tests drag-select a title with the real mouse and select PDF text; `npm run test:extension` covers local `.pdf` and `.pptx` files opened in the browser.

PowerPoint is a trademark of Microsoft Corporation. Opendeck is an independent project and is not affiliated with or endorsed by Microsoft.
