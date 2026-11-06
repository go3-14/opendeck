# Releasing

How to publish a version to the Chrome Web Store and Microsoft Edge Add-ons. Listing text, permission justifications and reviewer instructions are in [LISTING.md](LISTING.md).

## One-time setup

1. **Chrome Web Store:** register a developer account at <https://chrome.google.com/webstore/devconsole> (one-time $5 fee, Google account). Turn on 2-step verification, which the store requires.
2. **Edge Add-ons:** register at <https://partner.microsoft.com/dashboard/microsoftedge> (free).
3. **GitHub:** turn on *Issues* for the repository (the listing's support link points there) and check that `PRIVACY.md` is readable at the privacy-policy URL.

## Before every release

1. Make sure the working tree is clean and on `master`.
2. Raise the version in **both** `public/manifest.json` and `package.json` (the store rejects a version it already has). Use `MAJOR.MINOR.PATCH`.
3. Run the checks:

   ```bash
   npm run build
   npm test                          # fixture deck, in real Chrome
   npm test -- path/to/your/decks    # optional: your own presentations
   ```

4. If dependencies changed, refresh the licence notice: `npm run licenses`.
5. If the UI changed, refresh the store images: `npm run build && npm run screenshots`.
6. Build the upload file:

   ```bash
   npm run package                   # writes release/pptx-viewer-<version>.zip
   ```

## Manual check in the real extension (about 10 minutes)

The automated test cannot cover browser features that only exist in an installed extension. Load `dist/` unpacked in a **fresh Chrome profile** and in **Edge**, then check:

- [ ] First install opens the Settings page; closing it leaves a working extension.
- [ ] Toolbar icon opens the viewer; choosing a file, dragging a file and the recent-files list all open it.
- [ ] Without website access: downloading a `.pptx` saves normally and shows the "one more step" notification once; clicking it opens Settings.
- [ ] Settings → **Turn on** shows Chrome's permission prompt; afterwards a downloaded `.pptx` opens in the viewer and does **not** appear in downloads.
- [ ] Right-click a `.pptx` link: **Open in PPTX Viewer** opens it. With access off it opens Settings instead.
- [ ] Settings → **Turn off** removes the access again.
- [ ] A broken or blocked download (for example a link that needs a login you do not have) leaves the normal download in place and shows the notification.
- [ ] Optional: with "Allow access to file URLs" enabled, opening a local `.pptx` works.
- [ ] Slideshow: builds, transitions, speaker view, `Esc`; print preview shows one slide per page.
- [ ] Extension page on `chrome://extensions` shows the new icon and no errors in the service worker.

## Publish: Chrome Web Store

1. Open the developer dashboard, **Add new item** (or open the existing item and **Package → Upload new package**), and upload `release/pptx-viewer-<version>.zip`.
2. **Store listing:** paste the description and summary from LISTING.md; set category Productivity and language English; upload `public/icons/icon128.png`, the five screenshots, the small tile and the marquee.
3. **Privacy:** paste the single purpose, each permission justification and the privacy-policy URL; answer "no remote code"; leave all data-collection boxes unchecked and accept the three certifications.
4. **Distribution:** public, all regions (or as you prefer).
5. **Test instructions:** paste the reviewer instructions from LISTING.md.
6. **Submit for review.** Reviews typically take a few days; extensions with host-permission requests can take longer. The optional-permission justification above is what reviewers read first.

## Publish: Microsoft Edge Add-ons

Same zip. Create a new extension in the Partner Center, upload the package, reuse the description, screenshots and justifications, and set the privacy-policy and support URLs. Edge reviews are usually quicker.

## After publishing

1. Tag the commit and attach the zip to a GitHub release:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   Then create a release from that tag on GitHub and upload `release/pptx-viewer-1.0.0.zip`.
2. Add the store links to the README.
3. Watch the issue tracker and the store's review feedback for the first week.

## Updating later

Bump the version, repeat the checks, run `npm run package`, then upload the new zip as a new package of the same item. Chrome updates installed copies automatically (usually within hours). If an update adds a permission, Chrome asks existing users to approve it, so avoid new permissions unless needed.

## Firefox and Zen

Firefox and Zen use the same code with a different manifest (event-page background script, add-on id, no Chrome-only keys). `npm run package:firefox` writes `release/pptx-viewer-firefox-<version>.zip`.

1. Sign in at <https://addons.mozilla.org/developers/> (free Firefox account).
2. **Submit a New Add-on**, upload the Firefox zip, and pick how to distribute it:
   - **On this site** (public listing, reviewed in a few days). Zen users can install it from the listing.
   - **On your own** (unlisted). Mozilla signs it within minutes and gives you an `.xpi` to attach to the GitHub release. Firefox and Zen only install signed files.
3. When asked for source code, upload a zip of the repository (or link it) and point to the README's build steps (`npm install`, `npm run build`). The bundled React and JSZip code triggers the automatic "innerHTML" and "Function constructor" warnings; that is expected.
4. Listing text, screenshots and privacy policy URL are the same as for Chrome. Data collection is declared as "none" in the manifest.
5. Test before submitting: in Firefox open `about:debugging`, choose This Firefox, **Load Temporary Add-on**, and select the unzipped `manifest.json`. Run the manual checks above. Downloads interception and the permission prompt behave slightly differently in Firefox, so check them there.

Requires Firefox 140 or newer.
