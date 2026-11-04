// tests/make-fixtures.mjs
// Generates a small deck that exercises the renderer's inheritance features.
//
//   node tests/make-fixtures.mjs <output.pptx>
//
// Slide 1  placeholders inheriting geometry/text styles from layout + master,
//          bullets, wrapping, slide-number field, master/layout decor shapes
// Slide 2  gradient background, group with child scaling, <p:style> fills,
//          rotated shape, dashed + arrowed connectors, rounded rectangle
// Slide 3  cropped image (top-left quadrant is red), table with a merged cell
// Slide 4  dark colour-map override (bg1 → dk1, tx1 → lt1) via bgRef
// Slide 5  four large pictures over a picture background (slow-to-load images)
//
// What each slide should look like is listed in tests/README.md.

import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import JSZip from 'jszip';

const out = process.argv[2];
if (!out) throw new Error('usage: node tests/make-fixtures.mjs <output.pptx>');

const IN = 914400;
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const rels = (items) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
const rel = (id, type, target) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`;

// ─── PNG (4×4 quadrants: red, green / blue, yellow) ───────────────────────────
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function quadrantPng() {
  const colors = [[255, 0, 0], [0, 200, 0], [0, 0, 255], [255, 255, 0]];
  const w = 4;
  const rows = [];
  for (let y = 0; y < w; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push(...colors[(y >= 2 ? 2 : 0) + (x >= 2 ? 1 : 0)], 255);
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Large tinted-noise PNG: slow to read and decode, so progressive painting is easy to observe. */
function noisyPng(w, h, [r, g, b]) {
  const noise = crypto.randomBytes(w * h * 3);
  const raw = Buffer.alloc(h * (w * 3 + 1));
  const base = [r, g, b];
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    raw[o] = 0;
    for (let i = 0; i < w * 3; i++) {
      raw[o + 1 + i] = Math.max(0, Math.min(255, base[i % 3] - 30 + (noise[y * w * 3 + i] % 61)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Building blocks ──────────────────────────────────────────────────────────
const xfrm = (x, y, w, h, extra = '') =>
  `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
const grpHead = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const solid = (c) => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`;
const scheme = (c) => `<a:solidFill><a:schemeClr val="${c}"/></a:solidFill>`;
const run = (t, attrs = '', inner = '') => `<a:r><a:rPr lang="en-US"${attrs}>${inner}</a:rPr><a:t>${t}</a:t></a:r>`;
const para = (runs, pPr = '') => `<a:p>${pPr}${runs}</a:p>`;
const tx = (paras, bodyPr = '<a:bodyPr/>', lst = '<a:lstStyle/>') => `<p:txBody>${bodyPr}${lst}${paras}</p:txBody>`;

const ph = (id, name, phAttrs, spPr, txBody) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph ${phAttrs}/></p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr>${txBody}</p:sp>`;

const shape = (id, name, geom, spPr, body = '', style = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${spPr}` +
  `<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>` + // callers put xfrm/fill first; the parser does not depend on child order
  `</p:spPr>${style}${body}</p:sp>`;

const styleRef = (fill, ln, font) =>
  `<p:style><a:lnRef idx="${ln}"><a:schemeClr val="accent1"/></a:lnRef>` +
  `<a:fillRef idx="${fill}"><a:schemeClr val="${fill === 1 ? 'accent2' : 'accent1'}"/></a:fillRef>` +
  `<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>` +
  `<a:fontRef idx="minor"><a:schemeClr val="${font}"/></a:fontRef></p:style>`;

const connector = (id, geom, x, y, w, h, ln) =>
  `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Connector ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
  `<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${ln}</p:spPr></p:cxnSp>`;

const slideXml = (shapes, { bg = '', clrMapOvr = '<a:masterClrMapping/>' } = {}) =>
  `${HEAD}<p:sld ${NS}><p:cSld>${bg}<p:spTree>${grpHead}${shapes}</p:spTree></p:cSld>` +
  `<p:clrMapOvr>${clrMapOvr}</p:clrMapOvr></p:sld>`;

const sldNum = (id) =>
  ph(id, 'Slide Number', 'type="sldNum" idx="12"', '', tx(para('<a:fld id="{00000000-1234-1234-1234-123412341234}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld>')));

// ─── Theme ────────────────────────────────────────────────────────────────────
const phClrFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const themeXml =
  `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test"><a:themeElements>` +
  '<a:clrScheme name="C">' +
  '<a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="F"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>' +
  `<a:fmtScheme name="M"><a:fillStyleLst>${phClrFill}${phClrFill}${phClrFill}</a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350">${phClrFill}</a:ln><a:ln w="12700">${phClrFill}</a:ln><a:ln w="19050">${phClrFill}</a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst/><a:bgFillStyleLst>${phClrFill}${phClrFill}${phClrFill}</a:bgFillStyleLst></a:fmtScheme>` +
  '</a:themeElements></a:theme>';

// ─── Master and layouts ───────────────────────────────────────────────────────
const lvl = (n, marL, indent, bullet, sz) =>
  `<a:lvl${n}pPr marL="${marL}" indent="${indent}"><a:buFont typeface="Arial"/>${bullet}<a:defRPr sz="${sz}"/></a:lvl${n}pPr>`;

const masterXml =
  `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${grpHead}` +
  ph(2, 'Title', 'type="title"', xfrm(457200, 274638, 11277600, 1143000), tx(para(run('Title')), '<a:bodyPr anchor="ctr"/>')) +
  ph(3, 'Body', 'type="body" idx="1"', xfrm(457200, 1600200, 11277600, 4525963), tx(para(run('Body')))) +
  ph(4, 'Slide Number', 'type="sldNum" idx="12"', xfrm(8610600, 6356350, 2743200, 365125),
    tx(para('<a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld>'), '<a:bodyPr/>',
      '<a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle>')) +
  // decor: orange strip along the bottom edge (not a placeholder → drawn on every slide)
  shape(5, 'Footer strip', 'rect', `${xfrm(0, 6492240, 12192000, 365760)}${scheme('accent2')}`) +
  '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:txStyles>' +
  `<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4000" b="1">${scheme('tx2')}<a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
  `<p:bodyStyle>${lvl(1, 342900, -342900, '<a:buChar char="•"/>', 2400)}${lvl(2, 742950, -285750, '<a:buChar char="–"/>', 2000)}</p:bodyStyle>` +
  '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>' +
  '</p:txStyles></p:sldMaster>';

const layout1Xml =
  `${HEAD}<p:sldLayout ${NS}><p:cSld name="Title and Content"><p:spTree>${grpHead}` +
  ph(2, 'Title', 'type="title"', '', tx(para(run('Title')))) +
  ph(3, 'Content', 'idx="1"', '', tx(para(run('Content')))) +
  // decor: blue bar on the left edge
  shape(4, 'Left bar', 'rect', `${xfrm(0, 0, 137160, 6858000)}${scheme('accent1')}`) +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const layout2Xml =
  `${HEAD}<p:sldLayout ${NS}><p:cSld name="Title Only"><p:spTree>${grpHead}` +
  ph(2, 'Title', 'type="title"', xfrm(457200, 228600, 11277600, 1000000),
    tx(para(run('Title')), '<a:bodyPr/>', '<a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle>')) +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

// ─── Slides ───────────────────────────────────────────────────────────────────
const slide1 = slideXml(
  ph(2, 'Title', 'type="title"', '', tx(para(run('Placeholder inheritance')))) +
  ph(3, 'Content', 'idx="1"', '', tx(
    para(run('First bullet point that is long enough to wrap onto a second line when it reaches the right edge of the box')) +
    para(run('Sub bullet'), '<a:pPr lvl="1"/>') +
    para(run('Bold ', ' b="1"') + run('and normal text')) +
    para(run('Numbered one'), '<a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr>') +
    para(run('Numbered two'), '<a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod"/></a:pPr>'))) +
  sldNum(4),
);

const slide2 = slideXml(
  ph(2, 'Title', 'type="title"', '', tx(para(run('Groups, styles, connectors')))) +
  // group: child space 2in×1in is scaled 3× to 6in×3in at (1in, 2in)
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="${IN}" y="${2 * IN}"/><a:ext cx="${6 * IN}" cy="${3 * IN}"/><a:chOff x="0" y="0"/><a:chExt cx="${2 * IN}" cy="${IN}"/></a:xfrm></p:grpSpPr>` +
  shape(11, 'Child A', 'rect', `${xfrm(0, 0, IN, IN)}${solid('4472C4')}`) +
  shape(12, 'Child B', 'ellipse', `${xfrm(IN, 0, IN, IN)}${solid('70AD47')}`) +
  '</p:grpSp>' +
  // no fill in spPr: fill and white text come from <p:style> (fillRef accent2, fontRef lt1)
  shape(13, 'Styled', 'roundRect', `${xfrm(8 * IN, 2 * IN, 3 * IN, IN, ' rot="1200000"')}`,
    tx(para(run('Style fill'), '<a:pPr algn="ctr"/>'), '<a:bodyPr anchor="ctr"/>'), styleRef(1, 1, 'lt1')) +
  connector(14, 'straightConnector1', IN, 5.5 * IN, 5 * IN, 0,
    '<a:ln w="38100"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:prstDash val="dash"/><a:tailEnd type="triangle"/></a:ln>') +
  connector(15, 'bentConnector3', 7 * IN, 4.5 * IN, 3 * IN, IN, `<a:ln w="25400">${scheme('accent1')}<a:tailEnd type="triangle"/></a:ln>`),
  {
    bg: `<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="BDD7EE"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`,
  },
);

const slide3 = slideXml(
  ph(2, 'Title', 'type="title"', '', tx(para(run('Image crop and table')))) +
  // crop to the top-left quadrant (red) → the whole 3in×3in picture must be red
  `<p:pic><p:nvPicPr><p:cNvPr id="10" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="rId2"/><a:srcRect r="50000" b="50000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
  `<p:spPr>${xfrm(IN, 1.8 * IN, 3 * IN, 3 * IN)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
  // table: first row has a merged 2-column cell
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="11" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
  `<p:xfrm><a:off x="${5 * IN}" y="${2 * IN}"/><a:ext cx="${6 * IN}" cy="${IN}"/></p:xfrm>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/>` +
  `<a:tblGrid><a:gridCol w="${2 * IN}"/><a:gridCol w="${2 * IN}"/><a:gridCol w="${2 * IN}"/></a:tblGrid>` +
  `<a:tr h="${0.5 * IN}"><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('Merged header')}</a:p></a:txBody><a:tcPr>${solid('DDEBF7')}</a:tcPr></a:tc>` +
  `<a:tc hMerge="1">${'<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody>'}<a:tcPr/></a:tc>` +
  `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('C1')}</a:p></a:txBody><a:tcPr>${solid('FCE4D6')}</a:tcPr></a:tc></a:tr>` +
  `<a:tr h="${0.5 * IN}">` +
  ['A2', 'B2', 'C2'].map((t) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run(t)}</a:p></a:txBody><a:tcPr/></a:tc>`).join('') +
  '</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>',
);

const slide4 = slideXml(
  ph(2, 'Title', 'type="title"', '', tx(para(run('Dark colour map')))) +
  shape(10, 'Text', 'rect', xfrm(IN, 2 * IN, 8 * IN, IN), tx(para(run('tx1 resolves to white on this slide')))),
  {
    bg: '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>',
    clrMapOvr: '<a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>',
  },
);

// Slide 5: four large pictures over a picture background (used to check that a
// slide appears all at once instead of piece by piece).
const HEAVY_TINTS = [[220, 60, 60], [60, 200, 60], [60, 60, 220], [220, 200, 60]];
const heavyPic = (n, x, y) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${10 + n}" name="Heavy ${n}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="rId${n + 2}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
  `<p:spPr>${xfrm(x, y, 4.5 * IN, 2.2 * IN)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const slide5 = slideXml(
  ph(2, "Title", "type=\"title\"", "", tx(para(run("Heavy images")))) +
  heavyPic(0, 0.6 * IN, 1.5 * IN) + heavyPic(1, 6.4 * IN, 1.5 * IN) +
  heavyPic(2, 0.6 * IN, 4 * IN) + heavyPic(3, 6.4 * IN, 4 * IN),
  { bg: "<p:bg><p:bgPr><a:blipFill><a:blip r:embed=\"rId6\"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>" },
);

// ─── Package ──────────────────────────────────────────────────────────────────
const zip = new JSZip();
zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>`);
zip.file('_rels/.rels', rels(rel('rId1', 'officeDocument', 'ppt/presentation.xml')));
zip.file('ppt/presentation.xml',
  `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
  '<p:sldIdLst>' + [2, 3, 4, 5, 6].map((n) => `<p:sldId id="${254 + n}" r:id="rId${n}"/>`).join('') +
  '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
zip.file('ppt/_rels/presentation.xml.rels', rels(
  rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml') +
  [1, 2, 3, 4, 5].map((n) => rel(`rId${n + 1}`, 'slide', `slides/slide${n}.xml`)).join('') +
  rel('rId20', 'theme', 'theme/theme1.xml')));
zip.file('ppt/theme/theme1.xml', themeXml);
zip.file('ppt/slideMasters/slideMaster1.xml', masterXml);
zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels(
  rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') +
  rel('rId2', 'slideLayout', '../slideLayouts/slideLayout2.xml') +
  rel('rId3', 'theme', '../theme/theme1.xml')));
zip.file('ppt/slideLayouts/slideLayout1.xml', layout1Xml);
zip.file('ppt/slideLayouts/slideLayout2.xml', layout2Xml);
for (const n of [1, 2]) {
  zip.file(`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`, rels(rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')));
}
[[slide1, 1], [slide2, 2], [slide3, 2], [slide4, 2], [slide5, 2]].forEach(([xml, layout], i) => {
  const n = i + 1;
  zip.file(`ppt/slides/slide${n}.xml`, xml);
  zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels(
    rel('rId1', 'slideLayout', `../slideLayouts/slideLayout${layout}.xml`) +
    (n === 3 ? rel('rId2', 'image', '../media/image1.png') : '') +
    (n === 5 ? [0, 1, 2, 3, 4].map((k) => rel(`rId${k + 2}`, 'image', `../media/heavy${k}.png`)).join('') : '')));
});
zip.file('ppt/media/image1.png', quadrantPng());
HEAVY_TINTS.forEach((tint, k) => zip.file(`ppt/media/heavy${k}.png`, noisyPng(1600, 1200, tint)));
zip.file('ppt/media/heavy4.png', noisyPng(1920, 1080, [120, 120, 160]));

fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`wrote ${out}`);
