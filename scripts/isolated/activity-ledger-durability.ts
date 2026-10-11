// biome-ignore-all lint/suspicious/noExplicitAny: the read model's answers are untyped JSON
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * Audit durability of the activity ledger: what is lost when a write fails, and that nothing is lost silently.
 *
 *   npx tsx scripts/isolated/activity-ledger-durability.ts <replica-db>
 *
 * The ledger's paths are broken ON PURPOSE (a table renamed out from under the writer, inside a transaction that is rolled back), and the
 * proof asserts the consequence each durability class promises:
 *   critical     the strict writer, in the transaction of the change: a failed record fails the change; the best-effort writer refuses the type
 *   operational  best effort: the failure is counted and returned as null, and the caller's work is untouched
 *   no loop      the failure counter being unwritable does not raise and never produces an event about itself
 */
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
const refused = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

let exit = 1
try {
  const office = String((await one(`select app.operator_office() as o`)).o)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_enabled', 'true'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', '{"version":1,"mode":"all"}'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const marker = `proof.durability.${run}`
  const markerRows = async () => Number((await one(`select count(*) as c from public.system_config where key like ${lit(`${marker}%`)}`)).c)
  const safe = (type: string, key: string) => `select app.record_activity_safely(p_office => ${lit(office)}::uuid, p_event_type => ${lit(type)}, p_idempotency_key => ${lit(`${key}-${run}`)}, p_actor_kind => 'system', p_actor => 'worker', p_summary => 's')`
  const strict = (type: string, key: string) => `select app.record_activity(p_office => ${lit(office)}::uuid, p_event_type => ${lit(type)}, p_idempotency_key => ${lit(`${key}-${run}`)}, p_actor_kind => 'system', p_actor => 'worker', p_summary => 's')`

  // ---------------------------------------------------------------------------------------------- the classes
  const classes = (await db.execute(`select event_type, source, durability, external_writable from public.activity_event_types`)).rows as { event_type: string; source: string; durability: string; external_writable: boolean }[]
  check('classes: every projected type is derived (the owning table is its record) and no native type is', classes.filter((c) => c.source === 'projected').every((c) => c.durability === 'derived') && classes.filter((c) => c.source === 'native').every((c) => c.durability !== 'derived'), `${classes.length} types`)
  check('classes: a correction is critical, tool-call detail is diagnostic', classes.find((c) => c.event_type === 'activity.corrected')?.durability === 'critical' && classes.filter((c) => c.event_type.startsWith('tool.call_')).every((c) => c.durability === 'diagnostic'), 'activity.corrected critical, tool.call_* diagnostic')
  check('classes: nothing an external worker may write is critical, so the door can fail a worker without failing the office', classes.filter((c) => c.external_writable).every((c) => c.durability !== 'critical'), 'external types are not critical')
  check('classes: there is no event type about the ledger failing to write (no loop to fall into)', !classes.some((c) => /write_failed|ledger_failed|activity\.(error|failure)/.test(c.event_type)), 'no self-referential type')

  // ---------------------------------------------------------------------------------------------- critical never rides the best-effort writer
  const before = Number((await one(`select count(*) as c from public.activity_write_failures where office_id = ${lit(office)}::uuid`)).c)
  const viaSafe = await one(`${safe('activity.corrected', 'crit')} as id`)
  const stored = Number((await one(`select count(*) as c from public.activity_events where idempotency_key = ${lit(`crit-${run}`)}`)).c)
  const after = Number((await one(`select count(*) as c from public.activity_write_failures where office_id = ${lit(office)}::uuid`)).c)
  const health = json((await one(`select app.activity_ledger_health(${lit(office)}::uuid) as v`)).v)
  check('critical: the best-effort writer refuses a critical type, stores nothing, returns null and counts it', viaSafe.id === null && stored === 0 && after === before + 1 && health.critical_via_best_effort_24h >= 1, `returned ${String(viaSafe.id)}, stored ${stored}, counted +${after - before}, health ${health.critical_via_best_effort_24h}`)

  // ---------------------------------------------------------------------------------------------- critical: a failed record fails the change
  await db.execute('begin')
  await db.execute(`insert into public.system_config (key, value, description) values (${lit(marker)}, 'true'::jsonb, 'the change a critical record describes')`)
  const badRecord = await refused(strict('no.such_type', 'strict'))
  await db.execute('rollback')
  check('critical: the strict writer raises inside the change\'s transaction, so the change and its record are one unit (nothing of it survives)', badRecord.length > 0 && (await markerRows()) === 0, `${badRecord.slice(0, 60)}; change rows left ${await markerRows()}`)
  await db.execute('begin')
  await db.execute(`insert into public.system_config (key, value, description) values (${lit(`${marker}.ok`)}, 'true'::jsonb, 'the change')`)
  const goodId = String((await one(`${strict('activity.corrected', 'strict-ok')} as id`)).id)
  await db.execute('rollback')
  const orphan = Number((await one(`select count(*) as c from public.activity_events where activity_id = ${lit(goodId)}::uuid`)).c)
  check('critical: a change that rolls back takes its record with it (no record of a thing that did not happen)', orphan === 0 && (await markerRows()) === 0, `record rows left ${orphan}`)

  // ---------------------------------------------------------------------------------------------- operational: break the path on purpose
  await db.execute('begin')
  await db.execute(`insert into public.system_config (key, value, description) values (${lit(`${marker}.work`)}, 'true'::jsonb, 'the caller''s own work')`)
  await db.execute('alter table public.activity_events rename to activity_events_broken')
  let brokenId: unknown = 'not run'
  let workSurvived = false
  let counted = 0
  let brokenRaised = ''
  try {
    brokenId = (await one(`${safe('system.recovered', 'broken')} as id`)).id
    workSurvived = (await markerRows()) === 1
    counted = Number((await one(`select count(*) as c from public.activity_write_failures where event_type = 'system.recovered' and reason is not null and occurred_at > now() - interval '1 minute'`)).c)
  } catch (e) {
    brokenRaised = (e as Error).message
  }
  await db.execute('rollback')
  check('operational: with the ledger table gone the best-effort writer returns null, does not raise, leaves the caller\'s work and counts the failure', brokenId === null && workSurvived && counted >= 1, brokenRaised !== '' ? `RAISED ${brokenRaised.slice(0, 60)}` : `returned ${String(brokenId)}, caller work kept ${workSurvived}, counted ${counted}`)
  const restored = (await one(`select to_regclass('public.activity_events') is not null as ok`)).ok === true
  check('operational: the broken state was rolled back, the proof left no damage', restored, 'activity_events restored')

  // ---------------------------------------------------------------------------------------------- no loop: the counter is gone too
  await db.execute('begin')
  await db.execute('alter table public.activity_events rename to activity_events_broken')
  await db.execute('alter table public.activity_write_failures rename to activity_write_failures_broken')
  const loopErr = await refused(safe('system.recovered', 'loop'))
  let noSelf = 0
  if (loopErr === '') noSelf = Number((await one(`select count(*) as c from public.activity_events_broken where event_type not in (select event_type from public.activity_event_types where source = 'native' and event_type <> 'activity.corrected')`)).c)
  await db.execute('rollback')
  check('no loop: with the ledger AND its failure counter gone the best-effort writer still does not raise, and writes no event about itself', loopErr === '' && noSelf === 0, loopErr || 'returned without raising')

  // ---------------------------------------------------------------------------------------------- the counter is bounded
  const flood = await db.execute(`do $$ begin for i in 1 .. 260 loop perform app.record_activity_safely(p_office => ${lit(office)}::uuid, p_event_type => 'nope.nope', p_idempotency_key => 'f-' || i || '-${run}', p_actor_kind => 'system', p_actor => 'w', p_summary => 's'); end loop; end $$`).then(() => '', (e: Error) => e.message)
  const hourly = Number((await one(`select count(*) as c from public.activity_write_failures where office_id = ${lit(office)}::uuid and occurred_at > now() - interval '1 hour'`)).c)
  check('bounded: a flood of failures is counted up to 200 an hour and no further, and never raises', flood === '' && hourly <= 201, `${hourly} counted, ${flood || 'no error'}`)

  // ---------------------------------------------------------------------------------------------- the diagnostic volume cap (phase 8)
  // the section above saturated the failure counter (200 an hour); a disposable replica may clear it so the cap's own count is visible
  await db.execute(`delete from public.activity_write_failures where office_id = ${lit(office)}::uuid`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.diag_native_per_day', '3'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const base = Number((await one(`select count(*) as c from public.activity_events where office_id = ${lit(office)}::uuid and visibility = 'diagnostic' and actor_kind <> 'external' and occurred_at > now() - interval '1 day'`)).c)
  const capNow = base + 3
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.diag_native_per_day', ${lit(String(capNow))}::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const written: (string | null)[] = []
  for (let i = 0; i < 5; i++) written.push(String((await one(`${safe('tool.call_completed', `cap-${i}`)} as id`)).id ?? 'null'))
  const failuresBefore = Number((await one(`select count(*) as c from public.activity_write_failures where office_id = ${lit(office)}::uuid and sqlstate = '53400'`)).c)
  check('cap: past the office\'s daily diagnostic limit the best-effort writer stores nothing more and returns null (3 of 5 stored, the 4th and 5th refused)', written.slice(0, 3).every((w) => w !== 'null') && written.slice(3).every((w) => w === 'null'), written.map((w) => (w === 'null' ? 'null' : 'id')).join(','))
  check('cap: a refusal is COUNTED in the failure counter (never silent), with the cap in the reason', failuresBefore >= 2, `${failuresBefore} counted`)
  const hs = json((await one(`select app.activity_ledger_health(${lit(office)}::uuid) as v`)).v)
  check('cap: the health reading shows the diagnostic volume, the cap in force and the table size (the deployment office only), so storage is read without a query', Number(hs.native_diagnostic_24h) >= 3 && Number(hs.diagnostic_cap_per_day) === capNow && Number(hs.native_table_bytes) > 0, `${hs.native_diagnostic_24h} diagnostic in 24 h, cap ${hs.diagnostic_cap_per_day}, ${hs.native_table_bytes} bytes`)
  const replay = await one(`${safe('tool.call_completed', 'cap-0')} as id`)
  check('cap: a replay of a key already stored at the cap returns the stored id and is not counted as a loss', String(replay.id) === written[0], String(replay.id))
  const userType = await one(`${safe('budget.threshold_reached', 'cap-user')} as id`)
  check('cap: a user-visible type is not capped (positive control: the cap is about diagnostic rows, not about the office going quiet)', userType.id !== null, String(userType.id))
  const strictDiag = await refused(strict('tool.call_completed', 'cap-strict'))
  check('cap: the strict writer is not capped (a caller that needs the row in its own transaction gets it)', strictDiag === '', strictDiag || 'written')
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.diag_native_per_day', '100000'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const raised = await one(`${safe('tool.call_completed', 'cap-raised')} as id`)
  check('cap: raising the setting restores writing at once', raised.id !== null, String(raised.id))
  await db.execute(`delete from public.system_config where key = 'activity.diag_native_per_day'`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
