// biome-ignore-all lint/suspicious/noExplicitAny: a wrapper executor and untyped catalogue rows
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * Rehearsal of the failure modes of the ledger's deployment, on the isolated replica (phase 3 P4).
 *
 *   bash scripts/isolated/activity-migration-rehearsal.sh        # builds the database (1060 only), runs this
 *
 * Starting point: a clone of the replica with 1060 applied and NOTHING else of the ledger. It proves, in order:
 *   interrupted migration   1061 with a failure at its very end, sent the way the runner sends a file (one request), leaves NONE of its
 *                           objects behind; the real file then applies; applying it, 1060 and 1062 again changes nothing and
 *                           never resets a switch somebody turned on or a row already written
 *   interrupted index build a concurrent build cancelled while it waits leaves an INVALID index (what a killed deploy leaves); the health
 *                           reading names it; the staged build drops and rebuilds only that one, and a VALID index keeps its
 *                           catalogue identity across a second run (it was not dropped and rebuilt)
 *   connection              an executor that wraps every statement in a transaction (what a pooled or API connection may do) is refused
 *                           by CREATE INDEX CONCURRENTLY with the transaction-block error; the builder reports a failure per index
 *                           and leaves nothing invalid, so a wrong connection cannot be mistaken for success
 *   default off             after every step the switch is still false and the read model answers disabled
 */
import { readdirSync, readFileSync } from 'node:fs'
import { ACTIVITY_INDEX_NAMES, ACTIVITY_INDEXES, createStatement, ensureActivityIndexes, inspectActivityIndexes } from '../../src/activity/indexes.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'ledger_rh'
const db = await isolated(dbName)
const holder = await isolated(dbName)
const builder = await isolated(dbName)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const dir = new URL('../../migrations/', import.meta.url).pathname
const file = (n: string) => readFileSync(dir + (readdirSync(dir).find((f) => f.startsWith(`${n}_`)) as string), 'utf8')
const flag = async () => String((await one(`select value::text as v from public.system_config where key = 'activity.ledger_enabled'`)).v)
const fn1061 = ['activity_read', 'activity_chain', 'activity_for_the_page', 'activity_ledger_health', 'activity_index_gaps']
const have1061 = async () => Number((await one(`select count(*) as c from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = any (${arr(fn1061)})`)).c)
function arr(a: string[]) {
  return `array[${a.map((x) => `'${x}'`).join(',')}]`
}

let exit = 1
try {
  check('start: 1060 is applied, none of 1061 exists, the switch is false', (await have1061()) === 0 && (await flag()) === 'false', `functions ${await have1061()}, switch ${await flag()}`)

  // ------------------------------------------------------------------------------------------ interrupted migration
  let failure = ''
  try {
    await db.execute(`${file('1061')}\n;\nselect 1/0;`)
  } catch (e) {
    failure = (e as Error).message
  }
  check('migration: 1061 with a failure at its end is refused', /division by zero/.test(failure), failure.slice(0, 60))
  check('migration: and leaves NONE of its objects behind (one request is one transaction)', (await have1061()) === 0, `${await have1061()} of ${fn1061.length} functions exist`)
  await db.execute(file('1061'))
  check('migration: the real 1061 then applies', (await have1061()) === fn1061.length, `${await have1061()} functions`)
  await db.execute(file('1062'))

  // switch on, write a row, then re-apply everything: nothing is reset or lost
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  const office = String((await one(`select app.operator_office() as o`)).o)
  await db.execute(`select app.record_activity(p_office => '${office}'::uuid, p_event_type => 'system.recovered', p_idempotency_key => 'rehearsal-row-1', p_actor_kind => 'system', p_actor => 'worker', p_summary => 'kept')`)
  const types0 = Number((await one(`select count(*) as c from public.activity_event_types`)).c)
  for (const n of ['1060', '1061', '1062']) await db.execute(file(n))
  const rows = Number((await one(`select count(*) as c from public.activity_events where idempotency_key = 'rehearsal-row-1'`)).c)
  const types1 = Number((await one(`select count(*) as c from public.activity_event_types`)).c)
  check('migration: applying 1060, 1061 and 1062 again is accepted and changes nothing', rows === 1 && types1 === types0 && (await have1061()) === fn1061.length, `row kept ${rows}, taxonomy ${types0} -> ${types1}`)
  check('migration: re-applying does NOT reset a switch somebody turned on', (await flag()) === 'true', `switch ${await flag()}`)
  await db.execute(`update public.system_config set value = 'false'::jsonb where key = 'activity.ledger_enabled'`)
  const off = (await one(`select app.activity_for_the_page('${office}'::uuid, 10)::text as v`)).v
  check('default off: switched off, the adapter answers disabled', JSON.parse(String(off)).enabled === false, 'enabled=false')

  // ------------------------------------------------------------------------------------------ interrupted index build
  const first = ACTIVITY_INDEXES[0] as (typeof ACTIVITY_INDEXES)[number]
  await holder.execute('begin isolation level repeatable read')
  await holder.execute('select count(*) from public.deliveries')
  const pending = builder.execute(createStatement(first)).then(() => 'completed', (e: Error) => e.message)
  let seen = false
  for (let i = 0; i < 100 && !seen; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const s = (await inspectActivityIndexes(db)).find((x) => x.name === first.name)
    seen = s?.present === true
  }
  check('interrupt: the concurrent build is under way (its index is registered, not yet valid) while an old snapshot is held', seen, seen ? 'registered' : 'never appeared')
  await db.execute(`select pg_cancel_backend(pid) from pg_stat_activity where query like 'create index concurrently%' and pid <> pg_backend_pid()`)
  const outcome = await pending
  await holder.execute('rollback')
  const left = (await inspectActivityIndexes(db)).find((x) => x.name === first.name)
  check('interrupt: a cancelled concurrent build leaves an INVALID index', /cancel/.test(outcome) && left?.present === true && left?.valid === false, `${outcome.slice(0, 50)}; present ${left?.present}, valid ${left?.valid}`)
  const gaps = (await one('select app.activity_index_gaps() as g')).g as string[]
  check('interrupt: the health reading names the invalid index as a gap', gaps.includes(first.name), `${gaps.length} gaps, includes it: ${gaps.includes(first.name)}`)
  const healed = await ensureActivityIndexes(db)
  const hf = healed.find((h) => h.name === first.name)
  check('recover: the staged build drops and rebuilds only the invalid one and builds the rest', hf?.outcome === 'rebuilt-after-invalid' && healed.filter((h) => h.outcome === 'built').length === ACTIVITY_INDEX_NAMES.length - 1, `${hf?.outcome}; others ${healed.filter((h) => h.outcome === 'built').length} built`)
  check('recover: every index is now valid and the health reading is empty', ((await one('select app.activity_index_gaps() as g')).g as string[]).length === 0 && (await inspectActivityIndexes(db)).every((s) => s.present && s.valid), 'no gaps')
  const oids = async () => JSON.stringify((await db.execute(`select c.relname, c.oid::text as o from pg_class c where c.relname = any (${arr([...ACTIVITY_INDEX_NAMES])}) order by 1`)).rows)
  const before = await oids()
  const again = await ensureActivityIndexes(db)
  check('recover: a second run is a no-op and no valid index was dropped and rebuilt (catalogue identity unchanged)', again.every((a) => a.outcome === 'already-built') && (await oids()) === before, 'identical')

  // ------------------------------------------------------------------------------------------ the wrong kind of connection
  await db.execute(`drop index concurrently if exists public.${first.name}`)
  const wrapped: any = {
    // what a pooled or API connection that opens a transaction per request does; its aborted transaction is ended by the pool, so we end it here
    execute: async (sql: string) => {
      if (!/create index concurrently/i.test(sql)) return (db as any).execute(sql)
      try {
        return await (builder as any).execute(`begin; ${sql}; commit`)
      } catch (e) {
        await (builder as any).execute('rollback').catch(() => undefined)
        throw e
      }
    },
  }
  const wrongConn = await ensureActivityIndexes(wrapped, { attempts: 1 })
  const w = wrongConn.find((x) => x.name === first.name)
  check('connection: CREATE INDEX CONCURRENTLY inside a transaction block is refused and reported as a failure, not as success', String(w?.outcome).startsWith('failed') && /transaction block/.test(String(w?.outcome)), String(w?.outcome).slice(0, 90))
  const afterWrong = await inspectActivityIndexes(db)
  check('connection: the refused attempt leaves no invalid index behind', afterWrong.every((s) => !s.present || s.valid), `${afterWrong.filter((s) => s.present && !s.valid).length} invalid`)
  await db.execute('rollback').catch(() => undefined)
  const repaired = await ensureActivityIndexes(db)
  check('connection: the correct connection then builds the missing one', repaired.find((x) => x.name === first.name)?.outcome === 'built', String(repaired.find((x) => x.name === first.name)?.outcome))
  check('default off: still false at the end', (await flag()) === 'false', `switch ${await flag()}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await holder.execute('rollback').catch(() => undefined)
  await holder.end().catch(() => undefined)
  await builder.end().catch(() => undefined)
  await db.end()
}
process.exit(exit)
