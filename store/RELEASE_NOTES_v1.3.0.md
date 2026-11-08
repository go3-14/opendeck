# Opendeck 1.3.0

## New

- **PDF files.** PDFs open in the same viewer as presentations: slide list with thumbnails, zoom, search, slideshow, printing, PNG export and dark mode. Password-protected PDFs ask for the password. Rendering uses pdf.js, which is loaded only when a PDF is opened, so PowerPoint files open exactly as fast as before.
- **PDF downloads and links.** With *Open downloads and links here* on, a PDF that would download, a right-clicked PDF link and a link to a `.pdf` address all open in Opendeck. Turn the setting off to get the browser's own PDF viewer back.

## Good to know

- Links are taken over for addresses that end in `.pdf` (the query string is kept). Local `file://` PDFs are not taken over; open them with the button or by dropping them.
- PDFs are for viewing: forms, annotations, signing and text selection are not supported.
- New permission: `declarativeNetRequest`, used for one redirect rule that exists only while website access is on. Chrome shows no extra warning for it.

## Also

- Tests: a generated PDF is opened, drawn, searched and inverted in dark mode; an extension-level test (`npm run test:extension`, Edge or Chromium) checks the PDF redirect.

PowerPoint is a trademark of Microsoft Corporation. Opendeck is an independent project and is not affiliated with or endorsed by Microsoft.
