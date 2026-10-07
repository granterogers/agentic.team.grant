import { fileText } from '../../src/text/file-text.ts'
import { onePage } from '../../tests/text/hostile-inputs.ts'
const cases: Record<string,string> = {
 numeric: '(1250.00 3400.50 220.10 98.00 15 17 19 21 23 25 27) Tj',
 codes: '(INV-0021 PO-8832 SKU-A12 SKU-B77 REF-1002 REF-1003) Tj',
 short: '(Total 40) Tj',
 prose: '(The quarterly review shows that revenue grew steadily across every region this year.) Tj',
}
for (const [k,v] of Object.entries(cases)) {
  const r = await fileText(onePage('', Buffer.from(`BT /F1 12 Tf 72 700 Td ${v} ET`,'latin1')), 'application/pdf','a.pdf')
  console.log(k, JSON.stringify(r).slice(0,150))
}
