# Opendeck 1.1.0

PPTX Viewer is now **Opendeck**: same free, open-source viewer, new name.

## What changed

- Renamed to Opendeck (extension name, menus and notifications, store text, website).
- Automated checks on every push (GitHub Actions): build, browser smoke test, visual regression test of every slide, website build and store packaging.
- New visual regression test that compares rendered slides with reference images, and a load-time benchmark (`npm run bench`). On the development laptop a 300-slide deck shows its slide list in 0.7 s.
- Deterministic test decks, so the tests give the same result on every run.

## Install

Download `opendeck-1.1.0.zip` (Chrome, Edge) or `opendeck-firefox-1.1.0.zip` (Firefox, Zen) below, unzip it into a folder you will keep, and load it from the browser's extensions page with Developer mode on. Store listings update automatically.

PowerPoint is a trademark of Microsoft Corporation. Opendeck is an independent project and is not affiliated with or endorsed by Microsoft.
