/**
 * HQ-DOC-026: connected Drive documents are read and indexed in the BACKGROUND, without being imported (migration 1020),
 * on a LOCAL replica inside one transaction that is rolled back.
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/isolated/drive-index.ts [replica-db]
 *
 * Drives the REAL drive.index handler (real driveAccess, real preview provider, real fileText, real document_preview_*
 * functions) against Postgres with a FAKE Drive that behaves like Drive: modified times, md5 checksums, Google formats
 * exported rather than downloaded, rate limits, 5xx, files in the bin. There is no network and no Google.
 *
 * Proves: derived text is indexed and searchable; NOTHING is copied (no storage call, no storage path, no import
 * request, no copy) and nothing is written to Drive (every call is a GET); an indexed document is still NOT importable
 * from what was derived (Import still fetches); an unchanged document costs one metadata call and no content fetch; a
 * changed one is read again; the run is bounded and oldest-first; a failure is recorded with its reason and backs off,
 * doubling; a rate limit stops the run; a disconnected or revoked source is not read at all and reading resumes on
 * reconnect; another office's documents are never touched; and held duties (the staging posture) fire only what is allowed.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { driveIndexHandler } from '../../src/handlers/drive-index.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'integ_full')
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
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
const OFFICE = String((await q('select app.test_office()::text o'))[0]?.o)
const run = Math.random().toString(36).slice(2, 8)

// ---- the fake Drive --------------------------------------------------------------------------------------------------
interface F {
  mime: string
  name: string
  body: string
  modified: string
  md5?: string
  trashed?: boolean
  fail?: number | undefined // an http status to answer with instead
}
const drive: Record<string, F> = {}
const calls: { method: string; url: string }[] = []
const fakeFetch = (async (url: string | URL, init?: { method?: string }) => {
  const u = String(url)
  const method = init?.method ?? 'GET'
  calls.push({ method, url: u })
  if (u === 'https://oauth2.googleapis.com/token')
    return new Response(
      JSON.stringify({
        access_token: 'tok-not-real',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
      }),
      { status: 200 },
    )
  const m = u.match(/googleapis\.com\/drive\/v3\/files\/([^/?]+)(\/export)?\?(.*)$/)
  if (m === null) throw new Error(`REFUSED: this proof makes no call to ${u}`)
  const f = drive[decodeURIComponent(m[1] ?? '')]
  if (f === undefined)
    return new Response('{"error":{"message":"File not found"}}', { status: 404 })
  if (f.fail !== undefined)
    return new Response(
      f.fail === 429
        ? '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}'
        : '{"error":{"message":"backend error"}}',
      { status: f.fail },
    )
  if (m[3]?.includes('fields='))
    return new Response(
      JSON.stringify({
        id: m[1],
        name: f.name,
        mimeType: f.mime,
        modifiedTime: f.modified,
        ...(f.md5 === undefined ? {} : { md5Checksum: f.md5 }),
        size: String(f.body.length),
        webViewLink: `https://drive.google.com/file/d/${m[1]}/view`,
        trashed: f.trashed === true,
      }),
      { status: 200 },
    )
  return new Response(f.body, {
    status: 200,
    headers: { 'content-type': 'text/plain', 'content-length': String(f.body.length) },
  })
}) as typeof fetch
const contentCalls = () => calls.filter((c) => /export\?|alt=media/.test(c.url)).length
const metaCalls = () => calls.filter((c) => /fields=/.test(c.url)).length

// Only the stored Google credential is stubbed (the replica has no vault secret); every other query goes to Postgres.
const withCredential: SqlExecutor = {
  execute: async (sql: string) => {
    if (sql.includes("'google.client_id'") && sql.includes('google.refresh_token'))
      return { rows: [{ client_id: 'cid', client_secret: 'csec', refresh_token: 'rtok' }] } as never
    return db.execute(sql)
  },
} as SqlExecutor
const tick = Date.now()
const handler = driveIndexHandler({ db: withCredential, fetchImpl: fakeFetch, now: () => tick })

await q('begin')
try {
  const mkOffice = async (name: string): Promise<string> => {
    const auth = String((await q('select gen_random_uuid()::text a'))[0]?.a)
    await q(
      `insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${name}.${run}@example.invalid`)})`,
    )
    await q(
      `insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(`${name} ${run}`)})`,
    )
    return String(
      (await q(`select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`))[0]
        ?.o,
    )
  }
  const project = async (office: string, slug: string): Promise<string> =>
    String(
      (
        await q(
          `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'active', ${lit(office)}::uuid) returning project_id::text id`,
        )
      )[0]?.id,
    )
  const attach = (pid: string, folder: string) =>
    q(
      `insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled) values (${lit(pid)}::uuid, 'drive', ${lit(folder)}, 'Folder', 'source', true)`,
    )
  const SLUG = `indexproof-${run}`
  const FOLDER = `folder-${run}`
  const PA = await project(OFFICE, SLUG)
  await attach(PA, FOLDER)
  await q(
    `insert into public.integration_connections (office_id, provider, account_ref, secret_name) values (${lit(OFFICE)}::uuid, 'google', 'primary', 'google.refresh_token') on conflict do nothing`,
  )
  const ref = async (
    office: string,
    pid: string,
    folder: string,
    file: string,
    title: string,
  ): Promise<string> =>
    String(
      (
        await q(`insert into public.documents (office_id, project_id, title, doc_type, origin, connector, external_parent_ref, external_ref, state, added_by)
      values (${lit(office)}::uuid, ${lit(pid)}::uuid, ${lit(title)}, 'file', 'source', 'drive', ${lit(folder)}, ${lit(file)}, 'approved', 'chief-of-staff') returning document_id::text id`)
      )[0]?.id,
    )
  const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9, 0, 0)).toISOString()
  const mk = (id: string, f: F) => {
    drive[`${id}-${run}`] = f
    return `${id}-${run}`
  }
  const gdoc = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('gdoc', {
      mime: 'application/vnd.google-apps.document',
      name: 'Pricing plan',
      body: 'The pricing plan says onboarding takes two weeks and support is email only.',
      modified: day(1),
    }),
    'Pricing plan',
  )
  const sheet = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('sheet', {
      mime: 'application/vnd.google-apps.spreadsheet',
      name: 'Budget',
      body: 'item,cost\nvenue,4000\ncatering,1200\n',
      modified: day(1),
    }),
    'Budget',
  )
  const txt = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('txt', {
      mime: 'text/plain',
      name: 'Notes.txt',
      body: 'Kevin will call the roofer about the deposit on Thursday.',
      modified: day(1),
      md5: 'aaa111',
    }),
    'Notes.txt',
  )
  const img = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('img', {
      mime: 'image/png',
      name: 'Site.png',
      body: 'PNGDATA',
      modified: day(1),
      md5: 'bbb222',
    }),
    'Site.png',
  )
  const zip = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('zip', {
      mime: 'application/zip',
      name: 'Archive.zip',
      body: 'ZIPDATA',
      modified: day(1),
      md5: 'ccc333',
    }),
    'Archive.zip',
  )
  const bin = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('bin', {
      mime: 'text/plain',
      name: 'Binned.txt',
      body: 'in the bin',
      modified: day(1),
      md5: 'ddd444',
      trashed: true,
    }),
    'Binned.txt',
  )

  const runIndex = async (limit?: number, office = OFFICE, pid = PA): Promise<string> => {
    const j = String(
      (
        await q(`insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, announce, pinned_config)
      values (${lit(office)}::uuid, gen_random_uuid(), ${lit(pid)}::uuid, ${lit(`idx-${Math.random().toString(36).slice(2)}`)}, 'drive.index', 'duty:drive-index', false, ${lit(JSON.stringify(limit === undefined ? {} : { limit }))}::jsonb) returning job_id::text id`)
      )[0]?.id,
    )
    const out = (await handler.handle(
      { jobId: j, projectId: pid, kind: 'drive.index' } as never,
      {} as never,
    )) as { body: string; announce: boolean }
    if (out.announce !== false) check('the run never announces', false, out.body)
    return out.body
  }
  const state = async (id: string) =>
    (await q(`select * from public.document_index_state where document_id = ${lit(id)}::uuid`))[0]
  const content = async (id: string) =>
    String(
      (
        await q(
          `select coalesce(content,'') c from public.documents where document_id = ${lit(id)}::uuid`,
        )
      )[0]?.c,
    )
  const age = (id: string, hours: number) =>
    q(
      `update public.document_index_state set last_checked_at = now() - interval '${String(hours)} hours' where document_id = ${lit(id)}::uuid`,
    )

  // 1. WHO IS DUE -------------------------------------------------------------------------------------------------------
  const cands = await call(`app.document_index_candidates(${lit(OFFICE)}::uuid, 25)`)
  check(
    'every connected Drive document of the office is due, none other',
    (cands as unknown[]).length === 6,
    String((cands as unknown[]).length),
  )

  // 2. THE FIRST RUN: indexes, copies nothing ------------------------------------------------------------------------------
  const said1 = await runIndex()
  check(
    'the run says what it did, in numbers, and that nothing was imported or copied',
    /Read and indexed: 3/.test(said1) && /Nothing was imported and nothing was copied/.test(said1),
    said1,
  )
  check(
    "a Google Doc is indexed: its text is the document's searchable content",
    (await content(gdoc)).startsWith('The pricing plan says onboarding'),
  )
  check(
    "a Sheet is indexed as its first sheet's rows",
    (await content(sheet)).includes('venue,4000'),
  )
  check('a text file is indexed', (await content(txt)).includes('roofer'))
  check(
    'the derived text is findable by the existing search column',
    Number(
      (
        await q(
          `select count(*)::int n from public.documents where office_id = ${lit(OFFICE)}::uuid and search @@ plainto_tsquery('english','onboarding')`,
        )
      )[0]?.n,
    ) === 1,
  )
  check(
    'an image is noted by version only: no text, no copy',
    (await content(img)) === '' && (await state(img))?.last_checked_at !== null,
  )
  check(
    'an unsupported file and a binned file are skipped, not failed',
    (await content(zip)) === '' &&
      (await content(bin)) === '' &&
      (await state(zip))?.failures === 0 &&
      /Skipped: 2/.test(said1),
    said1,
  )
  check(
    'every call to Google was a read (GET) of the Drive API or the token endpoint',
    calls.every((c) => c.method === 'GET' || c.url === 'https://oauth2.googleapis.com/token'),
    calls
      .filter((c) => c.method !== 'GET')
      .map((c) => c.method + c.url)
      .join(','),
  )
  check(
    'and none of them went anywhere but Google (no storage, nothing else)',
    calls.every((c) => /googleapis\.com/.test(c.url)),
  )

  // 3. INDEX IS NOT IMPORT -----------------------------------------------------------------------------------------------
  const none = await q(`select
      (select count(*)::int from public.documents where office_id = ${lit(OFFICE)}::uuid and imported_from_document_id is not null) copies,
      (select count(*)::int from public.documents where office_id = ${lit(OFFICE)}::uuid and storage_path is not null) files,
      (select count(*)::int from public.document_import_requests where office_id = ${lit(OFFICE)}::uuid) requests,
      (select count(*)::int from public.documents where document_id = ${lit(gdoc)}::uuid and origin = 'source') still_source`)
  check(
    'no copy, no stored file, no import request exists; the original is still an external source',
    Number(none[0]?.copies) === 0 &&
      Number(none[0]?.files) === 0 &&
      Number(none[0]?.requests) === 0 &&
      Number(none[0]?.still_source) === 1,
    JSON.stringify(none[0]),
  )
  const pressed = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(gdoc)}::uuid)`)
  check(
    'an indexed document is NOT importable from its derived text: Import still has to fetch it',
    pressed.ok === true && pressed.state === 'pending',
    JSON.stringify(pressed),
  )
  await q(`delete from public.document_import_requests where document_id = ${lit(gdoc)}::uuid`)
  await q(
    `update public.jobs set state = 'cancelled' where idempotency_key = ${lit(`import-fetch:${gdoc}`)} and state not in ('complete','failed','cancelled')`,
  ).catch(() => undefined)

  // 4. UNCHANGED: one metadata call, no content fetch ----------------------------------------------------------------------
  for (const id of [gdoc, sheet, txt, img, zip, bin]) await age(id, 7)
  const before = { c: contentCalls(), m: metaCalls() }
  const said2 = await runIndex()
  check(
    'an unchanged document costs one metadata call and no content fetch',
    contentCalls() === before.c && metaCalls() - before.m === 6 && /Unchanged: \d/.test(said2),
    `${String(contentCalls() - before.c)} content, ${String(metaCalls() - before.m)} meta; ${said2}`,
  )
  const rerun = await runIndex()
  check(
    'inside the six-hour window nothing is asked of Drive at all',
    /No connected Drive document is due/.test(rerun),
  )

  // 5. CHANGED: read again --------------------------------------------------------------------------------------------------
  for (const id of [gdoc, sheet, txt, img, zip, bin]) await age(id, 7)
  const gk = `gdoc-${run}`
  drive[gk] = {
    ...(drive[gk] as F),
    body: 'The pricing plan now says onboarding takes ten days.',
    modified: day(3),
  }
  const c0 = contentCalls()
  await runIndex()
  check(
    'a changed document is read again (exactly one content fetch) and its text is replaced',
    contentCalls() - c0 === 1 &&
      (await content(gdoc)).includes('ten days') &&
      !(await content(gdoc)).includes('two weeks'),
  )

  // 6. BOUNDED AND OLDEST-FIRST ---------------------------------------------------------------------------------------------
  const many: string[] = []
  for (let i = 0; i < 5; i++)
    many.push(
      await ref(
        OFFICE,
        PA,
        FOLDER,
        mk(`m${String(i)}`, {
          mime: 'text/plain',
          name: `M${String(i)}.txt`,
          body: `many ${String(i)}`,
          modified: day(1),
          md5: `m${String(i)}`,
        }),
        `M${String(i)}.txt`,
      ),
    )
  const said6 = await runIndex(2)
  check(
    'a run reads at most the number it is given',
    /2 connected Drive document\(s\) were due/.test(said6),
    said6,
  )
  const nextTwo = await call(`app.document_index_candidates(${lit(OFFICE)}::uuid, 2)`)
  check(
    'the never-checked documents come first, and the ones just read are not due again',
    (nextTwo as { document_id: string }[]).every((c) => many.includes(c.document_id)),
  )
  await runIndex(25)

  // 7. FAILURES: recorded, backed off, doubling; a pushback stops the run ---------------------------------------------------
  const bad = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('bad', {
      mime: 'text/plain',
      name: 'Flaky.txt',
      body: 'x',
      modified: day(1),
      md5: 'zzz',
      fail: 404,
    }),
    'Flaky.txt',
  )
  await runIndex()
  const s1 = await state(bad)
  check(
    'a failure is recorded with its reason and a back-off',
    Number(s1?.failures) === 1 &&
      /not_found/.test(String(s1?.last_error)) &&
      s1?.next_attempt_at !== null,
    JSON.stringify(s1),
  )
  check(
    '...and the document is not tried again while it backs off',
    (
      (await call(`app.document_index_candidates(${lit(OFFICE)}::uuid, 25)`)) as {
        document_id: string
      }[]
    ).every((c) => c.document_id !== bad),
  )
  await q(
    `update public.document_index_state set next_attempt_at = now() - interval '1 minute', last_checked_at = now() - interval '7 hours' where document_id = ${lit(bad)}::uuid`,
  )
  await runIndex()
  const s2 = await state(bad)
  const gap = (
    await q(
      `select extract(epoch from (next_attempt_at - last_checked_at))::int g from public.document_index_state where document_id = ${lit(bad)}::uuid`,
    )
  )[0]?.g
  check(
    'a second failure doubles the wait (15 min, then 30)',
    Number(s2?.failures) === 2 && Number(gap) >= 29 * 60 && Number(gap) <= 31 * 60,
    String(gap),
  )
  const limited = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('lim', {
      mime: 'text/plain',
      name: 'Limited.txt',
      body: 'y',
      modified: day(1),
      md5: 'lll',
      fail: 429,
    }),
    'Limited.txt',
  )
  const tail = await ref(
    OFFICE,
    PA,
    FOLDER,
    mk('tail', {
      mime: 'text/plain',
      name: 'Tail.txt',
      body: 'tail words',
      modified: day(1),
      md5: 'ttt',
    }),
    'Tail.txt',
  )
  await q(
    `insert into public.document_index_state (office_id, document_id, last_checked_at) values (${lit(OFFICE)}::uuid, ${lit(tail)}::uuid, now() - interval '3 days') on conflict do nothing`,
  )
  const saidLim = await runIndex()
  check(
    'a rate limit stops the run and says so; documents behind it wait for the next hour',
    /Stopped early: Drive said rate_limited/.test(saidLim) && (await content(tail)) === '',
    saidLim,
  )
  check(
    '...and the limited document is recorded as failed with the reason',
    /rate_limited/.test(String((await state(limited))?.last_error)),
  )
  drive[`lim-${run}`] = { ...(drive[`lim-${run}`] as F), fail: undefined }
  drive[`bad-${run}`] = { ...(drive[`bad-${run}`] as F), fail: undefined }
  await q(
    `update public.document_index_state set next_attempt_at = null, last_checked_at = now() - interval '7 hours' where document_id in (${lit(bad)}::uuid, ${lit(limited)}::uuid)`,
  )
  await runIndex()
  check(
    'once Drive recovers the failures clear',
    Number((await state(bad))?.failures) === 0 &&
      (await state(bad))?.last_error === null &&
      (await content(limited)) === 'y',
  )

  // 8. DISCONNECTED OR REVOKED: not read; reconnect resumes ----------------------------------------------------------------
  for (const id of [gdoc, sheet, txt]) await age(id, 7)
  drive[gk] = {
    ...(drive[gk] as F),
    body: 'A third version written while the source is switched off.',
    modified: day(5),
  }
  await q(
    `update public.project_attachments set enabled = false, disabled_reason = 'proof: switched off' where project_id = ${lit(PA)}::uuid`,
  )
  const off0 = calls.length
  const saidOff = await runIndex()
  check(
    'a switched-off source is not fetched from at all',
    calls.length === off0 && /No connected Drive document is due/.test(saidOff),
    saidOff,
  )
  check(
    '...and what was already derived is kept, not deleted',
    (await content(gdoc)).includes('ten days'),
  )
  await q(
    `update public.project_attachments set enabled = true, disabled_reason = null where project_id = ${lit(PA)}::uuid`,
  )
  await q(
    `update public.integration_connections set state = 'revoked', revoked_at = now() where office_id = ${lit(OFFICE)}::uuid and provider = 'google'`,
  )
  const rev0 = calls.length
  const saidRev = await runIndex()
  check(
    'a revoked Google connection is not fetched from at all either',
    calls.length === rev0 && /No connected Drive document is due/.test(saidRev),
    saidRev,
  )
  await q(
    `update public.integration_connections set state = 'active', revoked_at = null where office_id = ${lit(OFFICE)}::uuid and provider = 'google'`,
  )
  await runIndex()
  check(
    'reconnecting resumes reading, and picks up what changed meanwhile',
    (await content(gdoc)).includes('third version'),
  )

  // 9. TENANT ----------------------------------------------------------------------------------------------------------------
  const OTHER = await mkOffice('other')
  const PO = await project(OTHER, `indexother-${run}`)
  await attach(PO, `ofolder-${run}`)
  await q(
    `insert into public.integration_connections (office_id, provider, account_ref, secret_name) values (${lit(OTHER)}::uuid, 'google', 'primary', 'google.refresh_token') on conflict do nothing`,
  )
  const theirs = await ref(
    OTHER,
    PO,
    `ofolder-${run}`,
    mk('theirs', {
      mime: 'text/plain',
      name: 'Theirs.txt',
      body: 'the other office private words',
      modified: day(1),
      md5: 'ooo',
    }),
    'Theirs.txt',
  )
  const mine = (await call(`app.document_index_candidates(${lit(OFFICE)}::uuid, 25)`)) as {
    document_id: string
  }[]
  check(
    "another office's document is never in this office's list",
    mine.every((c) => c.document_id !== theirs),
  )
  for (const id of [gdoc, sheet, txt]) await age(id, 7)
  await runIndex()
  check(
    '...and a run for this office never reads or touches it',
    (await content(theirs)) === '' && (await state(theirs)) === undefined,
  )
  await runIndex(25, OTHER, PO)
  check(
    "the other office's own run reads its own document only",
    (await content(theirs)).includes('private words') &&
      (await content(gdoc)).includes('third version'),
  )

  // 10. HELD DUTIES (the staging posture) -----------------------------------------------------------------------------------
  const duty = async (slug: string): Promise<number> =>
    Number(
      (
        await q(
          `select count(*)::int n from app.due_responsibilities() d where d.slug = ${lit(slug)}`,
        )
      )[0]?.n,
    )
  await q(`insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, office_id)
           select 'drive-index', s.staff_id, 'Read connected Drive documents lazily and keep their text.', 'drive.index', 60, ${lit(OFFICE)}::uuid
             from public.staff s where s.slug = 'chief-of-staff' on conflict (office_id, slug) do nothing`)
  const shipped = (
    await q(
      `select bool_and(enabled) e, count(*)::int n from public.responsibilities where slug = 'drive-index' and office_id <> ${lit(OFFICE)}::uuid`,
    )
  )[0]
  check(
    'the duty ships SWITCHED OFF in every office that has one (no handler-less job fires between migrate and deploy)',
    Number(shipped?.n) === 0 || shipped?.e === false,
    JSON.stringify(shipped),
  )
  await q(
    `update public.responsibilities set enabled = true where slug = 'drive-index' and office_id = ${lit(OFFICE)}::uuid`,
  )
  const baseline = await duty('drive-index')
  check(
    'CONTROL: with nothing set a due duty is due (production behaviour is unchanged)',
    baseline >= 1,
    String(baseline),
  )
  const setCfg = (k: string, v: string) =>
    q(
      `insert into public.system_config (key, value, description, updated_by) values (${lit(k)}, ${lit(v)}::jsonb, 'proof', 'proof') on conflict (key) do update set value = excluded.value`,
    )
  await setCfg('duties.paused', 'true')
  check(
    'paused: no duty is due',
    (await duty('drive-index')) === 0 && (await duty('drive-watch')) === 0,
  )
  await setCfg('duties.allow', '["drive-index"]')
  check(
    'paused with an allow-list: only the listed duty is due',
    (await duty('drive-index')) >= 1 && (await duty('drive-watch')) === 0,
  )
  await q(`delete from public.system_config where key in ('duties.paused','duties.allow')`)
  check('and removing the keys restores everything', (await duty('drive-index')) >= 1)
  check(
    'the handler registers no write: it imports no storage, no drive write, no approval function',
    !/putFile|storage|document_import|hq_document_import/.test(
      await Bun_readFile('src/handlers/drive-index.ts'),
    ),
  )
} finally {
  await q('rollback')
  const left = await q(
    `select count(*)::int n from public.projects where slug like 'index%proof%' or slug like 'indexother-%'`,
  )
  check('teardown left nothing behind', Number(left[0]?.n) === 0)
  await db.end()
}
async function Bun_readFile(p: string): Promise<string> {
  const { readFileSync } = await import('node:fs')
  return readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${String(failed)} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
