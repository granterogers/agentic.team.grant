/**
 * What a person's dropped files become, through the DEPLOYED gateway, as the Sample Person (#419).
 *   npm run sample:documents      then      npm run sample:reset
 *
 * Uploads a long text file, a long text PDF (made by the office's own report generator), a Word file, an HTML page and an
 * image-only PDF into one of the Sample's projects, then asks the real retrieval code what the office can find:
 *   - a fact at the END of each long document is found AND shown (the acceptance criterion);
 *   - the image-only PDF is filed, openable, and reported as NOT searchable with a reason, never as indexed;
 *   - nothing is returned for a loaded project from a sibling project (no silent inference);
 *   - every other office is unchanged (fingerprinted before and after).
 * No model call and nothing is sent to anybody. The files it adds are not baseline, so `sample:reset` removes them.
 */
import { deflateRawSync } from 'node:zlib'
import { renderReport } from '../../src/artifacts/report.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { retrieve } from '../../src/knowledge/retrieval.ts'
import { diffFingerprints, otherOffices } from './fingerprint.ts'
import { gateway, lit, result, rows, sampleOffice, session } from './lib.ts'

const office = await sampleOffice()
const O = office.officeId
const s = await session()
const g = gateway(s)
const before = await otherOffices(O)
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const project = (
  await rows(
    `select project_id::text id from public.projects where office_id = ${lit(O)}::uuid and name = 'Wellness Studio Launch'`,
  )
)[0]
const sibling = (
  await rows(
    `select project_id::text id from public.projects where office_id = ${lit(O)}::uuid and status = 'active' and name <> 'Wellness Studio Launch' and name <> 'Unnamed' limit 1`,
  )
)[0]
if (project === undefined)
  throw new Error('the Sample has no Wellness Studio Launch project; run sample:seed')
const PID = String(project.id)
const run = Math.random().toString(36).slice(2, 8)

const filler = (n: number): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `Paragraph ${String(i)} covers the studio rota, the supplier calendar and the cleaning schedule in ordinary terms, with nothing in it worth remembering.`,
  ).join('\n\n')

const zip = (name: string, data: string): Buffer => {
  const raw = Buffer.from(data)
  const body = deflateRawSync(raw)
  const nm = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(nm.length, 26)
  const c = Buffer.alloc(46)
  c.writeUInt32LE(0x02014b50, 0)
  c.writeUInt16LE(8, 10)
  c.writeUInt32LE(body.length, 20)
  c.writeUInt32LE(raw.length, 24)
  c.writeUInt16LE(nm.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + nm.length, 12)
  end.writeUInt32LE(30 + nm.length + body.length, 16)
  return Buffer.concat([local, nm, body, c, nm, end])
}

const longTxt = `${filler(260)}\n\nThe studio insurance renewal reference ${run}-Quokka is held by Ottoline Brightwater.\n`
const longPdf = renderReport({
  title: `Studio operations manual ${run}`,
  subtitle: 'Sample fixture',
  author: 'The team',
  created: new Date(),
  blocks: [
    { kind: 'heading', level: 1, text: 'Operations' },
    ...Array.from({ length: 240 }, (_, i) => ({
      kind: 'paragraph' as const,
      text: `Section ${String(i)} describes the opening checklist, the towel supplier and the booking desk routine in plain words.`,
    })),
    {
      kind: 'paragraph',
      text: `The emergency shutoff valve ${run}-Axolotl is behind the boiler cupboard, key held by Bartholomew Finch.`,
    },
  ],
  sources: [],
}).bytes
const docx = zip(
  'word/document.xml',
  `<w:document><w:body><w:p><w:r><w:t>Staff handbook</w:t></w:r></w:p><w:p><w:r><w:t>The fire marshal ${run}-Pangolin is Cordelia Voss.</w:t></w:r></w:p></w:body></w:document>`,
)
const html = `<html><head><style>p{}</style></head><body><h1>Notice</h1><p>The loyalty card ${run}-Narwhal gives every tenth class free.</p></body></html>`
const imageOnly = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 30 >>\nstream\nq 595 0 0 842 0 0 cm /Im0 Do Q\nendstream\nendobj\n5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode /Length 4 >>\nstream\nÿØÿÙ\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n',
  'latin1',
)

const files: { name: string; mime: string; bytes: Buffer; searchable: boolean }[] = [
  { name: `ops-${run}.txt`, mime: 'text/plain', bytes: Buffer.from(longTxt), searchable: true },
  {
    name: `ops-manual-${run}.pdf`,
    mime: 'application/pdf',
    bytes: Buffer.from(longPdf),
    searchable: true,
  },
  {
    name: `handbook-${run}.docx`,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: docx,
    searchable: true,
  },
  { name: `notice-${run}.html`, mime: 'text/html', bytes: Buffer.from(html), searchable: true },
  { name: `scan-${run}.pdf`, mime: 'application/pdf', bytes: imageOnly, searchable: false },
]
const ids = new Map<string, string>()
for (const f of files) {
  const r = result(
    await g.act('document_upload', {
      p_project_id: PID,
      p_name: f.name,
      p_mime: f.mime,
      p_base64: `data:${f.mime};base64,${f.bytes.toString('base64')}`,
    }),
  )
  ids.set(f.name, String(r.document_id))
  check(
    `${f.name} (${String(f.bytes.length)} bytes): ${f.searchable ? 'searchable' : 'NOT searchable, with a reason'}`,
    r.searchable === f.searchable && (f.searchable || String(r.why ?? '').length > 10),
    `searchable=${String(r.searchable)}${r.why === undefined ? '' : ` why=${String(r.why)}`}`,
  )
}

const asked = async (query: string) => retrieve(db, { officeId: O }, query, PID)
for (const [name, query, fact] of [
  [
    `ops-${run}.txt`,
    `who holds the insurance renewal reference ${run}-Quokka`,
    'Ottoline Brightwater',
  ],
  [
    `ops-manual-${run}.pdf`,
    `where is the emergency shutoff valve ${run}-Axolotl`,
    'Bartholomew Finch',
  ],
  [`handbook-${run}.docx`, `who is the fire marshal ${run}-Pangolin`, 'Cordelia Voss'],
  [
    `notice-${run}.html`,
    `what does the loyalty card ${run}-Narwhal give`,
    'every tenth class free',
  ],
] as const) {
  const hits = await asked(query)
  const h = hits.find((x) => x.documentId === ids.get(name))
  check(
    `the fact in ${name} is found and shown`,
    h !== undefined && h.excerpt.includes(fact),
    h === undefined
      ? 'document not returned'
      : `parts ${(h.passage?.seqs ?? []).join(',')} of ${String(h.passage?.of)}`,
  )
}
{
  const long = (await asked(`where is the emergency shutoff valve ${run}-Axolotl`)).find(
    (x) => x.documentId === ids.get(`ops-manual-${run}.pdf`),
  )
  check(
    'the long PDF is read in passages (END of a document, not its head)',
    (long?.passage?.of ?? 0) > 20 && Math.max(...(long?.passage?.seqs ?? [0])) > 15,
    JSON.stringify(long?.passage?.seqs),
  )
}
{
  const scan = ids.get(`scan-${run}.pdf`)
  const row = (
    await rows(
      `select (content is null) as unread, (storage_path is not null) as stored from public.documents where document_id = ${lit(String(scan))}::uuid and office_id = ${lit(O)}::uuid`,
    )
  )[0]
  check(
    'the image-only PDF is stored and filed, with no invented text',
    row?.unread === true && row?.stored === true,
  )
}
if (sibling !== undefined) {
  const other = await asked(`${run}-Quokka ${run}-Axolotl`)
  check(
    'every document returned for the loaded project belongs to it',
    other.every((h) => h.scope === undefined || h.scope === 'this_project'),
  )
}
const moved = diffFingerprints(before, await otherOffices(O))
check('every other office is unchanged by the run', moved.length === 0, moved.join('; '))

console.log(
  failed === 0
    ? '\nall passed (now run npm run sample:reset to remove the fixtures)'
    : `\n${String(failed)} FAILED`,
)
process.exit(failed === 0 ? 0 : 1)
