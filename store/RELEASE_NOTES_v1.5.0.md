# Opendeck 1.5.0

## New

- **Download original.** The More menu now saves the exact file you opened (`.pptx`, `.ppsx`, `.pdf`…) under its own name. Opendeck cancels the browser's download when it takes over a file, so until now there was no way to keep it.
- **Export as PDF.** A presentation can be exported as a real PDF file, with no print dialog: one page per slide, each page the size and orientation of its slide, always in the original colours. The pages are pictures, so the text in the exported PDF cannot be selected; the original file keeps its text. A PDF you open in Opendeck is already a PDF: use *Download original PDF*.

## Fixed

- **Pages came out sideways.** *Print…* forced every sheet to landscape, so portrait pages were printed turned or squeezed. Each page now prints on a sheet that matches its orientation.

## Also

- The menu item *Print or save as PDF…* is now *Print…*; saving as PDF has its own item.
- Smoke tests: the exported PDF has one correctly sized page per slide and re-opens upright and not mirrored; the downloaded original is byte-identical; a portrait PDF prints on a portrait sheet.

PowerPoint is a trademark of Microsoft Corporation. Opendeck is an independent project and is not affiliated with or endorsed by Microsoft.
