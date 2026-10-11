// biome-ignore-all lint/suspicious/noExplicitAny: untyped rows
// biome-ignore-all format: dense proof script kept readable as written
/**
 * Per-office activation of the ledger (a canary), phase 4 P3. The master switch stays the kill switch.
 *
 *   npx tsx scripts/isolated/activity-office-scope.ts <replica-db>
 *
 * activity_ledger_on(office) is the master switch AND an office test that reads one optional allowlist
 * (system_config activity.ledger_offices). It can only NARROW the master switch. Proved here, each beside a positive control:
 *   precedence   the master switch off silences every office, listed or not, and an allowlist can never turn anything ON by itself
 *   scope        no allowlist row = every office; an array = the offices in it; empty, malformed or oddly typed = no office (fails closed)
 *   enforcement  a covered office writes, reads and chains; an uncovered one gets null writes, "disabled" reads and writes NOTHING,
 *                through all three writers (strict, safe, external) and all three readers (read, chain, page)
 *   immediacy    a change is in force for the next call (nothing is cached), in both directions
 *   audit        switching an office off, or the master off, deletes nothing it already recorded
 *   isolation    one office's events are never visible to the other, covered or not
 */
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'ledger'
const db = await isolated(dbName)
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const master = (on: boolean) => db.execute(`delete from public.system_config where key = 'activity.ledger_enabled'; insert into public.system_config (key, value, description) values ('activity.ledger_enabled', '${on}'::jsonb, 'proof')`)
const allow = async (value: string | null) => {
  await db.execute(`delete from public.system_config where key = 'activity.ledger_offices'`)
  if (value !== null) await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', ${lit(value)}::jsonb, 'proof')`)
}

let exit = 1
try {
  const mk = async (name: string, tag: string) => {
    const email = `scope-${tag}-${run}@example.invalid`
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
    return String(json((await one(`select app.provision_person_office(${lit(name)}, ${lit(email)}, ${lit(`s${tag}-${run}`)}) as r`)).r).office_id)
  }
  const A = await mk('Scope A', 'a')
  const B = await mk('Scope B', 'b')
  let n = 0
  const strict = async (o: string) => (await one(`select app.record_activity(${lit(o)}::uuid, 'budget.threshold_reached',${lit(`strict-${run}-${n++}`)}, 'system', 'worker', 'recovered') as v`)).v
  const safe = async (o: string) => (await one(`select app.record_activity_safely(${lit(o)}::uuid, 'budget.threshold_reached', ${lit(`safe-${run}-${n++}`)}, 'system', 'office', 'held back') as v`)).v
  const ext = async (o: string) => (await one(`select app.record_external_activity(${lit(o)}::uuid, 'hermes', 'external.research_completed',${lit(`ext-${run}-${n++}`)}, 'used') as v`)).v
  const read = async (o: string) => json((await one(`select app.activity_read(p_office => ${lit(o)}::uuid, p_visibility => 'operator') as v`)).v)
  const page = async (o: string) => json((await one(`select app.activity_for_the_page(${lit(o)}::uuid, 10) as v`)).v)
  const rows = async (o: string) => Number((await one(`select count(*) as c from public.activity_events where office_id = ${lit(o)}::uuid`)).c)
  const on = async (o: string) => (await one(`select app.activity_ledger_on(${lit(o)}::uuid) as v`)).v === true
  const allThree = async (o: string) => ({ s: await strict(o), f: await safe(o), e: await ext(o) })

  // ---------------------------------------------------------------------------------------------- precedence
  await master(false)
  await allow(JSON.stringify([A, B]))
  check('precedence: the master switch OFF silences every office even when both are listed', !(await on(A)) && !(await on(B)), 'both off')
  const offAll = await allThree(A)
  check('precedence: and its writers return null and store nothing', offAll.s === null && offAll.f === null && offAll.e === null && (await rows(A)) === 0, `rows ${await rows(A)}`)
  await master(true)
  await allow(JSON.stringify([]))
  check('precedence: an allowlist cannot turn anything ON by itself (empty list, master on: nobody)', !(await on(A)) && !(await on(B)), 'both off')

  // ---------------------------------------------------------------------------------------------- scope
  await allow(null)
  check('scope: no allowlist row means every office (the deployment-wide behaviour), with the master on', (await on(A)) && (await on(B)), 'both on')
  const hb0 = json((await one(`select app.activity_ledger_health(${lit(A)}::uuid) as v`)).v)
  check('scope: the health reading says the scope is all offices', hb0.scope === 'all_offices' && hb0.master_on === true && hb0.enabled === true, JSON.stringify({ scope: hb0.scope, master: hb0.master_on, enabled: hb0.enabled }))
  await allow(JSON.stringify([A]))
  check('scope: an array turns it on for the offices in it only', (await on(A)) && !(await on(B)), 'A on, B off')
  const hb1 = json((await one(`select app.activity_ledger_health(${lit(B)}::uuid) as v`)).v)
  check('scope: the health reading for an uncovered office says allowlist, master on, enabled false', hb1.scope === 'allowlist' && hb1.master_on === true && hb1.enabled === false, JSON.stringify({ scope: hb1.scope, master: hb1.master_on, enabled: hb1.enabled }))
  await allow(JSON.stringify([A, 'not-an-office', 7, null, { x: 1 }]))
  check('scope: junk entries in the list are ignored, a listed office is still covered', (await on(A)) && !(await on(B)), 'A on, B off')
  for (const [label, v] of [['a bare string naming the office', JSON.stringify(A)], ['an object', JSON.stringify({ [A]: true })], ['null', 'null'], ['a number', '1'], ['true', 'true'], ['an empty array', '[]']] as const) {
    await allow(v)
    check(`scope: ${label} is not a usable allowlist and turns it on for NO office`, !(await on(A)) && !(await on(B)), 'both off')
  }

  // ---------------------------------------------------------------------------------------------- enforcement
  await allow(JSON.stringify([A]))
  const bBefore = await rows(B)
  const covered = await allThree(A)
  check('enforcement: a covered office writes through the strict, safe and external writers', typeof covered.s === 'string' && typeof covered.f === 'string' && typeof covered.e === 'string', 'three ids')
  const uncovered = await allThree(B)
  check('enforcement: an uncovered office gets null from all three writers and nothing is stored (not even a failure counter)', uncovered.s === null && uncovered.f === null && uncovered.e === null && (await rows(B)) === bBefore, `rows ${bBefore} -> ${await rows(B)}`)
  const failures = Number((await one(`select count(*) as c from public.activity_write_failures where office_id = ${lit(B)}::uuid`)).c)
  check('enforcement: an uncovered office has no write-failure rows either', failures === 0, `${failures} rows`)
  const readA = await read(A)
  const readB = await read(B)
  check('enforcement: the read answers enabled with rows for a covered office and "disabled" with none for an uncovered one', readA.enabled === true && (readA.events as any[]).length >= 3 && readB.enabled === false && (readB.events as any[]).length === 0, `A ${readA.events.length} events, B enabled=${readB.enabled}`)
  const pageA = await page(A)
  const pageB = await page(B)
  check('enforcement: the Team HQ adapter answers the same way', pageA.enabled === true && pageA.office.length >= 3 && pageB.enabled === false && pageB.office.length === 0, `A ${pageA.office.length} rows, B enabled=${pageB.enabled}`)
  const ev = (readA.events as any[])[0]
  const chainB = json((await one(`select app.activity_chain(${lit(B)}::uuid, p_correlation => ${lit(String(ev.correlation_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid) as v`).catch(() => ({ v: { enabled: false } }))).v ?? { enabled: false })
  check('enforcement: the chain reader is disabled for an uncovered office', chainB.enabled === false, JSON.stringify(chainB).slice(0, 60))

  // ---------------------------------------------------------------------------------------------- immediacy, in both directions
  await allow(JSON.stringify([A, B]))
  const nowOn = await strict(B)
  check('immediacy: listing an office puts it in force for the very next call', typeof nowOn === 'string', 'next write stored')
  await allow(JSON.stringify([A]))
  const nowOff = await strict(B)
  check('immediacy: removing it takes it out of force for the very next call', nowOff === null, 'next write refused')

  // ---------------------------------------------------------------------------------------------- audit and isolation
  const aRows = await rows(A)
  const bRows = await rows(B)
  await master(false)
  check('audit: the master switch off deletes nothing already recorded', (await rows(A)) === aRows && (await rows(B)) === bRows, `A ${aRows}, B ${bRows} rows kept`)
  check('audit: and reads are disabled, not emptied', (await read(A)).enabled === false && (await page(A)).enabled === false, 'both disabled')
  await master(true)
  await allow(JSON.stringify([A, B]))
  const inB = ((await read(B)).events as any[]).map((e) => e.id)
  const inA = ((await read(A)).events as any[]).map((e) => e.id)
  check('isolation: neither office sees the other\'s events, covered or not (positive: each sees its own)', inA.length > 0 && inB.length > 0 && inA.every((i: string) => !inB.includes(i)), `A ${inA.length}, B ${inB.length}, shared ${inA.filter((i: string) => inB.includes(i)).length}`)
  const zero = (await one(`select app.activity_ledger_on() as v`)).v
  check('compat: the zero-argument form still means the master switch alone (old callers)', zero === true, `master ${zero}`)
  await allow(null)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
