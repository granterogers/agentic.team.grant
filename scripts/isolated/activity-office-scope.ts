// biome-ignore-all lint/suspicious/noExplicitAny: untyped rows
// biome-ignore-all format: dense proof script kept readable as written
/**
 * The ledger's activation state machine, FAIL CLOSED, on the isolated replica (phase 5).
 *
 *   npx tsx scripts/isolated/activity-office-scope.ts <replica-db>
 *
 * Effective result for an office = master switch (activity.ledger_enabled is JSON true) AND the office is covered by activity.ledger_offices:
 * an array containing its id, or exactly {"version":1,"mode":"all"}. A missing row, null, [], or anything else covers NO office.
 *
 *   matrix        every combination of master (true, false, a string, a number, null, missing) and allowlist (absent, null, [], a valid
 *                 list, junk entries, duplicates, an upper-case id, explicit all in either key order, all with another version or an
 *                 extra key or another mode, the bare string "all", numbers, booleans, objects, arrays of non-strings, a string that
 *                 holds an array), for an authorised and an unauthorised office, against the SAME decision enforced everywhere: the
 *                 decision function, all three writers (strict, safe, external), the read, the chain, the Team HQ adapter and the health reading
 *   no broadening a missing or malformed setting never covers an office that a valid list does not
 *   operator      the planner's statements, applied to a real database: every prefix of every plan covers no office outside the offices
 *                 covered before or after it (an interruption cannot broaden), and two plans made from the same state cannot both apply
 *                 (the compare-and-swap guard), the loser writing nothing
 *   audit         switching off or narrowing deletes nothing already recorded
 */

import { ALL_OFFICES_VALUE, applyPlan, CONFIRM_ALL_PHRASE, planSwitch, readStored, type SwitchPlan, type SwitchRequest } from '../../src/activity/switch.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'
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
const sock = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
const port = process.env.ISOLATED_PG_PORT ?? '55432'

const setMaster = async (v: unknown | undefined) => {
  await db.execute(`delete from public.system_config where key = 'activity.ledger_enabled'`)
  if (v !== undefined) await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_enabled', ${lit(JSON.stringify(v))}::jsonb, 'proof proof')`)
}
const setList = async (v: unknown | undefined) => {
  await db.execute(`delete from public.system_config where key = 'activity.ledger_offices'`)
  if (v !== undefined) await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', ${lit(JSON.stringify(v))}::jsonb, 'proof proof')`)
}

let exit = 1
const extra: PgExecutor[] = []
try {
  const mk = async (name: string, tag: string) => {
    const email = `scope-${tag}-${run}@example.invalid`
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
    return String(json((await one(`select app.provision_person_office(${lit(name)}, ${lit(email)}, ${lit(`s${tag}-${run}`)}) as r`)).r).office_id)
  }
  const A = await mk('Scope A', 'a')
  const B = await mk('Scope B', 'b')
  let n = 0
  const strict = async (o: string) => (await one(`select app.record_activity(${lit(o)}::uuid, 'budget.threshold_reached', ${lit(`strict-${run}-${n++}`)}, 'system', 'office', 'recovered') as v`)).v
  const safe = async (o: string) => (await one(`select app.record_activity_safely(${lit(o)}::uuid, 'budget.threshold_reached', ${lit(`safe-${run}-${n++}`)}, 'system', 'office', 'held back') as v`)).v
  const ext = async (o: string) => (await one(`select app.record_external_activity(${lit(o)}::uuid, 'hermes', 'external.research_completed', ${lit(`ext-${run}-${n++}`)}, 'used') as v`)).v
  const read = async (o: string) => json((await one(`select app.activity_read(p_office => ${lit(o)}::uuid, p_visibility => 'operator') as v`)).v)
  const page = async (o: string) => json((await one(`select app.activity_for_the_page(${lit(o)}::uuid, 10) as v`)).v)
  const chain = async (o: string) => json((await one(`select app.activity_chain(${lit(o)}::uuid, p_correlation => gen_random_uuid()) as v`)).v)
  const health = async (o: string) => json((await one(`select app.activity_ledger_health(${lit(o)}::uuid) as v`)).v)
  const rows = async (o: string) => Number((await one(`select count(*) as c from public.activity_events where office_id = ${lit(o)}::uuid`)).c)
  const covers = async (o: string) => (await one(`select app.activity_ledger_covers(${lit(o)}::uuid) as v`)).v === true

  // what the contract says, computed independently of the SQL (the oracle)
  const expected = (master: unknown | undefined, list: unknown | undefined, office: string): boolean => {
    if (master !== true) return false
    if (Array.isArray(list)) return list.includes(office)
    if (list !== null && typeof list === 'object') {
      const o = list as Record<string, unknown>
      return Object.keys(o).length === 2 && o.version === 1 && o.mode === 'all'
    }
    return false
  }
  const masters: [string, unknown | undefined][] = [['true', true], ['false', false], ['the string "true"', 'true'], ['the number 1', 1], ['null', null], ['missing row', undefined]]
  const lists: [string, (a: string, b: string) => unknown | undefined][] = [
    ['absent', () => undefined], ['null', () => null], ['empty array', () => []], ['[A]', (a) => [a]], ['[B]', (_a, b) => [b]], ['[A, B]', (a, b) => [a, b]],
    ['[A, junk entries]', (a) => [a, 7, null, 'not-a-uuid', { x: 1 }, true]], ['[A, A, A] duplicates', (a) => [a, a, a]], ['upper-case id', (a) => [a.toUpperCase().replace(/[0-9a-f]/g, (c) => c.toUpperCase())]],
    ['explicit all', () => ({ version: 1, mode: 'all' })], ['explicit all, keys reordered', () => ({ mode: 'all', version: 1 })],
    ['all, version 2', () => ({ version: 2, mode: 'all' })], ['all, version "1"', () => ({ version: '1', mode: 'all' })], ['all, extra key', () => ({ version: 1, mode: 'all', also: true })],
    ['all, no version', () => ({ mode: 'all' })], ['mode "most"', () => ({ version: 1, mode: 'most' })], ['empty object', () => ({})], ['object naming A', (a) => ({ [a]: true })],
    ['bare string "all"', () => 'all'], ['string holding an array', (a) => JSON.stringify([a])], ['number 1', () => 1], ['boolean true', () => true], ['[true]', () => [true]], ['nested [[A]]', (a) => [[a]]],
  ]

  // ---------------------------------------------------------------------------------------------- the matrix, at every surface
  let combos = 0
  const wrong: string[] = []
  const leaks: string[] = []
  for (const [mName, m] of masters) {
    for (const [lName, mkList] of lists) {
      const list = mkList(A, B)
      await setMaster(m)
      await setList(list)
      combos++
      for (const [who, office] of [['A', A], ['B', B]] as const) {
        const want = expected(m, list, office)
        const before = await rows(office)
        const c = await covers(office)
        const w = [await strict(office), await safe(office), await ext(office)]
        const r = await read(office)
        const p = await page(office)
        const ch = await chain(office)
        const h = await health(office)
        const wrote = (await rows(office)) - before
        const surfaces = { covers: c, strict: w[0] !== null, safe: w[1] !== null, ext: w[2] !== null, read: r.enabled === true, page: p.enabled === true, chain: ch.enabled === true, health: h.enabled === true }
        const bad = Object.entries(surfaces).filter(([, v]) => v !== want).map(([k]) => k)
        if (bad.length > 0 || wrote !== (want ? 3 : 0)) wrong.push(`master ${mName} / ${lName} / office ${who}: want ${want}, wrong on ${bad.join(',') || 'row count'} (wrote ${wrote})`)
        if (!want && (wrote > 0 || (r.events as any[]).length > 0 || (p.office as any[]).length > 0)) leaks.push(`master ${mName} / ${lName} / office ${who}`)
      }
    }
  }
  check(`matrix: ${combos} settings combinations, an authorised and an unauthorised office each, the SAME decision at the function, all three writers, read, chain, Team HQ adapter and health`, wrong.length === 0, wrong.length ? `${wrong.length} wrong, first: ${wrong[0]}` : `${combos * 2} decisions agree with the contract at ${8} surfaces`)
  check('matrix: an office that is not covered never wrote a row, read an event or drew an adapter row', leaks.length === 0, leaks.length ? `LEAK ${leaks[0]}` : 'none')

  // the positive controls the matrix needs: it must be able to say yes
  await setMaster(true)
  await setList([A])
  check('positive: master on and A listed covers A', (await covers(A)) && !(await covers(B)), 'A on, B off')
  await setList(ALL_OFFICES_VALUE)
  check('positive: explicit global mode covers both', (await covers(A)) && (await covers(B)), 'A on, B on')

  // ---------------------------------------------------------------------------------------------- no broadening, stated as a property
  const broadened: string[] = []
  for (const [lName, mkList] of lists) {
    await setMaster(true)
    await setList(mkList(A, B))
    const got = [await covers(A), await covers(B)]
    await setList([A])
    const baseline = [await covers(A), await covers(B)]
    // an arbitrary setting may cover an office only if it is a valid list naming it or the explicit global mode
    if (got[1] && !expected(true, mkList(A, B), B)) broadened.push(lName)
    void baseline
  }
  check('no broadening: no missing, null, empty, malformed or unrecognised setting covers an office that a valid list or the explicit global mode would not', broadened.length === 0, broadened.join(', ') || `${lists.length} settings checked`)
  await setMaster(true)
  await setList(undefined)
  check('no broadening: DELETING the allowlist row with the master on covers no office (the old fail-open)', !(await covers(A)) && !(await covers(B)) && (await health(A)).scope === 'none', `scope ${(await health(A)).scope}`)

  // ---------------------------------------------------------------------------------------------- health reports what is true
  const scopes: [string, unknown | undefined, string][] = [['absent', undefined, 'none'], ['null', null, 'none'], ['empty', [], 'none'], ['a list', [A], 'allowlist'], ['explicit all', ALL_OFFICES_VALUE, 'all_offices'], ['bare "all"', 'all', 'invalid'], ['all v2', { version: 2, mode: 'all' }, 'invalid']]
  const scopeBad: string[] = []
  for (const [name, v, want] of scopes) { await setMaster(true); await setList(v); const got = (await health(A)).scope; if (got !== want) scopeBad.push(`${name}: ${got}`) }
  check('health: the scope reading says none / allowlist / all_offices / invalid exactly where the decision does', scopeBad.length === 0, scopeBad.join('; ') || 'seven settings')

  // ---------------------------------------------------------------------------------------------- the operator: every prefix of every plan
  const conns: PgExecutor[] = []
  for (let i = 0; i < 2; i++) { const c = new PgExecutor(`postgresql://postgres@/${dbName}?host=${sock}&port=${port}`); await c.connect(); conns.push(c); extra.push(c) }
  const coveredNow = async () => [(await covers(A)) ? A : '', (await covers(B)) ? B : ''].filter((x) => x !== '')
  const prefixes = async (label: string, from: { master: unknown | undefined; list: unknown | undefined }, req: SwitchRequest) => {
    await setMaster(from.master); await setList(from.list)
    const start = await coveredNow()
    const state = await readStored(db)
    const plan = planSwitch(req, state)
    if (!plan.ok) return `${label}: refused (${plan.refusal.slice(0, 50)})`
    const seen: string[][] = [start]
    for (const s of plan.statements) {
      const r = await db.execute(s.sql)
      if (r.rows.length !== 1) return `${label}: statement did not apply`
      seen.push(await coveredNow())
    }
    const end = await coveredNow()
    const allowed = new Set([...start, ...end])
    const out = seen.flat().filter((o) => !allowed.has(o))
    return out.length === 0 ? '' : `${label}: an interruption would cover ${out.join(',')} outside the start and the end`
  }
  const problems: string[] = []
  const transitions: [string, { master: unknown | undefined; list: unknown | undefined }, SwitchRequest][] = [
    ['canary from off', { master: false, list: undefined }, { kind: 'canary', offices: [A] }],
    ['canary from a missing master', { master: undefined, list: undefined }, { kind: 'canary', offices: [A] }],
    ['canary from every office', { master: true, list: ALL_OFFICES_VALUE }, { kind: 'canary', offices: [A] }],
    ['canary from an invalid list', { master: true, list: 'all' }, { kind: 'canary', offices: [A] }],
    ['canary replacing B with A', { master: true, list: [B] }, { kind: 'canary', offices: [A] }],
    ['all from a canary, master off', { master: false, list: [A] }, { kind: 'all', confirm: CONFIRM_ALL_PHRASE }],
    ['all from nothing', { master: false, list: undefined }, { kind: 'all', confirm: CONFIRM_ALL_PHRASE }],
    ['add B', { master: true, list: [A] }, { kind: 'add', offices: [B] }],
    ['remove A', { master: true, list: [A, B] }, { kind: 'remove', offices: [A] }],
    ['off from every office', { master: true, list: ALL_OFFICES_VALUE }, { kind: 'off' }],
  ]
  for (const [label, from, req] of transitions) { const p = await prefixes(label, from, req); if (p !== '') problems.push(p) }
  check(`operator: after EVERY statement of ${transitions.length} plans the ledger covers no office outside the offices covered before or after (an interruption cannot broaden)`, problems.length === 0, problems[0] ?? `${transitions.length} plans, every prefix checked`)

  // two plans from one state: the second to apply must write nothing
  await setMaster(false); await setList(undefined)
  const s0 = await readStored(db)
  const planA = planSwitch({ kind: 'canary', offices: [A] }, s0) as Extract<SwitchPlan, { ok: true }>
  const planB = planSwitch({ kind: 'canary', offices: [B] }, s0) as Extract<SwitchPlan, { ok: true }>
  const [ra, rb] = [await applyPlan(conns[0] as PgExecutor, planA), await applyPlan(conns[1] as PgExecutor, planB)]
  check('operator: two plans made from the same state cannot both apply; the loser stops at its first statement and writes nothing', ra.stoppedAt === null && rb.stoppedAt === 0 && rb.applied === 0, `${ra.detail}; ${rb.detail.slice(0, 70)}`)
  check('operator: the winner\'s canary stands exactly (A on, B off)', (await covers(A)) && !(await covers(B)), 'A on, B off')
  // a change between the plan and the apply: the master was turned off by somebody else after the plan was read
  await setMaster(false); await setList([A])
  const s1 = await readStored(db)
  const planAll = planSwitch({ kind: 'all', confirm: CONFIRM_ALL_PHRASE }, s1) as Extract<SwitchPlan, { ok: true }>
  await db.execute(`update public.system_config set value = '[]'::jsonb where key = 'activity.ledger_offices'`)
  const rAll = await applyPlan(db as unknown as PgExecutor, planAll)
  check('operator: a setting changed after the plan was read stops the apply and nothing is broadened', rAll.stoppedAt === 0 && !(await covers(A)) && !(await covers(B)), rAll.detail.slice(0, 80))
  // idempotent re-apply
  await setMaster(false); await setList(undefined)
  const sc = await readStored(db)
  const pc = planSwitch({ kind: 'canary', offices: [A] }, sc) as Extract<SwitchPlan, { ok: true }>
  await applyPlan(db as unknown as PgExecutor, pc)
  const again = planSwitch({ kind: 'canary', offices: [A] }, await readStored(db)) as Extract<SwitchPlan, { ok: true }>
  check('operator: repeating a canary plans nothing and changes nothing (idempotent)', again.noop && (await covers(A)) && !(await covers(B)), `${again.statements.length} statements`)
  // rollback
  const off = planSwitch({ kind: 'off' }, await readStored(db)) as Extract<SwitchPlan, { ok: true }>
  await applyPlan(db as unknown as PgExecutor, off)
  check('operator: --off turns every office off and leaves the allowlist as it was (rollback is the master only)', !(await covers(A)) && (await readStored(db)).allowlist.kind === 'offices', 'A off, list kept')

  // ---------------------------------------------------------------------------------------------- audit
  await setMaster(true); await setList([A, B])
  await strict(A); await strict(B)
  const aRows = await rows(A)
  const bRows = await rows(B)
  await setList([A])
  await setMaster(false)
  check('audit: narrowing and switching off delete nothing already recorded, and reads answer disabled rather than empty', (await rows(A)) === aRows && (await rows(B)) === bRows && (await read(A)).enabled === false, `A ${aRows}, B ${bRows} kept`)
  await setMaster(true); await setList([A, B])
  const inA = ((await read(A)).events as any[]).map((e) => e.id)
  const inB = ((await read(B)).events as any[]).map((e) => e.id)
  check('isolation: with both offices covered neither sees the other\'s events (positive: each sees its own)', inA.length > 0 && inB.length > 0 && inA.every((i: string) => !inB.includes(i)), `A ${inA.length}, B ${inB.length}`)
  check('compat: the zero-argument form still means the master switch alone', (await one(`select app.activity_ledger_on() as v`)).v === true, 'master true')
  await setMaster(false); await setList(undefined)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  for (const c of extra) await c.end().catch(() => undefined)
  await db.end()
}
process.exit(exit)
