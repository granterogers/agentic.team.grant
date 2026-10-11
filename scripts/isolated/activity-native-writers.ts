// biome-ignore-all lint/suspicious/noExplicitAny: the read model's answers are untyped JSON
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The native writers the ledger has callers for: tool calls (the plan executor), the spending limit (app.defer_over_budget, 1062) and the
 * throttle the office waited out (projected from job_pauses). Driven through the real TypeScript writer and the real SQL function.
 *
 *   npx tsx scripts/isolated/activity-native-writers.ts <replica-db>
 *
 * What is asserted is what is recorded AND what is not: a tool call carries no input or output; a held-back agent is recorded once a day;
 * a suite's job is not recorded; with the switch off nothing is written; and with the ledger table broken the writers still cannot fail
 * the thing they observe.
 */
import { recordToolCall } from '../../src/activity/record.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

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
type Ev = Record<string, any>

let exit = 1
try {
  const grant = String((await one(`select app.operator_office() as o`)).o)
  const read = async (args: string): Promise<Ev[]> => (json((await one(`select app.activity_read(p_office => ${lit(grant)}::uuid, ${args}) as v`)).v).events as Ev[])
  const setSwitch = (on: boolean) => db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_enabled', '${on}'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const root = await realParent(db)
  const projectId = String(json((await one(`select app.hq_create_project(${lit(grant)}::uuid, ${lit(`Native ${run}`)}, 'upload', ${lit(`nat-${run}`)}, ${lit(`Native ${run}`)}, true) as v`)).v).project_id)
  await db.execute(`update public.jobs set project_id = ${lit(projectId)}::uuid, recipient_agent = 'research-director' where job_id = ${lit(root)}::uuid`)

  // ---------------------------------------------------------------------------------------------- tool calls
  await setSwitch(false)
  await recordToolCall(db, { jobId: root, capability: 'drive.read', step: 's1', specialist: 'research-director', phase: 'requested' })
  const offRows = Number((await one(`select count(*) as c from public.activity_events where job_id = ${lit(root)}::uuid`)).c)
  check('tool calls: with the switch off nothing is written', offRows === 0, `${offRows} rows`)
  await setSwitch(true)
  await recordToolCall(db, { jobId: root, capability: 'drive.read', step: 's1', specialist: 'research-director', phase: 'requested' })
  await recordToolCall(db, { jobId: root, capability: 'drive.read', step: 's1', specialist: 'research-director', phase: 'completed', outcome: 'found', durationMs: 412 })
  await recordToolCall(db, { jobId: root, capability: 'gmail.read', step: 's2', specialist: 'research-director', phase: 'failed', durationMs: 90, errorClass: 'TypeError' })
  const diag = await read(`p_job => ${lit(root)}::uuid, p_visibility => 'diagnostic', p_category => 'tool'`)
  check('tool calls: requested, completed and failed each become one event, attributed to the specialist and the job', diag.length === 3 && ['tool.call_requested', 'tool.call_completed', 'tool.call_failed'].every((t) => diag.some((e) => e.type === t && e.agent === 'research-director' && e.job_id === root)), diag.map((e) => e.type).join())
  const user = await read(`p_job => ${lit(root)}::uuid, p_visibility => 'user', p_category => 'tool'`)
  check('tool calls: diagnostic detail, hidden from the ordinary view', user.length === 0, `${user.length} at user visibility`)
  const done = diag.find((e) => e.type === 'tool.call_completed')
  const failedEv = diag.find((e) => e.type === 'tool.call_failed')
  check('tool calls: the capability, outcome and duration are recorded; a failure carries its class, never a message', done?.metadata?.tool === 'drive.read' && done?.metadata?.outcome === 'found' && done?.metadata?.duration_ms === 412 && failedEv?.metadata?.error_class === 'TypeError' && failedEv?.status === 'failed' && failedEv?.severity === 'warning', JSON.stringify({ d: done?.metadata, f: failedEv?.metadata }).slice(0, 160))
  const dump = JSON.stringify(diag)
  check('tool calls: nothing in an event could be a tool input or output', !/PRIVATE|payload|body/i.test(dump), 'no payload-shaped content')
  await recordToolCall(db, { jobId: root, capability: 'drive.read', step: 's1', specialist: 'research-director', phase: 'requested' })
  const again = await read(`p_job => ${lit(root)}::uuid, p_visibility => 'diagnostic', p_category => 'tool'`)
  check('tool calls: a redelivered call is not a second event', again.length === 3, `${again.length} events`)
  await db.execute(`update public.jobs set attempt = attempt + 1 where job_id = ${lit(root)}::uuid`).catch(() => undefined)
  const attemptNow = Number((await one(`select attempt as a from public.jobs where job_id = ${lit(root)}::uuid`)).a)
  await recordToolCall(db, { jobId: root, capability: 'drive.read', step: 's1', specialist: 'research-director', phase: 'requested' })
  const retried = await read(`p_job => ${lit(root)}::uuid, p_visibility => 'diagnostic', p_category => 'tool'`)
  check('tool calls: a retried attempt of the same step is a new event', retried.length === 4, `attempt ${attemptNow}, ${retried.length} events`)
  await db.execute('begin')
  await db.execute('alter table public.activity_events rename to activity_events_broken')
  let threw = false
  try { await recordToolCall(db, { jobId: root, capability: 'x.y', step: 's9', phase: 'completed' }) } catch { threw = true }
  await db.execute('rollback')
  check('tool calls: with the ledger table gone the writer returns normally, so a step cannot be failed by it', !threw, 'resolved')

  // ---------------------------------------------------------------------------------------------- the spending limit
  const real = await realParent(db)
  const bg = String((await one(`select app.enqueue_child(app.job_office(${lit(real)}::uuid), ${lit(real)}::uuid, 'drive.watch', '{"x":1}'::jsonb, interval '0', true, ${lit(projectId)}::uuid)::text as id`)).id)
  await db.execute(`update public.jobs set recipient_agent = 'finance-director' where job_id = ${lit(bg)}::uuid`)
  await db.execute(`insert into public.system_config (key, value, description) values ('budget.pence_for_the_office_per_day', '0'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  await setSwitch(false)
  await db.execute('select app.defer_over_budget()')
  const heldOff = Number((await one(`select count(*) as c from public.activity_events where event_type = 'budget.threshold_reached'`)).c)
  const movedOff = (await one(`select not_before > now() as moved from public.jobs where job_id = ${lit(bg)}::uuid`)).moved === true
  check('spending limit: with the switch off the work is still held back (behaviour unchanged) and nothing is recorded', movedOff && heldOff === 0, `held back ${movedOff}, events ${heldOff}`)
  await db.execute(`update public.jobs set not_before = null, state_reason = null where job_id = ${lit(bg)}::uuid`)
  await setSwitch(true)
  const r1 = json((await one(`select app.defer_over_budget() as v`)).v)
  const budgetEvents = await read(`p_type => 'budget.threshold_reached'`)
  const mine = budgetEvents.filter((e) => e.agent === 'finance-director')
  check('spending limit: holding an over-budget agent back records budget.threshold_reached once, with the reason the job carries', mine.length === 1 && String(mine[0]?.summary).includes('daily limit') && mine[0]?.actor_kind === 'system', `${mine.length} events, held ${r1.agents_held}: ${mine[0]?.summary}`)
  await db.execute(`update public.jobs set not_before = null where job_id = ${lit(bg)}::uuid`)
  await db.execute('select app.defer_over_budget()')
  const mine2 = (await read(`p_type => 'budget.threshold_reached'`)).filter((e) => e.agent === 'finance-director')
  check('spending limit: held again the same day it is the same event, not a second', mine2.length === 1, `${mine2.length} events`)
  check('spending limit: the held-back function still returns its counts', typeof r1.agents_held === 'number' && typeof r1.offices_held === 'number', JSON.stringify(r1))
  await db.execute(`update public.system_config set value = '200'::jsonb where key = 'budget.pence_for_the_office_per_day'`)

  // ---------------------------------------------------------------------------------------------- the throttle
  await db.execute(`insert into public.job_pauses (job_id, reason, detail, resume_when, resumable) values (${lit(root)}::uuid, 'rate_limited', 'provider said slow down', 'the window ends', true), (${lit(root)}::uuid, 'awaiting_human_action', 'needs a person', 'they answer', false)`)
  const rl = await read(`p_job => ${lit(root)}::uuid, p_visibility => 'diagnostic', p_type => 'integration.rate_limited'`)
  const rlUser = await read(`p_job => ${lit(root)}::uuid, p_visibility => 'user', p_type => 'integration.rate_limited'`)
  check('throttle: a rate-limit pause is an integration.rate_limited event, projected from job_pauses, and a pause for another reason is not', rl.length === 1 && rl[0]?.provenance === 'projected' && rl[0]?.source === 'job_pauses' && rl[0]?.severity === 'warning' && rl[0]?.evidence?.kind === 'job_pause', `${rl.length} events: ${rl[0]?.summary}`)
  check('throttle: diagnostic, and the pause\'s own words are not copied', rlUser.length === 0 && !JSON.stringify(rl).includes('slow down'), `${rlUser.length} at user visibility`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
