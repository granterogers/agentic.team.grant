/**
 * The office does not answer itself, and a redelivered event is not a second
 * message.
 *
 *   npm run verify:echo
 *
 * Issue #195, and the precondition for #193.
 *
 * ## Why this is a suite and not a feature
 *
 * Planning #195 assumed identity, deduplication and loop prevention all had to
 * be built. Reading the schema and the adapter says otherwise — every one of
 * them already exists:
 *
 *   - `inbound_commands.dedupe_key` is NOT NULL, UNIQUE, and shaped by
 *     `inbound_dedupe_key_shaped` as `<surface>:<kind>:<the surface's own id>`;
 *   - `deliveries.dedupe_key` is unique too, and `deliveries.message_ref`
 *     holds the external id of everything the office has ever sent;
 *   - `toCanonicalCommand` refuses an event carrying `bot_id`, or one whose
 *     user is the app itself, BEFORE any other branch;
 *   - `storeCommand` posts with `resolution=merge-duplicates` and treats a
 *     concurrent 409 as success rather than as a failure to retry;
 *   - `enqueue_inbound` returns the existing job for a command that already
 *     has one, because a webhook is at-least-once.
 *
 * What none of that had was a check. CLAUDE.md is blunt about what that is
 * worth: 0317's own header claimed "pressing Import twice imports one
 * document", and it did not, for five migrations. A property nothing asserts
 * is a property nobody has tested.
 *
 * So this drives the REAL signed endpoint, twice, and looks at what the
 * database actually holds — not the interpreter in isolation, which
 * `tests/slack/events.test.ts` already covers.
 *
 * ## The check that stops the fix being too eager
 *
 * Deduplication that is slightly too keen is worse than none, because it
 * discards something Grant said. So the suite also sends a message that quotes
 * the office's own words back, from a human, and asserts it IS recorded. A
 * loop-prevention rule that works by comparing text would fail exactly there.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { computeSignature } from '../../src/slack/signature.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const num = async (sql: string): Promise<number> => Number((await one(sql)).n ?? -1)

const ENDPOINT = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/slack-events`
const run = Math.random().toString(36).slice(2, 10)
const CHANNEL = 'C0ECHOVERIFY'
const TEAM = 'T0ECHOVERIFY'
const HUMAN = 'U0ECHOVERIFY'

const signingSecret = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'slack.signing_secret'`,
    )
  ).v ?? '',
)
if (signingSecret === '') {
  console.error('no slack.signing_secret in the vault — run npm run deploy:slack')
  process.exit(2)
}

/** Post a real, signed event at the real endpoint, exactly as Slack would. */
const deliver = async (event: Record<string, unknown>): Promise<number> => {
  const body = JSON.stringify({ type: 'event_callback', team_id: TEAM, event })
  const ts = String(Math.floor(Date.now() / 1000))
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': ts,
      'X-Slack-Signature': await computeSignature(signingSecret, ts, body),
    },
    body,
  })
  return r.status
}

const commandsFor = async (slackTs: string): Promise<number> =>
  num(
    `select count(*)::int as n from public.inbound_commands
      where dedupe_key = ${lit(`slack:message:${CHANNEL}:${slackTs}`)}`,
  )

/*
  Register this suite's Slack user as harness traffic before sending anything.

  `enqueue_inbound` composes `requested_by` as `<origin_channel>:<subject>`,
  and `subject` comes from `subject_identities` — so mapping this actor to
  `verify-echo` makes every job the suite causes a fixture (0342, #203).

  Without it these are `slack:U0ECHOVERIFY`, which is not a fixture, and the
  office picks them up and answers them for real. That is exactly what
  `verify:addressing` was doing to 43 jobs before anybody noticed.
*/
await db.execute(`
  insert into public.subject_identities (subject, origin_channel, actor, note)
  values ('verify-echo', 'slack', ${lit(HUMAN)}, 'verify:echo harness traffic (#203)')
  on conflict do nothing
`)

try {
  console.log('\na message arrives once')

  const first = `1700000${run.slice(0, 3)}.000100`
  const s1 = await deliver({
    type: 'message',
    user: HUMAN,
    channel: CHANNEL,
    ts: first,
    text: `Echo proof ${run} — the first time`,
  })
  check('Slack is answered', `http ${String(s1)}`, s1 >= 200 && s1 < 300)
  check(
    'and the message is recorded',
    `${String(await commandsFor(first))} row(s)`,
    (await commandsFor(first)) === 1,
  )

  // -----------------------------------------------------------------------
  console.log('\nthe same event, delivered again — which Slack does')

  const s2 = await deliver({
    type: 'message',
    user: HUMAN,
    channel: CHANNEL,
    ts: first,
    text: `Echo proof ${run} — the first time`,
  })
  check(
    'a redelivery is answered rather than refused',
    `http ${String(s2)} — a retry Slack is told to repeat is a retry forever`,
    s2 >= 200 && s2 < 300,
  )
  const after = await commandsFor(first)
  check(
    'and it is still ONE message, not two',
    `${String(after)} row(s) for the same channel and ts`,
    after === 1,
  )

  const jobs = await num(`
    select count(*)::int as n from public.jobs j
      join public.inbound_commands c on c.job_id = j.job_id
     where c.dedupe_key = ${lit(`slack:message:${CHANNEL}:${first}`)}
  `)
  const asFixture = await num(`
    select count(*)::int as n from public.jobs j
      join public.inbound_commands c on c.job_id = j.job_id
     where c.dedupe_key = ${lit(`slack:message:${CHANNEL}:${first}`)}
       and j.is_fixture
  `)
  check(
    'and that work is marked as harness traffic, not as Grant asking',
    `${String(asFixture)} of ${String(jobs)} is a fixture`,
    jobs === 0 || asFixture === jobs,
  )
  check(
    'and it made one piece of work, not two — enqueue_inbound is idempotent',
    `${String(jobs)} job(s)`,
    jobs <= 1,
  )

  // -----------------------------------------------------------------------
  console.log('\nthe office hearing itself')

  /*
    The exact shape of the loop #193 would create: the office posts to a
    channel, Slack's events API delivers that message straight back, and
    without this it becomes a new instruction — which produces another answer,
    which is delivered back again.
  */
  const botTs = `1700000${run.slice(0, 3)}.000200`
  const s3 = await deliver({
    type: 'message',
    bot_id: 'B0ECHOVERIFY',
    channel: CHANNEL,
    ts: botTs,
    text: `I have queued that for you ${run}`,
  })
  check('the office’s own post is answered politely', `http ${String(s3)}`, s3 >= 200 && s3 < 300)
  check(
    'and is NOT recorded as something anybody said',
    `${String(await commandsFor(botTs))} row(s) — nothing`,
    (await commandsFor(botTs)) === 0,
  )

  // -----------------------------------------------------------------------
  console.log('\nand the check that stops the rule being too eager')

  /*
    Grant quoting the office back at himself is a real message. A loop check
    that worked by comparing TEXT would throw this away, and the failure would
    be invisible: he would simply never get an answer.
  */
  const quoteTs = `1700000${run.slice(0, 3)}.000300`
  await deliver({
    type: 'message',
    user: HUMAN,
    channel: CHANNEL,
    ts: quoteTs,
    text: `I have queued that for you ${run}`,
  })
  check(
    'a person quoting the office verbatim IS recorded — the same words, a real message',
    `${String(await commandsFor(quoteTs))} row(s)`,
    (await commandsFor(quoteTs)) === 1,
  )

  // -----------------------------------------------------------------------
  console.log('\nthe identity that makes all of it possible')

  const shaped = await num(`
    select count(*)::int as n from public.inbound_commands
     where origin_ref like ${lit(`${CHANNEL}%`)}
       and dedupe_key !~ '^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$'
  `)
  check(
    'every message this run recorded carries a shaped identity',
    `${String(shaped)} malformed`,
    shaped === 0,
  )

  const unique = String(
    (
      await one(`
        select indexdef as v from pg_indexes
         where schemaname='public' and indexname='inbound_commands_dedupe'
      `)
    ).v ?? '',
  )
  /*
    Asserted as a PROPERTY — unique, over dedupe_key, with nothing nullable in
    it — rather than by index name alone. CLAUDE.md records four separate times
    a check asserted the artefact and went red on a correct refactor.
  */
  check(
    'and one message can only ever be recorded once, by constraint rather than by convention',
    unique.replace(/\s+/g, ' ').slice(0, 78),
    unique.includes('UNIQUE') && unique.includes('dedupe_key'),
  )
} finally {
  console.log('\nteardown')

  /*
    Jobs first. A job can never be deleted — `job_state_transitions` is
    append-only by §6 — so the withdrawal path is `cancelled`, and only from a
    non-terminal state: `enforce_job_transition` refuses complete -> cancelled
    and is right to, which is what `verify:import` learned by copying another
    suite's teardown along with its assumptions.
  */
  await db.execute(`
    update public.jobs
       set state = 'cancelled', state_reason = 'verify:echo probe, never run'
     where job_id in (
       select job_id from public.inbound_commands
        where origin_ref like ${lit(`${CHANNEL}%`)} and job_id is not null)
       and state not in ('complete', 'cancelled', 'failed')
  `)
  await db.execute(
    `delete from public.inbound_commands_slack where command_id in (
       select command_id from public.inbound_commands where origin_ref like ${lit(`${CHANNEL}%`)})`,
  )
  await db.execute(
    `delete from public.inbound_commands where origin_ref like ${lit(`${CHANNEL}%`)}`,
  )

  const left = await num(
    `select count(*)::int as n from public.inbound_commands where origin_ref like ${lit(`${CHANNEL}%`)}`,
  )
  check(
    'teardown — nothing this run said is still on the record',
    `${String(left)} left`,
    left === 0,
  )

  const live = await num(`
    select count(*)::int as n from public.jobs
     where state_reason = 'verify:echo probe, never run'
       and state not in ('complete', 'cancelled', 'failed')
  `)
  check(
    'teardown — and no probe job is still live in the queue',
    `${String(live)} live`,
    live === 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
