// viewer/renderer/unzip.js
// Wraps JSZip to extract all relevant PPTX parts into a structured map.
// JSZip is loaded as a global from ../lib/jszip.min.js (script tag, not module).
//
// export async function unzipPptx(arrayBuffer)
//   → { slideXmls, layoutXmls, masterXmls, themeXml, media }

'use strict';

/**
 * Sorts slide/layout/master filenames by numeric index so they are in
 * presentation order (slide1.xml < slide2.xml < slide10.xml).
 * @param {string[]} names
 * @returns {string[]}
 */
function sortByIndex(names) {
  return [...names].sort((a, b) => {
    const numA = parseInt(a.match(/(\d+)\.xml$/)?.[1] ?? '0', 10);
    const numB = parseInt(b.match(/(\d+)\.xml$/)?.[1] ?? '0', 10);
    return numA - numB;
  });
}

// Only decode media types that the canvas renderer can display. PPTX files
// commonly contain large video/audio parts under ppt/media; reading those into
// memory made the viewer appear to hang even though they are unsupported.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp']);

/**
 * Reads a zip entry as a UTF-8 string (XML).
 * @param {Object} entry - JSZip file entry
 * @returns {Promise<string>}
 */
async function readXml(entry) {
  return entry.async('text');
}

/**
 * Reads a zip entry as an ArrayBuffer, then wraps it in a Blob.
 * @param {Object} entry - JSZip file entry
 * @param {string} path - full zip path (used to determine MIME type)
 * @returns {Promise<Blob>}
 */
async function readBlob(entry, path) {
  const buffer = await entry.async('arraybuffer');
  const ext = path.split('.').pop().toLowerCase();
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    emf: 'image/emf',
    wmf: 'image/wmf',
  };
  return new Blob([buffer], { type: mimeMap[ext] || 'application/octet-stream' });
}

/**
 * Resolves slide → layout → master relationships using _rels files.
 * Returns a map: slideXmlPath → { layoutPath, masterPath }
 *
 * @param {Object} zip - JSZip instance
 * @param {string[]} slidePaths - array of full slide XML paths
 * @returns {Promise<Map<string, {layoutPath:string, masterPath:string}>>}
 */
async function resolveSlideRels(zip, slidePaths) {
  const relsMap = new Map();

  for (const slidePath of slidePaths) {
    // e.g. "ppt/slides/slide1.xml" → "ppt/slides/_rels/slide1.xml.rels"
    const dir = slidePath.substring(0, slidePath.lastIndexOf('/'));
    const base = slidePath.substring(slidePath.lastIndexOf('/') + 1);
    const relsPath = `${dir}/_rels/${base}.rels`;

    const relsEntry = zip.file(relsPath);
    if (!relsEntry) continue;

    const relsXml = await readXml(relsEntry);
    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'application/xml');
    const rels = relsDoc.querySelectorAll('Relationship');

    let layoutPath = null;

    for (const rel of rels) {
      const type = rel.getAttribute('Type') || '';
      const target = rel.getAttribute('Target') || '';

      if (type.endsWith('/slideLayout')) {
        // target is relative to "ppt/slides/", resolve to absolute zip path
        const resolved = new URL(target, `https://x/${slidePath}`).pathname.slice(1);
        layoutPath = resolved;
      }
    }

    // Now resolve layout → master
    let masterPath = null;
    if (layoutPath) {
      const layoutDir = layoutPath.substring(0, layoutPath.lastIndexOf('/'));
      const layoutBase = layoutPath.substring(layoutPath.lastIndexOf('/') + 1);
      const layoutRelsPath = `${layoutDir}/_rels/${layoutBase}.rels`;
      const layoutRelsEntry = zip.file(layoutRelsPath);

      if (layoutRelsEntry) {
        const layoutRelsXml = await readXml(layoutRelsEntry);
        const layoutRelsDoc = parser.parseFromString(layoutRelsXml, 'application/xml');
        for (const rel of layoutRelsDoc.querySelectorAll('Relationship')) {
          if ((rel.getAttribute('Type') || '').endsWith('/slideMaster')) {
            const target = rel.getAttribute('Target') || '';
            masterPath = new URL(target, `https://x/${layoutPath}`).pathname.slice(1);
            break;
          }
        }
      }
    }

    relsMap.set(slidePath, { layoutPath, masterPath });
  }

  return relsMap;
}

/** Builds a Map<slidePath, Map<rId, mediaPath>> for embedded raster images. */
async function resolveImageRels(zip, slidePaths) {
  const result = new Map();
  const imageType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

  for (const slidePath of slidePaths) {
    const dir = slidePath.substring(0, slidePath.lastIndexOf('/'));
    const base = slidePath.substring(slidePath.lastIndexOf('/') + 1);
    const relsEntry = zip.file(`${dir}/_rels/${base}.rels`);
    if (!relsEntry) continue;

    const relsDoc = new DOMParser().parseFromString(await readXml(relsEntry), 'application/xml');
    const slideImages = new Map();
    for (const rel of relsDoc.querySelectorAll('Relationship')) {
      if ((rel.getAttribute('Type') || '') !== imageType) continue;
      const target = rel.getAttribute('Target') || '';
      const path = new URL(target, `https://x/${slidePath}`).pathname.slice(1);
      slideImages.set(rel.getAttribute('Id'), path);
    }
    result.set(slidePath, slideImages);
  }
  return result;
}

/**
 * Returns slide paths in presentation order using <p:sldIdLst> and
 * ppt/_rels/presentation.xml.rels. Returns null if it can't be determined.
 */
async function orderedSlidePaths(zip, existingSlidePaths) {
  const presEntry = zip.file('ppt/presentation.xml');
  const relsEntry = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presEntry || !relsEntry) return null;

  const parser = new DOMParser();
  const presDoc = parser.parseFromString(await readXml(presEntry), 'application/xml');
  const relsDoc = parser.parseFromString(await readXml(relsEntry), 'application/xml');

  const targets = new Map(); // rId → zip path
  for (const rel of relsDoc.querySelectorAll('Relationship')) {
    if (!(rel.getAttribute('Type') || '').endsWith('/slide')) continue;
    const target = rel.getAttribute('Target') || '';
    // Targets are relative to ppt/ (or absolute when they start with "/").
    const path = target.startsWith('/')
      ? target.slice(1)
      : new URL(target, 'https://x/ppt/presentation.xml').pathname.slice(1);
    targets.set(rel.getAttribute('Id'), path);
  }

  const existing = new Set(existingSlidePaths);
  const ordered = [];
  for (const el of presDoc.getElementsByTagName('*')) {
    if (el.localName !== 'sldId') continue;
    const rId = el.getAttribute('r:id') ||
      el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = targets.get(rId);
    if (path && existing.has(path)) ordered.push(path);
  }
  return ordered.length ? ordered : null;
}

/**
 * Main entry point. Extracts all relevant parts of a PPTX (which is a ZIP).
 *
 * @param {ArrayBuffer} arrayBuffer - raw PPTX file bytes
 * @returns {Promise<{
 *   slideXmls: string[],
 *   layoutXmls: string[],
 *   masterXmls: string[],
 *   themeXml: string|null,
 *   media: Map<string, Blob>,
 *   slideRels: Map<string, {layoutPath:string, masterPath:string}>,
 *   imageRels: Map<string, Map<string, string>>,
 *   presentationXml: string|null
 * }>}
 */
export async function unzipPptx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  // ── Discover slide XML paths ──────────────────────────────────────────────
  const allFiles = Object.keys(zip.files);

  const fileSortedSlides = sortByIndex(
    allFiles.filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  );
  // Prefer true presentation order (sldIdLst); fall back to filename order.
  const slidePaths = (await orderedSlidePaths(zip, fileSortedSlides)) || fileSortedSlides;
  const layoutPaths = sortByIndex(
    allFiles.filter(p => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p))
  );
  const masterPaths = sortByIndex(
    allFiles.filter(p => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p))
  );

  // Theme: usually ppt/theme/theme1.xml
  const themePath = allFiles.find(p => /^ppt\/theme\/theme\d+\.xml$/.test(p)) || null;

  // ── Read all XMLs in parallel ─────────────────────────────────────────────
  const [slideXmls, layoutXmls, masterXmls, themeXml, presentationXml, slideRels, imageRels] = await Promise.all([
    Promise.all(slidePaths.map(p => readXml(zip.file(p)))),
    Promise.all(layoutPaths.map(p => readXml(zip.file(p)))),
    Promise.all(masterPaths.map(p => readXml(zip.file(p)))),
    themePath ? readXml(zip.file(themePath)) : Promise.resolve(null),
    zip.file('ppt/presentation.xml') ? readXml(zip.file('ppt/presentation.xml')) : Promise.resolve(null),
    resolveSlideRels(zip, slidePaths),
    resolveImageRels(zip, slidePaths),
  ]);

  // ── Read media files ──────────────────────────────────────────────────────
  const mediaPaths = allFiles.filter(p => {
    if (!p.startsWith('ppt/media/')) return false;
    const ext = p.split('.').pop()?.toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });
  const mediaEntries = await Promise.all(
    mediaPaths.map(async p => [p, await readBlob(zip.file(p), p)])
  );
  const media = new Map(mediaEntries);

  return {
    slideXmls,   // string[] — ordered slide XMLs
    layoutXmls,  // string[] — ordered layout XMLs
    masterXmls,  // string[] — ordered master XMLs
    themeXml,    // string|null — first theme XML
    media,       // Map<zipPath, Blob>
    slideRels,   // Map<slidePath, {layoutPath, masterPath}>
    imageRels,   // Map<slidePath, Map<rId, mediaPath>>
    presentationXml,
    slidePaths,  // string[] — for cross-referencing with slideRels
    layoutPaths,
    masterPaths,
  };
}
