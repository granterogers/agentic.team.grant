// biome-ignore-all lint/suspicious/noExplicitAny: the replica's rows are untyped
// biome-ignore-all lint/style/noNonNullAssertion: a rehearsal over rows it has just created
// biome-ignore-all format: a dense rehearsal script kept readable as written
/**
 * Can old diagnostic ledger events be taken out of the live table and put back, byte for byte? (capacity investigation, 11 October 2026)
 *
 *   npx tsx scripts/isolated/activity-archive-rehearsal.ts <replica-db>
 *
 * This is a REHEARSAL of a mechanism, never a capability: nothing here is wired to anything, no migration adds a delete path, and the
 * append-only guard is only stepped round on a disposable replica (a user-trigger disable that no product role can do). It exists so that
 * "archive, then remove from the live table" is a tested round trip before anybody proposes it, and so the saving is a measured number.
 *
 * The rehearsal: seed events across a year (diagnostic tool calls, consequential recoveries and budget events, an outside worker's reports);
 * fingerprint the whole table; export the diagnostic events older than a horizon to gzipped JSON lines with a sha256 manifest; remove them
 * from the live table; show the Activity read still answers over what is left and the consequential rows are untouched; restore from the
 * archive after verifying its checksum; and require the table fingerprint to equal the original. Also reports bytes online versus archived.
 */
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'ledger'
const db = await isolated(dbName)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const HORIZON_DAYS = Number(process.env.ARCHIVE_HORIZON_DAYS ?? 90)
const N = Number(process.env.ARCHIVE_EVENTS ?? 3000)

let exit = 1
try {
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', '{"version":1,"mode":"all"}'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.diag_native_per_day', '100000'::jsonb, 'rehearsal') on conflict (key) do update set value = excluded.value`)
  const office = String((await one(`select app.operator_office() as o`)).o)
  const run = Date.now().toString(36)

  // ---- seed: a year of events, backdated on the disposable replica only
  await db.execute(`select count(*) from (select app.record_activity(p_office => ${lit(office)}::uuid, p_event_type => (array['tool.call_requested','tool.call_completed','tool.call_failed'])[1 + g % 3], p_idempotency_key => 'arc-d-${run}-' || g, p_actor_kind => 'agent', p_actor => 'research-director', p_summary => 'Looked up a sheet (' || g || ')', p_agent_slug => 'research-director', p_tool => 'drive.read', p_metadata => jsonb_build_object('capability','drive.read','step', g % 7, 'outcome','found','duration_ms', 100 + g % 900)) from generate_series(1, ${N}) g) q`)
  await db.execute(`select count(*) from (select app.record_activity(p_office => ${lit(office)}::uuid, p_event_type => 'budget.threshold_reached', p_idempotency_key => 'arc-b-${run}-' || g, p_actor_kind => 'system', p_actor => 'worker', p_summary => 'The day budget reached 80 percent (' || g || ')', p_agent_slug => 'research-director') from generate_series(1, ${Math.floor(N / 20)}) g) q`)
  await db.execute(`select count(*) from (select app.record_activity(p_office => ${lit(office)}::uuid, p_event_type => 'system.recovered', p_idempotency_key => 'arc-r-${run}-' || g, p_actor_kind => 'system', p_actor => 'worker', p_summary => 'Recovered a stalled job (' || g || ')', p_status => 'completed') from generate_series(1, ${Math.floor(N / 20)}) g) q`)
  await db.execute(`alter table public.activity_events disable trigger user;
    update public.activity_events set occurred_at = now() - (random() * 365 || ' days')::interval - interval '1 minute' where idempotency_key like 'arc-%-${run}-%';
    alter table public.activity_events enable trigger user`)
  const fingerprint = async (where = 'true') => {
    const r = await one(`select count(*) as n, coalesce(md5(string_agg(to_jsonb(a)::text, '' order by a.activity_id)), '') as h from public.activity_events a where ${where}`)
    return { n: Number(r.n), h: String(r.h) }
  }
  const mine = `a.idempotency_key like 'arc-%-${run}-%'`
  const original = await fingerprint(mine)
  const slicePredicate = `${mine} and a.occurred_at < now() - interval '${HORIZON_DAYS} days' and exists (select 1 from public.activity_event_types t where t.event_type = a.event_type and t.durability = 'diagnostic' and t.source = 'native')`
  const sliceCount = Number((await one(`select count(*) as c from public.activity_events a where ${slicePredicate}`)).c)
  const consequentialInSlice = Number((await one(`select count(*) as c from public.activity_events a join public.activity_event_types t on t.event_type = a.event_type where ${slicePredicate} and t.durability <> 'diagnostic'`)).c)
  console.log(`seeded ${original.n} events over a year; ${sliceCount} diagnostic events are older than ${HORIZON_DAYS} days`)
  check('slice: it holds diagnostic native events only (no consequential type, no outside worker, ever)', sliceCount > 0 && consequentialInSlice === 0, `${sliceCount} selected, ${consequentialInSlice} consequential`)
  const rest = await fingerprint(`${mine} and not (${slicePredicate.replace(mine + ' and ', '')})`)

  // ---- a page over the old window, to compare after the round trip
  const windowEnd = `now() - interval '${HORIZON_DAYS} days'`
  const pageBefore = json((await one(`select app.activity_read(p_office => ${lit(office)}::uuid, p_visibility => 'diagnostic', p_until => ${windowEnd}, p_limit => 200) as v`)).v).events.map((e: any) => String(e.id))

  // ---- export: gzipped JSON lines, one object per event, with a manifest
  const t0 = performance.now()
  const exported = (await db.execute(`select to_jsonb(a)::text as j from public.activity_events a where ${slicePredicate} order by a.activity_id`)).rows.map((r: any) => String(r.j))
  const body = Buffer.from(`${exported.join('\n')}\n`, 'utf8')
  const gz = gzipSync(body, { level: 9 })
  const manifest = { rows: exported.length, sha256: createHash('sha256').update(gz).digest('hex'), horizon_days: HORIZON_DAYS, columns: Object.keys(JSON.parse(exported[0]!)).length }
  const exportMs = performance.now() - t0
  const onlineBytes = Number((await one(`select coalesce(sum(pg_column_size(a.*)), 0) as b from public.activity_events a where ${slicePredicate}`)).b) + sliceCount * 28
  const indexShare = Number((await one(`select pg_indexes_size('public.activity_events') as b`)).b) / Math.max(Number((await one(`select count(*) as c from public.activity_events`)).c), 1)
  console.log(`exported ${manifest.rows} events in ${exportMs.toFixed(0)} ms: ${gz.length} bytes gzipped (${(gz.length / manifest.rows).toFixed(0)} B an event) against about ${(onlineBytes / sliceCount + indexShare).toFixed(0)} B online with its indexes`)
  check('export: the archive holds every selected row and its checksum is recorded', manifest.rows === sliceCount && manifest.sha256.length === 64, `${manifest.rows} rows, sha256 ${manifest.sha256.slice(0, 12)}`)
  check('export: the archive is at least four times smaller than the live rows with their indexes', gz.length * 4 < onlineBytes + indexShare * sliceCount, `${(gz.length / manifest.rows).toFixed(0)} B against ${((onlineBytes / sliceCount) + indexShare).toFixed(0)} B`)

  // ---- remove from the live table (disposable replica only: the product has no such path)
  await db.execute(`alter table public.activity_events disable trigger user; delete from public.activity_events a where ${slicePredicate}; alter table public.activity_events enable trigger user`)
  const afterDelete = await fingerprint(mine)
  check('removal: exactly the slice left the table and every other row is byte-identical', afterDelete.n === rest.n && afterDelete.h === rest.h, `${original.n} -> ${afterDelete.n} rows`)
  const stillReads = json((await one(`select app.activity_read(p_office => ${lit(office)}::uuid, p_visibility => 'diagnostic', p_limit => 50) as v`)).v)
  check('removal: the Activity read still answers over what is left (newest page, not partial)', Array.isArray(stillReads.events) && stillReads.events.length > 0 && stillReads.partial !== true, `${stillReads.events.length} events`)
  const consequentialLeft = Number((await one(`select count(*) as c from public.activity_events a join public.activity_event_types t on t.event_type = a.event_type where ${mine} and t.durability <> 'diagnostic'`)).c)
  check('removal: every consequential event is still there', consequentialLeft === Math.floor(N / 20) * 2, `${consequentialLeft} of ${Math.floor(N / 20) * 2}`)

  // ---- restore: verify the checksum first, then insert the rows exactly as exported
  const t1 = performance.now()
  const verified = createHash('sha256').update(gz).digest('hex') === manifest.sha256
  check('restore: the archive verifies against its manifest before anything is read from it', verified, manifest.sha256.slice(0, 12))
  const lines = gunzipSync(gz).toString('utf8').trim().split('\n')
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500).map((l) => JSON.parse(l))
    await db.execute(`insert into public.activity_events select * from jsonb_populate_recordset(null::public.activity_events, ${lit(JSON.stringify(chunk))}::jsonb)`)
  }
  const restoreMs = performance.now() - t1
  const restored = await fingerprint(mine)
  check('restore: the table is byte-identical to the original (every column of every row, ordered by id)', restored.n === original.n && restored.h === original.h, `${restored.n} rows, ${restoreMs.toFixed(0)} ms`)
  const pageAfter = json((await one(`select app.activity_read(p_office => ${lit(office)}::uuid, p_visibility => 'diagnostic', p_until => ${windowEnd}, p_limit => 200) as v`)).v).events.map((e: any) => String(e.id))
  check('restore: the Activity read over the old window returns the same events in the same order as before the archive', JSON.stringify(pageAfter) === JSON.stringify(pageBefore), `${pageAfter.length} events`)
  const replay = await one(`select app.record_activity(p_office => ${lit(office)}::uuid, p_event_type => 'tool.call_completed', p_idempotency_key => 'arc-d-${run}-1', p_actor_kind => 'agent', p_actor => 'research-director', p_summary => 'a replay') as id`)
  const dupes = Number((await one(`select count(*) as c from public.activity_events where idempotency_key = 'arc-d-${run}-1'`)).c)
  check('restore: the idempotency keys came back, so a replay of an archived event is still recognised and adds no row', dupes === 1 && replay.id !== null, `${dupes} row for the key`)

  const failed = results.filter((r) => !r).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
