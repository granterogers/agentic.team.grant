/**
 * Synthetic work cannot cross a real external boundary.
 *
 *   npm run verify:escapes
 *
 * ## The failure this exists for
 *
 * On 21 September at 21:09 `verify:history` sent a real Telegram message to
 * Grant's own chat (message `1265`) and a real Slack message, and reported
 * **51/51, exit 0** while doing it. 0523 exists to make that impossible and
 * did not stop it, because every input to its guard was a value the harness
 * controls: the suite drives the real ingress on purpose, so while the job
 * runs its `requested_by` is `telegram:grant`, and `app.harness_job` — derived
 * from that string — said false at send time. The teardown rewrite then made
 * the escape visible afterwards, which is far too late.
 *
 * 0541 moves the mark off the work and onto the DOOR the work came through,
 * and makes it immutable. 0542 carries it down the lineage. This suite is the
 * sabotage that proves it.
 *
 * ## What "before any external side effect" means here, precisely
 *
 * Every attempt below runs through the real `DeliveryService` with a
 * transport that COUNTS its own invocations and sends nothing. In production
 * that call is the network. So `sends === 0` after an attempt is the proof
 * that nothing could have left the building — not an assertion about a
 * database column, but about whether the sending code was reached at all.
 *
 * The positive control is what makes that number mean anything: a permitted
 * delivery must drive the counter to 1. A stub nobody ever calls would
 * otherwise report a perfect score for a guard that refuses everything,
 * including Grant's real answers.
 */
import {
  type DeliveryChannel,
  DeliveryService,
  type SendRequest,
  type SendResult,
  type Transport,
} from '../../src/channels/delivery.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const run = Math.random().toString(36).slice(2, 10)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

let failures = 0
const check = (ok: boolean, label: string, detail = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

/*
  Grant's real destinations, on purpose.

  A guard proved only against a fabricated target is a guard proved against
  the case nobody was ever going to get wrong. `1386648496` is the chat that
  received "Reminder: Remind me khgkowx8." and, on 21 September, message 1265.
*/
const GRANTS_TELEGRAM = '1386648496'
const GRANTS_SLACK = String(
  (
    await one(
      `select channel_id as v from public.slack_channel_map
        where active and created_by_app order by created_at desc limit 1`,
    )
  ).v ?? 'C0C276SFM7D',
)

/** A transport that counts instead of sending. In production this is the network. */
class CountingTransport implements Transport {
  sends = 0
  lastTo = ''
  constructor(readonly channel: DeliveryChannel) {}
  async send(request: SendRequest): Promise<SendResult> {
    this.sends += 1
    this.lastTo = request.targetRef
    return { messageRef: `counted-${String(this.sends)}` }
  }
}

const jobs: string[] = []

/** A job created the way a suite creates one: through the real ingress. */
async function inboundJob(actor: string, channel: 'telegram' | 'slack'): Promise<string> {
  const cmd = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${lit(channel)}, ${lit(`escapes-${run}-${actor}`)}, ${lit(actor)},
            ${lit(`Escape probe ${run}.`)}, ${lit(`${channel}:message:escapes-${run}-${actor}`)},
            ${lit(actor)})
    returning command_id::text as id, synthetic`)
  /*
    `job_id`, read from the live function rather than guessed. The first draft
    read `job` -- which is what `app.say_in_project` returns -- and died on a
    cast of the empty string. Guessing a key costs what guessing a column name
    costs.
  */
  const enq = (await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v as
    | { job_id?: string }
    | string
  const parsed = typeof enq === 'string' ? (JSON.parse(enq) as { job_id?: string }) : enq
  const jobId = String(parsed.job_id ?? '')
  if (jobId === '') throw new Error(`enqueue_inbound returned no job_id: ${JSON.stringify(enq)}`)
  if (jobId !== '') jobs.push(jobId)
  return jobId
}

const attempt = async (
  jobId: string,
  channel: DeliveryChannel,
  target: string,
  label: string,
): Promise<{ outcome: string; sends: number }> => {
  const transport = new CountingTransport(channel)
  const service = new DeliveryService(db, transport)
  const result = await service.deliver({
    dedupeKey: `escapes:${run}:${label}:${channel}`,
    accountRef: channel === 'slack' ? 'T_escapes' : 'bot_escapes',
    targetRef: target,
    purpose: 'result',
    jobId,
    body: { text: `Escape probe ${run}. If you can read this, the guard failed.` },
  })
  return { outcome: result.outcome, sends: transport.sends }
}

console.log(`\nverify:escapes — synthetic work must not cross a real boundary (run ${run})\n`)

// ── 1. The exact defect: Grant-like attribution through the real ingress ───
const grantLike = await inboundJob('grant', 'telegram')
const marked = await one(`
  select synthetic, requested_by, is_fixture, app.harness_job(job_id) as harness
    from public.jobs where job_id = ${lit(grantLike)}::uuid`)
check(
  marked.synthetic === true,
  'a job whose attribution says Grant is still marked synthetic',
  `requested_by=${String(marked.requested_by)} is_fixture=${String(marked.is_fixture)} synthetic=${String(marked.synthetic)}`,
)
check(
  marked.harness === true,
  'and the send-time guard sees it as harness traffic',
  `harness_job=${String(marked.harness)}`,
)

const tg = await attempt(grantLike, 'telegram', GRANTS_TELEGRAM, 'grantlike')
check(
  tg.outcome === 'suppressed' && tg.sends === 0,
  "TELEGRAM ESCAPE REFUSED — to Grant's own chat, before the transport was reached",
  `outcome=${tg.outcome}, transport invoked ${String(tg.sends)} time(s)`,
)
const sl = await attempt(grantLike, 'slack', GRANTS_SLACK, 'grantlike')
check(
  sl.outcome === 'suppressed' && sl.sends === 0,
  'SLACK ESCAPE REFUSED — to a real app channel, before the transport was reached',
  `outcome=${sl.outcome}, transport invoked ${String(sl.sends)} time(s)`,
)

// ── 2. Attribution mutation, the move that hid the original escape ─────────
await db.execute(
  `update public.jobs set requested_by = 'telegram:grant', announce = true
    where job_id = ${lit(grantLike)}::uuid`,
)
const after = await attempt(grantLike, 'telegram', GRANTS_TELEGRAM, 'mutated')
check(
  after.outcome === 'suppressed' && after.sends === 0,
  'rewriting requested_by to look real does not unlock the send',
  `outcome=${after.outcome}, transport invoked ${String(after.sends)} time(s)`,
)

let refused = ''
try {
  await db.execute(
    `update public.jobs set synthetic = false where job_id = ${lit(grantLike)}::uuid`,
  )
  refused = '(the mark was cleared)'
} catch (error) {
  refused = (error as Error).message.replace(/\s+/g, ' ')
}
check(
  refused.includes('cannot be changed'),
  'and the mark itself cannot be cleared, by name',
  refused.slice(0, 96),
)

// ── 3. Lineage: a child of synthetic work is synthetic ─────────────────────
const child = String(
  (
    await one(
      `select app.enqueue_child(${lit(grantLike)}::uuid, 'artifact.report', '{}'::jsonb)::text as v`,
    )
  ).v ?? '',
)
if (child !== '') jobs.push(child)
const childMark = await one(
  `select synthetic, app.harness_job(job_id) as harness from public.jobs where job_id = ${lit(child)}::uuid`,
)
check(
  childMark.synthetic === true && childMark.harness === true,
  'a child of synthetic work inherits the mark',
  `synthetic=${String(childMark.synthetic)}`,
)
const childSend = await attempt(child, 'slack', GRANTS_SLACK, 'child')
check(
  childSend.outcome === 'suppressed' && childSend.sends === 0,
  'and the child cannot send either',
  `outcome=${childSend.outcome}, transport invoked ${String(childSend.sends)} time(s)`,
)

// ── 4. The other ingress vocabulary, so this is not a Telegram-only proof ──
const slackLike = await inboundJob('U0HISTREAL', 'slack')
const slackMark = await one(
  `select synthetic from public.jobs where job_id = ${lit(slackLike)}::uuid`,
)
const slackSend = await attempt(slackLike, 'slack', GRANTS_SLACK, 'slacklike')
check(
  slackMark.synthetic === true && slackSend.outcome === 'suppressed' && slackSend.sends === 0,
  'a Slack-shaped actor is refused on the same terms',
  `synthetic=${String(slackMark.synthetic)}, outcome=${slackSend.outcome}, sends=${String(slackSend.sends)}`,
)

// ── 5. POSITIVE CONTROL — without it, every zero above is meaningless ──────
/*
  A delivery that SHOULD go must drive the counter to 1, or this suite would
  score perfectly against a guard that refuses everything including Grant's
  real answers. Its inbound command is inserted through a simulated production
  door — `set local application_name` inside one statement — which is the only
  place in this repository that is allowed to do that, and the reason is
  exactly this control.
*/
const realCmd = await one(`
  set local application_name = 'PostgREST 14.5';
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
  values ('telegram', ${lit(`escapes-${run}-real`)}, '1386648496',
          ${lit(`Positive control ${run}.`)},
          ${lit(`telegram:message:escapes-${run}-real`)}, 'grant')
  returning command_id::text as id, synthetic`)
check(
  realCmd.synthetic === false,
  'CONTROL: a command arriving through a production door is NOT stamped',
  `synthetic=${String(realCmd.synthetic)} — the guard does not break real traffic`,
)
/*
  HELD IN THE SAME TRANSACTION THAT CREATES IT (ledger R37). This job is real
  by construction — that is the point of the control — so the deployed worker,
  which the enqueue wakes, would run it as Grant's turn and deliver the answer
  to his real Slack. It did, twice, on 21 September, and no witness could see
  it: the counter below is in this process and the worker is not. The job is
  made unrunnable and silent before the transaction commits, so no worker ever
  sees it as due; the claim under test (a PERMITTED delivery reaches the
  transport) does not need it to run.
*/
const realEnq = (
  await one(`select app.enqueue_inbound(${lit(String(realCmd.id))}::uuid) as v;
  update public.jobs set announce = false, not_before = app.now_utc() + interval '1 day'
   where pinned_config ->> 'command_id' = ${lit(String(realCmd.id))}`)
).v as { job_id?: string } | string
const realJob = String(
  (typeof realEnq === 'string' ? (JSON.parse(realEnq) as { job_id?: string }) : realEnq).job_id ??
    '',
)
if (realJob !== '') jobs.push(realJob)
/*
  Sent to a fabricated target, not Grant's. The claim under test is that a
  PERMITTED delivery reaches the transport; whose inbox it would land in is
  irrelevant to that and there is no reason to aim a probe at a real person.

  It must still satisfy `deliveries_target_shaped`, which requires a Telegram
  target to be `^-?[0-9]+$` -- so a fabricated NEGATIVE id, which has the
  shape of a group chat and belongs to nobody. The transport is a counter, so
  nothing leaves this process whatever the number says.
*/
/*
  #379. This control's key is one no production adapter writes, so since 0603
  its origin is UNKNOWN and the guard must refuse it even to Grant's real
  chat -- the shape of telegram:artifact_demo, which reached him on 17
  September. A refusal for the wrong reason looks exactly like the rule
  working, so the reason is asserted too.
*/
const unknownToGrant = await attempt(realJob, 'telegram', GRANTS_TELEGRAM, 'unknown-origin')
const unknownWhy = String(
  (
    await one(`select coalesce(suppressed_reason, '') as r from public.deliveries
      where dedupe_key = ${lit(`escapes:${run}:unknown-origin:telegram`)}`)
  ).r ?? '',
)
check(
  unknownToGrant.outcome === 'suppressed' &&
    unknownToGrant.sends === 0 &&
    unknownWhy.includes('unknown origin'),
  '#379: work of unknown origin never reaches his real chat, refused as unknown origin',
  `outcome=${unknownToGrant.outcome}, sends=${String(unknownToGrant.sends)}, reason=${unknownWhy}`,
)
/*
  The positive control, through a destination REGISTERED for this run (#378):
  a registered test destination may receive anything, so a delivery there
  must reach the transport. A fresh id each run, because the table refuses any
  target that has ever had a real delivery, and removed in teardown.
*/
const TEST_CHAT = `-9${String(Date.now()).slice(-12)}`
await db.execute(`insert into public.test_destinations (channel, target_ref, why)
  values ('telegram', ${lit(TEST_CHAT)}, ${lit(`verify:escapes ${run} - a group id nobody holds, behind a counting transport`)})`)
const permitted = await attempt(realJob, 'telegram', TEST_CHAT, 'control')
check(
  permitted.outcome === 'sent' && permitted.sends === 1,
  'CONTROL: a delivery to a registered test destination DOES reach the transport',
  `outcome=${permitted.outcome}, transport invoked ${String(permitted.sends)} time(s)`,
)

// ── 6. Nothing escaped, measured the way check:leaks measures it ───────────
const escaped = await one(`
  select count(*)::int as n from public.deliveries d
   where app.harness_job(d.job_id) and d.sent_at is not null
     and d.dedupe_key like ${lit(`escapes:${run}:%`)}`)
check(
  Number(escaped.n ?? -1) === 0,
  'no harness delivery of this run reached a real destination',
  `${String(escaped.n)} escape(s)`,
)

// The control job itself never ran and never reached anybody (R37).
const controlOut = await one(`
  select (select state::text from public.jobs where job_id = ${lit(realJob)}::uuid) as st,
         (select count(*)::int from public.deliveries
           where job_id = ${lit(realJob)}::uuid and sent_at is not null
             and target_ref <> ${lit(TEST_CHAT)}) as real_sends`)
check(
  controlOut.st === 'queued' && Number(controlOut.real_sends ?? -1) === 0,
  'the real-looking control job was held: no worker ran it and it reached nobody',
  `state=${String(controlOut.st)}, real sends=${String(controlOut.real_sends)}`,
)

// ── teardown, asserted ─────────────────────────────────────────────────────
await db.execute(`delete from public.deliveries where dedupe_key like ${lit(`escapes:${run}:%`)}`)
await db.execute(`select app.retire_test_destination('telegram', ${lit(TEST_CHAT)})`)
await db.execute(`
  delete from public.inbound_commands where dedupe_key like ${lit(`%escapes-${run}-%`)}`)
if (jobs.length > 0) {
  await db.execute(`
    update public.jobs set state = 'cancelled', state_reason = 'verify:escapes teardown'
     where job_id in (${jobs.map((j) => `${lit(j)}::uuid`).join(', ')})
       and state not in ('complete', 'cancelled', 'failed');
    update public.jobs set requested_by = 'verify:escapes'
     where job_id in (${jobs.map((j) => `${lit(j)}::uuid`).join(', ')});`)
}
const left = await one(`
  select
    (select count(*) from public.deliveries where dedupe_key like ${lit(`escapes:${run}:%`)})::int as d,
    -- Retired, never deleted (0606): nothing ACTIVE left, and the evidence kept.
    (select count(*) from public.test_destinations where target_ref = ${lit(TEST_CHAT)} and retired_at is null)::int as t,
    (select count(*) from public.test_destinations where target_ref = ${lit(TEST_CHAT)} and retired_at is not null)::int as kept,
    (select count(*) from public.jobs
      where job_id in (${jobs.length === 0 ? 'null' : jobs.map((j) => `${lit(j)}::uuid`).join(', ')})
        and state not in ('complete', 'cancelled', 'failed'))::int as j`)
check(
  Number(left.d ?? -1) === 0 &&
    Number(left.j ?? -1) === 0 &&
    Number(left.t ?? -1) === 0 &&
    Number(left.kept ?? -1) === 1,
  'teardown — no delivery row, no live job and no test destination of this run',
  `${String(left.d)} delivery row(s), ${String(left.j)} live job(s), ${String(left.t)} active test destination(s), ${String(left.kept)} retired and kept`,
)

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`)
  process.exit(1)
}
console.log('\nSynthetic work cannot cross a real external boundary.')
