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

/**
 * Retire any temporary specialists a previous run left behind.
 *
 * The specialist cap is global and small (3), so a run that leaves one alive
 * makes the NEXT run fail at "create a temporary specialist" - which is what
 * happened. A script that verifies a scarce resource has to release it, and
 * has to tolerate a predecessor that crashed before it could.
 */
await db.execute(`
  update public.staff set active = false
  where not permanent and slug like 'fixture-%' and active
`)

/**
 * Snapshot of the permanent roster, taken before anything runs.
 *
 * The property worth asserting is not "every role is on version 1" - a
 * legitimate prompt revision moves one, and 0025 already did. It is that THIS
 * SCRIPT changes none of them. A literal expected value would have started
 * failing the moment a real revision landed, which is how a check gets
 * loosened until it means nothing.
 */
const rosterBefore = (
  await db.execute(`select slug, prompt_version from public.staff where permanent order by slug`)
).rows
  .map((r) => `${String(r.slug)}=${String(r.prompt_version)}`)
  .join(',')

const project = await one(`
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`fixture-agents-${run}`)}, 'Fixture: agent engine', 'active')
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

// ---------------------------------------------------------------------------
// The exemption must be PROVABLE, not claimed
//
// 0018 built the gate and left a hole: `outputs.deterministic` skips review,
// and nothing checked it. An agent writing `deterministic => true` on an
// inferred conclusion exempted its own work - the caller bypass §16 rules out,
// reached through the field meant to make the exemption checkable. 0023 checks
// it, and these prove it bites.
// ---------------------------------------------------------------------------

const detJob = await mkJob(`fixture-det-${run}`)

const claimedWithModel = await mustRefuse(`
  insert into public.outputs (job_id, body, confidence, evidence, deterministic, model)
  values (${lit(detJob)}::uuid, 'A conclusion that names the model that wrote it.',
          'high', 'inferred', true, 'some/free-model')
`)
record(
  'review gate',
  'an output claiming determinism while naming a model is refused',
  claimedWithModel.slice(0, 150),
  claimedWithModel.includes('cannot be marked deterministic') &&
    claimedWithModel.includes('does not have a model'),
)

// A genuinely mechanical output on a job with no inference: permitted, so the
// check above is a gate and not a wall.
await db.execute(`
  insert into public.outputs (job_id, body, confidence, evidence, deterministic)
  values (${lit(detJob)}::uuid, 'Three jobs are queued and one is running.',
          'high', 'verified', true)
`)
const permitted = await one(
  `select count(*)::int as n from public.outputs where job_id = ${lit(detJob)}::uuid and deterministic`,
)
record(
  'review gate',
  'a genuinely mechanical output IS allowed the exemption',
  `deterministic outputs on a no-inference job: ${String(permitted?.n)}`,
  Number(permitted?.n) === 1,
)

// Now record an inference attempt against the job's correlation id, exactly as
// §11 requires, and the same claim becomes uncheckable and is refused.
const corr = await one(
  `select correlation_id::text as c from public.jobs where job_id = ${lit(detJob)}::uuid`,
)
await db.execute(`
  insert into public.inference_usage
    (provider, model_id, job_id, correlation_id, outcome, provenance)
  values ('openrouter', 'fixture/free-model', ${lit(detJob)}::uuid,
          ${lit(String(corr?.c))}::uuid, 'ok', 'calculated')
`)
const afterInference = await mustRefuse(`
  insert into public.outputs (job_id, body, confidence, evidence, deterministic)
  values (${lit(detJob)}::uuid, 'Another supposedly mechanical line.', 'high', 'verified', true)
`)
record(
  'review gate',
  'the same claim is refused once the job has recorded inference usage',
  afterInference.slice(0, 170),
  afterInference.includes('recorded inference') && afterInference.includes('deterministic'),
)

// And the exemption cannot be granted retroactively by an UPDATE, which is the
// obvious way round a check that only ran on INSERT.
//
// The first version of this ran the UPDATE with no eligible row to update: by
// that point every non-deterministic output on the job had been refused, so it
// matched nothing, succeeded trivially, and reported "(no error)". A zero-row
// UPDATE always succeeds - so a "must be refused" check needs something to
// actually refuse, and needs to confirm the row afterwards.
const flipTarget = await one(`
  insert into public.outputs (job_id, body, confidence, evidence, deterministic)
  values (${lit(detJob)}::uuid, 'An inferred conclusion, correctly not exempt.',
          'medium', 'inferred', false)
  returning output_id::text as id
`)
const retroactive = await mustRefuse(`
  update public.outputs set deterministic = true
  where output_id = ${lit(String(flipTarget?.id))}::uuid
`)
const stillNotExempt = await one(
  `select deterministic from public.outputs where output_id = ${lit(String(flipTarget?.id))}::uuid`,
)
record(
  'review gate',
  'the exemption cannot be granted retroactively by an update',
  `${retroactive.slice(0, 110)} | still deterministic=${String(stillNotExempt?.deterministic)}`,
  retroactive.includes('recorded inference') && stillNotExempt?.deterministic === false,
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
  /*
    Disabled by 0370, deliberately: src/google/mail.ts exports parseFrom and
    refreshMail and nothing that drafts a mail, so the row was advertising a
    capability to all eight agents with nothing behind it - 0298's defect,
    which is worse than being told no, because Grant finds out when nothing
    arrives.

    The baseline said true and had said it since 0018. So this check went red
    on a CORRECT change and reported `DRIFTED: gmail.draft=false` about the
    fix. Fourth instance in this repository of a control going stale when the
    thing it controls for changes - web.search is the same story, one table
    over - and it is the reason the value is written here with its migration
    named rather than simply flipped: the next person to see this red should
    be able to tell "somebody disabled a capability on purpose" from "somebody
    disabled a capability by accident", which is the whole point of a drift
    check.
  */
  'gmail.draft': false,
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
// 6. The Staff Builder, temporary specialists, prompt versioning (§8, §9, §21)
// ===========================================================================

const specSlug = `fixture-specialist-${run}`
const made = await one(`
  select app.create_temporary_specialist(
    ${lit(specSlug)},
    'Pricing Specialist (temporary)',
    'Pricing Specialist',
    'Advises on price architecture for the enterprise tier for the duration of one piece of work.',
    array['pricing', 'packaging']::text[],
    'Concrete about numbers and explicit about which are modelled.',
    'None of the eight permanent roles owns price architecture; finance owns unit economics, not packaging.',
    app.now_utc() + interval '2 hours',
    null
  )::text as id
`)
record(
  'staff builder',
  'the app role CAN create a temporary specialist',
  `staff_id=${String(made?.id).slice(0, 8)}`,
  String(made?.id).length === 36,
)

const noJustification = await mustRefuse(`
  select app.create_temporary_specialist(
    ${lit(`${specSlug}-b`)}, 'Someone', 'Someone', 'Does some things for a while on this job.',
    '{}'::text[], 'Plainly.', 'we needed someone', app.now_utc() + interval '1 hour', null)
`)
record(
  'staff builder',
  'a specialist with a non-reason for existing is refused',
  noJustification.slice(0, 120),
  noJustification.includes('staff_temporary_is_justified'),
)

const noExpiry = await mustRefuse(`
  select app.create_temporary_specialist(
    ${lit(`${specSlug}-c`)}, 'Someone', 'Someone',
    'Does some things indefinitely, which is the problem.',
    '{}'::text[], 'Plainly.',
    'A genuine gap in the permanent roster that this specialist is meant to fill.',
    null, null)
`)
record(
  'staff builder',
  'a specialist with no expiry is refused - that is a ninth permanent role',
  noExpiry.slice(0, 130),
  noExpiry.includes('must expire in the future'),
)

// The route that matters: the app role must not be able to add PERMANENT staff
// at all. The function hard-codes false, so the only way round is the table.
const directPermanent = await mustRefuse(`
  set local role ai_team_app;
  insert into public.staff (slug, name, title, permanent, responsibilities, communication_style)
  values (${lit(`${specSlug}-d`)}, 'Ninth Director', 'Ninth Director', true,
          'A permanent role the application decided to award itself.', 'Plainly.')
`)
record(
  'staff builder',
  'the app role cannot insert PERMANENT staff directly',
  directPermanent.slice(0, 120),
  directPermanent.includes('permission denied'),
)

const promote = await mustRefuse(`
  update public.staff set permanent = true, expires_at = null where slug = ${lit(specSlug)}
`)
record(
  'staff builder',
  'a temporary specialist cannot be promoted to permanent',
  promote.slice(0, 130),
  promote.includes('cannot be promoted from temporary to permanent'),
)

// The cap. Three slots; one is used, so two more succeed and the fourth must not.
const capSlots = Number((await one(`select app.temporary_specialist_slots() as n`))?.n)
for (let i = 0; i < capSlots - 1; i++) {
  await db.execute(`
    select app.create_temporary_specialist(
      -- A DISTINCT name per filler. 0071 made lower(name) unique among active
      -- staff, and every filler used to be called Filler — so the second one
      -- refused and this script died before reaching the cap it was written to
      -- demonstrate. (No backticks in this comment: it lives inside a template
      -- literal, and the first version of it ended the string.)
      ${lit(`${specSlug}-fill`)} || ${String(i)},
      ${lit(`Filler ${String(i)}`)}, 'Filler',
      'Occupies a specialist slot so that the cap can be demonstrated.',
      '{}'::text[], 'Plainly.',
      'Exists only to occupy a slot while the specialist cap is being demonstrated.',
      app.now_utc() + interval '1 hour', null)
  `)
}
const overCap = await mustRefuse(`
  select app.create_temporary_specialist(
    ${lit(`${specSlug}-over`)}, 'One Too Many', 'One Too Many',
    'The specialist that should not fit within the configured cap.',
    '{}'::text[], 'Plainly.',
    'Exists only to prove that the specialist cap refuses the one past the limit.',
    app.now_utc() + interval '1 hour', null)
`)
record(
  'staff builder',
  `the specialist cap refuses the one past ${String(capSlots)}`,
  overCap.slice(0, 130),
  overCap.includes('slots are already in use'),
)

// Expiry sweeps rather than filters.
await db.execute(`
  update public.staff set expires_at = app.now_utc() - interval '1 minute'
  where slug like ${lit(`${specSlug}%`)}
`)
const expired = await one(`select app.expire_temporary_staff() as n`)
const stillActive = await one(
  `select count(*)::int as n from public.staff where slug like ${lit(`${specSlug}%`)} and active`,
)
record(
  'staff builder',
  'expired specialists are swept inactive, not left for each caller to filter',
  `expired ${String(expired?.n)}, still active ${String(stillActive?.n)}`,
  Number(expired?.n) >= 1 && Number(stillActive?.n) === 0,
)

// --- prompt versioning ------------------------------------------------------

// Counted the join at first, which returned 10 once a role legitimately had
// three versions - the question is not how many prompts exist but whether each
// role's CURRENT pointer resolves to text.
const dangling0 = await db.execute(`
  select s.slug from public.staff s
  left join public.staff_prompts p
    on p.staff_id = s.staff_id and p.version = s.prompt_version
  where s.permanent and p.prompt_id is null
`)
record(
  'prompt versioning',
  "every permanent role's prompt_version resolves to real text",
  dangling0.rows.length === 0
    ? 'all 8 pointers resolve'
    : `DANGLING: ${dangling0.rows.map((r) => String(r.slug)).join(', ')}`,
  dangling0.rows.length === 0,
)

// And that text was written by a migration, not by a test. This is the check
// that would have caught a verification script rewriting a real role.
const foreignAuthor = await db.execute(`
  select s.slug, p.authored_by from public.staff s
  join public.staff_prompts p on p.staff_id = s.staff_id and p.version = s.prompt_version
  where s.permanent and p.authored_by not like 'migration:%'
`)
record(
  'prompt versioning',
  'every permanent role runs a prompt authored by a migration, not by a test',
  foreignAuthor.rows.length === 0
    ? 'all 8 authored by migrations'
    : `FOREIGN: ${foreignAuthor.rows.map((r) => `${String(r.slug)} by ${String(r.authored_by)}`).join(', ')}`,
  foreignAuthor.rows.length === 0,
)

// Versioning is exercised on a FIXTURE specialist, not on one of the eight.
//
// The first version of this used `research-director`, and it worked - which
// was the problem. It left a real permanent role pointing at a prompt written
// by a test, and since the pointer cannot go backwards by design, the damage
// could only be repaired by publishing yet another version (0025). Verifying a
// safety property must not require changing the thing being protected. This is
// the same mistake as the gmail.send one earlier in this file, in a different
// table.
const subject = `fixture-promptsubject-${run}`
await db.execute(`
  select app.create_temporary_specialist(
    ${lit(subject)}, 'Prompt Version Subject', 'Prompt Version Subject',
    'Exists so that prompt versioning can be exercised without touching a permanent role.',
    '{}'::text[], 'Plainly.',
    'Prompt versioning must be provable without editing one of the eight permanent identities.',
    app.now_utc() + interval '1 hour', null)
`)
await db.execute(`
  insert into public.staff_prompts (staff_id, version, body, rationale, authored_by)
  select staff_id, 1,
    'You are the prompt-version subject. Version one exists so that the pointer has somewhere legitimate to start from.',
    'Version 1 for the fixture specialist used to demonstrate prompt versioning.',
    'verify:agents'
  from public.staff where slug = ${lit(subject)}
`)

const dangling = await mustRefuse(`
  update public.staff set prompt_version = 7 where slug = ${lit(subject)}
`)
record(
  'prompt versioning',
  'pointing at a prompt version that does not exist is refused',
  dangling.slice(0, 130),
  dangling.includes('no such version exists'),
)

// A real version 2, then the pointer moves - proving the check above is a gate
// rather than a wall.
await db.execute(`
  insert into public.staff_prompts (staff_id, version, body, rationale, authored_by)
  select staff_id, 2,
    'You are the prompt-version subject. This second version exists to prove that the pointer moves only to text that exists.',
    'Written by verify:agents to demonstrate that the pointer moves only to text that exists.',
    'verify:agents'
  from public.staff where slug = ${lit(subject)}
`)
let moved = 'threw'
try {
  await db.execute(`update public.staff set prompt_version = 2 where slug = ${lit(subject)}`)
  moved = String(
    (await one(`select prompt_version from public.staff where slug = ${lit(subject)}`))
      ?.prompt_version,
  )
} catch (error) {
  moved = `refused: ${(error as Error).message.slice(0, 100)}`
}
record(
  'prompt versioning',
  'the pointer moves once the version exists',
  `prompt_version=${moved}`,
  moved === '2',
)

const backwards = await mustRefuse(`
  update public.staff set prompt_version = 1 where slug = ${lit(subject)}
`)
record(
  'prompt versioning',
  'the pointer cannot go backwards - a pinned version must mean one thing',
  backwards.slice(0, 130),
  backwards.includes('cannot go backwards'),
)

const rewritePrompt = await mustRefuse(`
  update public.staff_prompts set body = 'quietly different text now'
  where staff_id = (select staff_id from public.staff where slug = ${lit(subject)})
    and version = 2
`)
record(
  'prompt versioning',
  'a published prompt version cannot be rewritten',
  rewritePrompt.slice(0, 120),
  rewritePrompt.includes('append-only'),
)

// The eight are untouched by any of the above. Asserted, not assumed - that is
// the whole point of moving the subject.
const rosterAfter = (
  await db.execute(`select slug, prompt_version from public.staff where permanent order by slug`)
).rows
  .map((r) => `${String(r.slug)}=${String(r.prompt_version)}`)
  .join(',')
record(
  'prompt versioning',
  'this run left every permanent role exactly as it found it',
  rosterBefore === rosterAfter
    ? `unchanged: ${rosterAfter}`
    : `BEFORE ${rosterBefore} AFTER ${rosterAfter}`,
  rosterBefore === rosterAfter,
)

// ===========================================================================
// 7. Project switching (Phase 4's last item)
// ===========================================================================

/*
  This section, alone in this suite, uses REAL subjects. Issue #177, and #45's
  trap underneath it.

  `app.current_project` deliberately refuses a switch that names a FIXTURE
  project (0164: a harness that dies must not leave Grant's chat pointed at its
  fixture). `projects.is_fixture` is GENERATED from the slug. So a section that
  tests project switching CANNOT use `fixture-` subjects — the resolver is right
  to refuse them, and every check below reads `resolved=null` against code that
  works.

  That is exactly what happened, and it cost more than the eleven checks #45
  describes: the wrong-reason failure HID two real bugs in the same function
  (0291) for as long as it was red.

  So: two `probe-` projects, torn down at the end of this section. `probe-` and
  not some other real name because `app.project_debris()` lists that prefix, so
  a teardown that fails is caught by `npm run check:leaks` the same day.
*/
const scopeRef = `probe-chat-${run}`
const realProject = async (slug: string, name: string): Promise<string> =>
  String(
    (
      await one(`
        with created as (
          insert into public.projects (slug, name, status)
          values (${lit(slug)}, ${lit(name)}, 'active')
          returning project_id
        ),
        attached as (
          insert into public.project_attachments
            (project_id, connector, external_ref, display_name, role)
          select project_id, 'upload', 'probe', 'Verification probe', 'source'
            from created
          returning project_id
        )
        select project_id::text as id from created
      `)
    )?.id,
  )

const switchFrom = await realProject(`probe-switch-a-${run}`, 'Probe: switching, the first')
const otherId = await realProject(`probe-switch-b-${run}`, 'Probe: switching, the second')

const unresolved = await one(`
  select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scopeRef)}, null)::text as p
`)
record(
  'project switching',
  'an unknown scope resolves to NULL - ask, never "the most recent project"',
  `resolved=${String(unresolved?.p ?? 'null')}`,
  unresolved?.p === null || unresolved?.p === undefined,
)

await db.execute(`
  insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
  values ('telegram_chat', ${lit(scopeRef)}, ${lit(switchFrom)}::uuid, 'verify:agents',
          'Switching to a real project to demonstrate scoped context.')
`)
const afterSwitch = await one(
  `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scopeRef)}, null)::text as p`,
)
record(
  'project switching',
  'a switch scopes that surface and survives as durable state',
  `resolved=${String(afterSwitch?.p).slice(0, 8)}`,
  afterSwitch?.p === switchFrom,
)

// The latest switch wins, and the earlier one is still on the record - which
// is the reason this is a log and not a mutable row.
await db.execute(`
  insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
  values ('telegram_chat', ${lit(scopeRef)}, ${lit(otherId)}::uuid, 'verify:agents',
          'Switching again, to show that the latest wins and the first survives.')
`)
const latest = await one(
  `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scopeRef)}, null)::text as p`,
)
const history = await one(`
  select count(*)::int as n from public.project_switches where scope_ref = ${lit(scopeRef)}
`)
record(
  'project switching',
  'the latest switch wins and the previous one survives in history',
  `resolved=${String(latest?.p).slice(0, 8)}, ${String(history?.n)} switch(es) on record`,
  latest?.p === otherId && Number(history?.n) === 2,
)

// Un-scoping is an event, not a deletion.
await db.execute(`
  insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
  values ('telegram_chat', ${lit(scopeRef)}, null, 'verify:agents',
          'Explicitly clearing the project context for this scope.')
`)
const cleared = await one(
  `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scopeRef)}, null)::text as p`,
)
const historyAfter = await one(`
  select count(*)::int as n from public.project_switches where scope_ref = ${lit(scopeRef)}
`)
record(
  'project switching',
  'clearing the context is a recorded event, not a deleted row',
  `resolved=${String(cleared?.p ?? 'null')}, ${String(historyAfter?.n)} switch(es) still on record`,
  (cleared?.p === null || cleared?.p === undefined) && Number(historyAfter?.n) === 3,
)

/*
  And the fixture guard itself (0164), which until 0291 reached BACKWARDS.

  A scope whose latest switch names a fixture must read as no scope — not fall
  through to the real project it was pointed at two switches ago, which is a
  chat quietly working on the wrong thing while looking entirely reasonable.

  Asserted with a real switch underneath it, so a resolver that ignored the
  guard and one that fell back both fail, and for different reasons.
*/
/*
  Its own fixture, made here. `projectId` belongs to section 1 and an earlier
  section has already retired it by this point — reusing it failed on the
  foreign key, which is a fair warning that a subject shared across a thousand
  lines is a subject whose lifetime nobody is tracking.
*/
/*
  Active, with an attachment. `app.enforce_switch_target_active` refuses a
  switch into a paused or archived project — *"switching into an archived
  project would file new work somewhere nobody is looking"* — and ADR-0014
  refuses an active project with no enabled source. Both are right; the fixture
  simply has to be a well-formed project to be switched INTO at all.

  `fixture-` named, so `purge:fixtures` collects it — the opposite of the two
  `probe-` subjects above, and for the opposite reason: this one exists
  precisely to BE a fixture the resolver refuses.
*/
const harnessFixture = await realProject(`fixture-switch-${run}`, 'Fixture: a harness that died')
await db.execute(`
  insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
  values ('telegram_chat', ${lit(scopeRef)}, ${lit(switchFrom)}::uuid, 'verify:agents',
          'Back to a real project, so the guard below has something to fall back TO.'),
         ('telegram_chat', ${lit(scopeRef)}, ${lit(harnessFixture)}::uuid, 'verify:agents',
          'A harness switching the scope to its own fixture, and then dying.')
`)
const guarded = await one(
  `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scopeRef)}, null)::text as p`,
)
record(
  'project switching',
  'a switch to a FIXTURE reads as no scope, and does not fall back to an older one',
  `resolved=${String(guarded?.p ?? 'null')}`,
  guarded?.p === null || guarded?.p === undefined,
)

/*
  0361, and the reason the check above was worth distrusting even when green.

  It reported 56/56 on 11 September and 55/56 on 14 September against identical
  code, because BOTH halves of the tiebreak were undecided: switched_at is
  app.now_utc(), which is now() — the TRANSACTION timestamp, so the two switches
  written in one statement above share an instant to the microsecond — and
  switch_id was gen_random_uuid(), so `order by switch_id desc` was ordering by
  noise. Which switch counted was a coin flip, in the suite and in production
  alike: a chat could be pointed at the project from two switches ago while
  looking entirely reasonable.

  A single green run cannot tell a fixed coin from a lucky one, so this asserts
  the PROPERTY directly and repeatedly: write two switches in one transaction,
  and the second must win every time. Ten rounds is not proof of determinism in
  the mathematical sense; it is enough that a 50/50 defect survives it once in
  a thousand runs, where one round survives every other run.

  The subjects are `switchFrom` and `otherId`, the two REAL probe projects this
  section owns and tears down at the end. Not `projectId` — that belongs to
  section 1 and has already been retired by the time execution reaches here,
  which this file warns about forty lines above and which the first draft of
  this check did anyway. It failed 10 of 10 and looked exactly like a live
  ordering defect: a retired project is a fixture, a fixture switch correctly
  reads as no scope, and the loop counted every null as the older switch
  winning. The test was wrong and the fix was right, in the one direction that
  would have sent somebody rewriting a working function.

  Each round uses its own scope_ref, and the rows go when the probe projects go
  — project_delete clears project_switches (0292), so there is nothing extra to
  tear down and nothing left on an append-only table.
*/
const ORDER_ROUNDS = 10
let wrongWinner = 0
for (let i = 0; i < ORDER_ROUNDS; i += 1) {
  const ref = `order-proof-${run}-${String(i)}`
  await db.execute(`
    insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
    values ('telegram_chat', ${lit(ref)}, ${lit(switchFrom)}::uuid, 'verify:agents', 'first'),
           ('telegram_chat', ${lit(ref)}, ${lit(otherId)}::uuid, 'verify:agents',
            'second, and the one that counts')
  `)
  const seen = await one(
    `select app.current_project(app.test_office(), 'telegram_chat', ${lit(ref)})::text as p`,
  )
  if (seen?.p !== otherId) wrongWinner += 1
}
record(
  'project switching',
  'REGRESSION 0361: two switches in one transaction, and the LAST one written always wins',
  wrongWinner === 0
    ? `${String(ORDER_ROUNDS)} rounds, the second switch won every time`
    : `THE OLDER SWITCH WON ${String(wrongWinner)} of ${String(ORDER_ROUNDS)} ROUNDS — the tiebreak is undecided again`,
  wrongWinner === 0,
)

// Explicit beats everything.
const explicit = await one(`
  select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scopeRef)}, ${lit(projectId)}::uuid)::text as p
`)
record(
  'project switching',
  'a project named in the message outranks the scope context',
  `resolved=${String(explicit?.p).slice(0, 8)}`,
  explicit?.p === projectId,
)

// A permanent channel mapping outranks a switch made in that channel.
const chan = `C${run.toUpperCase()}`
await db.execute(`
  insert into public.slack_workspaces (team_id, team_name, bot_user_id)
  values (${lit(`T${run.toUpperCase()}`)}, 'Fixture workspace', ${lit(`U${run.toUpperCase()}`)})
  on conflict (team_id) do nothing
`)
await db.execute(`
  insert into public.slack_channel_map (team_id, channel_id, channel_name, project_id, active)
  values (${lit(`T${run.toUpperCase()}`)}, ${lit(chan)}, 'fixture-channel', ${lit(projectId)}::uuid, true)
`)
await db.execute(`
  insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
  values ('slack_channel', ${lit(chan)}, ${lit(otherId)}::uuid, 'verify:agents',
          'A passing switch inside a channel that is permanently mapped elsewhere.')
`)
const mapped = await one(
  `select app.resolve_project(app.test_office(), 'slack_channel', ${lit(chan)}, null)::text as p`,
)
record(
  'project switching',
  'a permanent channel mapping outranks a passing switch made in it',
  `resolved=${String(mapped?.p).slice(0, 8)} (map=${projectId.slice(0, 8)}, switch=${otherId.slice(0, 8)})`,
  mapped?.p === projectId,
)

// Switching into an archived project would file work where nobody looks.
await db.execute(`
  update public.projects set status = 'archived' where project_id = ${lit(otherId)}::uuid
`)
const intoArchived = await mustRefuse(`
  insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
  values ('telegram_chat', ${lit(scopeRef)}, ${lit(otherId)}::uuid, 'verify:agents',
          'Attempting to switch into an archived project.')
`)
record(
  'project switching',
  'switching into an archived project is refused',
  intoArchived.slice(0, 130),
  intoArchived.includes('nobody is looking'),
)

const rewriteSwitch = await mustRefuse(`
  update public.project_switches set reason = 'a different reason'
  where scope_ref = ${lit(scopeRef)}
`)
record(
  'project switching',
  'the switch log cannot be rewritten',
  rewriteSwitch.slice(0, 120),
  rewriteSwitch.includes('append-only'),
)

/*
  Teardown for this section's real subjects (#45).

  At the END of the section, not in the middle of it — the first version sat
  after the clearing check and deleted two projects that six later checks were
  still using, which is a teardown that breaks the thing it is tidying up after.

  `project_delete` refuses a project holding documents or jobs; these hold
  neither, and since 0292 it sweeps the switch log itself — which it could not
  before, so a project that had ever been the subject of a conversation was
  undeletable and said so with a raw constraint name.
*/
for (const gone of [`probe-switch-a-${run}`, `probe-switch-b-${run}`]) {
  const said = (await one(`select public.project_delete(${lit(gone)}) as r`))?.r as {
    ok?: boolean
    error?: string
  }
  record(
    'project switching',
    `the real subject ${gone} is torn down`,
    said?.ok === true ? 'gone' : String(said?.error),
    said?.ok === true,
  )
}

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
  await db.execute(`
    update public.staff set active = false
    where not permanent and slug like 'fixture-%' and active
  `)
  // `active = false` requires `archived_at`, by constraint - the pair is the
  // schema refusing to let "inactive" mean two different things. Setting one
  // without the other fails, which is the constraint working.
  await db.execute(`
    update public.slack_channel_map set active = false, archived_at = app.now_utc()
    where channel_name = 'fixture-channel' and active
  `)
  console.log('\nfixtures retired.')
} catch (error) {
  console.log(
    `\ncleanup did not complete: ${(error as Error).message.slice(0, 200)}\n` +
      'Run `npm run purge:fixtures -- --go` to retire them.',
  )
}

if (failed.length > 0) process.exit(1)
