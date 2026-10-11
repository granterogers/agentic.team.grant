// biome-ignore-all lint/suspicious/noExplicitAny: the read model's answers are untyped JSON
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The external-worker door and the ledger's tables, attacked (migrations 1060 to 1062, phase 3 P1 and P2).
 *
 *   npx tsx scripts/isolated/activity-external-attack.ts <replica-db>
 *
 * What a hostile or merely buggy worker, or a browser role, can do:
 *   quota        300 reports an hour per worker and 1 000 per office hold under CONCURRENT writers on separate connections (the count and
 *                the insert used to be two steps, so N writers could all read 299); a retry of an accepted report is never refused;
 *                a second worker is unaffected by the first's cap; the cap is the same however the worker names itself
 *   identity     a worker cannot vary its way past the name check or the key check (case, spaces, newline, colon, look-alikes, empty,
 *                over-long, control characters), cannot name another office's project or job, cannot reuse a key for another type
 *   authority    review decisions, confirmation, authorisation and critical severity are refused; evidence cannot say it is an approval
 *   roles        anon and authenticated can execute none of the ledger's functions and read none of its tables; a role switch cannot
 *                forge a row; history cannot be changed or deleted by the service role either
 *   cost         a long summary, deep or large metadata, an oversized evidence reference and a hostile redaction input stay bounded
 *
 * Positive controls sit beside every refusal: a suite of refusals alone passes against a door that refuses everything.
 */
import { PgExecutor } from '../../src/db/pg-executor.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'ledger'
const db = await isolated(dbName)
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const refused = async (sql: string, c = db): Promise<string> => {
  try {
    await c.execute(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}
const sock = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
const port = process.env.ISOLATED_PG_PORT ?? '55432'
const fresh = async () => {
  const c = new PgExecutor(`postgresql://postgres@/${dbName}?host=${sock}&port=${port}`)
  await c.connect()
  return c
}

let exit = 1
const extra: PgExecutor[] = []
try {
  await db.execute(`delete from public.system_config where key = 'activity.ledger_enabled'`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_enabled', 'true'::jsonb, 'proof')`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', '{"version":1,"mode":"all"}'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const mk = async (name: string, tag: string) => {
    const email = `ext-${tag}-${run}@example.invalid`
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
    return String(json((await one(`select app.provision_person_office(${lit(name)}, ${lit(email)}, ${lit(`x${tag}-${run}`)}) as r`)).r).office_id)
  }
  const A = await mk('Person A', 'a')
  const B = await mk('Person B', 'b')
  const call = (office: string, worker: string, key: string, type = 'external.usage_recorded', extraArgs = '') =>
    `select app.record_external_activity(${lit(office)}::uuid, ${lit(worker)}, ${lit(type)}, ${lit(key)}, 'report'${extraArgs}) as v`
  const count = async (office: string, where = '') =>
    Number((await one(`select count(*) as c from public.activity_events where office_id = ${lit(office)}::uuid and actor_kind = 'external' ${where}`)).c)

  // ---------------------------------------------------------------------------------------------- quota
  const pool: PgExecutor[] = []
  for (let i = 0; i < 8; i++) pool.push(await fresh())
  extra.push(...pool)
  const burst = async (office: string, worker: string, n: number, tag: string) => {
    let accepted = 0
    let limited = 0
    let other = 0
    await Promise.all(
      pool.map(async (c, ci) => {
        for (let i = ci; i < n; i += pool.length) {
          const e = await refused(call(office, worker, `${tag}-${i}`), c)
          if (e === '') accepted++
          else if (e.includes('hourly limit')) limited++
          else other++
        }
      }),
    )
    return { accepted, limited, other }
  }
  const w1 = await burst(A, 'hermes', 480, 'q1')
  check('quota: 480 concurrent reports from one worker on 8 connections are held to exactly 300', w1.accepted === 300 && w1.limited === 180 && w1.other === 0, JSON.stringify(w1))
  check('quota: the stored count agrees', (await count(A, `and actor = 'external:hermes'`)) === 300, `${await count(A, `and actor = 'external:hermes'`)} rows`)
  const retry = await one(call(A, 'hermes', 'q1-0'))
  check('quota: a retry of an accepted report is answered, not refused, when the worker is at its cap', typeof retry.v === 'string' && String(retry.v).length > 0, `returned ${String(retry.v).slice(0, 8)}`)
  check('quota: the retry stored nothing', (await count(A, `and actor = 'external:hermes'`)) === 300, 'still 300')
  const fresh1 = await refused(call(A, 'hermes', 'q1-new'))
  check('quota: a NEW report from the capped worker is refused with the limit sentence', fresh1.includes('hourly limit'), fresh1.slice(0, 80))
  const other = await one(call(A, 'second-worker', 'q2-0'))
  check('quota: another worker in the same office is not blocked by the first one\'s cap (positive control)', typeof other.v === 'string', `returned ${String(other.v).slice(0, 8)}`)
  // The office cap: three more workers, each trying 300, on top of the 300 + 1 already there.
  const rest = await Promise.all(['w-three', 'w-four', 'w-five', 'w-six'].map((w) => burst(A, w, 300, `o-${w}`)))
  const total = await count(A)
  check('quota: the office cap of 1 000 holds under concurrent workers', total === 1000, `${total} external rows`)
  check('quota: refusals past the office cap name the office limit', (await refused(call(A, 'w-seven', 'late-1'))).includes('limit of activity reports for this office'), `accepted ${rest.reduce((s, r) => s + r.accepted, 0)}`)
  const bOpen = await one(call(B, 'hermes', 'b-1'))
  check('quota: another office is unaffected by the first one\'s cap (positive control)', typeof bOpen.v === 'string', `office B accepted`)
  check('quota: a retry still passes at the office cap', typeof (await one(call(A, 'w-three', 'o-w-three-0'))).v === 'string' || (await count(A)) === 1000, 'retry answered')

  // ---------------------------------------------------------------------------------------------- identity
  const names = ['Hermes', 'hermes ', ' hermes', 'her\nmes', 'external:hermes', 'h', 'hermes;drop', 'h\u{E9}rmes', 'h\u{435}rmes', 'a'.repeat(41), '', '1hermes', 'hermes/../x']
  const bad = []
  for (const w of names) if ((await refused(call(B, w, `n-${bad.length}`))) === '') bad.push(w)
  check('identity: no variation of a worker name gets through the name check', bad.length === 0, `${names.length} variants refused${bad.length ? `, ACCEPTED ${bad.length}` : ''}`)
  const keyBad: string[] = []
  const badKeys: [string, string][] = [['empty', ''], ['over-long', 'k'.repeat(151)], ['newline', 'k\nk'], ['control', 'k\u0001k'], ['tab', 'k\tk']]
  for (const [n, k] of badKeys) if ((await refused(call(B, 'hermes', k))) === '') keyBad.push(n)
  const nullKey = await refused(`select app.record_external_activity(${lit(B)}::uuid, 'hermes', 'external.usage_recorded', null, 'x')`)
  check('identity: an empty, over-long, control-character or null key is refused', keyBad.length === 0 && nullKey !== '', `${badKeys.length + 1} variants, ${keyBad.length} accepted`)
  const edge = await one(call(B, 'a-worker-name-of-exactly-forty-characters-xx', 'k'.repeat(150)).replace('a-worker-name-of-exactly-forty-characters-xx', 'w'.repeat(40)))
  check('identity: the longest worker name with the longest key (150) is accepted, so the stored key fits its 200 limit (positive control)', typeof edge.v === 'string', 'accepted')
  const aId = await one(call(B, 'hermes', 'dup', 'external.usage_recorded'))
  const reuse = await refused(call(B, 'hermes', 'dup', 'external.worker_error'))
  check('identity: a key reused for another type is refused; the same key for the same type returns the same row', reuse !== '' && (await one(call(B, 'hermes', 'dup'))).v === aId.v, reuse.slice(0, 80))
  const sameKeyOtherWorker = await one(call(B, 'other-worker', 'dup'))
  check('identity: the key is scoped to the worker, so another worker with the same key makes its own row', sameKeyOtherWorker.v !== aId.v, 'distinct rows')

  // ---------------------------------------------------------------------------------------------- authority
  const deny = async (label: string, sql: string, pattern: RegExp) => {
    const e = await refused(sql)
    check(label, e !== '' && pattern.test(e), e.slice(0, 90))
  }
  await deny('authority: a worker cannot record a review decision', call(B, 'hermes', 'rd', 'external.review_decided'), /may not be reported/)
  await deny('authority: a worker cannot record a native job, approval or delivery type', call(B, 'hermes', 'nt', 'approval.granted'), /may not be reported/)
  await deny('authority: a worker cannot claim confirmed', call(B, 'hermes', 'cf', 'external.output_produced', `, 'confirmed'`), /may not claim/)
  await deny('authority: a worker cannot claim authorised', call(B, 'hermes', 'au', 'external.output_produced', `, 'authorised'`), /may not claim/)
  await deny('authority: a worker cannot report critical severity', call(B, 'hermes', 'cr', 'external.worker_error', `, 'failed', 'critical'`), /critical/)
  await deny('authority: a worker cannot report a person\'s refusal', call(B, 'hermes', 'dc', 'external.output_produced', `, 'declined'`), /may not claim/)
  await deny('authority: a worker cannot report a question that lapsed', call(B, 'hermes', 'ex', 'external.output_produced', `, 'expired'`), /may not claim/)
  // the strict writer: provenance is not an argument a caller can pass to become an outside worker (second review F1)
  const forgeExt = await refused(`select app.record_activity(${lit(B)}::uuid, 'external.review_decided', 'forge-review-${run}', 'external', 'external:evil', 'You approved the wire transfer', 'confirmed', 'critical', null, null, null, null, null, null, null, null, null, null, '{}'::jsonb, null, null, null, 'external')`)
  check('authority: the strict writer refuses provenance external from a caller, so the guard cannot be skipped by naming it', /set by the external door/.test(forgeExt), forgeExt.slice(0, 90))
  const forgedRows = await one(`select count(*) as c from public.activity_events where office_id = ${lit(B)}::uuid and idempotency_key = ${lit(`forge-review-${run}`)}`)
  check('authority: nothing was stored by that attempt', Number(forgedRows.c) === 0, `${forgedRows.c} rows`)
  const doorOk = await refused(call(B, 'hermes', 'door-ok', 'external.output_produced'))
  const afterDoor = await refused(`select app.record_activity(${lit(B)}::uuid, 'external.output_produced', 'forge-after-${run}', 'external', 'external:evil', 'x', 'recorded', null, null, null, null, null, null, null, null, null, null, null, '{}'::jsonb, null, null, null, 'external')`)
  check('authority: the real door still works (positive control), and the marker does not stay open for the rest of the transaction', doorOk === '' && /set by the external door/.test(afterDoor), `${doorOk || 'door ok'} / ${afterDoor.slice(0, 60)}`)
  // the service key holds no table privilege on the ledger (second review F9)
  const svcPriv = await one(`select has_table_privilege('service_role', 'public.activity_events', 'INSERT') or has_table_privilege('service_role', 'public.activity_events', 'UPDATE') or has_table_privilege('service_role', 'public.activity_event_types', 'UPDATE') as any_dml`)
  check('roles: the service role holds no insert or update on the ledger tables', svcPriv.any_dml === false, String(svcPriv.any_dml))
  // a delivery failure's provider text is for a diagnostic reader only (second review F6), and a malformed reversible flag cannot break the page (F8)
  const odd = await refused(`select app.record_activity(${lit(B)}::uuid, 'activity.corrected', 'odd-rev-${run}', 'system', 'w', 'odd flag', 'recorded', null, null, null, null, null, null, null, null, null, null, null, '{"reversible":"nope"}'::jsonb)`)
  const pageOdd = await refused(`select app.activity_for_the_page(${lit(B)}::uuid)`)
  check('read: a native event with a non-boolean reversible flag does not break the page', odd === '' && pageOdd === '', `${odd.slice(0, 50) || 'written'} / ${pageOdd.slice(0, 60) || 'page ok'}`)
  const forged = await one(call(B, 'hermes', 'ev', 'external.output_produced', `, 'recorded', null, null, null, null, '{}'::jsonb, '{"kind":"approval","id":"x","ref":"y"}'::jsonb`))
  const evRow = await one(`select provenance, source_interface, actor_kind, evidence_ref->>'kind' as k from public.activity_events where activity_id =${lit(String(forged.v))}::uuid`)
  check('authority: evidence cannot call itself an approval; provenance, interface and actor are forced', evRow.k === 'external' && evRow.provenance === 'external' && evRow.source_interface === 'external' && evRow.actor_kind === 'external', JSON.stringify(evRow))
  const claimsApproved = await one(`select count(*) as c from public.activity_events where office_id = ${lit(B)}::uuid and actor_kind = 'external' and event_type like 'approval.%'`)
  check('authority: no external row is of an approval, review, delivery or skill-install type', Number(claimsApproved.c) === 0, `${claimsApproved.c} rows`)
  const overBig = await refused(call(B, 'hermes', 'big', 'external.output_produced', `, 'recorded', null, null, null, null, '{}'::jsonb, ${lit(JSON.stringify({ note: 'x'.repeat(5000) }))}::jsonb`))
  const bigOk = overBig === '' ? (await one(`select pg_column_size(evidence_ref) as n from public.activity_events where idempotency_key = 'ext:hermes:big' and office_id = ${lit(B)}::uuid`)).n : null
  check('authority: an oversized evidence reference is refused or cut below 1 KB', overBig !== '' || Number(bigOk) <= 1024, overBig ? overBig.slice(0, 70) : `stored ${bigOk} bytes`)

  // ---------------------------------------------------------------------------------------------- roles
  const roleDb = await fresh()
  extra.push(roleDb)
  const asRole = async (role: string, sql: string) => {
    try {
      await roleDb.execute(`set role ${role}`)
      return await refused(sql, roleDb)
    } finally {
      await roleDb.execute('reset role').catch(() => undefined)
    }
  }
  for (const role of ['anon', 'authenticated']) {
    const fns = [
      `select app.record_external_activity(${lit(B)}::uuid, 'hermes', 'external.usage_recorded', 'r-${role}', 'x')`,
      `select app.record_activity(${lit(B)}::uuid, 'system.recovered', 'r2-${role}', 'system', 'worker', 'x')`,
      `select app.activity_read(p_office => ${lit(B)}::uuid)`,
      `select app.activity_redact('x')`,
      `select app.activity_ledger_on()`,
    ]
    const let_through: string[] = []
    for (const f of fns) if ((await asRole(role, f)) === '') let_through.push(f.slice(7, 40))
    check(`roles: ${role} can execute none of the ledger functions`, let_through.length === 0, let_through.length ? `LET THROUGH ${let_through.join(', ')}` : `${fns.length} refused`)
    const tbl = await asRole(role, `select count(*) from public.activity_events`)
    const ins = await asRole(role, `insert into public.activity_events (office_id, event_type, actor_kind, actor, summary, idempotency_key) values (${lit(B)}::uuid, 'system.recovered', 'system', 'x', 'x', 'direct-${role}')`)
    check(`roles: ${role} can neither read nor insert into the table`, tbl !== '' && ins !== '', `${tbl.slice(0, 40)} / ${ins.slice(0, 40)}`)
  }
  const svc = await asRole('service_role', call(B, 'hermes', 'svc-direct-1'))
  check('roles: the service role has no usage on schema app, so PostgREST cannot reach the door (an application boundary must)', svc !== '' && /permission denied/.test(svc), svc.slice(0, 70))
  const owner = await one(call(B, 'hermes', 'owner-direct-1'))
  check('roles: the owning role can use the door (positive control)', typeof owner.v === 'string', 'accepted')
  const upd = await refused(`update public.activity_events set summary = 'tampered' where office_id = ${lit(B)}::uuid`)
  const del = await refused(`delete from public.activity_events where office_id = ${lit(B)}::uuid`)
  const trunc = await refused(`truncate public.activity_events`)
  check('roles: even the owner cannot change, delete or truncate history', upd !== '' && del !== '' && trunc !== '', `${upd.slice(0, 30)} / ${del.slice(0, 30)} / ${trunc.slice(0, 30)}`)

  // ---------------------------------------------------------------------------------------------- cost
  const t0 = Date.now()
  await one(call(B, 'hermes', 'long', 'external.worker_error', `, 'failed', null, null, null, null, ${lit(JSON.stringify({ outcome: 'y'.repeat(2000), model: 'm' }))}::jsonb`).replace(`'report'`, lit('z'.repeat(200000))))
  const longRow = await one(`select length(summary) as n, pg_column_size(metadata) as m from public.activity_events where idempotency_key = 'ext:hermes:long' and office_id = ${lit(B)}::uuid`)
  check('cost: a 200 000 character summary and a 2 000 character metadata value are cut and quick', Number(longRow.n) <= 300 && Number(longRow.m) < 2200 && Date.now() - t0 < 3000, `summary ${longRow.n}, metadata ${longRow.m} bytes, ${Date.now() - t0} ms`)
  const t1 = Date.now()
  const huge = await refused(call(B, 'hermes', 'huge', 'external.worker_error', `, 'failed', null, null, null, null, ${lit(JSON.stringify({ outcome: 'y'.repeat(100000), model: 'm' }))}::jsonb`))
  check('cost: a 100 000 character metadata value is refused outright, quickly', huge.includes('larger than 16 KB') && Date.now() - t1 < 2000, `${huge.slice(0, 60)}, ${Date.now() - t1} ms`)
  const deepMeta = JSON.stringify(JSON.parse(`${'{"a":'.repeat(50)}1${'}'.repeat(50)}`))
  const deepOk = await refused(call(B, 'hermes', 'deep', 'external.usage_recorded', `, 'recorded', null, null, null, null, ${lit(deepMeta)}::jsonb`))
  const deepRow = await one(`select metadata from public.activity_events where idempotency_key = 'ext:hermes:deep' and office_id = ${lit(B)}::uuid`)
  check('cost: nested metadata is refused or reduced to the allowlist', deepOk !== '' || !JSON.stringify(deepRow.metadata ?? {}).includes('"a"'), deepOk ? deepOk.slice(0, 70) : JSON.stringify(deepRow.metadata))
  const manyKeys: Record<string, number> = {}
  for (let i = 0; i < 500; i++) manyKeys[`k${i}`] = i
  const manyOk = await refused(call(B, 'hermes', 'many', 'external.usage_recorded', `, 'recorded', null, null, null, null, ${lit(JSON.stringify(manyKeys))}::jsonb`))
  const manyRow = await one(`select pg_column_size(metadata) as m, metadata from public.activity_events where idempotency_key = 'ext:hermes:many' and office_id = ${lit(B)}::uuid`)
  check('cost: 500 unknown metadata keys are refused or dropped and counted', manyOk !== '' || (Number(manyRow.m) < 600 && json(manyRow.metadata)?.dropped_keys === 500), manyOk ? manyOk.slice(0, 70) : JSON.stringify(manyRow.metadata).slice(0, 80))
  const good = await one(call(B, 'hermes', 'usage', 'external.usage_recorded', `, 'recorded', null, null, null, null, '{"prompt_tokens": 1234, "total_tokens": 1500, "duration_ms": 842, "model": "m1", "cost_status": "not_reported"}'::jsonb`))
  const goodRow = await one(`select metadata from public.activity_events where activity_id =${lit(String(good.v))}::uuid`)
  const gm = json(goodRow.metadata)
  check('cost: token counts and durations pass the allowlist unchanged (positive control)', gm.prompt_tokens === 1234 && gm.total_tokens === 1500 && gm.duration_ms === 842 && gm.dropped_keys === undefined, JSON.stringify(gm))
  const sneaky = await one(call(B, 'hermes', 'sneak', 'external.usage_recorded', `, 'recorded', null, null, null, null, '{"duration_ms": 5, "notes": "a free text body", "authorization": "x", "nested": {"a": 1}}'::jsonb`))
  const sm = json((await one(`select metadata from public.activity_events where activity_id =${lit(String(sneaky.v))}::uuid`)).metadata)
  check('cost: free-text and credential-named keys are dropped and counted, the figure survives', sm.duration_ms === 5 && sm.notes === undefined && sm.authorization === undefined && sm.nested === undefined && sm.dropped_keys === 3, JSON.stringify(sm))

  // ---------------------------------------------------------------------------------------------- review findings (phase 3)
  const nat = (type: string, key: string, actorKind: string, actor: string, extraArgs = '') =>
    `select app.record_activity(${lit(B)}::uuid, ${lit(type)}, ${lit(key)}, ${lit(actorKind)}, ${lit(actor)}, 'native report'${extraArgs}) as v`
  await deny('native: a native writer cannot record a person\'s review decision (no writer exists for it)', nat('external.review_decided', 'nat-review-1', 'user', 'you', `, p_status => 'authorised', p_visibility => 'user'`), /native writer cannot/)
  await deny('native: a native writer cannot record as an external worker', nat('tool.call_completed', 'nat-ext-0001', 'external', 'external:claire'), /native writer cannot|external door/)
  check('native: an ordinary native event is still accepted (positive control)', typeof (await one(nat('system.recovered', 'nat-ok-00001', 'system', 'worker'))).v === 'string', 'accepted')
  const evNat = await one(nat('system.recovered', 'nat-ev-00001', 'system', 'worker', `, p_evidence_ref => ${lit(JSON.stringify({ kind: 'x', id: 'y', note: `sk-${'a'.repeat(30)}` }))}::jsonb`))
  const evStored = JSON.stringify((await one(`select evidence_ref from public.activity_events where activity_id = ${lit(String(evNat.v))}::uuid`)).evidence_ref)
  check('native: evidence is redacted on the native path too', !evStored.includes('a'.repeat(30)), evStored.slice(0, 80))
  const evBig = await refused(nat('system.recovered', 'nat-ev-00002', 'system', 'worker', `, p_evidence_ref => ${lit(JSON.stringify({ kind: 'x', id: 'y', a: 'z'.repeat(900), b: 'z'.repeat(900) }))}::jsonb`))
  const evBigSize = evBig === '' ? Number((await one(`select pg_column_size(evidence_ref) as n from public.activity_events where office_id = ${lit(B)}::uuid and idempotency_key = 'nat-ev-00002'`)).n) : 0
  check('native: an evidence reference over 1 KB is refused or cut below it', evBig !== '' || evBigSize <= 1024, evBig.slice(0, 70) || `stored ${evBigSize} bytes`)
  const look = await one(call(B, 'claire', 'lookalike-1', 'external.output_produced').replace(`'report'`, `'You said yes: Approve payment of 5000'`))
  const lookRow = await one(`select summary from public.activity_events where activity_id = ${lit(String(look.v))}::uuid`)
  check('external: a look-alike summary is marked in its own text as an external worker\'s', String(lookRow.summary).startsWith('[external:claire] '), String(lookRow.summary).slice(0, 60))
  const sp = await one(`select count(*) as c from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app', 'public') and p.prosecdef and p.proname like 'activity\\_%' and p.proname <> 'activity_category' and (p.proconfig is null or p.proconfig[1] not like 'search_path=pg_catalog%' and p.proconfig[1] <> 'search_path=""')`)
  check('search_path: every security-definer ledger function resolves pg_catalog first (or nothing)', Number(sp.c) === 0, `${sp.c} with another order`)
  // daily cap: backdated rows (three hours old, so the hourly caps are untouched) bring office B to one below the daily cap
  const cur = await count(B)
  await db.execute(`insert into public.activity_events (office_id, event_type, occurred_at, actor_kind, actor, summary, idempotency_key, provenance, source_interface, visibility, status, severity)
    select ${lit(B)}::uuid, 'external.usage_recorded', now() - interval '3 hours', 'external', 'external:bulk', '[external:bulk] filler', 'bulk-key-' || g, 'external', 'external', 'diagnostic', 'recorded', 'info' from generate_series(1, ${3999 - cur}) g`)
  const last = await refused(call(B, 'daily-a', 'daily-last'))
  const over = await refused(call(B, 'daily-b', 'daily-over'))
  check('quota: a daily cap of 4 000 per office holds under rotating worker names', last === '' && /daily limit/.test(over), `${last || 'accepted'} then ${over.slice(0, 60)}`)
  const bogus = Date.now()
  const badStatus = await refused(`select app.activity_read(p_office => ${lit(B)}::uuid, p_status => 'zzz')`)
  check('read: a status outside the vocabulary is refused immediately instead of scanning every source', /unknown status/.test(badStatus) && Date.now() - bogus < 1000, `${badStatus.slice(0, 40)}, ${Date.now() - bogus} ms`)
  const goodStatus = await refused(`select app.activity_read(p_office => ${lit(B)}::uuid, p_status => 'completed')`)
  check('read: a real status still reads (positive control)', goodStatus === '', goodStatus.slice(0, 60) || 'ok')
  // off means off: nothing, not even a failure counter or an answer
  await db.execute(`update public.system_config set value = 'false'::jsonb where key = 'activity.ledger_enabled'`)
  const fBefore = Number((await one(`select count(*) as c from public.activity_write_failures`)).c)
  const safeOff = await one(`select app.record_activity_safely(${lit(B)}::uuid, 'activity.corrected', 'k-off-000001', 'system', 'w', 's') as v`)
  const extOff = await refused(`select app.record_external_activity(${lit(B)}::uuid, 'BAD NAME', 'job.completed', 'x', 'x') as v`)
  const fAfter = Number((await one(`select count(*) as c from public.activity_write_failures`)).c)
  check('flag off: the best-effort writer writes no failure counter, and the door answers nothing, not even a validation error', safeOff.v === null && fAfter === fBefore && extOff === '', `counter ${fBefore} -> ${fAfter}, door ${extOff || 'silent'}`)
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  for (const c of extra) await c.end().catch(() => undefined)
  await db.end()
}
process.exit(exit)
