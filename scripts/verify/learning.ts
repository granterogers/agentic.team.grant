/**
 * Demonstrate feedback capture and notification learning.
 *
 *   npm run verify:learning
 *
 * The property under test is a negative one: **learning cannot change a
 * preference by itself.** That is harder to demonstrate than a positive
 * capability, because "it did not do something" is satisfied by code that does
 * nothing at all. So the checks show both halves - the pattern IS detected,
 * and detecting it changes nothing - which together mean the restraint is
 * deliberate rather than incidental.
 */

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
  what: string
  outcome: string
  passed: boolean
}
const checks: Check[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
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
      ? error.message.replace(/\s+/g, ' ').slice(0, 250)
      : String(error)
  }
}

const project = await one(`
  insert into public.projects (slug, name, status)
  values (${lit(`fixture-learning-${run}`)}, 'Fixture: learning', 'active')
  returning project_id::text as id
`)
const projectId = String(project?.id)

// ===========================================================================
// Feedback
// ===========================================================================

const correctionWithoutContent = await mustRefuse(`
  insert into public.feedback (subject_kind, signal, origin_channel)
  values ('output', 'correction', 'slack')
`)
record(
  'a correction that does not say what the right answer was is refused',
  correctionWithoutContent.slice(0, 120),
  correctionWithoutContent.includes('feedback_correction_says_what'),
)

await db.execute(`
  insert into public.feedback (subject_kind, signal, origin_channel, body)
  values ('output', 'correction', 'slack',
          'The churn figure should have cited source B, not source A.')
`)
await db.execute(`
  insert into public.feedback (subject_kind, signal, origin_channel)
  values ('briefing', 'negative', 'telegram')
`)
const kinds = await db.execute(`
  select signal::text as signal, origin_channel from public.feedback
  order by created_at desc limit 2
`)
record(
  'a weak signal and a strong one are stored distinguishably',
  kinds.rows.map((r) => `${String(r.signal)}/${String(r.origin_channel)}`).join(', '),
  kinds.rows.length === 2,
)

const rewriteFeedback = await mustRefuse(`
  update public.feedback set signal = 'positive' where signal = 'negative'
`)
record(
  'feedback cannot be rewritten - what he thought is a record',
  rewriteFeedback.slice(0, 110),
  rewriteFeedback.includes('append-only'),
)

// ===========================================================================
// The pattern IS detected
// ===========================================================================

// Twelve routine Slack notifications about this project, all ignored.
for (let i = 0; i < 12; i++) {
  await db.execute(`
    insert into public.notification_events
      (channel, severity, project_id, subject_kind, outcome)
    values ('slack', 'routine', ${lit(projectId)}::uuid, 'job', 'delivered')
  `)
}

const patterns = await db.execute(`
  select channel, severity::text as severity, sent, ignored, ignored_ratio
  from app.notification_patterns()
  where project_id = ${lit(projectId)}::uuid
`)
record(
  'a real pattern of ignored notifications IS detected',
  patterns.rows.length === 0
    ? 'nothing detected'
    : `${String(patterns.rows[0]?.channel)}/${String(patterns.rows[0]?.severity)}: ${String(patterns.rows[0]?.ignored)}/${String(patterns.rows[0]?.sent)} ignored (${String(patterns.rows[0]?.ignored_ratio)})`,
  patterns.rows.length === 1 && Number(patterns.rows[0]?.ignored) === 12,
)

// ...and detecting it changed nothing.
const prefsAfter = await one(`
  select count(*)::int as n from public.notification_preferences
  where project_id = ${lit(projectId)}::uuid
`)
const instructionsAfter = await one(`
  select count(*)::int as n from public.preference_instructions
  where interpreted_by like 'learning%'
`)
record(
  'detecting the pattern changed NO preference and wrote NO instruction',
  `preferences for this project: ${String(prefsAfter?.n)}, learning-authored instructions: ${String(instructionsAfter?.n)}`,
  Number(prefsAfter?.n) === 0 && Number(instructionsAfter?.n) === 0,
)

// ===========================================================================
// What the detector will never propose
// ===========================================================================

for (let i = 0; i < 12; i++) {
  await db.execute(`
    insert into public.notification_events
      (channel, severity, project_id, subject_kind, outcome)
    values ('telegram', 'blocker', ${lit(projectId)}::uuid, 'job', 'delivered')
  `)
}
const blockerPattern = await db.execute(`
  select severity::text as severity from app.notification_patterns()
  where project_id = ${lit(projectId)}::uuid and severity = 'blocker'
`)
record(
  'twelve ignored BLOCKERS produce no pattern - that rule cannot be learned away',
  `${String(blockerPattern.rows.length)} blocker pattern(s) from 12 ignored blockers`,
  blockerPattern.rows.length === 0,
)

// Dismissal is an interaction, so it is not "ignored". Six ignored and six
// dismissed is half, well under the threshold.
for (let i = 0; i < 6; i++) {
  await db.execute(`
    insert into public.notification_events
      (channel, severity, project_id, subject_kind, outcome, resolved_at)
    values ('voice', 'routine', ${lit(projectId)}::uuid, 'job', 'dismissed', app.now_utc())
  `)
}
for (let i = 0; i < 6; i++) {
  await db.execute(`
    insert into public.notification_events
      (channel, severity, project_id, subject_kind, outcome)
    values ('voice', 'routine', ${lit(projectId)}::uuid, 'job', 'delivered')
  `)
}
const dismissedPattern = await db.execute(`
  select ignored_ratio from app.notification_patterns()
  where project_id = ${lit(projectId)}::uuid and channel = 'voice'
`)
record(
  'a dismissal counts as engagement, not as being ignored',
  `${String(dismissedPattern.rows.length)} pattern(s) from 6 ignored + 6 dismissed`,
  dismissedPattern.rows.length === 0,
)

const smallSample = await db.execute(`
  select channel from app.notification_patterns(50, 0.8)
  where project_id = ${lit(projectId)}::uuid
`)
record(
  'twelve observations is not enough when the sample floor is fifty',
  `${String(smallSample.rows.length)} pattern(s)`,
  smallSample.rows.length === 0,
)

// ===========================================================================
// Proposals are inert
// ===========================================================================

const proposal = await one(`
  insert into public.preference_proposals (change, rationale, evidence, channel, project_id)
  values ('{"min_severity": "important"}'::jsonb,
          'Twelve routine Slack notifications about this project in thirty days, none acted on.',
          '{"sent": 12, "ignored": 12}'::jsonb, 'slack', ${lit(projectId)}::uuid)
  returning proposal_id::text as id
`)
record(
  'a proposal can be recorded',
  `proposal ${String(proposal?.id).slice(0, 8)}`,
  String(proposal?.id).length === 36,
)

const unevidenced = await mustRefuse(`
  insert into public.preference_proposals (change, rationale, evidence)
  values ('{"min_severity": "important"}'::jsonb,
          'It felt like he was ignoring them.', '{}'::jsonb)
`)
record(
  'a proposal with no evidence behind it is refused',
  unevidenced.slice(0, 120),
  unevidenced.includes('preference_proposals_evidence_present'),
)

const unaccountable = await mustRefuse(`
  update public.preference_proposals
  set state = 'accepted', settled_at = app.now_utc()
  where proposal_id = ${lit(String(proposal?.id))}::uuid
`)
record(
  'a proposal cannot be marked accepted without naming the instruction that carried it out',
  unaccountable.slice(0, 130),
  unaccountable.includes('preference_proposals_accepted_names_instruction'),
)

const appAccepts = await mustRefuse(`
  set local role ai_team_app;
  update public.preference_proposals set state = 'declined', settled_at = app.now_utc()
  where proposal_id = ${lit(String(proposal?.id))}::uuid
`)
record(
  'the app role cannot settle a proposal at all - acceptance is reserved',
  appAccepts.slice(0, 120),
  appAccepts.includes('permission denied'),
)

// And the whole point: while the proposal sits open, nothing has changed.
const stillNoPreference = await one(`
  select count(*)::int as n from public.notification_preferences
  where project_id = ${lit(projectId)}::uuid
`)
record(
  'while a proposal is open, the preference it proposes does not exist',
  `${String(stillNoPreference?.n)} preference row(s) for this project`,
  Number(stillNoPreference?.n) === 0,
)

// ===========================================================================
// Report, then clean up
// ===========================================================================
console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) {
  console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

try {
  await db.execute(
    `delete from public.preference_proposals where project_id = ${lit(projectId)}::uuid`,
  )
  await db.execute(
    `delete from public.notification_events where project_id = ${lit(projectId)}::uuid`,
  )
  await db.execute(
    `delete from public.feedback where created_at >= app.now_utc() - interval '10 minutes'`,
  )
  await db.execute(
    `update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid`,
  )
  console.log('\nfixtures retired.')
} catch (error) {
  console.log(`\ncleanup did not complete: ${(error as Error).message.slice(0, 160)}`)
}

if (failed.length > 0) process.exit(1)
