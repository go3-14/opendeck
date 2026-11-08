// Writes a tiny two-page PDF by hand (no library): page 1 has a heading and a red
// rectangle, page 2 has a line with the word "zebra". Usage: node make-pdf.mjs out.pdf
import fs from 'node:fs'

const stream = (body) => `<< /Length ${body.length} >>\nstream\n${body}\nendstream`
const page1 = [
  'BT /F1 36 Tf 72 700 Td (Opendeck PDF test page one) Tj ET',
  '1 0 0 rg 72 400 200 100 re f',
].join('\n')
const page2 = 'BT /F1 28 Tf 72 700 Td (Second page with the word zebra) Tj ET'

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
  stream(page1),
  stream(page2),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]

let out = '%PDF-1.4\n'
const offsets = []
objects.forEach((body, i) => {
  offsets.push(out.length)
  out += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xref = out.length
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
fs.writeFileSync(process.argv[2], out, 'latin1')
