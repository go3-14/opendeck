// Generates a clean six-slide demo presentation for the store screenshots.
//   node scripts/make-demo-deck.mjs <output.pptx>
//
// It exercises the visible features (placeholders, charts, a styled table,
// cards, notes, transitions) with a consistent, neutral design.

import fs from 'node:fs'
import JSZip from 'jszip'

const out = process.argv[2]
if (!out) throw new Error('usage: node scripts/make-demo-deck.mjs <output.pptx>')

// Layout coordinates below are in inches on a 13.333 x 7.5 inch slide.
const IN = 914400
const e = (inches) => Math.round(inches * IN)
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const FONT = 'Segoe UI'

const INK = '0F172A'
const SLATE = '475569'
const MUTED = '94A3B8'
const PANEL = 'F1F5F9'
const BLUE = '2563EB'
const SKY = '0EA5E9'
const GREEN = '10B981'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rels = (items) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`
const rel = (id, type, target) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`
const grpHead = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${e(w)}" cy="${e(h)}"/></a:xfrm>`
const solid = (c) => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const run = (text, { sz, b, color, i } = {}) =>
  `<a:r><a:rPr lang="en-US"${sz ? ` sz="${sz}"` : ''}${b ? ' b="1"' : ''}${i ? ' i="1"' : ''}>${color ? solid(color) : ''}</a:rPr><a:t>${esc(text)}</a:t></a:r>`
const para = (runs, pPr = '') => `<a:p>${pPr}${runs}</a:p>`
const tx = (paras, bodyPr = '<a:bodyPr/>', lst = '<a:lstStyle/>') => `<p:txBody>${bodyPr}${lst}${paras}</p:txBody>`

const ph = (id, name, attrs, spPr, body) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph ${attrs}/></p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr>${body}</p:sp>`

const box = (id, name, x, y, w, h, { geom = 'rect', fill, body = '', adj } = {}) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}` +
  `<a:prstGeom prst="${geom}"><a:avLst>${adj != null ? `<a:gd name="adj" fmla="val ${adj}"/>` : ''}</a:avLst></a:prstGeom>` +
  `${fill ? solid(fill) : '<a:noFill/>'}</p:spPr>${body}</p:sp>`

const bulletP = (text, level = 0) =>
  para(run(text), level ? '<a:pPr lvl="1"/>' : '')

const slideXml = (shapes, { transition = true } = {}) =>
  `${HEAD}<p:sld ${NS}><p:cSld><p:spTree>${grpHead}${shapes}</p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition ? '<p:transition spd="med"><p:fade/></p:transition>' : ''}</p:sld>`

// ─── Theme ────────────────────────────────────────────────────────────────────
const fillList = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)
const themeXml =
  `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Demo"><a:themeElements>` +
  `<a:clrScheme name="Demo"><a:dk1><a:srgbClr val="${INK}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="1E293B"/></a:dk2><a:lt2><a:srgbClr val="${PANEL}"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="${BLUE}"/></a:accent1><a:accent2><a:srgbClr val="${SKY}"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="${GREEN}"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4>` +
  '<a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="EF4444"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>' +
  `<a:fontScheme name="Demo"><a:majorFont><a:latin typeface="${FONT}"/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Demo"><a:fillStyleLst>${fillList}</a:fillStyleLst><a:lnStyleLst>` +
  ['6350', '12700', '19050'].map((w) => `<a:ln w="${w}">${fillList.slice(0, fillList.length / 3)}</a:ln>`).join('') +
  `</a:lnStyleLst><a:effectStyleLst/><a:bgFillStyleLst>${fillList}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`

// ─── Master and layouts ───────────────────────────────────────────────────────
const masterXml =
  `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr>${solid('FFFFFF')}<a:effectLst/></p:bgPr></p:bg><p:spTree>${grpHead}` +
  ph(2, 'Title', 'type="title"', xfrm(0.7, 0.5, 11.9, 1.0), tx(para(run('Title')), '<a:bodyPr anchor="ctr"/>')) +
  ph(3, 'Body', 'type="body" idx="1"', xfrm(0.7, 1.8, 11.9, 4.7), tx(para(run('Body')))) +
  box(4, 'Footer rule', 0, 7.38, 13.333, 0.12, { fill: BLUE }) +
  box(5, 'Footer text', 0.7, 6.95, 6, 0.35, {
    body: tx(para(run('Acme Corp  ·  Q3 2026 Business Review', { sz: 1000, color: MUTED })), '<a:bodyPr anchor="ctr"/>'),
  }) +
  '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:txStyles>' +
  `<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3400" b="1">${solid(INK)}<a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
  '<p:bodyStyle>' +
  `<a:lvl1pPr marL="285750" indent="-285750"><a:spcBef><a:spcPts val="1400"/></a:spcBef><a:buClr><a:srgbClr val="${BLUE}"/></a:buClr><a:buChar char="•"/><a:defRPr sz="2400">${solid(INK)}</a:defRPr></a:lvl1pPr>` +
  `<a:lvl2pPr marL="628650" indent="-228600"><a:spcBef><a:spcPts val="400"/></a:spcBef><a:buClr><a:srgbClr val="${MUTED}"/></a:buClr><a:buChar char="–"/><a:defRPr sz="1900">${solid(SLATE)}</a:defRPr></a:lvl2pPr>` +
  '</p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>'

const contentLayout =
  `${HEAD}<p:sldLayout ${NS}><p:cSld name="Title and Content"><p:spTree>${grpHead}` +
  ph(2, 'Title', 'type="title"', '', tx(para(run('Title')))) +
  ph(3, 'Content', 'idx="1"', '', tx(para(run('Content')))) +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'

const titleLayout =
  `${HEAD}<p:sldLayout ${NS} showMasterSp="0"><p:cSld name="Title Slide"><p:bg><p:bgPr>${solid(INK)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${grpHead}` +
  box(2, 'Accent', 0.9, 2.35, 1.2, 0.09, { fill: BLUE }) +
  ph(3, 'Title', 'type="ctrTitle"', xfrm(0.9, 2.6, 11.4, 1.7),
    tx(para(run('Title')), '<a:bodyPr anchor="t"/>', `<a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="5400" b="1">${solid('FFFFFF')}</a:defRPr></a:lvl1pPr></a:lstStyle>`)) +
  ph(4, 'Subtitle', 'type="subTitle" idx="1"', xfrm(0.9, 4.4, 11.4, 1.0),
    tx(para(run('Subtitle')), '<a:bodyPr/>', `<a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2400">${solid('CBD5E1')}</a:defRPr></a:lvl1pPr></a:lstStyle>`)) +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'

// ─── Charts ───────────────────────────────────────────────────────────────────
const strCache = (items) => `<c:strCache><c:ptCount val="${items.length}"/>${items.map((c, i) => `<c:pt idx="${i}"><c:v>${c}</c:v></c:pt>`).join('')}</c:strCache>`
const numCache = (items) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${items.length}"/>${items.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`
const ser = (idx, name, color, cats, vals, extra = '') =>
  `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/><c:tx><c:strRef><c:f>S!$B$1</c:f>${strCache([name])}</c:strRef></c:tx>` +
  `<c:spPr>${solid(color)}</c:spPr>${extra}<c:cat><c:strRef><c:f>S!$A$2</c:f>${strCache(cats)}</c:strRef></c:cat>` +
  `<c:val><c:numRef><c:f>S!$B$2</c:f>${numCache(vals)}</c:numRef></c:val></c:ser>`
const axes =
  '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>' +
  '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>'
const chartDoc = (plot, legend) =>
  `${HEAD}<c:chartSpace xmlns:c="${C_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">` +
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
  `<c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="${legend}"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`

const regions = ['North America', 'Europe', 'APAC', 'LATAM']
const revenueChart = chartDoc(
  '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
  ser(0, 'This year ($M)', BLUE, regions, [4.2, 3.1, 2.4, 1.8]) + ser(1, 'Last year ($M)', 'CBD5E1', regions, [3.6, 2.8, 1.9, 1.4]) +
  `<c:gapWidth val="70"/><c:axId val="1"/><c:axId val="2"/></c:barChart>${axes}`, 'b')

const channels = ['Direct', 'Partners', 'Online', 'Other']
const dPt = (i, c) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${solid(c)}</c:spPr></c:dPt>`
const channelChart = chartDoc(
  '<c:pieChart><c:varyColors val="1"/>' +
  ser(0, 'Share', 'FFFFFF', channels, [42, 28, 20, 10], [BLUE, SKY, GREEN, MUTED].map((c, i) => dPt(i, c)).join('')) +
  '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>' +
  '<c:firstSliceAng val="0"/></c:pieChart>', 'r')

const chartFrame = (id, name, x, y, w, h, rId) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
  `<p:xfrm><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${e(w)}" cy="${e(h)}"/></p:xfrm>` +
  `<a:graphic><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" r:id="${rId}"/></a:graphicData></a:graphic></p:graphicFrame>`

// ─── Table style ──────────────────────────────────────────────────────────────
const STYLE_ID = '{DEMO0000-0000-0000-0000-000000000001}'
const edge = (tag, w, color) => `<a:${tag}><a:ln w="${w}">${solid(color)}</a:ln></a:${tag}>`
const tableStyles =
  `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${STYLE_ID}"><a:tblStyle styleId="${STYLE_ID}" styleName="Demo">` +
  `<a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:srgbClr val="${INK}"/></a:tcTxStyle>` +
  `<a:tcStyle><a:tcBdr>${edge('insideH', 9525, 'E2E8F0')}${edge('bottom', 9525, 'E2E8F0')}</a:tcBdr><a:fill>${solid('FFFFFF')}</a:fill></a:tcStyle></a:wholeTbl>` +
  `<a:band1H><a:tcStyle><a:tcBdr/><a:fill>${solid(PANEL)}</a:fill></a:tcStyle></a:band1H>` +
  `<a:firstRow><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:srgbClr val="FFFFFF"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill>${solid(BLUE)}</a:fill></a:tcStyle></a:firstRow>` +
  '</a:tblStyle></a:tblStyleLst>'

const cell = (t, { right = false } = {}) =>
  `<a:tc><a:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p>${right ? '<a:pPr algn="r"/>' : ''}${run(t, { sz: 1800 })}</a:p></a:txBody><a:tcPr marL="137160" marR="137160" anchor="ctr"/></a:tc>`
const tableFrame = (id, x, y, w, rows) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Channel table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
  `<p:xfrm><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${e(w)}" cy="${e(0.6 * rows.length)}"/></p:xfrm>` +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>' +
  `<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>${STYLE_ID}</a:tableStyleId></a:tblPr>` +
  `<a:tblGrid><a:gridCol w="${e(w * 0.48)}"/><a:gridCol w="${e(w * 0.24)}"/><a:gridCol w="${e(w * 0.28)}"/></a:tblGrid>` +
  rows.map((r) => `<a:tr h="${e(0.6)}">${r.map((t, i) => cell(t, { right: i > 0 })).join('')}</a:tr>`).join('') +
  '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'

// ─── Slides ───────────────────────────────────────────────────────────────────
const card = (id, x, y, w, h, big, bigColor, caption) =>
  box(id, `Card ${id}`, x, y, w, h, {
    geom: 'roundRect', fill: PANEL, adj: 8000,
    body: tx(
      para(run(big, { sz: 5400, b: true, color: bigColor }), '<a:pPr algn="l"/>') + para(run(caption, { sz: 1800, color: SLATE })),
      '<a:bodyPr lIns="274320" rIns="182880" anchor="ctr"/>',
    ),
  })

const column = (id, x, label, color, items) =>
  box(id, `${label} header`, x, 1.9, 3.9, 0.7, {
    geom: 'round2SameRect', fill: color,
    body: tx(para(run(label, { sz: 2200, b: true, color: 'FFFFFF' })), '<a:bodyPr lIns="228600" anchor="ctr"/>'),
  }) +
  box(id + 1, `${label} body`, x, 2.6, 3.9, 3.7, {
    fill: PANEL,
    body: tx(
      items.map((t) => para(run(t, { sz: 1900, color: INK }), `<a:pPr marL="228600" indent="-228600"><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buClr><a:srgbClr val="${color}"/></a:buClr><a:buChar char="•"/></a:pPr>`)).join(''),
      '<a:bodyPr lIns="228600" tIns="137160" rIns="182880"/>',
    ),
  })

const slides = [
  // 1 Title
  slideXml(
    ph(2, 'Title', 'type="ctrTitle"', '', tx(para(run('Quarterly Business Review')))) +
    ph(3, 'Subtitle', 'type="subTitle" idx="1"', '', tx(para(run('Q3 2026  ·  Product and Growth')))),
  ),
  // 2 Highlights
  slideXml(
    ph(2, 'Title', 'type="title"', '', tx(para(run('Highlights')))) +
    ph(3, 'Content', 'idx="1"', '', tx(
      bulletP('Revenue up 18% year over year, ahead of plan') + bulletP('Strongest quarter for Europe and APAC', 1) +
      bulletP('Customer retention reached 94%') + bulletP('Churn fell for the third quarter in a row', 1) +
      bulletP('Three major launches shipped on schedule') + bulletP('Support response time cut in half'),
    )),
  ),
  // 3 Revenue chart
  slideXml(
    ph(2, 'Title', 'type="title"', '', tx(para(run('Revenue by region')))) +
    chartFrame(4, 'Revenue chart', 0.7, 1.65, 7.6, 5.1, 'rId2') +
    card(5, 8.7, 1.85, 3.9, 2.2, '+18%', BLUE, 'Revenue growth, year over year') +
    card(6, 8.7, 4.3, 3.9, 2.2, '$11.5M', INK, 'Total revenue this quarter'),
  ),
  // 4 Channels
  slideXml(
    ph(2, 'Title', 'type="title"', '', tx(para(run('Where the growth came from')))) +
    chartFrame(4, 'Channel chart', 0.5, 1.7, 5.9, 4.9, 'rId2') +
    tableFrame(5, 6.8, 2.3, 5.8, [['Channel', 'Share', 'Change'], ['Direct', '42%', '+9%'], ['Partners', '28%', '+31%'], ['Online', '20%', '+22%'], ['Other', '10%', '−4%']]),
  ),
  // 5 Roadmap
  slideXml(
    ph(2, 'Title', 'type="title"', '', tx(para(run('Roadmap')))) +
    column(4, 0.7, 'Now', BLUE, ['Ship the mobile app', 'Faster search', 'Self-serve onboarding']) +
    column(6, 4.7, 'Next', SKY, ['Team workspaces', 'Offline mode', 'Public API beta']) +
    column(8, 8.7, 'Later', GREEN, ['Analytics dashboards', 'Partner marketplace', 'More languages']),
  ),
  // 6 Thank you
  slideXml(
    ph(2, 'Title', 'type="ctrTitle"', '', tx(para(run('Thank you')))) +
    ph(3, 'Subtitle', 'type="subTitle" idx="1"', '', tx(para(run('Questions and discussion')))),
  ),
]
const layouts = [1, 2, 2, 2, 2, 1] // 1 = title layout, 2 = content layout

const notesXml = (text) =>
  `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${grpHead}` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>` +
  text.split('\n').map((l) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(l)}</a:t></a:r></a:p>`).join('') +
  '</p:txBody></p:sp></p:spTree></p:cSld></p:notes>'
const notes = {
  2: 'Open with the headline number, then walk through the three supporting points.\nSave retention for last: it is the best news.',
  3: 'Europe and APAC drove most of the growth.\nMention that the LATAM launch is only two months old.',
}

// ─── Package ──────────────────────────────────────────────────────────────────
const zip = new JSZip()
zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`)
zip.file('_rels/.rels', rels(rel('rId1', 'officeDocument', 'ppt/presentation.xml')))
zip.file('ppt/presentation.xml',
  `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
  `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`)
zip.file('ppt/_rels/presentation.xml.rels', rels(
  rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml') +
  slides.map((_, i) => rel(`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`)).join('') +
  rel('rId20', 'theme', 'theme/theme1.xml')))
zip.file('ppt/theme/theme1.xml', themeXml)
zip.file('ppt/tableStyles.xml', tableStyles)
zip.file('ppt/slideMasters/slideMaster1.xml', masterXml)
zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels(
  rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') + rel('rId2', 'slideLayout', '../slideLayouts/slideLayout2.xml') + rel('rId3', 'theme', '../theme/theme1.xml')))
zip.file('ppt/slideLayouts/slideLayout1.xml', titleLayout)
zip.file('ppt/slideLayouts/slideLayout2.xml', contentLayout)
for (const n of [1, 2]) zip.file(`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`, rels(rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')))

slides.forEach((xml, i) => {
  const n = i + 1
  zip.file(`ppt/slides/slide${n}.xml`, xml)
  zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels(
    rel('rId1', 'slideLayout', `../slideLayouts/slideLayout${layouts[i]}.xml`) +
    (n === 3 ? rel('rId2', 'chart', '../charts/chart1.xml') : '') +
    (n === 4 ? rel('rId2', 'chart', '../charts/chart2.xml') : '') +
    (notes[n] ? rel('rId9', 'notesSlide', `../notesSlides/notesSlide${n}.xml`) : '')))
  if (notes[n]) zip.file(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(notes[n]))
})
zip.file('ppt/charts/chart1.xml', revenueChart)
zip.file('ppt/charts/chart2.xml', channelChart)

fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`wrote ${out}`)
