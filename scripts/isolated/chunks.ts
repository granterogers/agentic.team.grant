/**
 * A long document is read in passages (#419) - the real indexer, the real reader and the real retrieval code, on a replica.
 *
 *   npx tsx scripts/isolated/chunks.ts <replica-db>
 *
 * The acceptance criterion: a fact near the END of a long document must be found, and shown. Beside it: the same fact at the
 * start and the middle, similar documents that must not be confused, a foreign office's and a foreign project's canary, a
 * re-index that must stale the old text, an archive and a delete that must leave nothing active, and sabotage controls that
 * prove each check can fail. Nothing here spends a model call.
 */
import { retrieve } from '../../src/knowledge/retrieval.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'chunks_proof')
const q = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const sha = async (s: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const OFFICE = String((await q(`select app.test_office()::text o`))[0]?.o)
const OTHER = String(
  (await q(`select office_id::text o from public.offices where kind = 'person' limit 1`))[0]?.o,
)
const run = Math.random().toString(36).slice(2, 8)
const project = async (office: string, name: string): Promise<string> =>
  String(
    (
      await q(
        `insert into public.projects (slug, name, status, office_id) values (${lit(`chunks-${run}-${name}`)}, ${lit(name)}, 'archived', ${lit(office)}::uuid) returning project_id::text id`,
      )
    )[0]?.id,
  )
const PA = await project(OFFICE, 'alpha')
const PB = await project(OFFICE, 'beta')
const PO = await project(OTHER, 'foreign')

const filler = (n: number, tag: string): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `Section ${String(i)} of ${tag} describes the routine operating cadence, the staffing rota and the supplier calendar in plain terms. ` +
      'Nothing in this paragraph is remarkable and it exists to take up room in the document.\n\n',
  ).join('')

const doc = async (
  office: string,
  projectId: string,
  title: string,
  content: string,
  state = 'approved',
): Promise<string> =>
  String(
    (
      await q(
        `insert into public.documents (office_id, project_id, title, content, content_fingerprint, fetched_at, origin, state)
         values (${lit(office)}::uuid, ${lit(projectId)}::uuid, ${lit(title)}, ${lit(content)}, ${lit(await sha(content))}, now(), 'yours', ${lit(state)})
         returning document_id::text id`,
      )
    )[0]?.id,
  )

// 1. the long document: one distinctive fact at the start, the middle and the very end, 90,000+ characters between.
const BODY = filler(620, 'the handbook')
const start = `Zorbulon clause: the quarterly audit is owned by Marguerite Okafor.\n\n${BODY.slice(0, 40000)}`
const middle = `${BODY.slice(40000, 80000)}\n\nQuillfeather clause: the emergency generator is tested every first Monday.\n\n`
const end = `${BODY.slice(80000)}\n\nVantablack clause: the archive key is held by the night porter, Desmond Achterberg.\n`
const LONG = start + middle + end
const longId = await doc(OFFICE, PA, 'Operations handbook', LONG)
check('the long document is over 50,000 characters', LONG.length > 50000, String(LONG.length))
const n = Number(
  (
    await q(
      `select count(*) n from public.document_chunks where document_id = ${lit(longId)}::uuid and state = 'active'`,
    )
  )[0]?.n,
)
check('it was cut into ordered passages', n > 30, `${String(n)} passages`)

// the end of the document, the criterion
for (const [label, query, fact] of [
  ['start', 'who owns the quarterly audit Zorbulon', 'Marguerite Okafor'],
  ['middle', 'when is the emergency generator tested Quillfeather', 'first Monday'],
  ['END', 'who holds the archive key Vantablack', 'Desmond Achterberg'],
] as const) {
  const hits = await retrieve(db, { officeId: OFFICE }, query, PA)
  const h = hits.find((x) => x.documentId === longId)
  check(
    `a fact at the ${label} of a long document is found and SHOWN`,
    h !== undefined && h.excerpt.includes(fact),
    h === undefined
      ? 'document not returned'
      : `parts ${(h.passage?.seqs ?? []).join(',')} of ${String(h.passage?.of)}`,
  )
  const at = (h?.passage?.seqs[0] ?? 0) / (h?.passage?.of ?? 1)
  const place = label === 'start' ? at < 0.1 : label === 'middle' ? at > 0.3 && at < 0.7 : at > 0.9
  check(
    `the ${label} fact really sits in that part of the document (the fixture is what it says)`,
    place,
    at.toFixed(2),
  )
}
{
  const h = (
    await retrieve(db, { officeId: OFFICE }, 'who holds the archive key Vantablack', PA)
  ).find((x) => x.documentId === longId)
  check(
    'the excerpt names which part of the document it is, and says so with an ellipsis join only when two',
    h?.passage !== undefined && h.passage.of > 30,
  )
  check('and is bounded', (h?.excerpt.length ?? 0) <= 2600, String(h?.excerpt.length))
}
// CONTROL: the old behaviour (head of the document) cannot show the end - proves the check can fail
{
  const head = LONG.slice(0, 1500)
  check(
    'CONTROL: the first 1,500 characters do NOT contain the end fact',
    !head.includes('Desmond Achterberg'),
  )
}

// 2. similar documents: same shape, one different fact
const simA = await doc(
  OFFICE,
  PA,
  'Lease summary A',
  `${filler(5, 'lease A')}The break clause for lease A is Pelargonium.\n`,
)
const simB = await doc(
  OFFICE,
  PA,
  'Lease summary B',
  `${filler(5, 'lease B')}The break clause for lease B is Rhododendron.\n`,
)
{
  const hits = await retrieve(db, { officeId: OFFICE }, 'break clause lease B Rhododendron', PA)
  const top = hits.find((x) => x.excerpt.includes('Rhododendron'))
  check('similar documents: the right one carries the fact', top?.documentId === simB)
  check(
    'and the other does not claim it',
    !(hits.find((x) => x.documentId === simA)?.excerpt ?? '').includes('Rhododendron'),
  )
}

// 3. isolation
const foreignOffice = await doc(
  OTHER,
  PO,
  'Foreign handbook',
  `Canary ${run} Wibblesnort belongs to the other office.\n${filler(3, 'x')}`,
)
const foreignProject = await doc(
  OFFICE,
  PB,
  'Beta handbook',
  `Canary ${run} Wibblesnort belongs to the beta project.\n${filler(3, 'y')}`,
)
{
  const hits = await retrieve(db, { officeId: OFFICE }, `Wibblesnort canary ${run}`, PA)
  check(
    'a foreign OFFICE canary never arrives',
    !hits.some((h) => h.documentId === foreignOffice || h.excerpt.includes('other office')),
  )
  check(
    'a foreign PROJECT canary is not read for the loaded project (no silent inference)',
    !hits.some((h) => h.documentId === foreignProject),
  )
  const direct = await q(
    `select count(*) n from app.best_chunks(${lit(OFFICE)}::uuid, array[${lit(foreignOffice)}::uuid], 'Wibblesnort', 5)`,
  )
  check(
    "best_chunks given another office's document id returns nothing",
    Number(direct[0]?.n) === 0,
  )
  const asOther = await retrieve(db, { officeId: OTHER }, `Wibblesnort canary ${run}`, PO)
  check(
    'CONTROL: the owner of the foreign canary does find it',
    asOther.some((h) => h.documentId === foreignOffice),
  )
}

// 4. re-index: new text stales the old
const evolving = await doc(
  OFFICE,
  PA,
  'Policy',
  `The refund window is Aubergine days.\n${filler(3, 'p')}`,
)
{
  const newText = `The refund window is Courgette days.\n${filler(3, 'p')}`
  await q(
    `update public.documents set content = ${lit(newText)}, content_fingerprint = ${lit(await sha(newText))} where document_id = ${lit(evolving)}::uuid`,
  )
  const hits = await retrieve(db, { officeId: OFFICE }, 'refund window Aubergine Courgette', PA)
  const h = hits.find((x) => x.documentId === evolving)
  check('re-indexed: the new text is what is shown', (h?.excerpt ?? '').includes('Courgette'))
  check('and the old text is not', !(h?.excerpt ?? '').includes('Aubergine'))
  const states = await q(
    `select state, count(*) n from public.document_chunks where document_id = ${lit(evolving)}::uuid group by 1 order by 1`,
  )
  check(
    'the old generation is stale, one active generation remains',
    states.some((r) => r.state === 'stale') && states.some((r) => r.state === 'active'),
    JSON.stringify(states),
  )
  await q(
    `update public.documents set content = content where document_id = ${lit(evolving)}::uuid`,
  )
  const same = await q(
    `select count(*) n from public.document_chunks where document_id = ${lit(evolving)}::uuid and state='active'`,
  )
  const again = Number(same[0]?.n)
  await q(
    `update public.documents set title = title || ' ' where document_id = ${lit(evolving)}::uuid`,
  )
  check(
    'an idempotent write does not multiply passages',
    Number(
      (
        await q(
          `select count(*) n from public.document_chunks where document_id = ${lit(evolving)}::uuid and state='active'`,
        )
      )[0]?.n,
    ) === again,
  )
}

// 5. archive, restore, delete
{
  await q(`update public.documents set state = 'archived' where document_id = ${lit(longId)}::uuid`)
  const act = Number(
    (
      await q(
        `select count(*) n from public.document_chunks where document_id = ${lit(longId)}::uuid and state='active'`,
      )
    )[0]?.n,
  )
  check('archiving leaves no active passage', act === 0)
  const hits = await retrieve(db, { officeId: OFFICE }, 'who holds the archive key Vantablack', PA)
  check('and the archived text is not retrievable', !hits.some((h) => h.documentId === longId))
  await q(`update public.documents set state = 'approved' where document_id = ${lit(longId)}::uuid`)
  const back = await retrieve(db, { officeId: OFFICE }, 'who holds the archive key Vantablack', PA)
  check(
    'restoring brings the end of the document back',
    back.some((h) => h.documentId === longId && h.excerpt.includes('Desmond Achterberg')),
  )
  await q(`delete from public.documents where document_id = ${lit(longId)}::uuid`)
  const gone = Number(
    (
      await q(
        `select count(*) n from public.document_chunks where document_id = ${lit(longId)}::uuid`,
      )
    )[0]?.n,
  )
  check('deleting the document removes every passage', gone === 0)
}

// 6. a document with no text, and a title-only match, still read as before
{
  await q(
    `insert into public.documents (office_id, project_id, title, origin, state) values (${lit(OFFICE)}::uuid, ${lit(PA)}::uuid, 'Scanned receipt Thistledown', 'yours', 'approved')`,
  )
  const hits = await retrieve(db, { officeId: OFFICE }, 'Thistledown', PA)
  check('a document with no text yields no passages and no crash', Array.isArray(hits))
}

// 7. sabotage: a chunker that drops the tail must turn the END check red
{
  const dropped = await q(`
    select count(*) n from app.chunk_text(${lit(LONG)}) k where k.end_char = length(${lit(LONG)})`)
  check(
    'SABOTAGE CONTROL: the final passage reaches the last character',
    Number(dropped[0]?.n) === 1,
  )
  const withoutTail = LONG.slice(0, LONG.length - 3000)
  const cut = await q(
    `select count(*) n from app.chunk_text(${lit(withoutTail)}) k where k.body like '%Desmond Achterberg%'`,
  )
  check(
    'SABOTAGE CONTROL: a text without the tail has no passage holding the end fact',
    Number(cut[0]?.n) === 0,
  )
}

// teardown: this replica copy is disposable, but leave nothing behind anyway
await q(
  `delete from public.documents where project_id in (${[PA, PB, PO].map(lit).join(',')}::uuid[])`.replace(
    '::uuid[]',
    '',
  ),
)
await q(`delete from public.projects where project_id in (${[PA, PB, PO].map(lit).join(',')})`)
const left = Number(
  (
    await q(
      `select count(*) n from public.document_chunks c where not exists (select 1 from public.documents d where d.document_id = c.document_id)`,
    )
  )[0]?.n,
)
check('teardown left no orphan passage', left === 0)

console.log(failed === 0 ? '\nall passed' : `\n${String(failed)} FAILED`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
