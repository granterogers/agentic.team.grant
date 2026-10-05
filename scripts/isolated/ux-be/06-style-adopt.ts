/**
 * "Save this report's style as the project's" (HQ-STYLE-013, migration 0970) and the logo (HQ-PDF-006/7/14), on a LOCAL
 * replica inside one transaction that is rolled back.
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/isolated/ux-be/06-style-adopt.ts [replica-db]
 *
 * Drives the REAL artifact handler with a fake model router, a stubbed storage fetch and an INJECTED logo fetcher
 * (fixtures from tests/artifacts/fixtures): no network, no model, no production.
 */
import { readFileSync } from 'node:fs'
import { artifactHandler } from '../../../src/handlers/artifact.ts'
import type { Job } from '../../../src/jobs/worker.ts'
import type { ProviderRouter } from '../../../src/providers/router.ts'
import { isolated } from '../guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_pdf2')
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
const fixture = (n: string): Uint8Array =>
  new Uint8Array(readFileSync(`tests/artifacts/fixtures/${n}`))

const OFFICE = String((await q('select app.test_office()::text o'))[0]?.o)
const run = Math.random().toString(36).slice(2, 8)

const stored: Uint8Array[] = []
globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
  const u = String(url)
  if (!u.includes('/object/files/')) throw new Error(`REFUSED: no network call (${u})`)
  stored.push(init?.body as Uint8Array)
  return new Response('{}', { status: 200 })
}) as typeof fetch

const router = {
  complete: async () => ({
    content: JSON.stringify({
      blocks: [
        { kind: 'paragraph', lead: true, text: 'Customers want faster onboarding.' },
        { kind: 'heading', level: 1, text: 'What we heard' },
        { kind: 'paragraph', text: 'Twelve of eighteen named onboarding.' },
      ],
      title: 'Customer research',
    }),
    model: 'fake/model',
  }),
}
let logoBytes: Uint8Array | null = fixture('logo-rgba.png')
const fetched: string[] = []
const handler = artifactHandler({
  db,
  fetchLogoBytes: async (path) => {
    fetched.push(path)
    return logoBytes
  },
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
  const SLUG = `adoptproof-${run}`
  const PA = await project(SLUG)
  const PB = await project(`${SLUG}-other`)
  const fileDoc = async (p: string, title: string, mime: string): Promise<string> => {
    const r = await call(`app.record_file_document(
      p_office => ${lit(OFFICE)}::uuid, p_project_id => ${lit(p)}::uuid, p_title => ${lit(title)},
      p_storage_path => ${lit(`${p}/${title}`)}, p_mime_type => ${lit(mime)}, p_byte_size => 3000::bigint,
      p_parent_ref => null, p_external_ref => ${lit(`proof:${title}:${run}`)}, p_duration_s => null,
      p_added_by => 'you', p_job_id => null, p_origin => 'yours')`)
    return String(r?.document_id)
  }
  const content =
    'Customer interviews: twelve of eighteen customers named onboarding as the main difficulty. '.repeat(
      4,
    )
  await q(`insert into public.documents
    (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at, origin, connector, state, added_by)
    values (${lit(OFFICE)}::uuid, ${lit(PA)}::uuid, 'Customer interview notes', 'note', ${lit(content)},
            encode(sha256(convert_to(${lit(content)}, 'utf8')), 'hex'), ${String(content.length)}, now(), 'source', 'upload', 'approved', 'you')`)
  const logoDoc = await fileDoc(PA, 'logo.png', 'image/png')
  const otherLogo = await fileDoc(PB, 'other-logo.png', 'image/png')
  check(
    'setup: two logo documents',
    /^[0-9a-f-]{36}$/.test(logoDoc) && /^[0-9a-f-]{36}$/.test(otherLogo),
    `${logoDoc} ${otherLogo}`,
  )

  const set = async (patch: object): Promise<Row> =>
    (await call(
      `app.hq_style_set(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(JSON.stringify(patch))}::jsonb, 'teamhq', 'grant')`,
    )) as Row
  const sA = await set({
    palette: { primary: '#117755' },
    formatting: { title_page: 'band' },
    logo_document_id: logoDoc,
    tone: 'Warm',
  })
  check('setup: a project style with a logo', sA.ok === true, JSON.stringify(sA).slice(0, 160))

  const asJob = async (): Promise<Job> => {
    const r = (
      await q(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id, pinned_config, office_id)
      values ('artifact.report', ${lit(`verify:adoptproof-${run}`)}, ${lit(PA)}::uuid, 'ad-' || gen_random_uuid(), gen_random_uuid(),
              ${lit(JSON.stringify({ brief: 'Write me a PDF report on what customers said', by: 'chief-of-staff' }))}::jsonb, ${lit(OFFICE)}::uuid)
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
  const madeIds = async (): Promise<string[]> =>
    (
      await q(
        `select document_id::text id from public.documents where project_id = ${lit(PA)}::uuid and origin = 'made' order by created_at`,
      )
    ).map((r) => String(r.id))

  // =============================================================== 1. the logo is drawn, and the snapshot is kept
  const out1 = await handler.handle(await asJob(), db)
  const pdf1 = Buffer.from(stored.at(-1) as Uint8Array).toString('latin1')
  check(
    "logo: the injected fetcher was asked for the logo document's own storage path",
    fetched.at(-1) === `${PA}/logo.png`,
    String(fetched.at(-1)),
  )
  check(
    'logo: the stored PDF carries an image and its soft mask',
    pdf1.includes('/Subtype /Image') && pdf1.includes('/SMask'),
  )
  check(
    'logo: the answer did not say it left a logo off',
    !out1.body.includes('left it off'),
    out1.body.slice(0, 200),
  )
  const [m1] = await madeIds()
  const prov1 = await call(
    `app.document_provenance_of(${lit(OFFICE)}::uuid, ${lit(String(m1))}::uuid)`,
  )
  check(
    'snapshot: provenance says a style snapshot is held',
    prov1?.has_style_snapshot === true && prov1?.has_provenance === true,
    JSON.stringify(prov1).slice(0, 200),
  )
  const snap = (
    await q(
      `select style_snapshot s from public.document_provenance where document_id = ${lit(String(m1))}::uuid`,
    )
  )[0]?.s as Record<string, unknown> & {
    palette?: { primary?: string }
    logo_document_id?: string
    tone?: string
    formatting?: { title_page?: string; density?: unknown }
    typography?: unknown
    source?: { kind?: string; document_id?: string }
  }
  check(
    'snapshot: it is the style the report looked like (palette, logo, tone, and the design laid over formatting)',
    snap?.palette?.primary === '#117755' &&
      snap?.logo_document_id === logoDoc &&
      snap?.tone === 'Warm' &&
      snap?.formatting?.title_page === 'band' &&
      typeof snap?.formatting?.density === 'string' &&
      !('source' in snap),
    JSON.stringify(snap),
  )
  const pubProv = await call(
    `public.hq_document_provenance(${lit(OFFICE)}::uuid, ${lit(String(m1))}::uuid)`,
  )
  check(
    'read: the public wrapper reports the snapshot, and says has_provenance=false for a document with none',
    pubProv?.has_style_snapshot === true &&
      (await call(`public.hq_document_provenance(${lit(OFFICE)}::uuid, ${lit(logoDoc)}::uuid)`))
        ?.has_provenance === false,
  )

  // an unsupported logo is not drawn and the report says so
  logoBytes = fixture('logo-16.png')
  const out2 = await handler.handle(await asJob(), db)
  const pdf2 = Buffer.from(stored.at(-1) as Uint8Array).toString('latin1')
  check('logo refused: a 16-bit PNG renders WITHOUT the image', !pdf2.includes('/Subtype /Image'))
  check(
    'logo refused: and the answer says so, with the reason',
    out2.body.includes('left it off') && out2.body.includes('16-bit'),
    out2.body.slice(0, 260),
  )
  logoBytes = null
  const out3 = await handler.handle(await asJob(), db)
  check(
    'logo unreachable: renders without it and says storage could not give it',
    out3.attachFile !== undefined && out3.body.includes('could not be fetched'),
    out3.body.slice(0, 260),
  )

  // =============================================================== 2. adopting the style
  const mids = await madeIds()
  const m = String(mids[0])
  const pro = async (): Promise<Row> =>
    ((
      await q(
        `select profile p from public.style_profiles where scope = 'project' and project_id = ${lit(PA)}::uuid`,
      )
    )[0]?.p ?? {}) as Row
  await set({ palette: { primary: '#aa3322' }, tone: 'Stern', typography: { heading: 'Times' } })
  const beforeProfile = JSON.stringify(await pro())
  const ask = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(m)}::uuid)`,
  )
  check(
    'adopt: with a style already in place it ASKS and names what it would replace',
    ask?.needs_confirmation === true &&
      ask?.ok === false &&
      JSON.stringify(ask.replaces).includes('palette'),
    JSON.stringify(ask),
  )
  check('adopt: asking changed nothing', JSON.stringify(await pro()) === beforeProfile)
  const events0 = Number(
    (await q(`select count(*)::int n from public.events where action_type = 'style.updated'`))[0]
      ?.n,
  )
  const done = await call(
    `public.hq_style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(m)}::uuid, true, 'grant')`,
  )
  check(
    'adopt: confirmed, it adopts and says it replaced a style',
    done?.ok === true && done?.adopted === true && done?.replaced_existing === true,
    JSON.stringify(done).slice(0, 200),
  )
  const after = (await pro()) as Record<string, unknown> & {
    palette?: { primary?: string }
    logo_document_id?: string
    tone?: string
    formatting?: { title_page?: string; density?: unknown }
    typography?: unknown
    source?: { kind?: string; document_id?: string }
  }
  check(
    "adopt: the project profile is now the report's style (colour, logo, tone, band) and the typography it did not have is gone",
    after.palette?.primary === '#117755' &&
      after.logo_document_id === logoDoc &&
      after.tone === 'Warm' &&
      after.formatting?.title_page === 'band' &&
      after.typography === undefined,
    JSON.stringify(after),
  )
  check(
    'adopt: it records where it came from (saved_from_document + the report)',
    after.source?.kind === 'saved_from_document' && after.source?.document_id === m,
  )
  const events1 = Number(
    (await q(`select count(*)::int n from public.events where action_type = 'style.updated'`))[0]
      ?.n,
  )
  check('adopt: the move is in the ledger', events1 === events0 + 1)
  const next = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(m)}::uuid)`,
  )
  check(
    'adopt: again, it is "unchanged" and asks nothing',
    next?.ok === true && next?.unchanged === true,
  )
  const resolved = await call(`app.hq_style_get(${lit(OFFICE)}::uuid, ${lit(SLUG)})`)
  check(
    'adopt: the resolved style the NEXT report will use has the adopted palette',
    resolved?.profile?.palette?.primary === '#117755',
  )

  // no style yet: no confirmation needed
  await call(`app.hq_style_clear(${lit(OFFICE)}::uuid, ${lit(SLUG)}, null, 'teamhq', 'grant')`)
  check(
    'setup: the project style was cleared',
    (await q(`select 1 from public.style_profiles where project_id = ${lit(PA)}::uuid`)).length ===
      0,
  )
  const fresh = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(m)}::uuid)`,
  )
  check(
    'adopt: with no style of its own, the project simply takes it',
    fresh?.ok === true && fresh?.adopted === true && fresh?.replaced_existing === false,
  )

  // =============================================================== 3. what it refuses, and why
  const sink = async (title: string, snapshot: string | null, project = PA): Promise<string> => {
    const id = String(
      (
        await call(`app.record_file_document(p_office => ${lit(OFFICE)}::uuid, p_project_id => ${lit(project)}::uuid, p_title => ${lit(title)},
      p_storage_path => ${lit(`${project}/${title}.pdf`)}, p_mime_type => 'application/pdf', p_byte_size => 5000::bigint, p_parent_ref => null,
      p_external_ref => ${lit(`made:${title}:${run}`)}, p_duration_s => null, p_added_by => 'chief-of-staff', p_job_id => null, p_origin => 'made')`)
      )?.document_id,
    )
    const rec = await call(
      `app.document_provenance_record(${lit(OFFICE)}::uuid, ${lit(id)}::uuid, null, 'default', null, '{}'::jsonb, '[]'::jsonb${snapshot === null ? '' : `, ${lit(snapshot)}::jsonb`})`,
    )
    check(`setup: provenance recorded for ${title}`, rec?.ok === true, JSON.stringify(rec))
    return id
  }
  const old = await sink(`old-${run}`, null)
  await call(`app.hq_style_clear(${lit(OFFICE)}::uuid, ${lit(SLUG)}, null, 'teamhq', 'grant')`)
  await set({ tone: 'Keep me' })
  const kept = JSON.stringify(await pro())
  const nosnap = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(old)}::uuid, true)`,
  )
  check(
    'no snapshot (made before 0970): it says so and changes nothing, even confirmed',
    typeof nosnap?.error === 'string' &&
      nosnap?.no_snapshot === true &&
      /before its style was recorded/.test(nosnap.error) &&
      JSON.stringify(await pro()) === kept,
    JSON.stringify(nosnap),
  )
  const none = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, gen_random_uuid(), true)`,
  )
  check(
    'unknown report: refused by name',
    /no report with that id/.test(String(none?.error)),
    JSON.stringify(none),
  )
  const notMade = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(logoDoc)}::uuid, true)`,
  )
  check(
    'a document the office did not make has no style to save',
    /only a report the office made/.test(String(notMade?.error)),
    JSON.stringify(notMade),
  )
  const foreign = await sink(
    `foreign-${run}`,
    JSON.stringify({ palette: { primary: '#334455' } }),
    PB,
  )
  const wrong = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(foreign)}::uuid, true)`,
  )
  check(
    "another project's report is refused",
    /different project/.test(String(wrong?.error)) && JSON.stringify(await pro()) === kept,
    JSON.stringify(wrong),
  )
  const noProj = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, 'no-such-project-${run}', ${lit(m)}::uuid, true)`,
  )
  check('an unknown project is refused by name', /no active project/.test(String(noProj?.error)))
  const stray = await sink(
    `stray-${run}`,
    JSON.stringify({ palette: { primary: '#334455' }, logo_document_id: otherLogo }),
  )
  const dropped = await call(
    `app.style_adopt_from_document(${lit(OFFICE)}::uuid, ${lit(SLUG)}, ${lit(stray)}::uuid, true)`,
  )
  const afterStray = (await pro()) as Record<string, unknown> & {
    palette?: { primary?: string }
    logo_document_id?: string
    tone?: string
    formatting?: { title_page?: string; density?: unknown }
    typography?: unknown
    source?: { kind?: string; document_id?: string }
  }
  check(
    'a logo this project does not hold is DROPPED and reported, never stored',
    dropped?.ok === true &&
      JSON.stringify(dropped.dropped).includes('logo_document_id') &&
      afterStray.logo_document_id === undefined &&
      afterStray.palette?.primary === '#334455',
    JSON.stringify(dropped).slice(0, 200),
  )
  const invalid = await sink(`invalid-${run}`, JSON.stringify({ palette: { primary: 'red' } }))
  const row = (
    await q(
      `select style_snapshot s from public.document_provenance where document_id = ${lit(invalid)}::uuid`,
    )
  )[0]
  check(
    'an invalid snapshot is not stored, and the provenance row survives',
    row !== undefined && row.s === null,
  )
  check(
    'the old seven-argument call (a worker without 0970) still records provenance',
    (await call(`app.document_provenance_of(${lit(OFFICE)}::uuid, ${lit(old)}::uuid)`))
      ?.has_provenance === true,
  )

  // no outward effect: adopting raised nothing
  const side = (
    await q(
      `select (select count(*) from public.deliveries) d, (select count(*) from public.blockers) b`,
    )
  )[0] as Row
  check('adopting raised no delivery or blocker', Number(side.d) === 0 && Number(side.b) === 0)
} finally {
  await q('rollback')
  const left = Number(
    (await q(`select count(*)::int n from public.projects where slug like 'adoptproof-%'`))[0]?.n,
  )
  check('teardown left nothing behind', left === 0, String(left))
  await db.end()
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${String(failed)} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
