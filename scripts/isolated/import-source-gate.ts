/**
 * A NEW import of an external document is refused by the SERVER when its source is disconnected (migration 1010), on a
 * LOCAL replica inside one transaction that is rolled back.
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/isolated/import-source-gate.ts [replica-db]
 *
 * Proves: a connected source imports; a switched-off attachment is refused (held material or not); a revoked or never
 * connected Google account is refused when a fetch would be needed, and NOT when Team HQ already holds the material;
 * the refusal is typed (error_code SOURCE_DISCONNECTED) and creates no request and no job; the public wrapper a stale
 * client or a direct RPC would call gives the same answer; a fetch job queued before the disconnect is refused by the
 * real drive.read_file handler before any Drive request; the enqueue function and fulfil cannot be used to get round
 * it; an already-imported copy stays whole and answerable after disconnection and so does the source's history;
 * reconnecting restores the ability to import; and another office's connected account, or another office's document,
 * cannot stand in for this one's. Drive is a fetch spy that fails the proof if it is ever called.
 */
import { driveReadHandler } from '../../src/handlers/drive-read.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_pol')
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

const driveCalls: string[] = []
const spy = (async (url: string | URL) => {
  driveCalls.push(String(url))
  throw new Error(`REFUSED: the gate proof makes no call to ${String(url)}`)
}) as typeof fetch
const handler = driveReadHandler({
  db,
  projectRef: 'proof',
  serviceKey: 'proof-key',
  fetchImpl: spy,
})

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
  const FOLDER = `folder-${run}`
  const SLUG = `gateproof-${run}`
  const PA = await project(OFFICE, SLUG)
  await q(
    `insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled) values (${lit(PA)}::uuid, 'drive', ${lit(FOLDER)}, 'Gate folder', 'source', true)`,
  )
  const connect = (office: string) =>
    q(
      `insert into public.integration_connections (office_id, provider, account_ref, secret_name) values (${lit(office)}::uuid, 'google', 'primary', 'google.refresh_token') on conflict do nothing`,
    )
  const revoke = (office: string) =>
    q(
      `update public.integration_connections set state = 'revoked', revoked_at = now() where office_id = ${lit(office)}::uuid and provider = 'google'`,
    )
  const setAttachment = (on: boolean) =>
    q(
      `update public.project_attachments set enabled = ${on ? 'true' : 'false'}, disabled_reason = ${on ? 'null' : "'proof: switched off'"} where project_id = ${lit(PA)}::uuid`,
    )
  const ref = async (file: string, title: string, content: string | null = null): Promise<string> =>
    String(
      (
        await q(`insert into public.documents
          (office_id, project_id, title, doc_type, origin, connector, external_parent_ref, external_ref, state, added_by${content === null ? '' : ', content, content_fingerprint, fetched_at'})
          values (${lit(OFFICE)}::uuid, ${lit(PA)}::uuid, ${lit(title)}, 'file', 'source', 'drive', ${lit(FOLDER)}, ${lit(file)}, 'approved', 'chief-of-staff'${content === null ? '' : `, ${lit(content)}, encode(sha256(convert_to(${lit(content)}, 'UTF8')), 'hex'), now()`})
          returning document_id::text id`)
      )[0]?.id,
    )
  const press = async (id: string, office = OFFICE) =>
    await call(`app.hq_document_import(${lit(office)}::uuid, ${lit(id)}::uuid)`)
  const requests = async (id: string): Promise<number> =>
    Number(
      (
        await q(
          `select count(*)::int n from public.document_import_requests where document_id = ${lit(id)}::uuid`,
        )
      )[0]?.n,
    )
  const jobs = async (id: string): Promise<number> =>
    Number(
      (
        await q(
          `select count(*)::int n from public.jobs where idempotency_key = ${lit(`import-fetch:${id}`)}`,
        )
      )[0]?.n,
    )
  const typed = (
    r: { ok?: boolean; error_code?: string; reason?: string; error?: string },
    reason: string,
  ): boolean =>
    r.ok === false &&
    r.error_code === 'SOURCE_DISCONNECTED' &&
    r.reason === reason &&
    /\S/.test(String(r.error))

  // 1. CONNECTED: permitted ----------------------------------------------------------------------------------------
  await connect(OFFICE)
  const d1 = await ref(`f1-${run}`, 'Connected source file')
  const r1 = await press(d1)
  check(
    'connected source: a fetch import is permitted (pending, one request, one job)',
    r1.ok === true &&
      r1.state === 'pending' &&
      (await requests(d1)) === 1 &&
      (await jobs(d1)) === 1,
    JSON.stringify(r1),
  )
  const held = await ref(
    `f1h-${run}`,
    'Connected source text',
    'Words Team HQ already holds from a real read.',
  )
  await q(`select app.document_preview_mark_read(${lit(OFFICE)}::uuid, ${lit(held)}::uuid)`)
  const r1h = await press(held)
  check(
    'connected source with held material: imports at once',
    r1h.ok === true && r1h.state === 'imported',
    JSON.stringify(r1h),
  )

  // 2. ATTACHMENT SWITCHED OFF: refused, typed, nothing created ------------------------------------------------------
  const d2 = await ref(`f2-${run}`, 'Needs a fetch')
  const d2h = await ref(
    `f2h-${run}`,
    'Text already held',
    'Held text of a source that is then switched off.',
  )
  await q(`select app.document_preview_mark_read(${lit(OFFICE)}::uuid, ${lit(d2h)}::uuid)`)
  await setAttachment(false)
  const r2 = await press(d2)
  check(
    'switched-off attachment: a new import is refused with SOURCE_DISCONNECTED (attachment_disabled)',
    typed(r2, 'attachment_disabled'),
    JSON.stringify(r2),
  )
  check(
    '...and it created no request and no job',
    (await requests(d2)) === 0 && (await jobs(d2)) === 0,
  )
  const r2h = await press(d2h)
  check(
    '...also when the text is already held: the document has left active retrieval, so it is not imported from',
    typed(r2h, 'attachment_disabled') && (await requests(d2h)) === 0,
    JSON.stringify(r2h),
  )

  // 3. DIRECT / STALE CLIENT: the public wrapper is the door a browser or RPC call uses ------------------------------
  const viaWrapper = await call(`public.hq_document_import(${lit(OFFICE)}::uuid, ${lit(d2)}::uuid)`)
  check(
    'stale client / direct RPC through the public wrapper gets the same typed refusal',
    typed(viaWrapper, 'attachment_disabled'),
    JSON.stringify(viaWrapper),
  )
  const viaWrapperChannel = await call(
    `public.hq_document_import(${lit(OFFICE)}::uuid, ${lit(d2)}::uuid, 'telegram')`,
  )
  check(
    '...whatever channel the caller claims (an agent or a chat reaches it with one)',
    typed(viaWrapperChannel, 'attachment_disabled'),
  )

  // 4. THE JOB / AGENT ROUTE ------------------------------------------------------------------------------------------
  await setAttachment(true)
  const d4 = await ref(`f4-${run}`, 'Queued while connected')
  const r4 = await press(d4)
  const jobId = String(
    (
      await q(
        `select job_id::text j from public.jobs where idempotency_key = ${lit(`import-fetch:${d4}`)}`,
      )
    )[0]?.j,
  )
  check(
    'a fetch job was queued while the source was connected',
    r4.ok === true && jobId !== 'undefined',
  )
  await setAttachment(false)
  const out = (await handler.handle(
    { jobId, projectId: PA, kind: 'drive.read_file' } as never,
    {} as never,
  )) as { body: string; announce: boolean }
  check(
    'the real drive.read_file handler refuses that job after the source was switched off',
    /SOURCE_DISCONNECTED/.test(out.body) && out.announce === false,
    out.body,
  )
  check('...and made no request to Drive at all', driveCalls.length === 0, driveCalls.join(','))
  check(
    '...and the request says why, for the page',
    /switched off/.test(
      String(
        (
          await q(
            `select last_error from public.document_import_requests where document_id = ${lit(d4)}::uuid`,
          )
        )[0]?.last_error,
      ),
    ),
  )
  const enq = await call(
    `app.document_import_enqueue_fetch(${lit(OFFICE)}::uuid, ${lit(d4)}::uuid)`,
  )
  const jobsAfter = Number(
    (
      await q(
        `select count(*)::int n from public.jobs where idempotency_key = ${lit(`import-fetch:${d4}`)} and state not in ('complete','cancelled','failed')`,
      )
    )[0]?.n,
  )
  check(
    'enqueueing a fetch directly (an agent, a retry, a script) queues nothing for a closed source',
    enq === null && jobsAfter <= 1,
  )
  // a new request made while connected, then the source closes before the file arrives
  await setAttachment(true)
  const d4b = await ref(`f4b-${run}`, 'Request open, file arrives after the switch-off')
  await press(d4b)
  await q(
    `update public.documents set content = 'late text', fetched_at = now(), content_fingerprint = encode(sha256(convert_to('late text', 'UTF8')),'hex') where document_id = ${lit(d4b)}::uuid`,
  )
  await q(`select app.document_preview_mark_read(${lit(OFFICE)}::uuid, ${lit(d4b)}::uuid)`)
  await setAttachment(false)
  const f4b = await call(`app.document_import_fulfil(${lit(OFFICE)}::uuid, ${lit(d4b)}::uuid)`)
  check(
    'a copy is not made when the source was switched off while the file was on its way',
    f4b.ok === false && f4b.error_code === 'SOURCE_DISCONNECTED' && f4b.fulfilled === false,
    JSON.stringify(f4b),
  )
  check(
    '...and no copy exists',
    Number(
      (
        await q(
          `select count(*)::int n from public.documents where imported_from_document_id = ${lit(d4b)}::uuid`,
        )
      )[0]?.n,
    ) === 0,
  )

  // 5. PROVIDER DISCONNECTED (Google revoked / never connected) --------------------------------------------------------
  await setAttachment(true)
  await revoke(OFFICE)
  const d5 = await ref(`f5-${run}`, 'Needs Google')
  const r5 = await press(d5)
  check(
    'revoked Google account: a fetch import is refused with SOURCE_DISCONNECTED (provider_disconnected)',
    typed(r5, 'provider_disconnected') && /Reconnect Google Drive/.test(String(r5.error)),
    JSON.stringify(r5),
  )
  check(
    '...and it created no request and no job',
    (await requests(d5)) === 0 && (await jobs(d5)) === 0,
  )
  const d5h = await ref(
    `f5h-${run}`,
    'Held while Google is revoked',
    'Text Team HQ holds from an earlier real read.',
  )
  await q(`select app.document_preview_mark_read(${lit(OFFICE)}::uuid, ${lit(d5h)}::uuid)`)
  const r5h = await press(d5h)
  check(
    '...but material Team HQ already holds needs no provider, so it still imports',
    r5h.ok === true && r5h.state === 'imported',
    JSON.stringify(r5h),
  )

  // 6. A DURABLE COPY SURVIVES DISCONNECTION; so does history ------------------------------------------------------------
  const copy = String(r5h.copy_id)
  await setAttachment(false)
  const again = await press(d5h)
  check(
    'pressing Import on an already-imported document says so, disconnected or not (it is not confused with a new import)',
    again.ok === true && again.already === true && again.copy_id === copy,
    JSON.stringify(again),
  )
  const c = (
    await q(
      `select origin, content, state from public.documents where document_id = ${lit(copy)}::uuid`,
    )
  )[0]
  check(
    'the durable copy is whole and not tied to the connection (origin is not source, content kept)',
    c?.origin !== 'source' && /earlier real read/.test(String(c?.content)),
  )
  const list = await call(`app.hq_project_documents(${lit(OFFICE)}::uuid, ${lit(SLUG)})`)
  check(
    "...and it is in the project's active list while the source is disconnected",
    (list.documents as { id: string }[]).some((d) => d.id === copy),
  )
  const hist = await call(`app.hq_project_documents(${lit(OFFICE)}::uuid, ${lit(SLUG)}, true)`)
  check(
    "the source's own metadata and provenance remain visible on request (nothing was deleted)",
    (hist.documents as { id: string }[]).some((d) => d.id === d5h),
  )
  check(
    'the source row still exists, with its history',
    Number(
      (
        await q(
          `select count(*)::int n from public.documents where document_id = ${lit(d5h)}::uuid`,
        )
      )[0]?.n,
    ) === 1,
  )

  // 7. RECONNECT restores -----------------------------------------------------------------------------------------------
  await setAttachment(true)
  const stillRevoked = await press(d5)
  check(
    'turning the attachment back on is not enough while Google is still revoked',
    typed(stillRevoked, 'provider_disconnected'),
  )
  await q(
    `update public.integration_connections set state = 'active', revoked_at = null where office_id = ${lit(OFFICE)}::uuid and provider = 'google'`,
  )
  const back = await press(d5)
  check(
    'reconnecting Google restores the ability to import (a fetch is queued again)',
    back.ok === true && back.state === 'pending' && (await jobs(d5)) === 1,
    JSON.stringify(back),
  )

  // 8. THE ACCOUNT BEHIND THE LEGACY NAME (an office from before 1000) ----------------------------------------------------
  const LEG = await mkOffice('legacy')
  const legProj = await project(LEG, `gatelegacy-${run}`)
  await q(
    `insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled) values (${lit(legProj)}::uuid, 'drive', 'legfolder', 'Legacy folder', 'source', true)`,
  )
  const legDoc = String(
    (
      await q(
        `insert into public.documents (office_id, project_id, title, doc_type, origin, connector, external_parent_ref, external_ref, state, added_by) values (${lit(LEG)}::uuid, ${lit(legProj)}::uuid, 'Legacy doc', 'file', 'source', 'drive', 'legfolder', ${lit(`leg-${run}`)}, 'approved', 'chief-of-staff') returning document_id::text id`,
      )
    )[0]?.id,
  )
  const noCred = await press(legDoc, LEG)
  check(
    'an office with no connection row and no stored credential is disconnected',
    typed(noCred, 'provider_disconnected'),
    JSON.stringify(noCred),
  )
  await q(
    `select vault.create_secret('legacy-token', app.google_legacy_vault_name(${lit(LEG)}::uuid, 'google.refresh_token'), 'gate proof')`,
  )
  const withCred = await press(legDoc, LEG)
  check(
    '...and connected once the 0800 credential exists',
    withCred.ok === true,
    JSON.stringify(withCred),
  )

  // 9. TENANT / SOURCE IDENTITY CANNOT BE SUBSTITUTED ---------------------------------------------------------------------
  await setAttachment(false)
  const d9 = await ref(`f9-${run}`, 'Main office, switched off')
  const OTHER = await mkOffice('other')
  await connect(OTHER)
  const sub = await press(d9, OTHER)
  check(
    'another office, however connected, gets "no document" for this office\'s document (nothing leaks)',
    sub.ok === false && /no document/i.test(String(sub.error)) && sub.error_code === undefined,
    JSON.stringify(sub),
  )
  check('...and creates nothing for it', (await requests(d9)) === 0 && (await jobs(d9)) === 0)
  const stillRefused = await press(d9)
  check(
    "the owner is still refused: the other office's connection did not stand in",
    typed(stillRefused, 'attachment_disabled'),
  )
  const gate = await call(`app.document_import_gate(${lit(OTHER)}::uuid, ${lit(d9)}::uuid)`)
  check(
    'the gate itself reads the document inside the office it is given: a foreign id is simply not a source document there',
    gate.ok === true,
  )
  check(
    'a native document is never gated (nothing to import, nothing to refuse)',
    (await call(`app.document_source_state(${lit(OFFICE)}::uuid, ${lit(copy)}::uuid)`)) === 'ok',
  )
  check('the handler made no Drive request in the whole run', driveCalls.length === 0)
} finally {
  await q('rollback')
  const left = await q(`select count(*)::int n from public.projects where slug like 'gate%'`)
  check('teardown left nothing behind', Number(left[0]?.n) === 0)
  await db.end()
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${String(failed)} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
