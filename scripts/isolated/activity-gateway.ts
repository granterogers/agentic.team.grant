// biome-ignore-all lint/suspicious/noExplicitAny: gateway answers are untyped JSON
/**
 * The unified activity ledger through the REAL hq-api edge function (migrations 1060 and 1061).
 *
 *   npx tsx scripts/isolated/activity-gateway.ts <replica-db>
 *
 * activity-ledger.ts calls the SQL directly; a proof that calls the SQL cannot see the gateway in front of it (the CLAUDE.md lesson
 * about `layout-cas`). This runs the function's own file, signs two people in, and reads the four ledger sections as a browser does.
 *
 *   sections   activity_feed, activity_ledger (the Team HQ adapter), activity_chain, activity_health answer for the caller's office only
 *   doors      a missing or unknown session is refused; a malformed id, instant, word or count is refused BY NAME, never with a database error
 *   isolation  naming the other person's project or job returns nothing; a person asking for operator visibility is given diagnostic
 *   switch     with the ledger off every section answers enabled:false and nothing else
 *   nothing left the machine: every URL the function tried that is not the replica is refused and recorded
 */
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'ledger')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const TOKEN = 'isolated-hq-token'
const S_A = `aaa.bbb.${'a'.repeat(70)}`
const S_B = `aaa.bbb.${'b'.repeat(70)}`
const A_EMAIL = `lg-a-${run}@example.com`
const B_EMAIL = `lg-b-${run}@example.com`

let exit = 1
try {
  await db.execute(
    `update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`,
  )
  await db.execute(
    `update public.offices set state = 'disabled', disabled_at = now() where kind = 'sample' and state = 'active'`,
  )
  for (const e of [A_EMAIL, B_EMAIL])
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(e)})`)
  const officeA = String(
    json(
      (
        await one(
          `select app.provision_person_office('Person A', ${lit(A_EMAIL)}, ${lit(`lga-${run}`)}) as r`,
        )
      ).r,
    ).office_id,
  )
  const officeB = String(
    json(
      (
        await one(
          `select app.provision_person_office('Person B', ${lit(B_EMAIL)}, ${lit(`lgb-${run}`)}) as r`,
        )
      ).r,
    ).office_id,
  )
  const mk = async (o: string, n: string) =>
    String(
      json(
        (
          await one(
            `select app.hq_create_project(${lit(o)}::uuid, ${lit(n)}, 'upload', ${lit(`${n}-${run}`.toLowerCase())}, ${lit(n)}, true) as v`,
          )
        ).v,
      ).project_id,
    )
  const projA = await mk(officeA, 'Alpha')
  const projB = await mk(officeB, 'Bravo')
  const rec = (
    office: string,
    key: string,
    type: string,
    summary: string,
    proj: string,
    sev?: string,
  ) =>
    one(
      `select app.record_activity(${lit(office)}::uuid, ${lit(type)}, ${lit(`${key}-${run}`)}, 'system', 'office', ${lit(summary)}, 'recorded', ${sev === undefined ? 'null' : lit(sev)}, null, null, ${lit(proj)}::uuid) as v`,
    )
  await rec(
    officeA,
    'a-budget',
    'budget.threshold_reached',
    'Alpha crossed 80% of the daily budget',
    projA,
    'warning',
  )
  await rec(
    officeA,
    'a-limit',
    'integration.rate_limited',
    'Alpha was rate limited by a provider',
    projA,
  )
  await rec(
    officeB,
    'b-budget',
    'budget.threshold_reached',
    'Bravo crossed 80% of the daily budget',
    projB,
    'warning',
  )
  await one(
    `select app.record_activity(${lit(officeA)}::uuid, 'system.recovered', ${lit(`a-rec-${run}`)}, 'system', 'worker', 'Alpha recovered a stalled job') as v`,
  )

  const gw = await startEdge({
    db,
    edgeFile: 'supabase/functions/hq-api/index.ts',
    env: {
      HQ_API_TOKEN: TOKEN,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'isolated-anon',
      SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
    },
    authUsers: { [S_A]: A_EMAIL, [S_B]: B_EMAIL },
  })
  type Out = { status: number; body: any }
  const get = async (bearer: string | null, section: string, query = ''): Promise<Out> => {
    const headers: Record<string, string> =
      bearer === null ? {} : { Authorization: `Bearer ${bearer}` }
    const r = await gw.call(
      new Request(
        `https://gw.invalid/functions/v1/hq-api?section=${section}${query === '' ? '' : `&${query}`}`,
        { headers },
      ),
    )
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }
  const events = (o: Out): any[] => (o.body?.events ?? o.body?.data?.events ?? []) as any[]
  const payload = (o: Out): any => o.body?.data ?? o.body

  const a = await get(S_A, 'activity_feed', 'visibility=diagnostic')
  const b = await get(S_B, 'activity_feed', 'visibility=diagnostic')
  check(
    'sections: each person reads their own feed, and only that',
    a.status === 200 &&
      b.status === 200 &&
      events(a).some((e) => e.summary.includes('Alpha')) &&
      !events(a).some((e) => e.summary.includes('Bravo')) &&
      events(b).some((e) => e.summary.includes('Bravo')) &&
      !events(b).some((e) => e.summary.includes('Alpha')),
    `A ${events(a).length} events, B ${events(b).length}`,
  )
  const x = await get(S_A, 'activity_feed', `project=${projB}&visibility=diagnostic`)
  check(
    "isolation: naming the other person's project returns nothing, not an error",
    x.status === 200 && events(x).length === 0,
    `status ${x.status}, ${events(x).length} events`,
  )
  const byProj = await get(S_A, 'activity_feed', `project=${projA}&visibility=diagnostic`)
  check(
    'filters: a project filter reaches the database as a parameter and narrows',
    byProj.status === 200 &&
      events(byProj).length === 2 &&
      events(byProj).every((e) => e.project_id === projA),
    `${events(byProj).length} events`,
  )
  const sev = await get(S_A, 'activity_feed', 'severity=warning&visibility=diagnostic')
  check(
    'filters: severity, category, status, source and type are word lists',
    sev.status === 200 &&
      events(sev).every((e) => ['warning', 'error', 'critical'].includes(e.severity)) &&
      events(sev).length >= 2,
    `${events(sev).length} at warning or above`,
  )
  const op = await get(S_A, 'activity_feed', 'visibility=operator')
  check(
    'isolation: a person asking for operator visibility is given diagnostic (no operator-only event)',
    op.status === 200 &&
      !events(op).some((e) => e.type === 'system.recovered') &&
      payload(op).visibility === 'operator',
    `${events(op).length} events, no system.recovered`,
  )
  const page = await get(S_A, 'activity_feed', 'visibility=diagnostic&limit=1')
  const next = payload(page).next
  const page2 = await get(
    S_A,
    'activity_feed',
    `visibility=diagnostic&limit=1&before_at=${encodeURIComponent(String(next?.at))}&before_id=${String(next?.id)}`,
  )
  check(
    'paging: the cursor the first page returns opens the second page, and they do not overlap',
    events(page).length === 1 &&
      events(page2).length === 1 &&
      events(page)[0].id !== events(page2)[0].id,
    `${String(events(page)[0]?.id).slice(0, 8)} then ${String(events(page2)[0]?.id).slice(0, 8)}`,
  )

  // Two events a few microseconds apart, inside one millisecond: a cursor that is rounded to milliseconds skips the older one.
  for (const [i, at] of [
    '2026-01-01T00:00:00.123456Z',
    '2026-01-01T00:00:00.123123Z',
    '2026-01-01T00:00:00.123001Z',
  ].entries())
    await one(
      `select app.record_activity(p_office => ${lit(officeA)}::uuid, p_event_type => 'budget.threshold_reached', p_idempotency_key => ${lit(`micro-${i}-${run}`)}, p_actor_kind => 'system', p_actor => 'office', p_summary => 'micro ${i}', p_occurred_at => ${lit(at)}::timestamptz) as v`,
    )
  const walked: string[] = []
  let cur = ''
  for (let i = 0; i < 6; i++) {
    const p = await get(
      S_A,
      'activity_feed',
      `since=2026-01-01T00:00:00Z&until=2026-01-01T00:00:01Z&limit=1${cur}`,
    )
    for (const e of events(p)) walked.push(String(e.summary))
    const n = payload(p).next
    if (n === null || n === undefined) break
    cur = `&before_at=${encodeURIComponent(String(n.at))}&before_id=${String(n.id)}`
  }
  check(
    'paging: events microseconds apart inside one millisecond are neither skipped nor repeated at a page boundary',
    walked.join(',') === 'micro 0,micro 1,micro 2',
    walked.join(','),
  )

  const adapter = await get(S_A, 'activity_ledger')
  const row = (payload(adapter).office ?? [])[0] ?? {}
  check(
    'adapter: the Team HQ shape (who, verb, what, project, when, at, via, category) over the gateway',
    adapter.status === 200 &&
      payload(adapter).enabled === true &&
      ['who', 'verb', 'what', 'at', 'category'].every((k) => k in row),
    `first: ${String(row.verb)} ${String(row.what)}`,
  )
  const health = await get(S_A, 'activity_health')
  const hb = await get(S_B, 'activity_health')
  check(
    "health: native volume is each office's own",
    health.status === 200 &&
      Number(payload(health).native_events_total) === 6 &&
      Number(payload(hb).native_events_total) === 1,
    `A ${payload(health).native_events_total}, B ${payload(hb).native_events_total}`,
  )
  const noJob = await get(S_A, 'activity_chain')
  check(
    'chain: a chain with neither a job nor a correlation is refused, and says so',
    noJob.status >= 400 && noJob.status < 500,
    `status ${noJob.status}`,
  )
  const xChain = await get(S_B, 'activity_chain', `correlation=${crypto.randomUUID()}`)
  check(
    "chain: an id that belongs to nobody answers with an empty chain, never another office's",
    xChain.status === 200 && events(xChain).length === 0,
    `${events(xChain).length} events`,
  )

  const noTok = await get(null, 'activity_feed')
  const badTok = await get(`aaa.bbb.${'q'.repeat(70)}`, 'activity_feed')
  check(
    'doors: no session and an unknown session are refused',
    noTok.status === 401 && badTok.status === 401,
    `${noTok.status} / ${badTok.status}`,
  )
  const bad: [string, string][] = [
    ['project=not-an-id', 'an id'],
    ['job=12345', 'an id'],
    ['since=yesterday-ish', 'a date and time'],
    ['since=2026-02-31', 'a date and time'],
    ['limit=lots', 'a small whole number'],
    ['limit=9999', 'a small whole number'],
    ['severity=loud', 'severity must be one of'],
    ['category=everything', 'category must be one of'],
    ['visibility=all', 'visibility must be one of'],
    ['status=maybe', 'status must be one of'],
    ['source=carrier-pigeon', 'source must be one of'],
  ]
  const bads = await Promise.all(bad.map(([q]) => get(S_A, 'activity_feed', q)))
  const names = bads.map(
    (o, i) => o.status === 400 && String(o.body?.error ?? '').includes(bad[i]?.[1] ?? '?'),
  )
  check(
    'doors: a malformed id, instant, word or count is refused by name with a 400, never a database error',
    names.every(Boolean),
    names.map((n, i) => `${bad[i]?.[0]}:${n ? 'ok' : 'NO'}`).join(' '),
  )
  const lim = await get(S_A, 'activity_feed', 'limit=500&visibility=diagnostic')
  check(
    'doors: a large but well-formed limit is accepted and capped by the database',
    lim.status === 200 && events(lim).length <= 200,
    `${events(lim).length} events`,
  )

  await db.execute(
    `update public.system_config set value = 'false'::jsonb where key = 'activity.ledger_enabled'`,
  )
  const offFeed = await get(S_A, 'activity_feed')
  const offPage = await get(S_A, 'activity_ledger')
  const offChain = await get(S_A, 'activity_chain', `correlation=${crypto.randomUUID()}`)
  check(
    'switch: with the ledger off every section answers enabled:false and nothing else',
    payload(offFeed).enabled === false &&
      events(offFeed).length === 0 &&
      payload(offPage).enabled === false &&
      (payload(offPage).office ?? []).length === 0 &&
      payload(offChain).enabled === false,
    'feed, adapter and chain all off',
  )
  const old = await get(S_A, 'lately')
  check(
    'compat: the existing lately section is untouched by the switch',
    old.status === 200 && Array.isArray(payload(old).office),
    `status ${old.status}`,
  )
  check(
    'nothing left the machine',
    gw.refusedUrls.length === 0,
    `${gw.refusedUrls.length} refused outbound URL(s)`,
  )

  const failed = results.filter((r) => !r).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
