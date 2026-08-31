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
 *   slideRels: Map<string, {layoutPath:string, masterPath:string}>
 * }>}
 */
export async function unzipPptx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  // ── Discover slide XML paths ──────────────────────────────────────────────
  const allFiles = Object.keys(zip.files);

  const slidePaths = sortByIndex(
    allFiles.filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  );
  const layoutPaths = sortByIndex(
    allFiles.filter(p => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p))
  );
  const masterPaths = sortByIndex(
    allFiles.filter(p => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p))
  );

  // Theme: usually ppt/theme/theme1.xml
  const themePath = allFiles.find(p => /^ppt\/theme\/theme\d+\.xml$/.test(p)) || null;

  // ── Read all XMLs in parallel ─────────────────────────────────────────────
  const [slideXmls, layoutXmls, masterXmls, themeXml, slideRels] = await Promise.all([
    Promise.all(slidePaths.map(p => readXml(zip.file(p)))),
    Promise.all(layoutPaths.map(p => readXml(zip.file(p)))),
    Promise.all(masterPaths.map(p => readXml(zip.file(p)))),
    themePath ? readXml(zip.file(themePath)) : Promise.resolve(null),
    resolveSlideRels(zip, slidePaths),
  ]);

  // ── Read media files ──────────────────────────────────────────────────────
  const mediaPaths = allFiles.filter(p => p.startsWith('ppt/media/'));
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
    slidePaths,  // string[] — for cross-referencing with slideRels
    layoutPaths,
    masterPaths,
  };
}
