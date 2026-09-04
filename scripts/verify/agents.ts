/**
 * Demonstrate the Phase 5 acceptance criteria against the live database.
 *
 *   npm run verify:agents
 *
 * The criteria, verbatim from docs/implementation-plan.md:
 *
 *   * an output without `reviewer_status` **cannot reach `committed`**
 *   * material disagreement is surfaced rather than averaged away
 *   * duplicate-work avoidance is enforced by the router as a required query
 *   * ambiguous input produces a bounded investigation or a clarification,
 *     never an uncontrolled multi-agent workload
 *
 * plus the failure injections: contradictory sources, malformed output,
 * runaway delegation attempt, duplicate task, forbidden destructive operation.
 *
 * ## What "demonstrated" means here
 *
 * Every "cannot" is proved by ATTEMPTING IT and showing the database refused,
 * with the refusal text in the report. A check whose expected value is a
 * literal is not a check - that lesson cost eleven defects and seven
 * false-passing checks across the five POC gates, and the shape it takes here
 * would be asserting that a constraint exists rather than that it bites.
 *
 * Everything this script creates is prefixed `fixture-` so
 * `npm run purge:fixtures` can find it whether or not this script survives to
 * clean up after itself.
 */

import {
  recordDecision,
  route,
  scanForDuplicates,
  verifyRosterMatchesDatabase,
} from '../../src/agents/router.ts'
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

/**
 * Run something that must fail, and report HOW it failed.
 *
 * Returning the message rather than a boolean is deliberate: "it threw" is
 * satisfied by a typo in the SQL, so every caller below asserts on the text of
 * the refusal and not merely on its existence.
 */
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

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

// ===========================================================================
// Fixtures
// ===========================================================================

const project = await one(`
  insert into public.projects (slug, name, status)
  values (${lit(`fixture-agents-${run}`)}, 'Fixture: agent engine', 'active')
  returning project_id::text as id
`)
const projectId = String(project?.id)

const mkJob = async (key: string, parent?: string): Promise<string> => {
  const row = await one(`
    insert into public.jobs
      (correlation_id, project_id, idempotency_key, kind, requested_by, parent_job_id)
    values
      (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(key)}, 'research', 'verify:agents',
       ${parent === undefined ? 'null' : `${lit(parent)}::uuid`})
    returning job_id::text as id
  `)
  return String(row?.id)
}

// ===========================================================================
// 1. The review gate — an unreviewed output cannot reach `committed`
// ===========================================================================

const gateJob = await mkJob(`fixture-gate-${run}`)
await db.execute(`
  insert into public.outputs (job_id, body, confidence, evidence)
  values (${lit(gateJob)}::uuid, 'A substantive finding that has not been reviewed.', 'medium', 'inferred')
`)

// Walk the legal path to `committing`, then attempt the last step.
for (const s of ['running', 'output_created', 'quality_review', 'committing']) {
  await db.execute(`update public.jobs set state = '${s}' where job_id = ${lit(gateJob)}::uuid`)
}
const blocked = await mustRefuse(
  `update public.jobs set state = 'committed' where job_id = ${lit(gateJob)}::uuid`,
)
record(
  'review gate',
  'a job with an unreviewed output cannot reach committed',
  blocked.slice(0, 150),
  blocked.includes('unreviewed') && blocked.includes('cannot reach committed'),
)

// The same job, once reviewed, must go through — otherwise the "gate" is just
// a wall and the check above proves nothing about the gate's selectivity.
await db.execute(`
  update public.outputs
  set reviewer_status = 'approved', reviewed_at = app.now_utc()
  where job_id = ${lit(gateJob)}::uuid
`)
let committed = 'threw'
try {
  await db.execute(
    `update public.jobs set state = 'committed' where job_id = ${lit(gateJob)}::uuid`,
  )
  committed = String(
    (await one(`select state::text as s from public.jobs where job_id = ${lit(gateJob)}::uuid`))?.s,
  )
} catch (error) {
  committed = `refused: ${(error as Error).message.slice(0, 120)}`
}
record(
  'review gate',
  'the same job commits once the output is reviewed',
  `state=${committed}`,
  committed === 'committed',
)

// A rejected output is not merely unreviewed — committing work its own
// reviewer rejected is the worse failure, and is refused separately.
const rejectedJob = await mkJob(`fixture-rejected-${run}`)
await db.execute(`
  insert into public.outputs (job_id, body, confidence, evidence, reviewer_status, reviewed_at, review_notes)
  values (${lit(rejectedJob)}::uuid, 'A finding the reviewer threw out.', 'low', 'speculative',
          'rejected', app.now_utc(), 'The sources do not support this claim.')
`)
for (const s of ['running', 'output_created', 'quality_review', 'committing']) {
  await db.execute(`update public.jobs set state = '${s}' where job_id = ${lit(rejectedJob)}::uuid`)
}
const rejectedBlocked = await mustRefuse(
  `update public.jobs set state = 'committed' where job_id = ${lit(rejectedJob)}::uuid`,
)
record(
  'review gate',
  'a REJECTED output cannot be committed either',
  rejectedBlocked.slice(0, 150),
  rejectedBlocked.includes('REJECTED'),
)

// Malformed output (failure injection): the body is the finding, so an empty
// one is not a finding.
const malformed = await mustRefuse(`
  insert into public.outputs (job_id, body, confidence, evidence)
  values (${lit(rejectedJob)}::uuid, '   ', 'low', 'speculative')
`)
record(
  'failure injection',
  'malformed output (blank body) is refused',
  malformed.slice(0, 120),
  malformed.includes('outputs_body_substantive'),
)

// Reservations without a reason are how disagreement gets averaged away: the
// reviewer hedges, nobody records why, and the hedge disappears downstream.
const unexplained = await mustRefuse(`
  insert into public.outputs (job_id, body, confidence, evidence, reviewer_status, reviewed_at)
  values (${lit(rejectedJob)}::uuid, 'A finding with a quiet reservation.', 'medium', 'inferred',
          'approved_with_reservations', app.now_utc())
`)
record(
  'disagreement',
  'approval WITH RESERVATIONS must say what they are',
  unexplained.slice(0, 120),
  unexplained.includes('outputs_reservations_are_explained'),
)

// ...and when it does say, the contradiction is stored as text, not collapsed
// into a confidence number. §10: surfaced, not averaged away.
const contradictionJob = await mkJob(`fixture-contradiction-${run}`)
await db.execute(`
  insert into public.outputs
    (job_id, body, confidence, evidence, contradictions, reviewer_status, reviewed_at, review_notes)
  values
    (${lit(contradictionJob)}::uuid,
     'Source A puts churn at 4%; source B puts it at 11%. Both are cited below.',
     'low', 'inferred',
     'The two sources disagree by a factor of nearly three and the discrepancy is not reconciled.',
     'approved_with_reservations', app.now_utc(),
     'Publishable only if the disagreement is shown alongside the figure.')
`)
const surfaced = await one(`
  select confidence::text as c, contradictions, reviewer_status::text as r
  from public.outputs where job_id = ${lit(contradictionJob)}::uuid
`)
record(
  'failure injection',
  'contradictory sources are surfaced verbatim, not averaged into one number',
  `confidence=${String(surfaced?.c)} status=${String(surfaced?.r)} contradictions recorded=${String((surfaced?.contradictions ?? '') !== '')}`,
  surfaced?.c === 'low' &&
    surfaced?.r === 'approved_with_reservations' &&
    String(surfaced?.contradictions ?? '').includes('disagree'),
)

// ===========================================================================
// 2. The required duplicate query
// ===========================================================================

const rosterMatch = await verifyRosterMatchesDatabase(db)
record(
  'roster',
  "the router's role constants still match the seeded staff",
  rosterMatch.ok
    ? 'all eight match'
    : `missing=${rosterMatch.missing.join(',')} extra=${rosterMatch.extra.join(',')}`,
  rosterMatch.ok,
)

// A routing decision with no recorded search cannot exist. This is the whole
// meaning of "required query": not flagged, not logged — refused.
const noSearch = await mustRefuse(`
  insert into public.routing_decisions
    (job_id, intent_class, confident, intent_reason, subject_terms,
     duplicate_resolution, roster, roster_reason)
  values (${lit(gateJob)}::uuid, 'assignment', true, 'because', '{}'::text[],
          'none_found', '{}'::text[], 'nobody needed here')
`)
record(
  'required query',
  'a routing decision with NO duplicate search is refused',
  noSearch.slice(0, 120),
  noSearch.includes('routing_decisions_search_was_performed'),
)

// The real thing: two differently-worded requests for the same work. Their
// idempotency keys differ, so 0005's unique index cannot collide them — this
// is precisely the gap the router closes.
const firstText = 'I need you to research the competitor pricing for the enterprise tier'
const firstJob = await mkJob(`fixture-dup-a-${run}`)
const firstScan = await scanForDuplicates(db, firstText, { projectId })
const firstDecision = route(firstText, firstScan)
await recordDecision(db, firstJob, firstDecision)
record(
  'required query',
  'the first request finds nothing and is recorded as none_found',
  `terms=[${firstDecision.searchTerms.join(' ')}] resolution=${firstDecision.resolution} blind spot=${String(firstScan.unroutedLiveJobs)} live job(s)`,
  firstDecision.resolution === 'none_found',
)

const secondText = 'what did we ever find out about enterprise pricing from the competitor'
const secondJob0 = await mkJob(`fixture-dup-b-${run}`)
const secondScan = await scanForDuplicates(db, secondText, { projectId })
const found = secondScan.candidates.find((c) => c.jobId === firstJob)
record(
  'required query',
  'a differently-worded request for the same work FINDS the live job',
  found === undefined
    ? `no candidate matched (${String(secondScan.candidates.length)} returned)`
    : `matched ${String(found.matchedTerms)} term(s): ${found.sharedTerms.join(', ')}`,
  found !== undefined && found.matchedTerms >= 2,
)

// Proof the two really are distinct to the idempotency index, so the router is
// closing a real gap rather than duplicating a constraint that already exists.
const keyRows = await db.execute(`
  select job_id::text as id, idempotency_key
  from public.jobs where job_id in (${lit(firstJob)}::uuid, ${lit(secondJob0)}::uuid)
`)
const distinctKeys = new Set(keyRows.rows.map((r) => String(r.idempotency_key)))
record(
  'required query',
  'the idempotency index could NOT have caught this (two live jobs, different keys)',
  `${String(keyRows.rows.length)} live job(s), ${String(distinctKeys.size)} distinct key(s)`,
  // Written first as `distinct >= 1`, which is true of any non-empty result
  // and therefore asserted nothing. The claim is that BOTH jobs exist and
  // their keys differ - that is what makes the router's match a real catch
  // rather than a restatement of the unique index.
  keyRows.rows.length === 2 && distinctKeys.size === 2,
)

// Linking is the §5-preferred outcome and must name the job it links to.
const linked = route(secondText, secondScan, { linkTo: firstJob })
const secondJob = secondJob0
await recordDecision(db, secondJob, linked)
record(
  'required query',
  'the duplicate is LINKED to the existing job rather than duplicated',
  `resolution=${linked.resolution} linked=${String(linked.linkedJobId).slice(0, 8)}`,
  linked.resolution === 'linked_to_existing' && linked.linkedJobId === firstJob,
)

const linkWithoutJob = await mustRefuse(`
  insert into public.routing_decisions
    (job_id, intent_class, confident, intent_reason, subject_terms,
     duplicate_resolution, roster, roster_reason)
  values (${lit(secondJob)}::uuid, 'assignment', true, 'because', array['pricing']::text[],
          'linked_to_existing', '{}'::text[], 'nobody needed here')
`)
record(
  'required query',
  'claiming to have linked, without naming the job, is refused',
  linkWithoutJob.slice(0, 120),
  linkWithoutJob.includes('routing_decisions_link_names_a_job'),
)

const unjustifiedDistinct = await mustRefuse(`
  insert into public.routing_decisions
    (job_id, intent_class, confident, intent_reason, subject_terms,
     duplicate_resolution, distinct_justification, roster, roster_reason)
  values (${lit(secondJob)}::uuid, 'assignment', true, 'because', array['pricing']::text[],
          'proceeded_distinct', 'dunno', '{}'::text[], 'nobody needed here')
`)
record(
  'required query',
  'proceeding past a near-duplicate without arguing for it is refused',
  unjustifiedDistinct.slice(0, 120),
  unjustifiedDistinct.includes('routing_decisions_distinct_is_argued'),
)

// A router that could rewrite its reasoning after the outcome is known cannot
// be audited.
const rewrite = await mustRefuse(`
  update public.routing_decisions set roster_reason = 'actually it was fine'
  where job_id = ${lit(firstJob)}::uuid
`)
record(
  'required query',
  'a recorded routing decision cannot be rewritten afterwards',
  rewrite.slice(0, 120),
  rewrite.includes('append-only') ||
    rewrite.includes('immutable') ||
    rewrite.includes('permission denied'),
)

// ===========================================================================
// 3. Ambiguity must not become a workload
// ===========================================================================

const vagueText = 'Maybe we should look into the competitor pricing'
const vagueScan = await scanForDuplicates(db, vagueText, { projectId })
const vague = route(vagueText, vagueScan)
record(
  'ambiguity',
  'a contested reading produces a clarification and convenes NOBODY',
  `intent=${vague.intent} confident=${String(vague.confident)} clarify=${String(vague.clarificationNeeded)} roster=[${vague.roster.join(',')}]`,
  vague.clarificationNeeded && vague.roster.length === 0,
)

const bigRosterOnAMaybe = await mustRefuse(`
  insert into public.routing_decisions
    (job_id, intent_class, confident, intent_reason, subject_terms,
     duplicate_resolution, roster, roster_reason)
  values (${lit(secondJob)}::uuid, 'suggestion', false, 'contested', array['pricing']::text[],
          'none_found', array['research-director','strategy-director','operations-director']::text[],
          'convening everyone on a maybe')
`)
record(
  'ambiguity',
  'the database refuses a team convened on an unconfident reading',
  bigRosterOnAMaybe.slice(0, 120),
  bigRosterOnAMaybe.includes('routing_decisions_unconfident_stays_small'),
)

const clearText = 'I need you to research the competitor onboarding flow'
const clear = route(clearText, await scanForDuplicates(db, clearText, { projectId }))
record(
  'ambiguity',
  'a CONFIDENT request still gets a bounded roster, not a team',
  `intent=${clear.intent} roster=[${clear.roster.join(',')}] (${String(clear.roster.length)})`,
  clear.confident && clear.roster.length >= 1 && clear.roster.length <= 3,
)

// ===========================================================================
// 4. Runaway delegation
// ===========================================================================

let parent = await mkJob(`fixture-depth-0-${run}`)
const depths: string[] = []
for (let d = 1; d <= 3; d++) {
  parent = await mkJob(`fixture-depth-${String(d)}-${run}`, parent)
  depths.push(String((await one(`select app.job_depth(${lit(parent)}::uuid) as d`))?.d))
}
record(
  'failure injection',
  'delegation is permitted down to the configured depth',
  `depths reached: ${depths.join(', ')}`,
  depths.join(',') === '1,2,3',
)

const runaway = await mustRefuse(`
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by, parent_job_id)
  values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(`fixture-depth-4-${run}`)},
          'research', 'verify:agents', ${lit(parent)}::uuid)
`)
record(
  'failure injection',
  'runaway delegation is refused one level past the cap',
  runaway.slice(0, 150),
  runaway.includes('delegation depth') && runaway.includes('limit is 3'),
)

// ===========================================================================
// 5. Forbidden destructive operation
// ===========================================================================

// `files.delete` is not in the table at all, so this is the unknown-tool path,
// not the destructive-tool path. Labelled as what it is: an earlier wording
// called it "a forbidden destructive tool", which would have let the real
// destructive case go untested behind a check that looked like it covered it.
const unknownTool = await one(`select app.tool_allowed('files.delete', false) as allowed`)
record(
  'failure injection',
  'an INVENTED tool name fails closed rather than falling through',
  `files.delete (not in the table) allowed=${String(unknownTool?.allowed)}`,
  unknownTool?.allowed === false,
)

// The actual destructive tool, which IS in the table, at level 3 and disabled.
const destructive = await one(`select app.tool_allowed('db.delete', true) as allowed`)
record(
  'failure injection',
  'a forbidden DESTRUCTIVE tool is refused even with approval',
  `db.delete (level 3, disabled) approved=true allowed=${String(destructive?.allowed)}`,
  destructive?.allowed === false,
)

// The discriminating question. `tool_allowed(tool, false)` returns false for
// ANY level-3 tool, approved or not, so asking it proves nothing about the
// policy - and a previous version of this file read its `false` as
// confirmation while gmail.send was in fact enabled. Asking WITH approval
// granted separates the two: only a policy disable refuses an approved
// level-3 call.
const gmailApproved = await one(`select app.tool_allowed('gmail.send', true) as allowed`)
record(
  'failure injection',
  'gmail.send is refused even WITH approval, which only a policy disable can do',
  `tool_allowed('gmail.send', approved=true)=${String(gmailApproved?.allowed)}`,
  gmailApproved?.allowed === false,
)

// Proof the check above discriminates: a level-3 tool that is NOT policy
// disabled must be allowed once approved. Without this, "refused with
// approval" could just mean level 3 is always refused.
const approvable = await one(`select app.tool_allowed('calendar.write', true) as allowed`)
record(
  'failure injection',
  'a tool that is NOT policy-disabled is allowed, so the check above discriminates',
  `tool_allowed('calendar.write', approved=true)=${String(approvable?.allowed)}`,
  approvable?.allowed === true,
)

// Run AS the application role. The first version of this ran through the
// Management API, which connects as a superuser: the UPDATE succeeded, the
// check reported "(no error - it was ACCEPTED)", and its pass condition
// accepted that outcome as a pass. It was not testing the app role's
// privileges at all, it was written so that it could not fail, and it left
// gmail.send ENABLED in the live database. Migration 0022 restored it.
const selfAuthorize = await mustRefuse(`
  set local role ai_team_app;
  update public.tool_permissions set enabled = true where tool = 'gmail.send'
`)
record(
  'failure injection',
  'the app role cannot grant itself the disabled tool',
  selfAuthorize.slice(0, 120),
  selfAuthorize.includes('permission denied'),
)

// And the row is still disabled afterwards, which is the fact that actually
// matters. A refused UPDATE that had already taken effect would satisfy the
// check above and still be a breach.
const stillOff = await one(`select enabled from public.tool_permissions where tool = 'gmail.send'`)
record(
  'failure injection',
  'gmail.send is still disabled after the attempt',
  `enabled=${String(stillOff?.enabled)}`,
  stillOff?.enabled === false,
)

// Drift detection. The incident above was invisible for a whole run because
// nothing compared the live policy against what was seeded. This does.
const POLICY_BASELINE: Readonly<Record<string, boolean>> = {
  'gmail.send': false,
  'db.delete': false,
  'production.write': false,
  'spend.money': false,
  'gmail.draft': true,
  'notebook.read': true,
}
const live = await db.execute(`
  select tool, enabled from public.tool_permissions
  where tool in (${Object.keys(POLICY_BASELINE).map(lit).join(', ')})
`)
const drift = live.rows
  .filter((r) => POLICY_BASELINE[String(r.tool)] !== Boolean(r.enabled))
  .map((r) => `${String(r.tool)}=${String(r.enabled)}`)
record(
  'failure injection',
  'the live tool policy matches the seeded baseline (no silent drift)',
  drift.length === 0
    ? `${String(live.rows.length)} tool(s) checked, all as seeded`
    : `DRIFTED: ${drift.join(', ')}`,
  drift.length === 0 && live.rows.length === Object.keys(POLICY_BASELINE).length,
)

// ===========================================================================
// Report FIRST, then clean up
//
// Written the other way round to begin with, and the first run proved why not:
// the blanket cleanup tried to cancel a job this script had deliberately
// driven to `committed`, the transition guard refused (correctly - committed
// goes to notifying or failed, not to cancelled), and the exception killed the
// process before a single result was printed. Twenty checks had run and the
// evidence went with them.
//
// Tidying is not a result. It goes after the report, and its own failure is
// reported rather than fatal.
// ===========================================================================
console.log('| group | check | outcome | |')
console.log('|---|---|---|---|')
for (const c of checks) {
  console.log(`| ${c.group} | ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

try {
  // Each job is walked to a terminal state along a LEGAL path. A committed job
  // finishes through notifying; everything still live is cancelled. Forcing a
  // state would have meant disabling the very guard the rest of this file
  // depends on.
  // A job stuck in `committing` because its output was rejected cannot be
  // cancelled and cannot commit. `failed` is the honest terminal state for it:
  // the work genuinely could not be committed.
  await db.execute(`
    update public.jobs set state = 'failed', finished_at = app.now_utc()
    where project_id = ${lit(projectId)}::uuid and state = 'committing'
  `)
  await db.execute(`
    update public.jobs set state = 'notifying'
    where project_id = ${lit(projectId)}::uuid and state = 'committed'
  `)
  await db.execute(`
    update public.jobs set state = 'complete', finished_at = app.now_utc()
    where project_id = ${lit(projectId)}::uuid and state = 'notifying'
  `)
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc()
    where project_id = ${lit(projectId)}::uuid
      and state not in ('complete', 'cancelled', 'failed')
  `)
  await db.execute(`
    update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid
  `)
  console.log('\nfixtures retired.')
} catch (error) {
  console.log(
    `\ncleanup did not complete: ${(error as Error).message.slice(0, 200)}\n` +
      'Run `npm run purge:fixtures -- --go` to retire them.',
  )
}

if (failed.length > 0) process.exit(1)
