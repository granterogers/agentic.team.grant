/*
 * Render sample reports so the cover can be LOOKED at: npx tsx scripts/sample/pdf-cover.ts [outDir] [logoDir]
 * Writes one PDF per variant; rasterise with `pdftoppm -r 80 -png`. Nothing here is a test: opening the image is the
 * check (CLAUDE.md, visual standard). A logo directory holds logo-rgba.png, logo-rgb.png, logo-pal.png and logo.jpg.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readImage } from '../../src/artifacts/image.ts'
import { type Report, renderReport } from '../../src/artifacts/report.ts'
import type { StyleProfile } from '../../src/artifacts/style.ts'
import { SAMPLE } from '../../tests/artifacts/sample-report.ts'

const out = process.argv[2] ?? '.out/pdf-cover'
const logos = process.argv[3] ?? '/tmp/pdfwork'
mkdirSync(out, { recursive: true })

const logo = (name: string) => {
  const r = readImage(new Uint8Array(readFileSync(`${logos}/${name}`)))
  if (!r.ok) throw new Error(`${name}: ${r.reason}`)
  return r.image
}

const longTitle: Report = {
  ...SAMPLE,
  title:
    'A deliberately long title that has to wrap across more than one line of the cover field and then some more words to be sure',
}
const noSummary: Report = { ...SAMPLE, subtitle: '' }
const many: Report = {
  ...SAMPLE,
  blocks: [
    ...SAMPLE.blocks,
    ...Array.from({ length: 12 }, (_, i) => [
      {
        kind: 'heading' as const,
        level: 1 as const,
        text: `Section ${String(i + 1)}: what the interviews said about onboarding`,
      },
      {
        kind: 'paragraph' as const,
        text: 'Customers described the first week as the moment they decided. '.repeat(14),
      },
    ]).flat(),
  ],
}

const variants: [string, Report, StyleProfile | null, Parameters<typeof renderReport>[2]][] = [
  ['default', SAMPLE, null, undefined],
  ['band', SAMPLE, { formatting: { title_page: 'band' } }, undefined],
  [
    'band-green-logo-rgba',
    SAMPLE,
    { palette: { primary: '#1f6f55' }, formatting: { title_page: 'band' }, logo_document_id: 'x' },
    { logo: logo('logo-rgba.png') },
  ],
  ['standard-logo-jpeg', SAMPLE, { logo_document_id: 'x' }, { logo: logo('logo.jpg') }],
  [
    'standard-logo-palette-times',
    SAMPLE,
    { typography: { heading: 'Times' }, logo_document_id: 'x' },
    { logo: logo('logo-pal.png') },
  ],
  [
    'compact-long-title-band',
    longTitle,
    { formatting: { title_page: 'band', density: 'compact' } },
    undefined,
  ],
  [
    'long-title-logo',
    longTitle,
    { logo_document_id: 'x', palette: { primary: '#7a2b4d' } },
    { logo: logo('logo-rgb.png') },
  ],
  ['no-summary', noSummary, { formatting: { title_page: 'band' } }, undefined],
  [
    'many-sections',
    many,
    { formatting: { title_page: 'band' }, logo_document_id: 'x' },
    { logo: logo('logo-rgba.png') },
  ],
]
for (const [name, report, style, assets] of variants) {
  const r = renderReport(report, style, assets)
  writeFileSync(`${out}/${name}.pdf`, r.bytes)
  console.log(
    `${name}: ${String(r.bytes.length)} bytes, problems=${JSON.stringify(r.problems)}, notes=${JSON.stringify(r.notes)}`,
  )
}
