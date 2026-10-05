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

/*
 * The matrix: npx tsx scripts/sample/pdf-cover.ts <outDir> <logoDir> matrix
 * short/long title x light/dark/no logo x thin/rich metadata x standard/band x default/compact. Written as
 * m-<title>-<logo>-<meta>-<cover>-<density>.pdf; it is a lot of covers on purpose, so contact sheets are cut from it.
 */
if (process.argv[4] === 'matrix') {
  const thin: Report = {
    ...SAMPLE,
    subtitle: '',
    blocks: SAMPLE.blocks.slice(2, 3),
    sources: [],
  }
  const shortTitle = 'Plot purchase status'
  const longer =
    'A deliberately long title that has to wrap across more than one line of the cover field and then some more words to be sure it needs the smaller sizes'
  const rich = (title: string): Report => ({
    ...many,
    title,
    sources: Array.from({ length: 14 }, (_, i) => ({
      ...(SAMPLE.sources[0] ?? { label: 'x', ref: 'x' }),
      ref: `s${String(i)}`,
    })) as Report['sources'],
  })
  const logoSet: [string, ReturnType<typeof logo> | null][] = [
    ['none', null],
    ['white', logo('logo-white-rgba.png')],
    ['black', logo('logo-black-rgba.png')],
    ['colour', logo('logo-rgba.png')],
  ]
  for (const [tn, title] of [
    ['short', shortTitle],
    ['long', longer],
  ] as const)
    for (const [ln, lg] of logoSet)
      for (const [mn, base] of [
        ['thin', thin],
        ['rich', rich(title)],
      ] as const)
        for (const cv of ['std', 'band'] as const)
          for (const dn of ['def', 'cmp'] as const) {
            const report: Report = { ...base, title }
            const style: StyleProfile = {
              formatting: {
                density: dn === 'cmp' ? 'compact' : 'comfortable',
                ...(cv === 'band' ? { title_page: 'band' } : {}),
              },
              ...(lg === null ? {} : { logo_document_id: 'x' }),
            } as StyleProfile
            const name = `m-${tn}-${ln}-${mn}-${cv}-${dn}`
            const r = renderReport(report, style, lg === null ? undefined : { logo: lg })
            writeFileSync(`${out}/${name}.pdf`, r.bytes)
            if (r.problems.length > 0)
              console.log(`${name}: PROBLEMS ${JSON.stringify(r.problems)}`)
          }
  console.log('matrix written')
}

/* Logo shapes: npx tsx scripts/sample/pdf-cover.ts <outDir> <logoDir> logos */
if (process.argv[4] === 'logos') {
  for (const f of [
    'logo-wide-rgba.png',
    'logo-tiny.png',
    'logo-thin-rgba.png',
    'logo-tall-rgba.png',
    'logo-lightgrey-rgba.png',
    'logo.jpg',
  ])
    for (const cv of ['std', 'band'] as const) {
      const style = {
        logo_document_id: 'x',
        ...(cv === 'band' ? { formatting: { title_page: 'band' } } : {}),
      } as StyleProfile
      const r = renderReport(SAMPLE, style, { logo: logo(f) })
      writeFileSync(`${out}/l-${f.replace(/\.\w+$/, '')}-${cv}.pdf`, r.bytes)
      console.log(f, cv, JSON.stringify(r.problems), JSON.stringify(r.notes))
    }
}
