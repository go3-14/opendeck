# Store listing

Everything to paste into the Chrome Web Store developer dashboard (and Microsoft Edge Add-ons, which asks for the same information). Images are in `screenshots/` and `promo/`; the upload zip comes from `npm run package`.

## Basics

| Field | Value |
| --- | --- |
| Name | Opendeck |
| Summary (132 characters max) | Free, open-source viewer for PowerPoint files, with search and a full-screen slideshow. Files never leave your device. |
| Category | Productivity |
| Language | English |
| Icon | `public/icons/icon128.png` (also in the zip) |
| Homepage URL | https://github.com/go3-14/pptx_viewer_extension |
| Support URL | https://github.com/go3-14/pptx_viewer_extension/issues |
| Privacy policy URL | https://github.com/go3-14/pptx_viewer_extension/blob/master/PRIVACY.md |

## Description

```text
Opendeck opens PowerPoint presentations right in your browser. No upload, no account, no server: your files are read and drawn on your own computer.

OPEN FILES YOUR WAY
• Click the toolbar icon, choose a file, or drop it on the page
• Right-click a presentation link and choose "Open in Opendeck"
• Optional: open presentations you download straight in the viewer
• Recent files are one click away
• Supports .pptx, .ppsx, .potx and macro-enabled variants

VIEW AND FIND
• Fits the slide to your window; zoom when you need to
• Slide list with thumbnails; light and dark themes follow your system
• Search slide text, tables and speaker notes (Ctrl+F)

PRESENT
• Full-screen slideshow that plays animation builds and slide transitions
• Speaker view with notes, the next slide and a timer
• Laser pointer, pen, slide grid, black and white screens, jump to any slide

USE THE CONTENT
• Copy a slide as an image or as text
• Copy a text outline of the whole presentation, notes included
• Print or save as PDF
• Export every slide as PNG images

WHAT IT DRAWS
Text with master and layout styles, shapes, pictures, tables with table styles, charts (column, bar, line, area, pie, doughnut), and SmartArt. Rare content it cannot draw is clearly marked instead of silently dropped.

PRIVATE BY DESIGN
• Nothing is uploaded and nothing is tracked
• Access to websites is optional and off until you turn it on in Settings; it is used only to read the file you just downloaded or right-clicked
• Recent files stay in your browser and can be cleared at any time

Open source (MIT): https://github.com/go3-14/pptx_viewer_extension

PowerPoint is a trademark of Microsoft Corporation. Opendeck is an independent project and is not affiliated with or endorsed by Microsoft.
```

## Single purpose

> View PowerPoint presentation files in the browser. Every feature (opening, searching, presenting, copying, printing) serves that one purpose.

## Permission justifications

| Permission | Justification to paste |
| --- | --- |
| `downloads` | Detects when a PowerPoint file starts downloading so it can be opened in the viewer instead. The download is only cancelled after the file has been read successfully; if anything fails, the normal download continues. |
| `contextMenus` | Adds the single "Open in Opendeck" item when the user right-clicks a link to a presentation file. |
| `notifications` | Tells the user when a file could not be opened, and (once) how to turn on opening downloads. |
| Host access (`optional_host_permissions`, `<all_urls>`) | Optional, never requested at install. When the user turns on "Open downloads and links here" in Settings, the extension fetches the specific file the user just downloaded or right-clicked so it can be shown. The address can be on any website, which is why all sites are requested. It is not used to read or modify web pages, and it can be turned off at any time. |

**Remote code:** No. All code ships in the package.

**Data usage:** the extension does not collect, transmit or sell any user data. Leave every data-collection box unchecked and tick the three certifications (no sale of data, no use unrelated to the single purpose, no use for creditworthiness or lending).

## Instructions for reviewers

```text
No account or login is needed.

1. Install and open the extension: a Settings page opens on first install. (Optional features need the "Turn on" button there; everything else works without it.)
2. Click the toolbar icon, choose "Choose file", and select store/sample/Quarterly Business Review.pptx from the source repository (https://github.com/go3-14/pptx_viewer_extension/tree/master/store/sample), or any .pptx file.
3. Use the slide list, Search (Ctrl+F, try "growth"), and the More menu (copy, print, export).
4. Click Present (or press F5) for the slideshow; press S for the speaker view, ? for all shortcuts, Esc to leave.
5. Optional feature: in Settings press "Turn on", then click a link to any .pptx file on the web; it opens in the viewer instead of downloading. Right-clicking such a link also offers "Open in Opendeck".

The extension makes no network requests of its own; it only fetches a file the user explicitly downloads or right-clicks, and only after the user grants the optional access.
```

## Screenshots (1280 x 800)

Upload in this order and add the captions if the dashboard asks for them.

| File | Caption |
| --- | --- |
| `screenshots/1-view.jpg` | Fits every slide to your window, with a slide list and charts drawn from the file |
| `screenshots/2-search.jpg` | Search slide text, tables and speaker notes |
| `screenshots/3-more-menu.jpg` | Copy a slide as an image or text, print or save as PDF, export PNGs |
| `screenshots/4-dark.jpg` | Light and dark themes follow your system |
| `screenshots/5-speaker-view.jpg` | Full-screen slideshow with speaker notes, next slide and a timer |

Promotional images: `promo/small-tile.jpg` (440 x 280) and `promo/marquee.jpg` (1400 x 560).
