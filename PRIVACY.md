# Privacy

Opendeck opens PowerPoint files entirely on your device.

- **No uploads, no servers, no analytics.** Presentations are read and drawn inside your browser. The extension contains no tracking and makes no network requests of its own.
- **One fetch, only when you ask.** If you turn on "Open downloads and links here", the extension downloads the specific file you just clicked or right-clicked (the same address your browser was already fetching) so it can show it. Nothing else is requested.
- **Recent files stay in your browser.** The last few files you opened (up to 5, 60 MB each) are stored in this browser's local database so you can reopen them. Use Settings → Clear recent files to delete them. Temporary copies made to hand a download to the viewer are deleted as soon as the viewer reads them, or after an hour at the latest.

## Permissions and why

| Permission | Why |
| --- | --- |
| `downloads` | Notice when a PowerPoint file starts downloading, so it can open in the viewer instead (the download is only cancelled after the file was read successfully). |
| `contextMenus` | The "Open in Opendeck" item when you right-click a presentation link. |
| `notifications` | Tell you when a file could not be opened, or how to turn on opening downloads. |
| Access to websites (`<all_urls>`, **optional**) | Fetch the file you downloaded or right-clicked. Not requested at install: you grant it from Settings and can remove it at any time. |

Opening local files by double-clicking needs Chrome's separate "Allow access to file URLs" switch for the extension; the extension never turns that on for you.

## Contact and changes

Questions or concerns: open an issue at <https://github.com/go3-14/pptx_viewer_extension/issues>. If this policy changes, the change is recorded in this file's history on GitHub.

Last updated: 2026-11-05
