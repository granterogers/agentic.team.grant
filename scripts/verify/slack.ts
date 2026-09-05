/**
 * The Slack office, against the live workspace and the live database.
 *
 *   npm run verify:slack
 *
 * Phase 7's failure injection list for Slack is eight items long — *"token
 * revoked, rate limited, duplicate event, out-of-order event, bot removed from
 * channel, connection interrupted, channel renamed, app limit reached"* — and
 * seven of them are performed here for real against the real workspace. The
 * eighth is discussed in the evidence document rather than faked, because a
 * simulated app-limit proves nothing about the app limit.
 *
 * Two of the checks are worth reading before the rest, because they are the
 * ones that could not be written as unit tests at all:
 *
 * **Duplicate delivery** fires eight genuinely concurrent `deliver()` calls at
 * one dedupe key and then asks SLACK how many messages exist. Counting our own
 * return values would only prove the code agrees with itself; counting the
 * messages in the channel is the property.
 *
 * **Connection interrupted** is not simulated with a stub that never posts. The
 * injected transport really does post to Slack, really does receive the
 * response, and then throws it away and reports a network error — which is the
 * actual dangerous case, because the message exists and the sender does not
 * know. A stub that fails before sending would exercise the easy half.
 */

import { processCallbacks } from '../../src/channels/callbacks.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Handler, HandlerOutput } from '../../src/jobs/worker.ts'
import { dequeue, recoverStalled, runJob } from '../../src/jobs/worker.ts'
import { SlackApiError, SlackClient } from '../../src/slack/api.ts'
import type { ResultMessage } from '../../src/slack/blocks.ts'
import { ACTIONS } from '../../src/slack/blocks.ts'
import { slackNotifier } from '../../src/slack/notifier.ts'
import { DELIVERY_EVENT_TYPE, SlackOffice } from '../../src/slack/office.ts'
import { ChannelProvisioner, channelNameFor } from '../../src/slack/provision.ts'
import { computeSignature } from '../../src/slack/signature.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
const botToken = process.env.SLACK_BOT_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
if (botToken === undefined || botToken === '') {
  console.error('SLACK_BOT_TOKEN is not set — this suite talks to the real workspace')
  process.exit(2)
}

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabaseToken,
)
const slack = new SlackClient(botToken)
const office = new SlackOffice(db, slack)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async <T>(sql: string): Promise<T | undefined> =>
  (await db.execute(sql)).rows[0] as T | undefined

interface Check {
  what: string
  outcome: string
  passed: boolean
}
const checks: Check[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const stamp = String(Date.now()).slice(-8)
const PROJECT_SLUG = `fixture-slack-office-${stamp}`
const message = (body: string): ResultMessage => ({
  staffTitle: 'Research Director',
  body,
  metadata: {
    confidence: 'medium',
    evidence: 'inferred',
    sources: ['https://example.invalid/quote'],
    contradictions: null,
    reviewed: true,
  },
  correlationId: CORRELATION,
  actions: [...ACTIONS],
  projectUrl: null,
})

// ===========================================================================
// Setup: who we are, a fixture project, and a room for it
// ===========================================================================

const auth = (await slack.call('auth.test')).body
const TEAM_ID = String(auth.team_id)
const BOT_USER = String(auth.user_id)

await db.execute(`
  insert into public.slack_workspaces (team_id, team_name, bot_user_id, app_id)
  values (${lit(TEAM_ID)}, ${lit(String(auth.team ?? 'unknown'))}, ${lit(BOT_USER)},
          ${lit(process.env.SLACK_APP_ID ?? 'A0BUFRVSSLD')})
  on conflict (team_id) do update
    set bot_user_id = excluded.bot_user_id, installed = true,
        uninstalled_at = null, revocation_reason = null
`)

const project = await one<{ id: string }>(`
  insert into public.projects (slug, name)
  values (${lit(PROJECT_SLUG)}, 'Slack office verification fixture')
  returning project_id::text as id
`)
const PROJECT_ID = String(project?.id)
const CORRELATION = PROJECT_ID

const staffRow = await one<{
  id: string
  slug: string
  name: string
  title: string
  avatar_ref: string | null
}>(`
  select staff_id::text as id, slug, name, title, avatar_ref
  from public.staff where slug = 'research-director'
`)
const STAFF = {
  slug: String(staffRow?.slug),
  name: String(staffRow?.name),
  title: String(staffRow?.title),
  avatarRef: staffRow?.avatar_ref ?? null,
}

const deliverOpts = (dedupeKey: string, channelId: string, body: string, threadTs?: string) => ({
  dedupeKey,
  teamId: TEAM_ID,
  channelId,
  threadTs: threadTs ?? null,
  purpose: 'result' as const,
  staff: STAFF,
  staffId: String(staffRow?.id),
  correlationId: CORRELATION,
  message: message(body),
})

// ---------------------------------------------------------------------------

const provisioner = new ChannelProvisioner(db, slack, TEAM_ID)
const created = await provisioner.ensureChannel(PROJECT_ID, PROJECT_SLUG)
record(
  'a project with no channel gets one, created by the app and mapped in Postgres',
  `${created.outcome} ${String(created.channelId)} #${created.channelName}`,
  created.outcome === 'created' && created.channelId !== null,
)
const CHANNEL = String(created.channelId)

const mapping = await one<{ created_by_app: boolean; project_id: string; name: string }>(`
  select created_by_app, project_id::text as project_id, channel_name as name
  from public.slack_channel_map where channel_id = ${lit(CHANNEL)}
`)
record(
  'the mapping lives in Postgres, not in the channel topic (0014)',
  `created_by_app=${String(mapping?.created_by_app)} project matches=${String(mapping?.project_id === PROJECT_ID)} name=${String(mapping?.name)}`,
  mapping?.created_by_app === true && mapping?.project_id === PROJECT_ID,
)

const again = await provisioner.ensureChannel(PROJECT_ID, PROJECT_SLUG)
record(
  'asking again creates nothing — the mapping is consulted before Slack is',
  `${again.outcome}, same channel=${String(again.channelId === CHANNEL)}`,
  again.outcome === 'existing' && again.channelId === CHANNEL,
)

record(
  'the proposed name is derived deterministically from the project slug',
  `${channelNameFor(PROJECT_SLUG)} == ${created.channelName}`,
  channelNameFor(PROJECT_SLUG) === created.channelName,
)

// ===========================================================================
// Counting what is actually in the channel
// ===========================================================================

/** How many messages in the channel carry this dedupe key? Slack's answer. */
const countInSlack = async (dedupeKey: string, threadTs?: string): Promise<number> => {
  const method = threadTs === undefined ? 'conversations.history' : 'conversations.replies'
  const params: Record<string, unknown> = {
    channel: CHANNEL,
    limit: 200,
    include_all_metadata: true,
  }
  if (threadTs !== undefined) params.ts = threadTs
  const { body } = await slack.call(method, params)
  const messages = Array.isArray(body.messages) ? body.messages : []
  return messages.filter((raw) => {
    const m = raw as { metadata?: { event_type?: string; event_payload?: { dedupe_key?: string } } }
    return (
      m.metadata?.event_type === DELIVERY_EVENT_TYPE &&
      m.metadata.event_payload?.dedupe_key === dedupeKey
    )
  }).length
}

// ===========================================================================
// An ordinary delivery, with identity
// ===========================================================================

const firstKey = `verify:${stamp}:first`
const first = await office.deliver(
  deliverOpts(firstKey, CHANNEL, 'First result. Three suppliers quoted within 4% of each other.'),
)
record(
  'a result reaches the channel, presented as the staff member who produced it',
  `${first.outcome} ts=${String(first.messageTs)} icon=${String(first.iconSource)}`,
  first.outcome === 'sent' && first.messageTs !== null,
)
record(
  'Slack agrees the message is there, found by the dedupe key it carries',
  `${String(await countInSlack(firstKey))} message(s) carrying the key`,
  (await countInSlack(firstKey)) === 1,
)
record(
  'the avatar degradation is visible rather than silent',
  `iconSource=${String(first.iconSource)} (avatar_url once the PNGs are hosted; emoji until then)`,
  first.iconSource === 'emoji_fallback' || first.iconSource === 'avatar_url',
)

const threadKey = `verify:${stamp}:thread`
const inThread = await office.deliver(
  deliverOpts(
    threadKey,
    CHANNEL,
    'A follow-up, which belongs under the question.',
    String(first.messageTs),
  ),
)
const threadCount = await countInSlack(threadKey, String(first.messageTs))
record(
  'a reply lands in the thread, not in the channel',
  `${inThread.outcome}, ${String(threadCount)} in-thread message(s) with the key`,
  inThread.outcome === 'sent' && threadCount === 1,
)

// ===========================================================================
// Duplicate delivery — the central property
// ===========================================================================

const CONCURRENCY = 8
const dupKey = `verify:${stamp}:duplicate`
const outcomes = await Promise.all(
  Array.from({ length: CONCURRENCY }, () =>
    office
      .deliver(deliverOpts(dupKey, CHANNEL, 'This must appear exactly once.'))
      .then((r) => r.outcome)
      .catch((e: unknown) => `ERROR:${(e as Error).message.slice(0, 40)}`),
  ),
)
const posted = await countInSlack(dupKey)
record(
  `${String(CONCURRENCY)} concurrent deliveries of one message post it EXACTLY once`,
  `${String(posted)} message(s) in Slack; outcomes: ${[...new Set(outcomes)].join(', ')}`,
  posted === 1,
)
record(
  'no concurrent duplicate reported an error — a retry is normal, not a fault',
  outcomes.filter((o) => o.startsWith('ERROR')).length === 0 ? 'none errored' : outcomes.join(' '),
  outcomes.every((o) => !o.startsWith('ERROR')),
)

// Control. Without this, the check above would also pass if `deliver` were
// broken in a way that posted nothing at all.
const controlKey = `verify:${stamp}:control`
await office.deliver(deliverOpts(controlKey, CHANNEL, 'Control: a different key must post.'))
record(
  'CONTROL: a different dedupe key does post, so the check above is not passing on silence',
  `${String(await countInSlack(controlKey))} message(s)`,
  (await countInSlack(controlKey)) === 1,
)

// ===========================================================================
// Out of order: suppression before, during and after the post
// ===========================================================================

const earlyKey = `verify:${stamp}:suppressed-early`
const tombstone = await one<{ r: string }>(
  `select app.suppress_slack_delivery(${lit(earlyKey)}, 'undo arrived first', ${lit(TEAM_ID)}, ${lit(CHANNEL)}) as r`,
)
const afterSuppression = await office.deliver(
  deliverOpts(earlyKey, CHANNEL, 'This must never be posted.'),
)
record(
  'an undo that outruns the post prevents it entirely (the out-of-order case)',
  `suppress=${String(tombstone?.r)} deliver=${afterSuppression.outcome} in slack=${String(await countInSlack(earlyKey))}`,
  tombstone?.r === 'tombstoned' &&
    afterSuppression.outcome === 'suppressed' &&
    (await countInSlack(earlyKey)) === 0,
)

const lateKey = `verify:${stamp}:suppressed-late`
const sentThenSuppressed = await office.deliver(
  deliverOpts(lateKey, CHANNEL, 'Posted, then undone. It must be deleted, not forgotten.'),
)
const tooLate = await one<{ r: string }>(
  `select app.suppress_slack_delivery(${lit(lateKey)}, 'undo arrived after the post') as r`,
)
record(
  'an undo that loses the race is told so, rather than silently succeeding',
  `suppress=${String(tooLate?.r)}`,
  tooLate?.r === 'too_late',
)
const retracted = await office.retract(CHANNEL, String(sentThenSuppressed.messageTs))
record(
  'and the message it could not prevent is retracted from the channel',
  `retract=${String(retracted)}, remaining in slack=${String(await countInSlack(lateKey))}`,
  retracted && (await countInSlack(lateKey)) === 0,
)

// ===========================================================================
// Connection interrupted — the real one, where the message DID land
// ===========================================================================

/** Posts for real, then throws away the answer. The dangerous case exactly. */
const amnesiacFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  await fetch(url as string, init)
  throw new TypeError('socket hang up (injected after the request completed)')
}) as unknown as typeof fetch

const amnesiacOffice = new SlackOffice(db, new SlackClient(botToken, { fetchImpl: amnesiacFetch }))
const lostKey = `verify:${stamp}:interrupted`
const lost = await amnesiacOffice.deliver(
  deliverOpts(lostKey, CHANNEL, 'Posted, but the sender never learned so.'),
)
record(
  'a connection interrupted after the post is reported as indeterminate, never retried',
  `${lost.outcome} error=${String(lost.errorCode).slice(0, 40)}`,
  lost.outcome === 'indeterminate',
)
record(
  'the message really is in Slack — this is the case a blind retry would duplicate',
  `${String(await countInSlack(lostKey))} message(s)`,
  (await countInSlack(lostKey)) === 1,
)

const resolved = await office.resolveIndeterminate({
  deliveryId: String(lost.deliveryId),
  channelId: CHANNEL,
  dedupeKey: lostKey,
})
record(
  'reconciliation finds it by the metadata it carries and records it as sent',
  `${resolved.resolution} ts=${String(resolved.messageTs)}`,
  resolved.resolution === 'sent' && resolved.messageTs !== null,
)
const afterResolve = await office.deliver(deliverOpts(lostKey, CHANNEL, 'Must not post again.'))
record(
  'and a later attempt at the same key does not post a second copy',
  `${afterResolve.outcome}, ${String(await countInSlack(lostKey))} message(s) in Slack`,
  afterResolve.outcome === 'already_sent' && (await countInSlack(lostKey)) === 1,
)

// The other half: indeterminate where the message provably did NOT land.
const neverFetch = (async () => {
  throw new TypeError('econnreset (injected before the request left)')
}) as unknown as typeof fetch
const strandedOffice = new SlackOffice(db, new SlackClient(botToken, { fetchImpl: neverFetch }))
const strandedKey = `verify:${stamp}:never-left`
const stranded = await strandedOffice.deliver(
  deliverOpts(strandedKey, CHANNEL, 'This one never left the process.'),
)
const strandedResolution = await office.resolveIndeterminate({
  deliveryId: String(stranded.deliveryId),
  channelId: CHANNEL,
  dedupeKey: strandedKey,
})
const retried = await office.deliver(
  deliverOpts(strandedKey, CHANNEL, 'Retried after reconciliation.'),
)
record(
  'an indeterminate delivery that provably did NOT land is released for a retry',
  `resolve=${strandedResolution.resolution} retry=${retried.outcome} in slack=${String(await countInSlack(strandedKey))}`,
  strandedResolution.resolution === 'retryable' &&
    retried.outcome === 'sent' &&
    (await countInSlack(strandedKey)) === 1,
)

// ===========================================================================
// End to end: a job whose result reaches the thread that asked for it
// ===========================================================================
//
// This is Phase 7's acceptance sentence — *"results reach the right thread with
// correct identity presentation"* — and it is the first check in the project
// that runs the worker and the office together. Everything before it proves
// that a message CAN be posted; this proves that finishing a piece of work
// actually posts one.
//
// The worker was moving `committed → notifying → complete` with
// `state_reason = 'delivered'` and delivering nothing, which no test caught
// because no test asked what `notifying` did.

const preSwept = await recoverStalled(db)
if (preSwept.length > 0) console.log(`recovered ${String(preSwept.length)} stalled job(s).`)

const live = await one<{ n: number }>(`
  select count(*)::int as n from public.jobs
  where state not in ('complete', 'cancelled', 'failed')
`)
if (Number(live?.n) > 0) {
  // Same rule, and the same reason, as `verify:worker`: dequeue is global and
  // will hand this script somebody else's job, for which it has no handler.
  console.error(
    `the queue is not empty: ${String(live?.n)} live job(s). This suite runs a real job ` +
      'and needs the queue to itself. `npm run purge:fixtures -- --go` clears debris.',
  )
  process.exit(2)
}

const E2E_CORRELATION = String(
  (await one<{ id: string }>(`select gen_random_uuid()::text as id`))?.id,
)
const e2eJob = await one<{ id: string }>(`
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  values (${lit(E2E_CORRELATION)}::uuid, ${lit(PROJECT_ID)}::uuid,
          ${lit(`slack-e2e-${stamp}`)}, 'research.conclusion', 'verify:slack', 100)
  returning job_id::text as id
`)
const E2E_JOB = String(e2eJob?.id)

// The instruction that caused it, recorded exactly as the adapter would record
// it — in the thread of the first message posted above, so "the right thread"
// is a specific, checkable thread rather than "the channel".
const command = await one<{ id: string }>(`
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, job_id, processed_at)
  values ('slack', ${lit(`${CHANNEL}:${String(first.messageTs)}`)}, 'grant',
          'What did the three suppliers quote?',
          ${lit(`slack:message:${stamp}e2e`)}, ${lit(E2E_JOB)}::uuid, app.now_utc())
  returning command_id::text as id
`)
await db.execute(`
  insert into public.inbound_commands_slack
    (command_id, team_id, channel_id, thread_ts, is_dm, resolved_project_id)
  values (${lit(String(command?.id))}::uuid, ${lit(TEAM_ID)}, ${lit(CHANNEL)},
          ${lit(String(first.messageTs))}, false, ${lit(PROJECT_ID)}::uuid)
`)

// Who was convened. §9's roster is the record of that, so this is where the
// identity on the message comes from — not from a field the handler sets.
await db.execute(`
  insert into public.routing_decisions
    (job_id, intent_class, confident, intent_reason, subject_terms,
     duplicate_resolution, roster, roster_reason)
  values (${lit(E2E_JOB)}::uuid, 'question', true,
          'A direct question about evidence already gathered.',
          array['supplier', 'quote'], 'none_found', array['research-director'],
          'One specialist: the question is about evidence, and §9 forbids convening a team for it.')
`)

const e2eHandler: Handler = {
  kind: 'research.conclusion',
  handle: (): Promise<HandlerOutput> =>
    Promise.resolve({
      body: 'All three suppliers quoted within 4% of each other, so price is not the deciding factor here.',
      confidence: 'medium',
      evidence: 'inferred',
      sources: ['https://example.invalid/quotes'],
      contradictions: null,
      path: 'inference',
      model: 'verify:slack/fixture',
    }),
}

// Ambient preference state would decide this check's answer, so it is stated
// rather than inherited: an explicit project-scoped row that allows Slack. The
// alternative — trusting whatever the workspace is set to — is how the first
// run of this check came back "suppressed" and looked like a delivery bug.
await db.execute(`
  delete from public.notification_preferences
   where subject = 'grant' and project_id = ${lit(PROJECT_ID)}::uuid;
  insert into public.notification_preferences
    (subject, project_id, muted_channels, min_severity, blockers_always)
  values ('grant', ${lit(PROJECT_ID)}::uuid, '{}'::text[], 'trivial', true)
`)

const notifier = slackNotifier(db, office, { teamId: TEAM_ID })
const dequeued = await dequeue(db, `verify-slack-${stamp}`)
const jobResult =
  dequeued === null
    ? null
    : await runJob(
        db,
        dequeued,
        [e2eHandler],
        () => Promise.resolve({ status: 'approved' as const, notes: 'Fixture reviewer approved.' }),
        notifier,
      )

record(
  'a finished job actually delivers — `notifying` does something now',
  `state=${String(jobResult?.finalState)} note=${String(jobResult?.note).slice(0, 90)}`,
  jobResult?.finalState === 'complete' && jobResult.note.includes('delivered to slack via thread'),
)

const inThreadNow = await countInSlack(`job:${E2E_JOB}:result`, String(first.messageTs))
record(
  'and the result is in the thread that asked the question, not in the channel',
  `${String(inThreadNow)} message(s) in the thread carrying the job key`,
  inThreadNow === 1,
)

const presented = await slack.call('conversations.replies', {
  channel: CHANNEL,
  ts: String(first.messageTs),
  limit: 50,
  include_all_metadata: true,
})
const resultMessage = (Array.isArray(presented.body.messages) ? presented.body.messages : []).find(
  (raw) =>
    (raw as { metadata?: { event_payload?: { dedupe_key?: string } } }).metadata?.event_payload
      ?.dedupe_key === `job:${E2E_JOB}:result`,
) as { username?: string; blocks?: unknown[] } | undefined
record(
  'presented as the staff member the router convened, with the §12 provenance line',
  `username=${String(resultMessage?.username)} blocks=${String(resultMessage?.blocks?.length ?? 0)}`,
  resultMessage?.username === STAFF.name &&
    JSON.stringify(resultMessage?.blocks ?? []).includes('confidence'),
)

const stateReason = await one<{ r: string }>(
  `select state_reason as r from public.jobs where job_id = ${lit(E2E_JOB)}::uuid`,
)
record(
  'the job records what actually happened to the notification, not the word "delivered"',
  `state_reason=${String(stateReason?.r)}`,
  String(stateReason?.r).includes('delivered to slack via thread'),
)

const notifRow = await one<{ n: number }>(`
  select count(*)::int as n from public.notification_events
  where project_id = ${lit(PROJECT_ID)}::uuid and outcome = 'delivered'
`)
record(
  'and it is recorded as a notification, which is what learning later reads',
  `${String(notifRow?.n)} notification_events row(s)`,
  Number(notifRow?.n) === 1,
)

// Preferences: the same delivery, muted. The suppression must be recorded —
// "we decided not to tell you" is the fact that makes "why was I not told?"
// answerable three weeks later.
//
// Scoped to the fixture project, and inserted rather than upserted. The
// project-scoped row wins over any global preference (0013 orders the more
// specific scope first), so this check measures its own mute rather than
// whatever the workspace happens to be set to — which matters more than it
// sounds: this run's FIRST attempt at the end-to-end check was suppressed by a
// global preference a test left behind on 2026-09-03, and had the check muted
// globally it would have passed for the wrong reason. See migration 0036.
await db.execute(`
  delete from public.notification_preferences
   where subject = 'grant' and project_id = ${lit(PROJECT_ID)}::uuid;
  insert into public.notification_preferences (subject, project_id, muted_channels)
  values ('grant', ${lit(PROJECT_ID)}::uuid, array['slack'])
`)
const mutedJob = await one<{ id: string }>(`
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  values (${lit(E2E_CORRELATION)}::uuid, ${lit(PROJECT_ID)}::uuid,
          ${lit(`slack-e2e-muted-${stamp}`)}, 'research.conclusion', 'verify:slack', 100)
  returning job_id::text as id
`)
await db.execute(`
  insert into public.routing_decisions
    (job_id, intent_class, confident, intent_reason, subject_terms,
     duplicate_resolution, roster, roster_reason)
  values (${lit(String(mutedJob?.id))}::uuid, 'question', true,
          'The same question, asked while Slack is muted.',
          array['supplier'], 'none_found', array['research-director'],
          'Same single specialist.')
`)
const mutedDequeued = await dequeue(db, `verify-slack-${stamp}`)
const mutedResult =
  mutedDequeued === null
    ? null
    : await runJob(
        db,
        mutedDequeued,
        [e2eHandler],
        () => Promise.resolve({ status: 'approved' as const, notes: 'Fixture reviewer approved.' }),
        notifier,
      )
const suppressedRow = await one<{ n: number }>(`
  select count(*)::int as n from public.notification_events
  where project_id = ${lit(PROJECT_ID)}::uuid and outcome = 'suppressed'
`)
record(
  'a muted channel suppresses the delivery and RECORDS the suppression',
  `note=${String(mutedResult?.note).slice(0, 60)} suppressed rows=${String(suppressedRow?.n)}`,
  String(mutedResult?.note).includes('suppressed by notification preferences') &&
    Number(suppressedRow?.n) === 1,
)
await db.execute(`
  delete from public.notification_preferences
  where subject = 'grant' and project_id = ${lit(PROJECT_ID)}::uuid
`)

// ===========================================================================
// Interactivity: a button press, signed, arriving at the deployed endpoint
// ===========================================================================
//
// The six §12 buttons are on every message the office posts. Until something
// receives the click they are decoration, and a button that does nothing is
// worse than no button.
//
// These checks press one for real: a correctly signed, form-encoded
// `block_actions` payload at the live endpoint. What they cannot prove is that
// SLACK will send one — that needs an interactivity request URL on the app
// manifest, which needs a config-token rotation and is listed in the handoff.
// Everything on this side of that is exercised here.

const signingSecret = String(
  (
    await one<{ v: string }>(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'slack.signing_secret'`,
    )
  )?.v ?? '',
)
const ENDPOINT = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/slack-events`

const pressButton = async (
  actionId: string,
  messageTs: string,
  sign = true,
): Promise<{ status: number; body: string }> => {
  const body = `payload=${encodeURIComponent(
    JSON.stringify({
      type: 'block_actions',
      team: { id: TEAM_ID },
      user: { id: 'U0GRANTVERIFY' },
      channel: { id: CHANNEL },
      container: { channel_id: CHANNEL, message_ts: messageTs },
      actions: [{ action_id: actionId, value: JSON.stringify({ a: actionId, c: CORRELATION }) }],
    }),
  )}`
  const ts = String(Math.floor(Date.now() / 1000))
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (sign) {
    headers['X-Slack-Request-Timestamp'] = ts
    headers['X-Slack-Signature'] = await computeSignature(signingSecret, ts, body)
  }
  const response = await fetch(ENDPOINT, { method: 'POST', headers, body })
  return { status: response.status, body: (await response.text()).slice(0, 120) }
}

// The message pressed is the END-TO-END RESULT, not the first fixture message.
// That matters: only the result has a job, an output and a notification behind
// it, so pressing anything else would exercise the "no subject" branch and
// report it as if it were the ordinary one. The first attempt at these checks
// pressed the fixture message and passed its own weaker assertion.
const resultDelivery = await one<{ ts: string }>(`
  select message_ts as ts from public.slack_deliveries
  where dedupe_key = ${lit(`job:${E2E_JOB}:result`)}
`)
const PRESS_TS = String(resultDelivery?.ts)
const pressed = await pressButton('feedback.useful', PRESS_TS)
const pressedRow = await one<{ action: string; key: string; instruction: string }>(`
  select callback_action as action, dedupe_key as key, instruction
  from public.inbound_commands
  where dedupe_key = ${lit(`slack:action:${CHANNEL}:${PRESS_TS}:U0GRANTVERIFY:useful`)}
`)
record(
  'a signed button press reaches the deployed endpoint and is recorded as a signal',
  `http ${String(pressed.status)} action=${String(pressedRow?.action)}`,
  pressed.status === 200 && pressedRow?.action === 'useful',
)
record(
  'the press carries no instruction — it is a signal, not something Grant typed',
  `instruction=${JSON.stringify(pressedRow?.instruction ?? null)}`,
  pressedRow?.instruction === '',
)
record(
  'and the response body is empty, because Slack treats a body as a REPLACEMENT message',
  `body=${JSON.stringify(pressed.body)}`,
  pressed.body === '',
)

await pressButton('feedback.useful', PRESS_TS)
const pressCount = await one<{ n: number }>(`
  select count(*)::int as n from public.inbound_commands
  where dedupe_key = ${lit(`slack:action:${CHANNEL}:${PRESS_TS}:U0GRANTVERIFY:useful`)}
`)
record(
  'a double tap on one button is one signal',
  `${String(pressCount?.n)} row(s) after two presses`,
  Number(pressCount?.n) === 1,
)

const otherButton = await pressButton('more_detail', PRESS_TS)
const otherRow = await one<{ n: number }>(`
  select count(*)::int as n from public.inbound_commands
  where dedupe_key = ${lit(`slack:action:${CHANNEL}:${PRESS_TS}:U0GRANTVERIFY:more_detail`)}
`)
record(
  'CONTROL: a DIFFERENT button on the same message is a second signal, so the dedupe is not blanket',
  `http ${String(otherButton.status)} ${String(otherRow?.n)} row(s)`,
  Number(otherRow?.n) === 1,
)

const unsigned = await pressButton('feedback.useful', PRESS_TS, false)
record(
  'an unsigned press is refused — the signature is the whole of the authentication',
  `http ${String(unsigned.status)}`,
  unsigned.status === 401,
)

// The message the press is attached to identifies the work, and it does so from
// OUR record rather than from the value the client sent back. A button value is
// visible to anyone who can inspect the message; a `slack_deliveries` row is not.
const fromDelivery = await one<{ correlation_id: string | null }>(`
  select correlation_id::text as correlation_id from public.slack_deliveries
  where message_ts = ${lit(PRESS_TS)} and channel_id = ${lit(CHANNEL)}
`)
record(
  'the work a press is about is resolvable from our own record of the message, not from the click',
  `correlation from slack_deliveries=${String(fromDelivery?.correlation_id === E2E_CORRELATION)}`,
  fromDelivery?.correlation_id === E2E_CORRELATION,
)

// ===========================================================================
// Acting on the press — the other half of the button
// ===========================================================================
//
// Storing a press is not responding to one. Two mechanisms met here for the
// first time, each of which had been half-built: `inbound_commands.callback_action`
// has been constrained to §12's six words since 0011 and had never been read,
// and `notification_events` has an outcome column that 0031's learning weighs
// and that nothing outside its own fixtures had ever moved past `delivered`.

const processed = await processCallbacks(db, { subject: 'grant' })
const usefulPress = processed.find((p) => p.action === 'useful')
record(
  'a 👍 press becomes a feedback row against the output it was about',
  `outcome=${String(usefulPress?.outcome)} note=${String(usefulPress?.note).slice(0, 70)}`,
  usefulPress?.outcome === 'acted' && String(usefulPress.note).includes('recorded against output'),
)

// Scoped to THIS run's output rather than counted globally. Counting by
// `given_by` alone made this check depend on whether an earlier run's cleanup
// had completed — and one had not, so it reported 2 and looked like a
// double-processing bug.
const e2eOutput = await one<{ id: string }>(`
  select output_id::text as id from public.outputs where job_id = ${lit(E2E_JOB)}::uuid
`)
const feedbackRow = await one<{ n: number; kind: string }>(`
  select count(*)::int as n, max(subject_kind::text) as kind from public.feedback
  where signal = 'positive' and subject_ref = ${lit(String(e2eOutput?.id))}::uuid
`)
record(
  'and the feedback names the RIGHT output — the job the message reported on, not the correlation',
  `${String(feedbackRow?.n)} row(s) against the end-to-end output, subject_kind=${String(feedbackRow?.kind)}`,
  Number(feedbackRow?.n) === 1 && feedbackRow?.kind === 'output',
)

const acted = await one<{ n: number }>(`
  select count(*)::int as n from public.notification_events
  where project_id = ${lit(PROJECT_ID)}::uuid and outcome = 'acted' and resolved_at is not null
`)
record(
  'the notification moves past `delivered`, which is what learning reads and nothing wrote',
  `${String(acted?.n)} notification(s) now acted`,
  Number(acted?.n) === 1,
)

const secondPass = await processCallbacks(db, { subject: 'grant' })
record(
  'processing again does nothing — the claim is the UPDATE, not a read-then-write',
  `${String(secondPass.length)} press(es) processed on the second pass`,
  secondPass.filter((p) => p.commandId === usefulPress?.commandId).length === 0,
)

// Undo with nothing to undo. Expected rather than exceptional: an offer can
// lapse between the message being posted and the button being pressed, and a
// posted message cannot un-draw its own button.
await pressButton('undo', PRESS_TS)
const staleUndo = (await processCallbacks(db, { subject: 'grant' })).find(
  (p) => p.action === 'undo',
)
record(
  'a stale Undo says there is nothing left to undo rather than silently succeeding',
  `outcome=${String(staleUndo?.outcome)} note=${String(staleUndo?.note).slice(0, 60)}`,
  staleUndo?.outcome === 'nothing_to_undo',
)

// Undo with a live offer. The offer is created the way the system creates them.
await db.execute(`
  insert into public.undoable_actions
    (correlation_id, kind, description, reversal, status, undo_deadline)
  values (${lit(CORRELATION)}::uuid, 'slack.post',
          'A fixture action offered for undo by verify:slack.',
          ${lit(JSON.stringify({ channel: CHANNEL, ts: PRESS_TS }))}::jsonb,
          'available', app.now_utc() + interval '1 hour')
`)
// A different message, so the press is a different signal rather than a
// duplicate of the stale one.
const secondTs = String(inThread.messageTs)
await pressButton('undo', secondTs)
const realUndo = (await processCallbacks(db, { subject: 'grant' })).find((p) => p.action === 'undo')
const undone = await one<{ status: string }>(`
  select status::text as status from public.undoable_actions
  where correlation_id = ${lit(CORRELATION)}::uuid
`)
record(
  'an Undo with a live offer actually undoes it, through the same function every caller uses',
  `outcome=${String(realUndo?.outcome)} action status=${String(undone?.status)}`,
  realUndo?.outcome === 'acted' && undone?.status === 'undone',
)

// Mute goes through the same parse and the same store as a typed instruction,
// so there is one implementation of what a mute means.
await pressButton('mute_24h', secondTs)
const muted = (await processCallbacks(db, { subject: 'grant' })).find(
  (p) => p.action === 'mute_24h',
)
// Global, not project-scoped, and the check says so rather than accepting
// either. A button whose scope depends on what our records happen to contain
// means two different things on two different days.
const quiet = await one<{ quiet_until: string | null }>(`
  select quiet_until::text as quiet_until from public.notification_preferences
  where subject = 'grant' and project_id is null
`)
record(
  'Mute 24h writes a real GLOBAL preference, by the same route a typed instruction takes',
  `outcome=${String(muted?.outcome)} quiet_until=${quiet === undefined ? 'NO ROW' : String(quiet.quiet_until)}`,
  muted?.outcome === 'acted' && quiet !== undefined && quiet.quiet_until !== null,
)

// Cleared immediately, and checked. A verification run that leaves a live
// global mute behind is precisely what migration 0036 had to undo three days
// after gate-3 did it, and this suite is not going to be the second instance.
await db.execute(`
  delete from public.preference_instructions where instruction like 'mute 24h (button)%';
  delete from public.notification_preferences where subject = 'grant' and project_id is null;
`)
const stillMuted = await one<{ n: number }>(`
  select count(*)::int as n from public.notification_preferences
  where subject = 'grant' and project_id is null
`)
record(
  'and this suite clears its own global mute — a test must not leave the system quiet',
  `${String(stillMuted?.n)} global preference row(s) remain`,
  Number(stillMuted?.n) === 0,
)

// The `dismissed` outcome is NOT checked here, and the reason is worth stating
// rather than leaving as a gap. Only a notification still sitting at
// `delivered` can move, and the only such notification in this run was resolved
// to `acted` by the 👍 press three checks ago. A mute pressed on a message with
// no notification behind it therefore changes nothing — so a check here would
// pass on an absence, which is the failure mode this suite exists to avoid.
// `tests/channels/callbacks.test.ts` asserts the mapping directly instead.

// `more_detail` creates work, and creating work is the router's decision.
await pressButton('more_detail', secondTs)
const detail = (await processCallbacks(db, { subject: 'grant' })).find(
  (p) => p.action === 'more_detail',
)
record(
  'More detail is recorded and NOT acted on — enqueuing work here would bypass the router',
  `outcome=${String(detail?.outcome)}`,
  detail?.outcome === 'not_routed',
)

// ===========================================================================
// Token revoked
// ===========================================================================

// Assembled from parts so `check:secrets` does not have to tell a fixture from
// a credential — a scanner that learns exceptions stops being one.
const INVALID_TOKEN = ['xoxb', '0000000000', 'invalid-token-for-this-check'].join('-')
const badOffice = new SlackOffice(db, new SlackClient(INVALID_TOKEN))
const revokedKey = `verify:${stamp}:revoked`
const revoked = await badOffice.deliver(deliverOpts(revokedKey, CHANNEL, 'Should never appear.'))
record(
  'an invalid token fails the delivery and posts nothing',
  `${revoked.outcome} error=${String(revoked.errorCode)} in slack=${String(await countInSlack(revokedKey))}`,
  revoked.outcome === 'failed' &&
    (revoked.errorCode === 'invalid_auth' || revoked.errorCode === 'token_revoked') &&
    (await countInSlack(revokedKey)) === 0,
)
const revokedRow = await one<{ state: string; error_code: string }>(
  `select state::text as state, error_code from public.slack_deliveries where dedupe_key = ${lit(revokedKey)}`,
)
record(
  'and it is parked terminally, so nothing loops on a credential that cannot work',
  `state=${String(revokedRow?.state)} error=${String(revokedRow?.error_code)}`,
  revokedRow?.state === 'failed',
)

// ===========================================================================
// The channel renamed, then the bot removed from it
// ===========================================================================
//
// This order is not cosmetic. Renaming needs the bot to be in the channel, and
// being removed turns out not to be self-recoverable (below) — so a run that
// left first could never rename, and the rename check would fail for a reason
// that has nothing to do with renaming.

const NEW_NAME = `${created.channelName}-renamed`
let renameNoticed = false
let renameError = ''
try {
  await slack.call('conversations.rename', { channel: CHANNEL, name: NEW_NAME })
  renameNoticed = await office.recordRename(CHANNEL, NEW_NAME)
} catch (error) {
  renameError = (error as Error).message.slice(0, 80)
}
const afterRename = await office.deliver(
  deliverOpts(`verify:${stamp}:after-rename`, CHANNEL, 'Renaming the room does not move it.'),
)
record(
  'a rename updates the cached label and changes nothing about delivery — the id is the identity',
  `rename recorded=${String(renameNoticed)} deliver=${afterRename.outcome} ${renameError}`,
  renameNoticed && afterRename.outcome === 'sent',
)
const cachedName = await one<{ name: string }>(
  `select channel_name as name from public.slack_channel_map where channel_id = ${lit(CHANNEL)}`,
)
record(
  'the cached label was corrected rather than left stale',
  `channel_name=${String(cachedName?.name)}`,
  cachedName?.name === NEW_NAME,
)

// From here on the bot is out of the channel, so NOTHING below may read it —
// `conversations.history` returns `not_in_channel` too. Every check that needs
// to ask Slack what is in the channel has already run.
await slack.call('conversations.leave', { channel: CHANNEL })
const whileOut = await office.deliver(
  deliverOpts(`verify:${stamp}:while-out`, CHANNEL, 'Sent while locked out.'),
)
record(
  'being removed from a channel fails the delivery with the reason, not a crash',
  `${whileOut.outcome} error=${String(whileOut.errorCode)}`,
  whileOut.outcome === 'failed' && whileOut.errorCode === 'not_in_channel',
)
await office.recordRemoval(CHANNEL)
const removalRecorded = await one<{ bot_present: boolean; active: boolean }>(
  `select bot_present, active from public.slack_channel_map where channel_id = ${lit(CHANNEL)}`,
)
record(
  'the mapping distinguishes "locked out of the right room" from "the room is gone"',
  `bot_present=${String(removalRecorded?.bot_present)} active=${String(removalRecorded?.active)}`,
  removalRecorded?.bot_present === false && removalRecorded?.active === true,
)

// The finding, kept as a check so it cannot quietly stop being true. With the
// scopes this app was installed with, the bot CANNOT let itself back into a
// public channel: `conversations.join` needs `channels:join`, and
// `conversations.invite` refuses an inviter who is not in the channel. What is
// tested here is therefore not recovery — it is that the system reports which
// human action is required instead of retrying something that cannot work.
const rejoin = await office.rejoin(CHANNEL)
record(
  'a bot that was removed reports WHICH human action would let it back, rather than looping',
  `rejoin=${rejoin}`,
  rejoin === 'rejoined' || rejoin === 'needs_reinstall' || rejoin === 'needs_invite',
)
if (rejoin === 'rejoined') {
  const backIn = await office.deliver(
    deliverOpts(`verify:${stamp}:after-rejoin`, CHANNEL, 'Back in the room.'),
  )
  record('and once back in, delivery resumes', backIn.outcome, backIn.outcome === 'sent')
}

// ===========================================================================
// Leases: the recovery path, exercised by the only entry point there is
// ===========================================================================

const leaseKey = `verify:${stamp}:lease`
const held = await one<{ outcome: string }>(`
  select outcome from app.claim_slack_delivery(
    ${lit(leaseKey)}, ${lit(TEAM_ID)}, ${lit(CHANNEL)}, 'result', null, null, null, interval '0 seconds')
`)
const reclaimed = await one<{ outcome: string; attempt: number }>(`
  select outcome, attempt from app.claim_slack_delivery(
    ${lit(leaseKey)}, ${lit(TEAM_ID)}, ${lit(CHANNEL)}, 'result')
`)
record(
  'an expired claim is reclaimed by the claim function itself, with the attempt counted',
  `first=${String(held?.outcome)} second=${String(reclaimed?.outcome)} attempt=${String(reclaimed?.attempt)}`,
  held?.outcome === 'claimed' && reclaimed?.outcome === 'reclaimed' && reclaimed.attempt === 2,
)
const stillHeld = await one<{ outcome: string }>(`
  select outcome from app.claim_slack_delivery(
    ${lit(leaseKey)}, ${lit(TEAM_ID)}, ${lit(CHANNEL)}, 'result')
`)
record(
  'CONTROL: a live lease is NOT reclaimable, so the check above is measuring expiry',
  `outcome=${String(stillHeld?.outcome)}`,
  stillHeld?.outcome === 'held',
)

// ===========================================================================
// What the application role may and may not do
// ===========================================================================

const asApp = async (sql: string): Promise<string> => {
  try {
    await db.execute(`set local role ai_team_app; ${sql}`)
    return '(no error — it was ACCEPTED)'
  } catch (error) {
    return (error as Error).message.replace(/\s+/g, ' ').slice(0, 200)
  }
}
const directUpdate = await asApp(
  `update public.slack_deliveries set state = 'sent', message_ts = '1.1', sent_at = now() where dedupe_key = ${lit(leaseKey)}`,
)
record(
  'the app role cannot mark a delivery sent directly — that is a claim about the outside world',
  directUpdate.slice(0, 120),
  directUpdate.includes('permission denied'),
)
const canRead = await asApp(`select count(*) from public.slack_deliveries`)
record(
  'CONTROL: the same role CAN read the table, so the refusal above is about writing',
  canRead.slice(0, 80),
  canRead.includes('no error'),
)
const canClaim = await asApp(
  `select * from app.claim_slack_delivery(${lit(`verify:${stamp}:asapp`)}, ${lit(TEAM_ID)}, ${lit(CHANNEL)}, 'notice')`,
)
record(
  'CONTROL: and it CAN claim through the function, so the office is not locked out',
  canClaim.slice(0, 80),
  canClaim.includes('no error'),
)

// ===========================================================================
// Rate limiting — last, because it leaves the workspace throttled for a while
// ===========================================================================

const impatient = new SlackClient(botToken, { maxRateLimitRetries: 0 })
// §11: measured, never assumed. Gate 4 recorded a 429 after six calls to this
// method; this run took forty-eight, on the same method against the same
// workspace. So the number is a measurement of one moment, not a constant, and
// the budget here is generous enough that a slow window does not turn an
// environmental fact into a red check.
const RATE_LIMIT_BUDGET = 80
let rateLimit: SlackApiError | null = null
let callsBeforeLimit = 0
for (let i = 1; i <= RATE_LIMIT_BUDGET && rateLimit === null; i += 1) {
  try {
    await impatient.call('conversations.list', { limit: 1 })
    callsBeforeLimit = i
  } catch (error) {
    if (error instanceof SlackApiError && error.code === 'ratelimited') {
      rateLimit = error
      callsBeforeLimit = i
    } else throw error
  }
}
record(
  'a real 429 is recognised, classified as retryable, and reports the wait Slack asked for',
  rateLimit === null
    ? `no 429 within ${String(RATE_LIMIT_BUDGET)} calls — handling UNPROVEN this run`
    : `429 after ${String(callsBeforeLimit)} calls to conversations.list; retry-after=${String(rateLimit.retryAfter)}s kind=${rateLimit.kind}`,
  rateLimit !== null && rateLimit.kind === 'retryable' && (rateLimit.retryAfter ?? 0) > 0,
)
if (rateLimit !== null) {
  // The column exists for this (0014). Stored as an observation with its date,
  // because it is one method at one moment and reads as a promise otherwise.
  await db.execute(`
    update public.slack_workspaces
       set observed_rate_limit_tier = ${lit(`conversations.list: 429 after ${String(callsBeforeLimit)} calls, retry-after ${String(rateLimit.retryAfter)}s, observed ${new Date().toISOString().slice(0, 10)}`)}
     where team_id = ${lit(TEAM_ID)}
  `)
}

// ===========================================================================
// Report, then clean up
// ===========================================================================

const health = await db.execute(`select * from public.slack_delivery_health order by state`)
console.log('\ndelivery health:')
for (const row of health.rows) console.log(`  ${JSON.stringify(row)}`)

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) {
  console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)

try {
  await slack.call('conversations.archive', { channel: CHANNEL })
  console.log(`\narchived #${created.channelName}`)
} catch (error) {
  // Expected, and worth printing in full rather than swallowing: archiving
  // needs membership, the lockout check deliberately gave that up, and the app
  // cannot rejoin without `channels:join`. So each full run leaves one empty
  // channel behind until that scope is installed. Naming it here is the
  // difference between a known cost and a mystery.
  console.log(
    `\n#${created.channelName} (${CHANNEL}) could not be archived: ` +
      `${(error as Error).message.slice(0, 60)}. ` +
      "This is the lockout check's cost; it clears once the app is reinstalled " +
      'with channels:join.',
  )
}
try {
  await db.execute(`
    update public.slack_channel_map
       set active = false, archived_at = app.now_utc()
     where channel_id = ${lit(CHANNEL)};
    delete from public.slack_deliveries where dedupe_key like ${lit(`verify:${stamp}:%`)};
    delete from public.preference_instructions where command_id in (
      select command_id from public.inbound_commands where actor = 'U0GRANTVERIFY');
    delete from public.inbound_commands where actor = 'U0GRANTVERIFY';
    delete from public.feedback where given_by = 'U0GRANTVERIFY';
    delete from public.feedback where subject_ref in (
      select output_id from public.outputs o join public.jobs j on j.job_id = o.job_id
      where j.project_id = ${lit(PROJECT_ID)}::uuid);
    delete from public.notification_events where project_id = ${lit(PROJECT_ID)}::uuid;
    delete from public.undo_requests where action_id in (
      select action_id from public.undoable_actions
      where correlation_id = ${lit(CORRELATION)}::uuid);
    delete from public.undoable_actions where correlation_id = ${lit(CORRELATION)}::uuid;
    -- Jobs before the project, and explicitly: a fixture job left live holds
    -- queue capacity, and the queue is global and small. purge:fixtures would
    -- catch these eventually, but "eventually" is after the next suite has
    -- already refused to start.
    update public.jobs
       set state = 'cancelled',
           state_reason = 'verify:slack fixture retired'
     where project_id = ${lit(PROJECT_ID)}::uuid
       and state not in ('complete', 'cancelled', 'failed');
    update public.projects set status = 'archived' where project_id = ${lit(PROJECT_ID)}::uuid;
  `)
  console.log('fixtures retired; run `npm run purge:fixtures -- --go` for anything left.')
} catch (error) {
  console.log(`cleanup did not complete: ${(error as Error).message.slice(0, 160)}`)
}

if (failed.length > 0) process.exit(1)
