/**
 * END TO END, LOCAL: scheduled duties and the daily budget, driven with TWO real person offices (E3, areas 5 and 6).
 *
 *   npx tsx scripts/isolated/e2e-duties-budget.ts <replica-db>
 *
 * Runs against a CLONE of the replica (it commits; the caller drops the clone). Nothing spends a model call.
 *
 * Duties: the dispatcher is the real `app.dispatch_due_responsibilities`. Proven here: a duty is fired once per period
 * and stamped with ITS OWN office; a second person's duties never fire for the first and vice versa; a disabled office
 * fires nothing; the pause switch plus its allow-list hold and release duties; an anchored duty (a morning briefing) fires
 * once a day and not twice; the system office keeps the system duties. And the thing that is NOT there: a person office
 * made by `app.provision_person_office` or `app.self_provision_office` has no duties at all (reported, asserted so the
 * finding is a check and not a sentence).
 *
 * Budget: `app.spent_today`, `app.over_budget`, `app.defer_over_budget` with two offices. Proven: spend is counted for one
 * office only and a null office is refused; the office ceiling and the per-agent ceiling each bind; over-budget BACKGROUND
 * work of the office that spent is held to tomorrow with the reason written on the job and no other office's work moves;
 * a person's own turns (`office.instruction`, `office.pursue`) are never parked; harness work neither counts nor is held;
 * free-model work (zero pence) never reaches a ceiling; held work stays held on a second pass.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'e3_duties')
const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const one = async (sql: string): Promise<Row> => (await q(sql))[0] as Row
const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>
let failed = 0
let total = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

let exit = 1
try {
  const person = async (tag: string, timezone: string): Promise<{ office: string; key: string }> => {
    const email = `e3duty.${tag}.${run}@example.com`
    const key = `e3duty-${tag}-${run}`
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
    const r = json(
      (await one(`select app.provision_person_office(${lit(`E3 ${tag}`)}, ${lit(email)}, ${lit(key)}) as r`)).r,
    )
    await db.execute(`update public.offices set timezone = ${lit(timezone)} where office_id = ${lit(String(r.office_id))}::uuid`)
    return { office: String(r.office_id), key }
  }
  const op = String((await one('select app.operator_office()::text as o')).o)
  const sys = String((await one(`select office_id::text as o from public.offices where kind = 'system'`)).o)
  const B = await person('b', 'Pacific/Auckland')
  const C = await person('c', 'Europe/London')

  // ---- 1. a new person has no duties (the finding), then the product's own duty row shape is copied to drive the dispatcher
  const own = await q(`select count(*)::int n from public.responsibilities where office_id in (${lit(B.office)}::uuid, ${lit(C.office)}::uuid)`)
  check(
    'FINDING (asserted): a person office made by app.provision_person_office holds NO scheduled duties - no briefing, reminders, drive watch, notion sync or calendar refresh',
    Number(own[0]?.n) === 0,
    `${String(own[0]?.n)} duties`,
  )
  const selfOffice = await q(`select pg_get_functiondef('app.self_provision_office(uuid,text,text)'::regprocedure) as d`)
  check(
    'FINDING (asserted): self_provision_office (the stranger sign-up path) does not seed duties either',
    !/responsibilit/i.test(String(selfOffice[0]?.d)),
  )
  const operatorDuties = Number((await one(`select count(*)::int n from public.responsibilities where office_id = ${lit(op)}::uuid`)).n)
  const systemDuties = Number((await one(`select count(*)::int n from public.responsibilities where office_id = ${lit(sys)}::uuid`)).n)
  check('the operator office holds its duties and the system office its own', operatorDuties >= 10 && systemDuties >= 5, `operator ${String(operatorDuties)}, system ${String(systemDuties)}`)
  const personKinds = (await q(`select distinct job_kind from public.responsibilities where office_id = ${lit(op)}::uuid and enabled`)).map((r) => String(r.job_kind))
  const systemKinds = (await q(`select distinct job_kind from public.responsibilities where office_id = ${lit(sys)}::uuid`)).map((r) => String(r.job_kind))
  check('person duties and system duties are different kinds (no system kind is a person duty)', personKinds.every((k) => !systemKinds.includes(k)), `${personKinds.length} person kinds / ${systemKinds.length} system kinds`)

  // the shape a seeding step would have to copy, applied by hand only so the dispatcher can be driven across offices
  const seed = async (office: string, onlyKinds: string[]): Promise<void> => {
    await db.execute(
      `insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, at_time, timezone, pinned_config, recipient_agent, created_by, office_id, enabled)
       select r.slug, r.staff_id, r.description, r.job_kind, r.period_minutes, r.at_time, r.timezone, r.pinned_config, r.recipient_agent, 'e3 copy', ${lit(office)}::uuid, true
         from public.responsibilities r where r.office_id = ${lit(op)}::uuid and r.job_kind = any(${`array[${onlyKinds.map(lit).join(',')}]`}::text[])`,
    )
  }
  await seed(B.office, ['tasks.remind', 'briefing.morning'])
  await seed(C.office, ['tasks.remind', 'briefing.morning'])
  // quiet the operator's own duties so the counts below are about the two copies
  await db.execute(`update public.responsibilities set last_run_at = now() where office_id in (${lit(op)}::uuid, ${lit(sys)}::uuid)`)
  const due = await q(`select * from app.due_responsibilities()`)
  const dueKinds = due.map((d) => String(d.slug))
  check('only the two copies are due (one tasks.remind and one briefing per person office), nothing of the operator\'s or the system\'s', dueKinds.length === 4 && dueKinds.filter((s) => s === 'task-reminders').length === 2 && dueKinds.filter((s) => s === 'morning-briefing').length === 2, JSON.stringify(dueKinds))
  const fired = await q(`select * from app.dispatch_due_responsibilities()`)
  const jobs = await q(`select j.office_id::text o, j.kind, j.requested_by from public.jobs j where j.requested_by like 'duty:%' and j.office_id in (${lit(B.office)}::uuid, ${lit(C.office)}::uuid) order by 2`)
  check('each fired duty job is stamped with the office whose duty it was (never the other, never Grant)', jobs.length >= 2 && jobs.every((j) => j.o === B.office || j.o === C.office) && jobs.filter((j) => j.kind === 'tasks.remind' && j.o === B.office).length === 1 && jobs.filter((j) => j.kind === 'tasks.remind' && j.o === C.office).length === 1, JSON.stringify(jobs.map((j) => `${String(j.kind)}@${j.o === B.office ? 'B' : 'C'}`)))
  check('the operator and system offices got no job from the two copies', Number((await one(`select count(*)::int n from public.jobs where requested_by like 'duty:%' and office_id in (${lit(op)}::uuid, ${lit(sys)}::uuid) and created_at > now() - interval '1 minute'`)).n) === 0)
  const again = await q(`select * from app.dispatch_due_responsibilities()`)
  check('a second dispatch in the same period fires nothing (once per period)', again.filter((r) => r.outcome === 'fired').length === 0, `fired ${String(fired.length)} then ${String(again.length)} rows`)
  const stamped = await q(`select office_id::text o, count(*)::int n from public.jobs where requested_by like 'duty:%' and office_id in (${lit(B.office)}::uuid, ${lit(C.office)}::uuid) group by 1`)
  console.log(`INFO duty jobs per office: ${JSON.stringify(stamped.map((s) => [s.o === B.office ? 'B' : 'C', s.n]))}`)
  const brief = await q(`select j.office_id::text o, j.idempotency_key from public.jobs j where j.kind = 'briefing.morning' and j.office_id in (${lit(B.office)}::uuid, ${lit(C.office)}::uuid)`)
  console.log(`INFO morning briefing fired now for: ${JSON.stringify(brief.map((b) => [b.o === B.office ? 'B(Auckland)' : 'C(London)', b.idempotency_key]))}`)
  check('an anchored duty keys on the office\'s LOCAL date (the idempotency key carries a calendar date, not a window number)', brief.every((b) => /:\d{4}-\d{2}-\d{2}$/.test(String(b.idempotency_key))), JSON.stringify(brief.map((b) => b.idempotency_key)))
  check('the clone\'s announce flag on a duty job is true by construction (the dispatcher writes announce = true) - what may be SAID is decided downstream', (await q(`select announce from public.jobs where requested_by like 'duty:%' and office_id = ${lit(B.office)}::uuid`)).every((r) => r.announce === true))

  // ---- 2. disabled office; pause + allow-list --------------------------------------------------------------------
  await db.execute(`update public.responsibilities set last_run_at = null where office_id in (${lit(B.office)}::uuid, ${lit(C.office)}::uuid)`)
  await db.execute(`update public.offices set state = 'disabled', disabled_at = now() where office_id = ${lit(C.office)}::uuid`)
  const dueOff = (await q(`select r.office_id::text o from app.due_responsibilities() d join public.responsibilities r on r.responsibility_id = d.responsibility_id`)).map((r) => r.o)
  check('a DISABLED office\'s duties are not due (control: the active one still is)', !dueOff.includes(C.office) && dueOff.includes(B.office), `${dueOff.length} due`)
  await db.execute(`update public.offices set state = 'active', disabled_at = null where office_id = ${lit(C.office)}::uuid`)
  await db.execute(`insert into public.system_config (key, value, description) values ('duties.paused', 'true'::jsonb, 'e3 proof') on conflict (key) do update set value = excluded.value`)
  const dueP = await q(`select slug from app.due_responsibilities()`)
  check('duties.paused holds every duty', dueP.length === 0, `${dueP.length} due`)
  await db.execute(`insert into public.system_config (key, value, description) values ('duties.allow', '["task-reminders"]'::jsonb, 'e3 proof') on conflict (key) do update set value = excluded.value`)
  const dueA = (await q(`select slug from app.due_responsibilities()`)).map((r) => r.slug)
  check('duties.allow releases ONLY the named duty (for each office that holds it)', dueA.length >= 1 && dueA.every((s) => s === 'task-reminders'), JSON.stringify(dueA))
  await db.execute(`delete from public.system_config where key in ('duties.paused','duties.allow')`)

  // ---- 3. budget: spend, ceilings, deferral ---------------------------------------------------------------------------------
  const agent = 'finance-director'
  const other = 'research-director'
  const spend = async (office: string, who: string, pence: number, requestedBy = `duty:e3-${run}`, kind = 'office.chores'): Promise<void> => {
    await db.execute(
      `insert into public.jobs (office_id, correlation_id, idempotency_key, kind, requested_by, recipient_agent, state, trace_pence, started_at, finished_at)
       values (${lit(office)}::uuid, gen_random_uuid(), ${lit(`spend-${run}-${Math.random()}`)}, ${lit(kind)}, ${lit(requestedBy)}, ${lit(who)}, 'complete', ${String(pence)}, now(), now())`,
    )
  }
  const queued = async (office: string, who: string | null, kind: string, requestedBy = 'duty:e3'): Promise<string> =>
    String(
      (
        await one(
          `insert into public.jobs (office_id, correlation_id, idempotency_key, kind, requested_by, recipient_agent) values (${lit(office)}::uuid, gen_random_uuid(), ${lit(`q-${run}-${Math.random()}`)}, ${lit(kind)}, ${lit(requestedBy)}, ${who === null ? 'null' : lit(who)}) returning job_id::text as id`,
        )
      ).id,
    )
  const spentToday = async (office: string, who: string | null = null): Promise<number> =>
    Number((await one(`select app.spent_today(${lit(office)}::uuid${who === null ? '' : `, ${lit(who)}`}) as s`)).s)
  const over = async (office: string, who: string | null): Promise<string | null> =>
    ((await one(`select app.over_budget(${lit(office)}::uuid, ${who === null ? 'null' : lit(who)}) as s`)).s as string | null) ?? null

  const limits = await q(`select key, value from public.system_config where key like 'budget.%'`)
  console.log(`INFO limits: ${JSON.stringify(limits)}`)
  await spend(B.office, agent, 70)
  check('spend is counted for the office that spent it (B 70p) and not for another (C 0p)', (await spentToday(B.office)) === 70 && (await spentToday(C.office)) === 0, `${String(await spentToday(B.office))}/${String(await spentToday(C.office))}`)
  check('per-agent spend is per agent', (await spentToday(B.office, agent)) === 70 && (await spentToday(B.office, other)) === 0)
  const nullRefused = await db.execute(`select app.spent_today(null)`).then(() => 'answered', (e) => String(e))
  check('a null office is REFUSED, never read as the whole deployment', /no_office/.test(nullRefused), nullRefused.slice(0, 60))
  check('under both limits: over_budget says nothing (B, finance 70p > per-agent 60p is the agent ceiling, so this one DOES speak)', (await over(B.office, agent))?.includes('daily limit of 60p') === true, String(await over(B.office, agent)))
  check('control: the other agent in the same office is not held, and neither is another office\'s same agent', (await over(B.office, other)) === null && (await over(C.office, agent)) === null)

  const bBg = await queued(B.office, agent, 'office.chores')
  const bBgOther = await queued(B.office, other, 'office.chores')
  const bTurn = await queued(B.office, agent, 'office.instruction', 'teamhq:e3-person')
  const bPursue = await queued(B.office, agent, 'office.pursue', 'teamhq:e3-person')
  const cBg = await queued(C.office, agent, 'office.chores')
  const held1 = json((await one(`select app.defer_over_budget() as r`)).r)
  const st = async (id: string): Promise<Row> => one(`select state::text s, coalesce(not_before > now() + interval '30 minutes', false) as deferred, state_reason r from public.jobs where job_id = ${lit(id)}::uuid`)
  const sBg = await st(bBg)
  check('over its agent ceiling: the office\'s background job for THAT agent is held to tomorrow, with the reason written on the job', sBg.deferred === true && /daily limit/.test(String(sBg.r)), String(sBg.r))
  check('the same office\'s background job for ANOTHER agent is not held', (await st(bBgOther)).deferred === false)
  check('another office\'s job for the same agent is not held', (await st(cBg)).deferred === false)
  check('a person\'s own turns (office.instruction, office.pursue) are never parked, even over budget', (await st(bTurn)).deferred === false && (await st(bPursue)).deferred === false)
  console.log(`INFO first deferral: ${JSON.stringify(held1)}`)
  const heldAgain = json((await one(`select app.defer_over_budget() as r`)).r)
  check('a second pass holds nothing new (idempotent)', Number(heldAgain.agents_held) === 0, JSON.stringify(heldAgain))

  // office ceiling
  await spend(C.office, other, 55)
  await spend(C.office, 'growth-director', 55)
  await spend(C.office, 'operations-director', 55)
  await spend(C.office, 'strategy-director', 55)
  const sC = await spentToday(C.office)
  check('four agents each UNDER 60p add up to an office over its 200p ceiling', sC === 220 && (await over(C.office, 'finance-director'))?.startsWith('the office has spent 220p') === true, `${String(sC)}p: ${String(await over(C.office, 'finance-director'))}`)
  const cBg2 = await queued(C.office, 'finance-director', 'office.chores')
  const bBg3 = await queued(B.office, other, 'office.chores')
  await db.execute(`select app.defer_over_budget()`)
  check('the office ceiling holds the whole office\'s background work (C) and nothing of B\'s', (await st(cBg2)).deferred === true && (await st(bBg3)).deferred === false)

  // harness spend and free models
  await spend(B.office, 'strategy-director', 500, 'verify:e3-harness')
  check('harness (verify:) spend does not count against the office', (await spentToday(B.office, 'strategy-director')) === 0)
  await spend(B.office, 'growth-director', 0)
  check('a free-model job (0 pence) counts for nothing: the budget is a money ceiling, not a call ceiling', (await spentToday(B.office, 'growth-director')) === 0)
  const stillHeldElsewhere = Number((await one(`select count(*)::int n from public.jobs where office_id in (${lit(op)}::uuid, ${lit(sys)}::uuid) and state_reason like '%daily limit%' and created_at > now() - interval '5 minutes'`)).n)
  check('no job of the operator or system office was held by any of the above', stillHeldElsewhere === 0)

  // the SYSTEM office: its jobs' spend is its own
  check('the system office has its own (zero) spend and is not part of any person office ceiling', (await spentToday(sys)) === 0)

  console.log(`\n${String(total - failed)}/${String(total)} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
