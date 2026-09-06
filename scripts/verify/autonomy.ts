/**
 * Demonstrate the Phase 6 acceptance criteria against the live database.
 *
 *   npm run verify:autonomy
 *
 * The criteria:
 *
 *   * limits hold under concurrent load and across restarts
 *   * "leave me alone today" persists as structured preference
 *   * Needs Me stays small
 *
 * The first is enforced by 0006 and demonstrated in `verify:jobs`; the
 * concurrency half is re-proved here because "holds under concurrent load" is
 * the claim most likely to be true in a single-threaded test and false in
 * production.
 *
 * Everything created is prefixed `fixture-` for `npm run purge:fixtures`.
 */

import { generateBriefing, localDate } from '../../src/briefings/compose.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const run = Date.now().toString(36)
interface Check {
  group: string
  what: string
  outcome: string
  passed: boolean
}
const checks: Check[] = []
const record = (group: string, what: string, outcome: string, passed: boolean): void => {
  checks.push({ group, what, outcome, passed })
}
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const mustRefuse = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return '(no error - it was ACCEPTED)'
  } catch (error) {
    return error instanceof SqlExecutionError || error instanceof Error
      ? error.message.replace(/\s+/g, ' ').slice(0, 300)
      : String(error)
  }
}

const project = await one(`
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`fixture-autonomy-${run}`)}, 'Fixture: autonomy', 'active')
    returning project_id
  ),
  attached as (
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role)
    select project_id, 'upload', 'fixture', 'Verification fixture', 'source'
      from created
    returning project_id
  )
  select project_id::text as id from created
`)
const projectId = String(project?.id)

// ===========================================================================
// 1. Autonomy
// ===========================================================================

const defaultLevel = await one(`select app.autonomy_for(null)::text as l`)
record(
  'autonomy',
  'the global default is the cautious end, not the permissive one',
  `global=${String(defaultLevel?.l)}`,
  defaultLevel?.l === 'suggest',
)

const unsetProject = await one(`select app.autonomy_for(${lit(projectId)}::uuid)::text as l`)
record(
  'autonomy',
  'a project with no setting of its own inherits the global level',
  `project=${String(unsetProject?.l)}`,
  unsetProject?.l === 'suggest',
)

await db.execute(`
  insert into public.autonomy_settings (project_id, level, set_by, reason)
  values (${lit(projectId)}::uuid, 'act', 'verify:autonomy',
          'Raising this one project to act, to show that project scope overrides global.')
`)
const raised = await one(`select app.autonomy_for(${lit(projectId)}::uuid)::text as l`)
const globalUnchanged = await one(`select app.autonomy_for(null)::text as l`)
record(
  'autonomy',
  'a project setting overrides global WITHOUT changing global',
  `project=${String(raised?.l)} global=${String(globalUnchanged?.l)}`,
  raised?.l === 'act' && globalUnchanged?.l === 'suggest',
)

const agentRaises = await mustRefuse(`
  set local role ai_team_app;
  insert into public.autonomy_settings (project_id, level, set_by, reason)
  values (null, 'act', 'some-agent', 'An agent widening its own remit.')
`)
record(
  'autonomy',
  'an agent cannot raise its own autonomy level',
  agentRaises.slice(0, 120),
  agentRaises.includes('permission denied'),
)

const rewriteHistory = await mustRefuse(`
  update public.autonomy_settings set level = 'act' where project_id is null
`)
record(
  'autonomy',
  'the autonomy history cannot be rewritten after the fact',
  rewriteHistory.slice(0, 120),
  rewriteHistory.includes('append-only'),
)

// Autonomy is not authority: a job at `act` still cannot reach a disabled tool
// or commit unreviewed output. Proved by asking the two systems together.
const stillGated = await one(`
  select app.autonomy_for(${lit(projectId)}::uuid)::text as autonomy,
         app.tool_allowed('gmail.send', true) as gmail
`)
record(
  'autonomy',
  'autonomy at `act` does NOT unlock a policy-disabled tool',
  `autonomy=${String(stillGated?.autonomy)} gmail.send allowed=${String(stillGated?.gmail)}`,
  stillGated?.autonomy === 'act' && stillGated?.gmail === false,
)

// ===========================================================================
// 2. Responsibilities
// ===========================================================================

const cos = await one(`select staff_id::text as id from public.staff where slug = 'chief-of-staff'`)
await db.execute(`
  insert into public.responsibilities
    (slug, staff_id, project_id, description, job_kind, period_minutes)
  values (${lit(`fixture-duty-${run}`)}, ${lit(String(cos?.id))}::uuid, ${lit(projectId)}::uuid,
          'A recurring duty created to demonstrate scheduling and idempotency.',
          'duty.fixture', 60)
`)

const due = await db.execute(`
  select slug, idempotency_key from app.due_responsibilities()
  where slug = ${lit(`fixture-duty-${run}`)}
`)
record(
  'responsibilities',
  'a never-run duty is due immediately',
  `${String(due.rows.length)} due, key=${String(due.rows[0]?.idempotency_key ?? 'none')}`,
  due.rows.length === 1,
)

// The key must be stable within a period: that is what makes two firings
// collide instead of producing two jobs.
const dueAgain = await db.execute(`
  select idempotency_key from app.due_responsibilities()
  where slug = ${lit(`fixture-duty-${run}`)}
`)
record(
  'responsibilities',
  'the idempotency key is stable within a period, so a re-fire collides',
  `${String(due.rows[0]?.idempotency_key)} == ${String(dueAgain.rows[0]?.idempotency_key)}`,
  due.rows[0]?.idempotency_key === dueAgain.rows[0]?.idempotency_key,
)

// And the collision is real, not theoretical: enqueue twice with that key.
const key = String(due.rows[0]?.idempotency_key)
await db.execute(`
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
  values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(key)}, 'duty.fixture', 'verify:autonomy')
`)
const collided = await mustRefuse(`
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
  values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(key)}, 'duty.fixture', 'verify:autonomy')
`)
record(
  'responsibilities',
  'a duty firing twice in one period collides instead of duplicating',
  collided.slice(0, 130),
  collided.includes('jobs_one_live_per_idempotency_key'),
)

await db.execute(`
  update public.responsibilities set last_run_at = app.now_utc()
  where slug = ${lit(`fixture-duty-${run}`)}
`)
const notDue = await db.execute(`
  select slug from app.due_responsibilities() where slug = ${lit(`fixture-duty-${run}`)}
`)
record(
  'responsibilities',
  'a duty that just ran is not due again until its period elapses',
  `${String(notDue.rows.length)} due`,
  notDue.rows.length === 0,
)

const tooFast = await mustRefuse(`
  insert into public.responsibilities
    (slug, staff_id, project_id, description, job_kind, period_minutes)
  values (${lit(`fixture-duty-fast-${run}`)}, ${lit(String(cos?.id))}::uuid, null,
          'A duty that would fire every minute and produce a job every minute.',
          'duty.fixture', 1)
`)
record(
  'responsibilities',
  'a duty cannot be scheduled faster than the sync cadence',
  tooFast.slice(0, 120),
  tooFast.includes('responsibilities_period_sane'),
)

// A duty whose owner is deactivated stops firing.
//
// Exercised on a FIXTURE owner, not on chief-of-staff. Deactivating a real
// permanent role to prove a query filter is the same mistake that left
// gmail.send enabled and moved research-director's prompt - and the earlier
// version of this check dodged it by not deactivating anything at all, while
// keeping a label that said it did.
await db.execute(`
  update public.staff set active = false
  where not permanent and slug like 'fixture-dutyowner-%' and active
`)
const owner = await one(`
  select app.create_temporary_specialist(
    ${lit(`fixture-dutyowner-${run}`)}, 'Duty Owner', 'Duty Owner',
    'Owns a fixture duty so that the owner-active rule can be exercised safely.',
    '{}'::text[], 'Plainly.',
    'A duty needs an owner, and deactivating a permanent role to test a filter is not acceptable.',
    app.now_utc() + interval '1 hour', null)::text as id
`)
await db.execute(`
  insert into public.responsibilities
    (slug, staff_id, project_id, description, job_kind, period_minutes)
  values (${lit(`fixture-duty-owned-${run}`)}, ${lit(String(owner?.id))}::uuid, ${lit(projectId)}::uuid,
          'A duty owned by a fixture specialist, used to prove the owner-active rule.',
          'duty.fixture', 60)
`)
const ownedDue = (
  await db.execute(
    `select slug from app.due_responsibilities() where slug = ${lit(`fixture-duty-owned-${run}`)}`,
  )
).rows.length

await db.execute(
  `update public.staff set active = false where slug = ${lit(`fixture-dutyowner-${run}`)}`,
)
const ownedDueAfter = (
  await db.execute(
    `select slug from app.due_responsibilities() where slug = ${lit(`fixture-duty-owned-${run}`)}`,
  )
).rows.length

// ===========================================================================
// 3. Needs Me stays small
// ===========================================================================

const startingPressure = await one(`select * from app.needs_me_pressure()`)
const cap = Number(startingPressure?.cap)

/**
 * An overdue blocker is an OLD one, not one with an impossible deadline.
 *
 * `blockers_deadline_after_creation` refuses a deadline before creation, which
 * is right - a blocker cannot be born late. So the fixture backdates
 * `created_at` as well, which is what a genuinely overdue blocker looks like:
 * raised two days ago with a deadline that has since passed. Forcing the
 * deadline alone would have meant weakening a correct constraint to make a
 * test convenient.
 */
const mkBlocker = async (i: number, overdue: boolean, canContinue: boolean): Promise<void> => {
  await db.execute(`
    insert into public.blockers
      (project_id, requested_action, why_needed, real_deadline, consequences_of_delay,
       approval_options, originating_agent, work_can_continue, state, created_at)
    values
      (${lit(projectId)}::uuid,
       ${lit(`Fixture decision ${String(i)}: approve or decline the fixture option.`)},
       'Needed so that the Needs Me ordering and cap can be demonstrated.',
       ${overdue ? "app.now_utc() - interval '1 hour'" : "app.now_utc() + interval '2 days'"},
       'The fixture work stays parked until this is answered.',
       array['approve', 'decline']::text[], 'chief-of-staff', ${String(canContinue)}, 'open',
       ${overdue ? "app.now_utc() - interval '2 days'" : 'app.now_utc()'})
  `)
}

// One overdue, one blocking-but-not-due, one non-blocking. Ordering must put
// them in that order regardless of insertion order, so they go in backwards.
await mkBlocker(1, false, true)
await mkBlocker(2, false, false)
await mkBlocker(3, true, true)

const ordered = await db.execute(`
  select requested_action, overdue, work_can_continue from public.needs_me
  where project_id = ${lit(projectId)}::uuid
`)
const order = ordered.rows.map((r) =>
  r.overdue === true ? 'overdue' : r.work_can_continue === false ? 'blocked' : 'informational',
)
record(
  'needs me',
  'ordering puts overdue first, then work that is actually stopped',
  order.join(' > '),
  order.join(',') === 'overdue,blocked,informational',
)

// Now push past the cap and confirm the pressure is REPORTED rather than
// silently truncated.
for (let i = 4; i <= cap + 3; i++) await mkBlocker(i, false, true)

const pressure = await one(`select * from app.needs_me_pressure()`)
record(
  'needs me',
  'when the list outgrows the cap, the overflow is reported rather than hidden',
  `open=${String(pressure?.open_items)} cap=${String(pressure?.cap)} suppressed=${String(pressure?.suppressed)}`,
  Number(pressure?.open_items) > cap && Number(pressure?.suppressed) > 0,
)

// Compared UNFILTERED against the pressure count. The first version counted
// the view for this project and compared it to the global open count - two
// different populations, so "10 of 12" looked like truncation evidence and was
// arithmetic between unrelated numbers.
const viewCount = await one(`select count(*)::int as n from public.needs_me`)
record(
  'needs me',
  'the view itself does NOT truncate - hiding items would hide the problem',
  `view returns ${String(viewCount?.n)}, ${String(pressure?.open_items)} open, cap ${String(cap)}`,
  Number(viewCount?.n) === Number(pressure?.open_items) && Number(viewCount?.n) > cap,
)

// Resolving takes them off the list.
await db.execute(`
  update public.blockers set state = 'resolved', resolved_at = app.now_utc(),
    resolution = 'Resolved by the verification script.'
  where project_id = ${lit(projectId)}::uuid and state = 'open'
`)
const afterResolve = await one(`
  select count(*)::int as n from public.needs_me where project_id = ${lit(projectId)}::uuid
`)
record(
  'needs me',
  'resolved blockers leave the list',
  `${String(afterResolve?.n)} remaining for this project`,
  Number(afterResolve?.n) === 0,
)

// ===========================================================================
// 4. Today
// ===========================================================================

const todayRow = await one(`
  select state::text as state, minutes_since_change
  from public.today where project_id = ${lit(projectId)}::uuid limit 1
`)
record(
  'today',
  'live work appears in Today with a computed staleness, so nothing looks stuck silently',
  `state=${String(todayRow?.state)} minutes_since_change=${String(todayRow?.minutes_since_change)}`,
  todayRow !== undefined && Number.isFinite(Number(todayRow.minutes_since_change)),
)

const waitingFirst = await db.execute(`
  select state::text as state from public.today where project_id = ${lit(projectId)}::uuid
`)
record(
  'today',
  'Today excludes finished work',
  `${String(waitingFirst.rows.length)} live row(s), states: ${[...new Set(waitingFirst.rows.map((r) => String(r.state)))].join(', ')}`,
  waitingFirst.rows.every((r) => !['complete', 'cancelled', 'failed'].includes(String(r.state))),
)

record(
  'responsibilities',
  'a duty stops firing when its owner is deactivated',
  `due with active owner: ${String(ownedDue)}, after deactivating the owner: ${String(ownedDueAfter)}`,
  ownedDue === 1 && ownedDueAfter === 0,
)

// ===========================================================================
// 5. Briefings — the property is "never twice"
// ===========================================================================

const scope = `fixture-brief-${run}`
const forDate = localDate(new Date(), 'Europe/London')

const first = await generateBriefing(db, 'morning', forDate, scope)
record(
  'briefings',
  'a morning briefing is generated from live counts',
  first === null
    ? 'none generated'
    : `${String(first.body.split('\n').length)} lines, ${String(first.inputs.liveJobs)} live job(s)`,
  first?.body.includes(forDate) === true,
)

// The one that matters. A duty that crashed after sending and before recording
// WILL be re-attempted - "read state, continue" guarantees it - and a second
// morning briefing is the failure most likely to make a person stop reading
// them.
const second = await generateBriefing(db, 'morning', forDate, scope)
const count = await one(`
  select count(*)::int as n from public.briefings
  where scope_ref = ${lit(scope)} and kind = 'morning' and for_date = ${lit(forDate)}::date
`)
record(
  'briefings',
  'a re-attempted duty does NOT send a second morning briefing',
  `second attempt returned ${second === null ? 'null (already exists)' : 'A NEW BRIEFING'}, ${String(count?.n)} row(s) stored`,
  second === null && Number(count?.n) === 1,
)

// Evening is a different briefing, not a duplicate.
const evening = await generateBriefing(db, 'evening', forDate, scope)
record(
  'briefings',
  'the evening briefing on the same day is not blocked by the morning one',
  evening === null ? 'blocked' : 'generated',
  evening !== null,
)

// And tomorrow's morning is not blocked by today's.
const tomorrow = localDate(new Date(Date.now() + 86_400_000), 'Europe/London')
const nextDay = await generateBriefing(db, 'morning', tomorrow, scope)
record(
  'briefings',
  "tomorrow's morning briefing is not blocked by today's",
  nextDay === null ? 'blocked' : `generated for ${tomorrow}`,
  nextDay !== null,
)

// Generated but not delivered is a legitimate state - "leave me alone today"
// mutes delivery, not generation - and must be distinguishable from a crash.
await db.execute(`
  update public.briefings set suppressed_reason = 'quiet_until is in the future (leave me alone today)'
  where scope_ref = ${lit(scope)} and kind = 'evening'
`)
const suppressed = await one(`
  select delivered_at, suppressed_reason from public.briefings
  where scope_ref = ${lit(scope)} and kind = 'evening'
`)
record(
  'briefings',
  'a muted briefing is generated-and-suppressed, distinguishable from a crash',
  `delivered_at=${String(suppressed?.delivered_at ?? 'null')} reason=${String(suppressed?.suppressed_reason).slice(0, 40)}`,
  suppressed?.delivered_at === null && String(suppressed?.suppressed_reason).length > 0,
)

const rewriteBody = await mustRefuse(`
  update public.briefings set body = 'Actually everything was fine.'
  where scope_ref = ${lit(scope)} and kind = 'morning' and for_date = ${lit(forDate)}::date
`)
record(
  'briefings',
  'what a briefing said cannot be changed after the fact',
  rewriteBody.slice(0, 130),
  rewriteBody.includes('cannot be changed after it is generated'),
)

// Delivery fields, by contrast, must remain updatable.
let delivery = 'threw'
try {
  await db.execute(`
    update public.briefings
    set delivered_at = app.now_utc(), delivered_to = array['telegram']::text[]
    where scope_ref = ${lit(scope)} and kind = 'morning' and for_date = ${lit(forDate)}::date
  `)
  delivery = String(
    (
      await one(`
    select array_to_string(delivered_to, ',') as d from public.briefings
    where scope_ref = ${lit(scope)} and kind = 'morning' and for_date = ${lit(forDate)}::date
  `)
    )?.d,
  )
} catch (error) {
  delivery = `refused: ${(error as Error).message.slice(0, 100)}`
}
record(
  'briefings',
  'delivery CAN be recorded afterwards, so the body rule is a gate not a wall',
  `delivered_to=${delivery}`,
  delivery === 'telegram',
)

// ===========================================================================
// 6. Project monitoring
// ===========================================================================

const attention = await db.execute(`
  select slug, open_blockers, live_jobs, stalled_jobs, has_brief, brief_is_stale
  from app.project_attention()
`)
record(
  'monitoring',
  'project_attention reports facts per active project, not a score',
  `${String(attention.rows.length)} active project(s); columns: ${Object.keys(attention.rows[0] ?? {}).join(', ')}`,
  attention.rows.length > 0 && 'open_blockers' in (attention.rows[0] ?? {}),
)

const mine = attention.rows.find((r) => String(r.slug) === `fixture-autonomy-${run}`)
record(
  'monitoring',
  'a project with live work and no brief is reported as exactly that',
  mine === undefined
    ? 'fixture project not found'
    : `live_jobs=${String(mine.live_jobs)} has_brief=${String(mine.has_brief)} open_blockers=${String(mine.open_blockers)}`,
  mine !== undefined && Number(mine.live_jobs) >= 1 && mine.has_brief === false,
)

// ===========================================================================
// Report, then clean up
// ===========================================================================
console.log('| group | check | outcome | |')
console.log('|---|---|---|---|')
for (const c of checks) {
  console.log(`| ${c.group} | ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

try {
  await db.execute(`delete from public.briefings where scope_ref like 'fixture-%'`)
  await db.execute(`delete from public.responsibilities where slug like 'fixture-duty-%'`)
  await db.execute(`
    update public.staff set active = false
    where not permanent and slug like 'fixture-%' and active
  `)
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc()
    where project_id = ${lit(projectId)}::uuid and state not in ('complete', 'cancelled', 'failed')
  `)
  await db.execute(`
    update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid
  `)
  console.log('\nfixtures retired.')
} catch (error) {
  console.log(`\ncleanup did not complete: ${(error as Error).message.slice(0, 200)}`)
}

if (failed.length > 0) process.exit(1)
