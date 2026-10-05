/**
 * The report pipeline, end to end, on a LOCAL replica, inside one transaction that is rolled back (migration 0940).
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/isolated/ux-be/05-artifacts.ts [replica-db]
 *
 * Drives the REAL artifact handler (real runSteps, retrieve, storeArtifact's record_file_document, the version
 * functions) against Postgres with a FAKE model router and a stubbed storage fetch: no network, no model, no
 * production. Proves: the source is resolved over logical documents (other project, archived and superseded never
 * resolve; the head does); an ambiguous phrase asks and makes nothing; first creation is version 1 with provenance;
 * a revision is version 2 (draft head) and version 3 (approved head) of ONE logical document, idempotently; changing
 * the style changes the file's colours and the recorded hash; generating/saving/versioning needs no approval and
 * raises no blocker, delivery or approval row; the approval boundary still refuses an outbound or outside effect.
 */
import { createHash } from 'node:crypto'
import { artifactHandler } from '../../../src/handlers/artifact.ts'
import type { Job } from '../../../src/jobs/worker.ts'
import type { ProviderRouter } from '../../../src/providers/router.ts'
import { isolated } from '../guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_art')
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
// biome-ignore lint/suspicious/noExplicitAny: a jsonb answer is read by key in a proof
const call = async (sql: string): Promise<any> => {
  const raw = (await q(`select (${sql}) as r`))[0]?.r
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const OFFICE = String((await q('select app.test_office()::text o'))[0]?.o)
const run = Math.random().toString(36).slice(2, 8)

// ---- stubs: storage and the model. Nothing leaves this process. --------------------------------------------------
const stored = new Map<string, Uint8Array>()
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
  const u = String(url)
  if (!u.includes('/object/files/'))
    throw new Error(`REFUSED: this proof makes no network call (${u})`)
  stored.set(u, init?.body as Uint8Array)
  return new Response('{}', { status: 200 })
}) as typeof fetch

const prompts: string[] = []
const reply = (title: string, design?: unknown): string =>
  JSON.stringify({
    blocks: [
      {
        kind: 'paragraph',
        lead: true,
        text: 'Customers want faster onboarding and clearer pricing.',
      },
      { kind: 'heading', level: 1, text: 'What we heard' },
      {
        kind: 'paragraph',
        text: 'Twelve of the eighteen customers interviewed named onboarding as their main difficulty.',
      },
      {
        kind: 'chart',
        title: 'Main difficulty',
        bars: [
          { label: 'Onboarding', value: 12 },
          { label: 'Pricing', value: 4 },
          { label: 'Support', value: 2 },
        ],
      },
    ],
    ...(design === undefined ? {} : { design }),
    title,
  })
let nextReply = reply('Customer research report')
const router = {
  complete: async (req: { messages: { content: string }[] }) => {
    prompts.push(req.messages.map((m) => m.content).join('\n'))
    return { content: nextReply, model: 'fake/model' }
  },
}
const handler = artifactHandler({
  db,
  projectRef: 'proof',
  router: router as unknown as ProviderRouter,
  serviceKey: 'proof-key',
})

await q('begin')
try {
  const project = async (slug: string): Promise<string> =>
    String(
      (
        await q(
          `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'active', ${lit(OFFICE)}::uuid) returning project_id::text id`,
        )
      )[0]?.id,
    )
  const SLUG = `artproof-${run}`
  const PA = await project(SLUG)
  const PB = await project(`${SLUG}-other`)
  let tick = 0
  const doc = async (
    p: string,
    title: string,
    content: string,
    over: { state?: string; days?: number } = {},
  ): Promise<string> =>
    String(
      (
        await q(`insert into public.documents
        (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at, origin, connector, state, created_at, updated_at, added_by)
        values (${lit(OFFICE)}::uuid, ${lit(p)}::uuid, ${lit(title)}, 'note', ${lit(content)}, ${lit(sha(content + String(++tick)))}, ${String(content.length)}, now(),
                'source', 'upload', ${lit(over.state ?? 'approved')}, now() - (${String(over.days ?? 1)} * interval '1 day'), now() - (${String(over.days ?? 1)} * interval '1 day'), 'you')
        returning document_id::text id`)
      )[0]?.id,
    )

  // =================================================================== 1. resolving over logical documents
  await doc(
    PA,
    'Customer research report Q1',
    'Q1 interviews: pricing was the main concern. '.repeat(4),
    { days: 120 },
  )
  const q3 = await doc(
    PA,
    'Customer research report Q3',
    'Q3 interviews: twelve of eighteen customers named onboarding as the main difficulty. '.repeat(
      4,
    ),
    { days: -0.05 },
  )
  const other = await doc(
    PB,
    'Customer research report Q4 (other project)',
    'Another project entirely. '.repeat(8),
    { days: 1 },
  )
  const archived = await doc(
    PA,
    'Customer research report Q5 archived',
    'Archived and newest. '.repeat(8),
    { state: 'archived', days: 0 },
  )
  const draft = await doc(PA, 'Customer research report Q6 draft', 'Not approved yet. '.repeat(8), {
    state: 'draft',
    days: 0,
  })
  const v1 = await doc(PA, 'Customer research report Q2', 'Q2 first version. '.repeat(8), {
    days: 60,
  })
  const v2 = await doc(PA, 'Customer research report Q2', 'Q2 second version. '.repeat(8), {
    days: 50,
  })
  const sup = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v1)}::uuid, null, ${lit(v2)}::uuid, 'v2', 'teamhq', false)`,
  )
  check('setup: a superseded version exists', sup?.ok === true, JSON.stringify(sup))

  const { resolveSourceDocument } = await import('../../../src/artifacts/source.ts')
  const latest = await resolveSourceDocument(db, {
    office: OFFICE,
    phrase: 'the latest customer research report',
    project: SLUG,
  })
  check(
    '"the latest customer research report" resolves to the newest APPROVED report in this project',
    latest.status === 'resolved' && latest.status === 'resolved' && latest.document.id === q3
      ? true
      : latest.status === 'ambiguous' || latest.status === 'none'
        ? false
        : false,
    JSON.stringify(latest).slice(0, 200),
  )
  const all = JSON.stringify(latest)
  check("negative: the other project's newer report never appears", !all.includes(other))
  check('negative: the archived report never appears', !all.includes(archived))
  check('negative: the unapproved draft never appears', !all.includes(draft))
  check('negative: the superseded version never appears (its head may)', !all.includes(v1))
  const vague = await resolveSourceDocument(db, {
    office: OFFICE,
    phrase: 'the customer research report',
    project: SLUG,
  })
  check(
    'without "latest" three equal-looking reports are AMBIGUOUS and the caller asks',
    vague.status === 'ambiguous',
    vague.status,
  )
  check(
    'the candidates are logical documents: the head of Q2 is offered, its superseded v1 is not',
    vague.status === 'ambiguous' &&
      vague.candidates.some((c) => c.id === v2) &&
      !vague.candidates.some((c) => c.id === v1),
  )
  const none = await resolveSourceDocument(db, {
    office: OFFICE,
    phrase: 'the pricing strategy memo',
    project: SLUG,
  })
  check(
    'nothing matching is "none" with what the project does hold offered',
    none.status === 'none' && none.candidates.length > 0,
  )

  // =================================================================== 2. version 1, with provenance
  const asJob = async (brief: string): Promise<Job> => {
    const r = (
      await q(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id, pinned_config, office_id)
      values ('artifact.report', ${lit(`verify:artproof-${run}`)}, ${lit(PA)}::uuid, 'ap-' || gen_random_uuid(), gen_random_uuid(),
              ${lit(JSON.stringify({ brief, by: 'chief-of-staff' }))}::jsonb, ${lit(OFFICE)}::uuid)
      returning job_id::text id, correlation_id::text cid, idempotency_key k`)
    )[0] as Row
    return {
      attempt: 1,
      correlationId: String(r.cid),
      idempotencyKey: String(r.k),
      jobId: String(r.id),
      kind: 'artifact.report',
      projectId: PA,
    }
  }
  const counts = async (): Promise<Record<string, number>> => {
    const r = (
      await q(`select (select count(*) from public.deliveries) d, (select count(*) from public.blockers) b,
        (select count(*) from public.jobs where kind <> 'artifact.report' and created_at > now() - interval '1 minute' and requested_by like 'verify:artproof%') j`)
    )[0] as Row
    return { b: Number(r.b), d: Number(r.d), j: Number(r.j) }
  }
  const before = await counts()
  const styleA = await call(
    `app.hq_style_set(${lit(OFFICE)}::uuid, ${lit(SLUG)}, '{"palette":{"primary":"#aa3322"},"formatting":{"title_page":"standard"}}'::jsonb, 'teamhq', 'grant')`,
  )
  check(
    'setup: a project style',
    styleA && !('error' in styleA),
    JSON.stringify(styleA).slice(0, 120),
  )

  const job1 = await asJob('Make a beautiful PDF of the latest customer research report')
  nextReply = reply('Customer research report', { title_page: 'band', font: 'Comic Sans' })
  const out1 = await handler.handle(job1, db)
  check(
    'v1: the model was shown the RESOLVED source text, first',
    prompts.at(-1)?.includes('twelve of eighteen customers named onboarding') === true &&
      prompts
        .at(-1)
        ?.includes('The source document to turn into the report: "Customer research report Q3"') ===
        true,
  )
  check(
    "v1: the other project's and archived text never reached the model",
    !prompts.at(-1)?.includes('Another project entirely') &&
      !prompts.at(-1)?.includes('Archived and newest'),
  )
  check(
    'v1: a PDF came back attached to the requesting turn',
    out1.attachFile !== undefined && out1.body.includes('pages'),
    out1.body.slice(0, 160),
  )
  check('v1: says nothing about a version (it is the first)', !/version \d/.test(out1.body))
  const made1 = await q(
    `select document_id::text id, state, origin, produced_by_job::text j, mime_type from public.documents where project_id = ${lit(PA)}::uuid and origin = 'made' order by created_at`,
  )
  check(
    "v1: saved to Documents once, as the office's own draft, tied to its job",
    made1.length === 1 &&
      made1[0]?.origin === 'made' &&
      made1[0]?.j === job1.jobId &&
      made1[0]?.state === 'draft',
    JSON.stringify(made1),
  )
  const m1 = String(made1[0]?.id)
  const prov1 = await call(`app.document_provenance_of(${lit(OFFICE)}::uuid, ${lit(m1)}::uuid)`)
  check(
    'v1: provenance keeps the job, the style hash + updated_at, the design and the cited source',
    prov1?.job_id === job1.jobId &&
      /^[0-9a-f]{12}$/.test(String(prov1?.style_hash)) &&
      prov1?.style_updated_at != null &&
      JSON.stringify(prov1.sources).includes(q3) &&
      prov1.design?.titlePage === 'standard',
    JSON.stringify(prov1).slice(0, 300),
  )
  check(
    'v1: the model proposed a band; the house style said standard and won, and the reason says so',
    JSON.stringify(prov1?.design?.reasons).includes('the house style says so'),
  )
  check(
    'v1: the unsupported "font" in the model\'s design was ignored (the design is the supported set)',
    !JSON.stringify(prov1?.design).includes('Comic'),
  )
  const pdf1 = [...stored.values()].at(-1) as Uint8Array
  const hash1 = String(prov1?.style_hash)
  const txt1 = Buffer.from(pdf1).toString('latin1')

  // idempotent per job: running the same job again makes no second document and no second row
  const again = await handler.handle(job1, db)
  const made1b = await q(
    `select count(*)::int n from public.documents where project_id = ${lit(PA)}::uuid and origin = 'made'`,
  )
  const provN = await q(
    `select count(*)::int n from public.document_provenance where document_id = ${lit(m1)}::uuid`,
  )
  check(
    'v1: the same job again makes no second document and no second provenance row',
    Number(made1b[0]?.n) === 1 && Number(provN[0]?.n) === 1 && again.attachFile !== undefined,
  )

  // =================================================================== 3. ambiguity asks
  const jobAsk = await asJob('Turn the customer research report into a PDF')
  const promptsBefore = prompts.length
  const outAsk = await handler.handle(jobAsk, db)
  const madeAsk = await q(
    `select count(*)::int n from public.documents where project_id = ${lit(PA)}::uuid and origin = 'made'`,
  )
  check(
    'ambiguous: asks which, lists candidates, spends no model call and makes no file',
    outAsk.attachFile === undefined &&
      outAsk.body.includes('Which one') &&
      prompts.length === promptsBefore &&
      Number(madeAsk[0]?.n) === 1,
    outAsk.body.slice(0, 200),
  )
  const jobNone = await asJob('Find the pricing strategy memo and turn it into a PDF')
  const outNone = await handler.handle(jobNone, db)
  check(
    'none: says it could not find it and makes nothing',
    outNone.attachFile === undefined &&
      /Nothing in this project matched|could not find/.test(outNone.body),
  )

  // =================================================================== 4. revision -> version 2 (draft head)
  await q(`select pg_sleep(0.05)`)
  await call(
    `app.hq_style_set(${lit(OFFICE)}::uuid, ${lit(SLUG)}, '{"palette":{"primary":"#117755"},"typography":{"heading":"Times"},"formatting":{"title_page":"band"}}'::jsonb, 'teamhq', 'grant')`,
  )
  const job2 = await asJob('Redo the PDF with a band title')
  nextReply = reply('Customer research report')
  const out2 = await handler.handle(job2, db)
  const lineage = await q(
    `select document_id::text id, state, superseded_by::text s from public.documents where project_id = ${lit(PA)}::uuid and origin = 'made' order by (superseded_by is null), created_at`,
  )
  check(
    'v2: one NEW document, and it is version 2 of the first (the head is archived and points at it)',
    lineage.length === 2 && lineage[0]?.s === lineage[1]?.id && lineage[0]?.state === 'archived',
    JSON.stringify(lineage),
  )
  check(
    'v2: the answer says it is version 2 and that version 1 is kept',
    /version 2/.test(out2.body) && /history/.test(out2.body),
    out2.body.slice(0, 260),
  )
  const m2 = String(lineage[1]?.id)
  check(
    'v2: it stays a DRAFT - the office does not approve its own unreviewed work',
    lineage[1]?.state === 'draft',
  )
  const vers = await call(`app.hq_document_versions(${lit(OFFICE)}::uuid, ${lit(m2)}::uuid)`)
  check(
    'v2: hq_document_versions shows v1 and v2 of one logical document',
    vers?.version_count === 2 && vers.versions.map((v: Row) => v.version).join() === '1,2',
    JSON.stringify(vers).slice(0, 200),
  )
  check(
    'v2: the version note names the job and the style',
    String(vers?.versions?.[1]?.note).includes(job2.jobId.slice(0, 8)) &&
      /style [0-9a-f]{12}/.test(String(vers?.versions?.[1]?.note)),
  )
  const prov2 = await call(`app.document_provenance_of(${lit(OFFICE)}::uuid, ${lit(m2)}::uuid)`)
  // updated_at cannot differ inside one transaction (now() is the transaction's instant); the hash is what moves here.
  check(
    'v2: the recorded style hash CHANGED with the style, and updated_at was recorded',
    prov2?.style_hash !== hash1 &&
      prov2?.style_updated_at != null &&
      Date.parse(prov2.style_updated_at) >= Date.parse(prov1?.style_updated_at),
    `${hash1} -> ${prov2?.style_hash}`,
  )
  const txt2 = Buffer.from([...stored.values()].at(-1) as Uint8Array).toString('latin1')
  check(
    "v2: the file's colour changed with it (#aa3322 -> #117755)",
    /0\.667 0\.2 0\.133 (rg|RG)/.test(txt1) &&
      !/0\.667 0\.2 0\.133 (rg|RG)/.test(txt2) &&
      /0\.067 0\.467 0\.333 (rg|RG)/.test(txt2),
  )
  check(
    'v2: it reused the sources version 1 cited (no source named in the request)',
    prompts.at(-1)?.includes('twelve of eighteen customers named onboarding') === true,
  )
  const dup = await call(
    `app.document_revise_made(${lit(OFFICE)}::uuid, ${lit(String(lineage[0]?.id))}::uuid, ${lit(m2)}::uuid, 'again')`,
  )
  check(
    'v2: revising again with the same pair is "already", not a v3',
    dup?.ok === true && dup.already === true && dup.version === 2,
    JSON.stringify(dup),
  )
  const third = String(
    (
      await q(`insert into public.documents (office_id, project_id, title, origin, state, mime_type, byte_size, storage_path, added_by, produced_by)
      values (${lit(OFFICE)}::uuid, ${lit(PA)}::uuid, 'A third made PDF', 'made', 'draft', 'text/plain', 100, ${lit(`${PA}/made/third-${run}.pdf`)}, 'chief-of-staff', 'chief-of-staff') returning document_id::text id`)
    )[0]?.id,
  )
  const stale = await call(
    `app.document_revise_made(${lit(OFFICE)}::uuid, ${lit(String(lineage[0]?.id))}::uuid, ${lit(third)}::uuid, 'x')`,
  )
  check(
    'negative: a stale head is refused with the current id, not forked',
    stale?.ok === false &&
      String(stale.error).includes('not the latest version') &&
      stale.current_id === m2,
    JSON.stringify(stale),
  )
  const foreign = await call(
    `app.document_revise_made(${lit(OFFICE)}::uuid, ${lit(m2)}::uuid, ${lit(q3)}::uuid, 'x')`,
  )
  check(
    'negative: a document the office did not make cannot be adopted as a version',
    foreign?.ok === false && String(foreign.error).includes('made'),
    JSON.stringify(foreign),
  )

  // =================================================================== 5. approved head -> v3 is a DRAFT beside the approved v2
  // Approval belongs to a version (Grant, 5 October 2026): v3 made from approved v2 does not inherit v2's approval and
  // must not make the approved document disappear from Documents.
  await q(`update public.documents set state = 'approved' where document_id = ${lit(m2)}::uuid`)
  const job3 = await asJob('Revise the report so it is more concise')
  nextReply = reply('Customer research report')
  const out3 = await handler.handle(job3, db)
  const vers3 = await call(`app.hq_document_versions(${lit(OFFICE)}::uuid, ${lit(m2)}::uuid)`)
  check(
    'v3: a revision of an approved head is version 3 of the same logical document, saved as a DRAFT',
    vers3?.version_count === 2 &&
      vers3.versions.length === 3 &&
      vers3.versions[2]?.state === 'draft' &&
      vers3.versions[2]?.version === 3 &&
      vers3.current_id === m2 &&
      vers3.pending_id === vers3.versions[2]?.document_id &&
      /version 3/.test(out3.body) &&
      /draft/.test(out3.body) &&
      /approved version stays/.test(out3.body),
    JSON.stringify(vers3).slice(0, 160) + out3.body.slice(0, 100),
  )
  const m3 = String(vers3?.pending_id)
  const listed = await call(`app.hq_project_documents(${lit(OFFICE)}::uuid, ${lit(SLUG)})`)
  const item = (listed.documents as Row[]).filter(
    (d) => String(d.title).includes('Customer research report') && d.origin === 'made',
  )
  check(
    'v3: Documents still lists the logical document: v2 Approved is the item, v3 Draft is exposed beside it, v3 is not an item',
    item.length === 1 &&
      item[0]?.id === m2 &&
      item[0]?.version_count === 2 &&
      item[0]?.current_state === 'approved' &&
      (item[0]?.pending_version as Row | null)?.id === m3 &&
      (item[0]?.pending_version as Row | null)?.state === 'draft' &&
      (item[0]?.pending_version as Row | null)?.version === 3,
    JSON.stringify(item.map((d) => [d.title, d.version_count, d.pending_version])),
  )
  const asked4 = await asJob('Revise the report again with a band title')
  nextReply = reply('Customer research report')
  const out4 = await handler.handle(asked4, db)
  const vers4 = await call(`app.hq_document_versions(${lit(OFFICE)}::uuid, ${lit(m2)}::uuid)`)
  check(
    'v3b: a second revision replaces the pending draft (one pending draft, the earlier one kept as history)',
    vers4?.versions.filter((v: Row) => v.is_pending === true).length === 1 &&
      vers4.pending_id !== m3 &&
      vers4.current_id === m2 &&
      (await q(`select state from public.documents where document_id = ${lit(m3)}::uuid`))[0]
        ?.state === 'archived' &&
      /version 3/.test(out4.body),
    JSON.stringify(vers4?.versions.map((v: Row) => [v.state, v.version])).slice(0, 200),
  )
  const m3b = String(vers4?.pending_id)
  await q(`update public.documents set state = 'approved' where document_id = ${lit(m3b)}::uuid`)
  const vers5 = await call(`app.hq_document_versions(${lit(OFFICE)}::uuid, ${lit(m2)}::uuid)`)
  check(
    'v3c: a person approving the draft makes it the current version and archives v2 (listed as one item at version 3)',
    vers5?.current_id === m3b &&
      vers5.pending_id === null &&
      vers5.version_count === 3 &&
      (
        (await call(`app.hq_project_documents(${lit(OFFICE)}::uuid, ${lit(SLUG)})`))
          .documents as Row[]
      ).filter(
        (d) => String(d.title).includes('Customer research report') && d.origin === 'made',
      )[0]?.id === m3b,
    JSON.stringify(vers5?.versions.map((v: Row) => [v.state, v.version])).slice(0, 200),
  )
  const rollback = await call(
    `app.hq_document_rollback(${lit(OFFICE)}::uuid, ${lit(m1)}::uuid, 'back', 'teamhq')`,
  )
  check(
    'nothing was deleted: the first version can still be rolled back to (as a new version 4)',
    rollback?.ok === true && rollback.version === 4,
    JSON.stringify(rollback).slice(0, 160),
  )

  // =================================================================== 6. no approval to make/save/version; the gate still holds outward
  const after = await counts()
  check(
    'generating, saving and versioning raised no blocker, no delivery and no other job',
    after.b === before.b && after.d === before.d && after.j === before.j,
    JSON.stringify({ before, after }),
  )
  const verdict = async (tool: string, audience: string): Promise<string> =>
    String(
      (
        await call(
          `app.authorize_effect(p_office => ${lit(OFFICE)}::uuid, p_project => ${lit(PA)}::uuid, p_tool => ${lit(tool)}, p_asked_job => ${lit(job1.jobId)}::uuid, p_audience => ${lit(audience)})`,
        )
      )?.verdict,
    )
  const own = await verdict('document.create', 'office')
  const outward = await verdict('document.create', 'outside')
  const mail = await verdict('gmail.send', 'outside')
  const post = await verdict('slack.post', 'outside')
  check('document.create for the office itself is not asked about', own === 'proceed', own)
  check(
    'the same tool aimed OUTSIDE the office is never proceed on its own (approval architecture)',
    outward !== 'proceed',
    outward,
  )
  check(
    'gmail.send and slack.post outward are not proceed either',
    mail !== 'proceed' && post !== 'proceed',
    `${mail} / ${post}`,
  )
  check(
    'the outputs went nowhere but the asking turn (attachFile only; no delivery rows)',
    out1.attachFile !== undefined && after.d === before.d,
  )
} finally {
  await q('rollback')
  globalThis.fetch = realFetch
  const left = await q(`select count(*)::int n from public.projects where slug like 'artproof-%'`)
  check('teardown left nothing behind', Number(left[0]?.n) === 0)
  await db.end()
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${String(failed)} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
