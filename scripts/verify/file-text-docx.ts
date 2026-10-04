/**
 * The file reader against a DOCX written by a REAL producer (docx-js), not by hand (#419).
 *   npm run verify:file-text-docx
 *
 * `tests/text/file-text.test.ts` builds its Word files with a hand-written zip and is classed SYNTHETIC. This builds one with
 * the docx library the office's own tooling uses (headings, bulleted and numbered lists, a table, Unicode, a long body) and
 * asserts that every sentinel sentence comes back: at the start, in a list, in a table cell, in the middle and in the last
 * paragraph of a document over 50,000 characters. The sentinels are the ground truth, because we wrote them.
 * Local class: no office, no network. Skipped with a sentence (never a pass) when the docx library is not installed here.
 */
import { createRequire } from 'node:module'
import { fileText } from '../../src/text/file-text.ts'

const require = createRequire(import.meta.url)
// The library is a development-machine tool, not a dependency of this repository, so it has no types here.
// biome-ignore lint/suspicious/noExplicitAny: an optional third-party producer used only by this check
let lib: any = null
for (const where of [process.env.DOCX_LIB ?? '', '/node-tools/node_modules/docx', 'docx']) {
  if (where === '') continue
  try {
    lib = require(where)
    break
  } catch {
    // try the next place
  }
}
if (lib === null) {
  console.log(
    'the docx library is not installed here: the real-producer DOCX check is NOT run (a skip, not a pass)',
  )
  process.exit(0)
}
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
} = lib

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` (${detail})`}`)
  if (!ok) failed += 1
}

const filler = (n: number): string =>
  `Paragraph ${String(n)}: the joinery schedule for bay ${String(n % 17)} was reviewed against the drawings and nothing further was raised. `.repeat(
    4,
  )

const SENT = {
  start: 'The opening sentinel says the deposit is forty percent.',
  heading: 'Payment Terms And Retention',
  bullet: 'Bullet sentinel: retention is released after twelve months.',
  numbered: 'Numbered sentinel: the architect signs off on stage three.',
  cell: 'Cell sentinel: delivery slot Thursday 14:30',
  unicode: 'Unicode sentinel: café déjà vu naïve — “quoted” 東京 Ωmega',
  middle: 'The middle sentinel says the crane hire is booked for week twenty-two.',
  end: 'The closing sentinel says the final account is due on 30 November.',
}

const body: unknown[] = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(SENT.heading)] }),
  new Paragraph({ children: [new TextRun(SENT.start)] }),
  new Paragraph({ bullet: { level: 0 }, children: [new TextRun(SENT.bullet)] }),
  new Paragraph({
    numbering: { reference: 'n', level: 0 },
    children: [new TextRun(SENT.numbered)],
  }),
  new Paragraph({ children: [new TextRun(SENT.unicode)] }),
]
for (let i = 0; i < 260; i += 1) {
  body.push(new Paragraph({ children: [new TextRun(filler(i))] }))
  if (i === 130) body.push(new Paragraph({ children: [new TextRun(SENT.middle)] }))
}
body.push(new Paragraph({ children: [new TextRun(SENT.end)] }))

const table = new Table({
  width: { size: 9000, type: WidthType.DXA },
  columnWidths: [4500, 4500],
  rows: [
    new TableRow({
      children: ['Item', 'Detail'].map(
        (t) =>
          new TableCell({
            width: { size: 4500, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun(t)] })],
          }),
      ),
    }),
    new TableRow({
      children: ['Delivery', SENT.cell].map(
        (t) =>
          new TableCell({
            width: { size: 4500, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun(t)] })],
          }),
      ),
    }),
  ],
})

const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'n',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }],
      },
    ],
  },
  sections: [{ children: [...body.slice(0, 5), table, ...body.slice(5)] }],
})
const bytes = new Uint8Array(await Packer.toBuffer(doc))
const r = await fileText(
  bytes,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'schedule.docx',
)
const text = r.text ?? ''
check('a real docx-js file is read, not declined', r.text !== null, 'why' in r ? String(r.why) : '')
check('it is long enough to be the real test', text.length > 50000, String(text.length))
for (const [k, s] of Object.entries(SENT)) check(`sentinel: ${k}`, text.includes(s))
check('the END of the document is present', text.trimEnd().endsWith(SENT.end), text.slice(-80))
check('no markup leaked', !/<\/?w:|<w:|xmlns/.test(text))
// CONTROL: the old first-1,500-character reading must be unable to see the end, or this check could not fail
check(
  'control: the first 1,500 characters do not hold the end',
  !text.slice(0, 1500).includes(SENT.end),
)
console.log(`\n${failed === 0 ? 'all passed' : `${String(failed)} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
