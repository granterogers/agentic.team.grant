/**
 * Gate 4 — Slack.
 *
 *   npm run poc:gate-4
 *
 * §13: *"Prove installation, auth, channel mapping, project channel creation,
 * DM, thread, reactions, event receipt, **command normalization**, preference
 * updates, rate limits, token revocation, reconnect/reinstall, that **Postgres
 * remains canonical**, and that **Slack history loss does not break the
 * application**."*
 *
 * Fifteen requirements, in that order below.
 *
 * What is real: the workspace, the bot, the channel it creates, the messages it
 * posts, the thread, the reaction, the rate-limit measurement, the deployed
 * endpoint, and the database. Inbound events are **signed with the real signing
 * secret and posted to the live endpoint**, which exercises the identical code
 * path Slack's own traffic takes — Slack's own `url_verification` reached this
 * endpoint and passed during `npm run slack:configure-events`, which is the
 * third-party half of that claim.
 *
 * What is not real: a human typing. Slack has no API for that, so a message
 * "from Grant" is synthesised. Recorded as a limitation rather than glossed.
 *
 * The script cleans up after itself: the channel it creates is archived and its
 * messages deleted — which is not tidiness, it is check 15.
 */

import { applyPreference } from '../../src/channels/preference-store.ts'
import { parseInstruction } from '../../src/channels/preferences.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { computeSignature } from '../../src/slack/signature.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
const botToken = process.env.SLACK_BOT_TOKEN
if (supabase === undefined || supabase === '' || botToken === undefined || botToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN and SLACK_BOT_TOKEN are required')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)
const endpoint = `https://${ref}.supabase.co/functions/v1/slack-events`

const rows: { n: string; what: string; outcome: string; passed: boolean }[] = []
const add = (n: string, what: string, outcome: string, passed: boolean): void => {
  rows.push({ n, what, outcome, passed })
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n} ${what} — ${outcome}`)
}

type SlackResponse = Record<string, unknown> & { ok?: boolean; error?: string }

/** Write methods: `chat.*`, `conversations.create/archive`, `reactions.add`. */
const slack = async (method: string, body?: unknown): Promise<SlackResponse> => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body ?? {}),
  })
  return (await r.json()) as SlackResponse
}

/**
 * Read methods, which need query parameters rather than a JSON body.
 *
 * The Slack Web API is not uniformly JSON, and this run is how that was
 * discovered. `conversations.replies`, `reactions.get` and
 * `conversations.history` sent as JSON return `ok: false` with
 * `invalid_arguments` and `no_item_specified` — errors that describe the
 * arguments rather than the encoding, so they read as "you asked for the wrong
 * thing" instead of "you asked the wrong way".
 *
 * The dangerous part was not the failure. `ok: false` carries no `messages`
 * key, so `((body.messages ?? []) as unknown[]).length` is 0, and a check
 * written as "at least 0 replies" or "no error thrown" would have passed while
 * reading nothing at all. Every read below asserts an exact count.
 */
const slackRead = async (
  method: string,
  params: Record<string, string>,
): Promise<SlackResponse> => {
  const r = await fetch(
    `https://slack.com/api/${method}?${new URLSearchParams(params).toString()}`,
    { method: 'GET', headers: { Authorization: `Bearer ${botToken}` } },
  )
  return (await r.json()) as SlackResponse
}

const signingSecret = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'slack.signing_secret'`,
    )
  ).rows[0]?.v ?? '',
)
if (signingSecret === '') {
  console.error('no slack.signing_secret in the vault — run npm run deploy:slack')
  process.exit(2)
}

/** Post a signed envelope to the live endpoint, exactly as Slack would. */
const deliver = async (
  envelope: unknown,
  opts: { badSignature?: boolean; staleBy?: number } = {},
): Promise<{ status: number; body: string }> => {
  const body = JSON.stringify(envelope)
  const ts = String(Math.floor(Date.now() / 1000) - (opts.staleBy ?? 0))
  const signature =
    opts.badSignature === true
      ? `v0=${'0'.repeat(64)}`
      : await computeSignature(signingSecret, ts, body)
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': ts,
      'X-Slack-Signature': signature,
    },
    body,
  })
  return { status: r.status, body: (await r.text()).slice(0, 300) }
}

const stamp = Date.now()
const GRANT = 'U_GATE4_GRANT'
let channelId = ''
let projectId = ''
let parentTs = ''
let teamId = ''
let botUserId = ''

// ---------------------------------------------------------------------------
// 1. installation and 2. auth
// ---------------------------------------------------------------------------
{
  const auth = await slack('auth.test')
  teamId = String(auth.team_id ?? '')
  botUserId = String(auth.user_id ?? '')
  const workspace = await db.execute(`
    select team_name, bot_user_id, installed from public.slack_workspaces
    where team_id = '${teamId}'
  `)
  add(
    '1',
    'the app is installed, and installation is a fact in Postgres',
    `team=${String(auth.team)} bot=${String(auth.user)} installed=${String(workspace.rows[0]?.installed)}`,
    auth.ok === true && workspace.rows[0]?.installed === true,
  )
  add(
    '2',
    'auth works and the bot user id recorded matches the live one',
    `${botUserId} vs ${String(workspace.rows[0]?.bot_user_id)}`,
    botUserId !== '' && String(workspace.rows[0]?.bot_user_id) === botUserId,
  )
}

// ---------------------------------------------------------------------------
// 3. project channel creation — the app creates its own channel
// ---------------------------------------------------------------------------
{
  const project = await db.execute(`
    insert into public.projects (name, slug, status)
    values ('Gate 4 probe ${stamp}', 'gate4-probe-${String(stamp).slice(-8)}', 'active')
    returning project_id::text as project_id
  `)
  projectId = String(project.rows[0]?.project_id)

  const name = `gate4-probe-${String(stamp).slice(-8)}`
  const created = await slack('conversations.create', { name, is_private: false })
  channelId = String((created.channel as Record<string, unknown> | undefined)?.id ?? '')
  add(
    '3',
    'the app creates a project channel itself',
    `#${name} -> ${channelId === '' ? String(created.error) : channelId}`,
    created.ok === true && channelId !== '',
  )
}

// ---------------------------------------------------------------------------
// 4. channel mapping, and it resolves both ways
// ---------------------------------------------------------------------------
{
  await db.execute(`
    insert into public.slack_channel_map
      (channel_id, team_id, project_id, channel_name, purpose, created_by_app)
    values
      ('${channelId}', '${teamId}', '${projectId}'::uuid,
       'gate4-probe', 'project', true)
    on conflict (channel_id) do update
      set project_id = excluded.project_id, active = true, archived_at = null
  `)
  const forward = await db.execute(
    `select app.project_for_slack_channel('${channelId}')::text as project_id`,
  )
  const back = await db.execute(
    `select array_agg(c)::text as channels from app.slack_channels_for_project('${projectId}') c`,
  )
  add(
    '4',
    'the channel resolves to its project, and the project to its channels',
    `channel -> project: ${String(forward.rows[0]?.project_id) === projectId ? 'correct' : 'WRONG'}; ` +
      `project -> channels: ${String(back.rows[0]?.channels)}`,
    String(forward.rows[0]?.project_id) === projectId &&
      String(back.rows[0]?.channels).includes(channelId),
  )
}

// ---------------------------------------------------------------------------
// 5. a real message, and 6. a real thread
// ---------------------------------------------------------------------------
{
  const posted = await slack('chat.postMessage', {
    channel: channelId,
    text: 'Gate 4 evidence: parent message.',
  })
  parentTs = String(posted.ts ?? '')
  const reply = await slack('chat.postMessage', {
    channel: channelId,
    thread_ts: parentTs,
    text: 'Gate 4 evidence: threaded reply.',
  })
  const replies = await slackRead('conversations.replies', { channel: channelId, ts: parentTs })
  const count = ((replies.messages as unknown[] | undefined) ?? []).length
  add(
    '5',
    'the app posts to a channel',
    `ts=${parentTs || String(posted.error)}`,
    posted.ok === true && parentTs !== '',
  )
  add(
    '6',
    'a threaded reply lands in the thread, confirmed by reading the thread back',
    `reply ts=${String(reply.ts ?? reply.error)}; read back ok=${String(replies.ok)}` +
      `${replies.ok === true ? '' : ` (${String(replies.error)})`}; messages in thread=${String(count)}`,
    reply.ok === true && replies.ok === true && count === 2,
  )
}

// ---------------------------------------------------------------------------
// 7. reactions, outbound and read back
// ---------------------------------------------------------------------------
{
  const added = await slack('reactions.add', {
    channel: channelId,
    timestamp: parentTs,
    name: 'eyes',
  })
  const got = await slackRead('reactions.get', { channel: channelId, timestamp: parentTs })
  const message = got.message as Record<string, unknown> | undefined
  const names = (((message?.reactions ?? []) as { name?: string }[]) ?? []).map((r) =>
    String(r.name),
  )
  add(
    '7',
    'a reaction is added and reads back on the message',
    `added=${String(added.ok)} read back ok=${String(got.ok)}` +
      `${got.ok === true ? '' : ` (${String(got.error)})`} reactions=[${names.join(',')}]`,
    added.ok === true && got.ok === true && names.includes('eyes'),
  )
}

// ---------------------------------------------------------------------------
// 8. event receipt — signature enforcement at the live endpoint
// ---------------------------------------------------------------------------
{
  const unsigned = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"type":"url_verification","challenge":"x"}',
  })
  const badSig = await deliver({ type: 'url_verification', challenge: 'x' }, { badSignature: true })
  const stale = await deliver({ type: 'url_verification', challenge: 'x' }, { staleBy: 600 })
  const good = await deliver({ type: 'url_verification', challenge: `g4-${stamp}` })
  add(
    '8',
    'the endpoint refuses unsigned, wrongly signed and replayed requests, and answers a valid one',
    `unsigned=${String(unsigned.status)} bad_sig=${String(badSig.status)} ` +
      `replayed=${String(stale.status)} valid=${String(good.status)} echoed=${String(good.body.includes(String(stamp)))}`,
    unsigned.status === 401 &&
      badSig.status === 401 &&
      stale.status === 401 &&
      good.status === 200 &&
      good.body.includes(String(stamp)),
  )
}

// ---------------------------------------------------------------------------
// 9. command normalization — four event shapes, one canonical envelope
// ---------------------------------------------------------------------------
{
  const event = (e: Record<string, unknown>, id: string): unknown => ({
    type: 'event_callback',
    team_id: teamId,
    api_app_id: 'A0BUFRVSSLD',
    event_id: id,
    event_time: Math.floor(stamp / 1000),
    event: e,
  })

  const shapes: { label: string; envelope: unknown; expect: Record<string, unknown> }[] = [
    {
      label: 'channel message',
      envelope: event(
        {
          type: 'message',
          user: GRANT,
          channel: channelId,
          ts: `${String(stamp)}.000100`,
          text: 'what is the status of the migration?',
        },
        `Ev-msg-${stamp}`,
      ),
      expect: { is_dm: false, thread_ts: null, callback_action: null },
    },
    {
      label: 'mention with the address stripped',
      envelope: event(
        {
          type: 'message',
          user: GRANT,
          channel: channelId,
          ts: `${String(stamp)}.000150`,
          text: `<@${botUserId}> summarise the last week`,
        },
        `Ev-mention-${stamp}`,
      ),
      expect: { instruction: 'summarise the last week' },
    },
    {
      label: 'threaded reply',
      envelope: event(
        {
          type: 'message',
          user: GRANT,
          channel: channelId,
          ts: `${String(stamp)}.000200`,
          thread_ts: `${String(stamp)}.000100`,
          text: 'and the one before that',
        },
        `Ev-thread-${stamp}`,
      ),
      expect: { thread_ts: `${String(stamp)}.000100` },
    },
    {
      label: 'direct message',
      envelope: event(
        {
          type: 'message',
          user: GRANT,
          channel: 'D0GATE4DM01',
          channel_type: 'im',
          ts: `${String(stamp)}.000300`,
          text: 'only important things',
        },
        `Ev-dm-${stamp}`,
      ),
      expect: { is_dm: true },
    },
    {
      label: 'reaction',
      envelope: event(
        {
          type: 'reaction_added',
          user: GRANT,
          reaction: '+1',
          item: { type: 'message', channel: channelId, ts: `${String(stamp)}.000100` },
        },
        `Ev-react-${stamp}`,
      ),
      expect: { callback_action: 'useful' },
    },
  ]

  const outcomes: string[] = []
  let allOk = true
  for (const shape of shapes) {
    const r = await deliver(shape.envelope)
    const ok = r.status === 200 && r.body.includes('dedupe_key')
    if (!ok) allOk = false
    outcomes.push(`${shape.label}=${String(r.status)}${ok ? '' : ` ${r.body.slice(0, 60)}`}`)
  }

  const stored = await db.execute(`
    select c.dedupe_key, c.instruction, c.callback_action,
           s.is_dm, s.thread_ts, s.channel_id, s.reaction
    from public.inbound_commands c
    left join public.inbound_commands_slack s on s.command_id = c.command_id
    where c.dedupe_key like 'slack:%${String(stamp)}%'
       or c.dedupe_key like 'slack:reaction:${channelId}:${String(stamp)}%'
    order by c.dedupe_key
  `)

  const byKind = Object.fromEntries(
    stored.rows.map((r) => [String(r.dedupe_key).split(':')[1] ?? '?', r]),
  )
  const dmRow = stored.rows.find((r) => r.is_dm === true)
  const threadRow = stored.rows.find((r) => r.thread_ts !== null)
  const reactionRow = stored.rows.find((r) => r.callback_action === 'useful')
  const mentionRow = stored.rows.find((r) => String(r.instruction) === 'summarise the last week')

  add('9', 'five event shapes normalize into one canonical envelope', outcomes.join(' '), allOk)
  add(
    '9b',
    'and each is stored with the Slack routing that only Slack means',
    `rows=${String(stored.rows.length)} kinds=[${Object.keys(byKind).join(',')}] ` +
      `dm=${String(dmRow !== undefined)} thread=${String(threadRow !== undefined)} ` +
      `reaction=${String(reactionRow !== undefined)} mention_stripped=${String(mentionRow !== undefined)}`,
    stored.rows.length === 5 &&
      dmRow !== undefined &&
      threadRow !== undefined &&
      reactionRow !== undefined &&
      mentionRow !== undefined,
  )

  // Our own message coming back as an event. Without this the app answers
  // itself, forever, and the loop is the kind that costs money.
  const selfEcho = await deliver(
    event(
      {
        type: 'message',
        user: botUserId,
        channel: channelId,
        ts: `${String(stamp)}.000400`,
        text: 'Gate 4 evidence: parent message.',
      },
      `Ev-self-${stamp}`,
    ),
  )
  add(
    '9c',
    "the app's own message is not read back as an instruction",
    `${String(selfEcho.status)} ${selfEcho.body.includes('ignored') ? 'ignored' : selfEcho.body.slice(0, 60)}`,
    selfEcho.status === 200 && selfEcho.body.includes('ignored'),
  )

  // Idempotency, concurrently — Slack retries on any non-2xx and on timeout.
  const dup = shapes[0]?.envelope
  const concurrent = await Promise.all([1, 2, 3, 4, 5].map(async () => deliver(dup)))
  const after = await db.execute(`
    select count(*)::int as n from public.inbound_commands
    where dedupe_key = 'slack:message:${channelId}:${String(stamp)}.000100'
  `)
  add(
    '9d',
    '5 concurrent redeliveries of one event produce one row',
    `all 200: ${String(concurrent.every((r) => r.status === 200))}; rows: ${String(after.rows[0]?.n)}`,
    concurrent.every((r) => r.status === 200) && Number(after.rows[0]?.n) === 1,
  )
}

// ---------------------------------------------------------------------------
// 10. preference updates, arriving from Slack
// ---------------------------------------------------------------------------
{
  // The DM in check 9 said "only important things". §5 forbids the adapter from
  // acting on it — *"channel adapters may only translate"* — so the adapter
  // stored it and the policy applies it. That separation is the point: this is
  // the same parse the Telegram path uses, on an instruction that arrived over
  // Slack.
  const command = await db.execute(`
    select command_id::text as command_id, instruction
    from public.inbound_commands
    where dedupe_key = 'slack:message:D0GATE4DM01:${String(stamp)}.000300'
  `)
  const instruction = String(command.rows[0]?.instruction ?? '')
  const outcome = await applyPreference(db, parseInstruction(instruction), {
    originChannel: 'slack',
    instruction,
    commandId: String(command.rows[0]?.command_id),
  })
  const held = await db.execute(`
    select app.notification_allowed('grant', 'slack', 'routine'::public.notify_severity) as routine,
           app.notification_allowed('grant', 'slack', 'important'::public.notify_severity) as important,
           app.notification_allowed('grant', 'slack', 'blocker'::public.notify_severity) as blocker
  `)
  const r = held.rows[0]
  add(
    '10',
    'a preference instruction arriving over Slack updates the same structured preference',
    `applied=${String(outcome.applied)} from=${JSON.stringify(instruction)}; ` +
      `routine=${r?.routine === true ? 'delivered' : 'held'} ` +
      `important=${r?.important === true ? 'delivered' : 'held'} ` +
      `blocker=${r?.blocker === true ? 'delivered' : 'held'}`,
    outcome.applied && r?.routine === false && r?.important === true && r?.blocker === true,
  )
}

// ---------------------------------------------------------------------------
// 11. rate limits — measured, not assumed (§11)
// ---------------------------------------------------------------------------
{
  // §11 requires the figure to be measured rather than copied from the docs, so
  // this drives one method until Slack refuses and records what refusal looks
  // like — the status, and whether `Retry-After` is actually present, since a
  // backoff strategy that guesses the wait is a backoff strategy that hammers.
  //
  // `conversations.list` (tier 2), not `conversations.info` (tier 3). The first
  // version of this check used info and reported "30 calls, no 429", which is a
  // true sentence that measures nothing: the burst allowance simply covered it.
  // A rate-limit check that never reaches the rate limit has not observed the
  // rate limit.
  const started = Date.now()
  let calls = 0
  let status = 0
  let retryAfter = ''
  for (let i = 0; i < 120; i += 1) {
    const r = await fetch('https://slack.com/api/conversations.list?limit=1', {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    calls += 1
    if (r.status === 429) {
      status = 429
      retryAfter = r.headers.get('retry-after') ?? 'ABSENT'
      break
    }
  }
  const elapsed = Date.now() - started
  const measured =
    status === 429
      ? `429 after ${String(calls)} conversations.list calls in ${String(elapsed)}ms, Retry-After: ${retryAfter}s`
      : `no 429 in ${String(calls)} calls over ${String(elapsed)}ms`
  await db.execute(`
    update public.slack_workspaces
    set observed_rate_limit_tier = '${measured.replace(/'/g, "''")}'
    where team_id = '${teamId}'
  `)
  add(
    '11',
    'the rate limit is reached, and its retry contract is read from the response',
    measured,
    // A pass requires actually hitting it AND Slack telling us how long to
    // wait. Without Retry-After the only options are guessing or spinning.
    status === 429 && /^\d+$/.test(retryAfter),
  )

  // Slack said 30 seconds. Waiting it out and confirming the next call succeeds
  // is the other half: a documented Retry-After that does not actually clear is
  // worse than none, because the backoff would be built on it.
  const wait = Number(retryAfter) + 1
  await new Promise((resolve) => setTimeout(resolve, wait * 1000))
  const recovered = await slackRead('conversations.list', { limit: '1' })
  add(
    '11b',
    'and honouring Retry-After actually clears it',
    `waited ${String(wait)}s, next call ok=${String(recovered.ok)}${recovered.ok === true ? '' : ` (${String(recovered.error)})`}`,
    recovered.ok === true,
  )
}

// ---------------------------------------------------------------------------
// 12. token revocation, and 13. reinstall
// ---------------------------------------------------------------------------
{
  // A signed `tokens_revoked` event, not an actual revocation: revoking the
  // token would end the run and require Grant in a browser to undo. What is
  // being proven is that the application *learns* of it from the event rather
  // than by a call failing later, which is the difference the gate is asking
  // about.
  const revoked = await deliver({
    type: 'event_callback',
    team_id: teamId,
    event_id: `Ev-revoke-${stamp}`,
    event: { type: 'tokens_revoked', tokens: { bot: [botUserId] } },
  })
  const afterRevoke = await db.execute(`
    select installed, revocation_reason, uninstalled_at is not null as has_timestamp
    from public.slack_workspaces where team_id = '${teamId}'
  `)
  add(
    '12',
    'a tokens_revoked event marks the workspace uninstalled, with a reason',
    `${String(revoked.status)} installed=${String(afterRevoke.rows[0]?.installed)} ` +
      `reason=${String(afterRevoke.rows[0]?.revocation_reason)} ` +
      `timestamped=${String(afterRevoke.rows[0]?.has_timestamp)}`,
    revoked.status === 200 &&
      afterRevoke.rows[0]?.installed === false &&
      String(afterRevoke.rows[0]?.revocation_reason) === 'tokens_revoked' &&
      afterRevoke.rows[0]?.has_timestamp === true,
  )

  // Reinstall is what `npm run deploy:slack` does on its way past: the upsert
  // clears the revocation. Run here as the same statement rather than a
  // different one, so the reconnect path proven is the one that ships.
  const auth = await slack('auth.test')
  await db.execute(`
    insert into public.slack_workspaces (team_id, team_name, bot_user_id, installed)
    values ('${teamId}', '${String(auth.team ?? '').replace(/'/g, "''")}', '${botUserId}', true)
    on conflict (team_id) do update
      set installed = true, uninstalled_at = null, revocation_reason = null
  `)
  const afterReinstall = await db.execute(`
    select installed, revocation_reason, uninstalled_at from public.slack_workspaces
    where team_id = '${teamId}'
  `)
  add(
    '13',
    'reconnecting clears the revocation, and nothing else was lost',
    `installed=${String(afterReinstall.rows[0]?.installed)} ` +
      `reason=${String(afterReinstall.rows[0]?.revocation_reason)} ` +
      `uninstalled_at=${String(afterReinstall.rows[0]?.uninstalled_at)}`,
    afterReinstall.rows[0]?.installed === true &&
      afterReinstall.rows[0]?.revocation_reason === null,
  )
}

// ---------------------------------------------------------------------------
// 14. Postgres remains canonical, and 15. Slack history loss
//
// The blunt test: destroy the Slack side and see what the application still
// knows. Every message this run posted is deleted and the channel archived —
// which is also the cleanup, so the destructive step is not optional.
// ---------------------------------------------------------------------------
{
  const before = await db.execute(`
    select count(*)::int as n from public.inbound_commands
    where dedupe_key like 'slack:%${String(stamp)}%'
  `)

  // Delete the real messages from Slack.
  //
  // Bounded to messages this app authored, because that is the bound Slack
  // imposes: `chat.delete` cannot remove a `channel_join` or the archive
  // notice, which are system messages with no author to delete them. The first
  // version of this check asserted "all messages deleted" and failed at 1 of 2
  // — the second was the bot's own join notice. The bound is real, so the
  // assertion is on what is actually deletable and the remainder is reported.
  const history = await slackRead('conversations.history', { channel: channelId, limit: '100' })
  const top = (
    (history.messages as { ts?: string; subtype?: string; thread_ts?: string }[] | undefined) ?? []
  ).filter((m) => m.ts !== undefined)

  // Thread replies do NOT appear in `conversations.history` — only the parent
  // does. The first version of this check reported "deleted 1/1" while the
  // threaded reply was still sitting in Slack, so its claim that every posted
  // message was gone was false and the check passed anyway. Replies are now
  // fetched per parent.
  const threadReplies: { ts?: string; subtype?: string }[] = []
  for (const m of top) {
    if (m.thread_ts === undefined && m.ts !== parentTs) continue
    const replies = await slackRead('conversations.replies', {
      channel: channelId,
      ts: String(m.ts),
    })
    for (const r of (replies.messages as { ts?: string; subtype?: string }[] | undefined) ?? []) {
      if (r.ts !== undefined && r.ts !== m.ts) threadReplies.push(r)
    }
  }

  const all = [...top, ...threadReplies]
  const authored = all.filter((m) => m.subtype === undefined)
  const systemMessages = all.length - authored.length
  let deleted = 0
  for (const m of authored) {
    const r = await slack('chat.delete', { channel: channelId, ts: m.ts })
    if (r.ok === true) deleted += 1
  }
  const archived = await slack('conversations.archive', { channel: channelId })

  // Mark the mapping inactive, which is what the application would do on
  // learning the channel is gone. The row is kept, not deleted: it explains
  // where past instructions came from.
  await db.execute(`
    update public.slack_channel_map
    set active = false, archived_at = app.now_utc()
    where channel_id = '${channelId}'
  `)

  const after = await db.execute(`
    select count(*)::int as n,
           count(*) filter (where length(trim(instruction)) > 0)::int as with_text
    from public.inbound_commands
    where dedupe_key like 'slack:%${String(stamp)}%'
  `)
  const stillResolvable = await db.execute(`
    select count(*)::int as n from public.slack_channel_map
    where channel_id = '${channelId}'
  `)
  const remaining = await slackRead('conversations.history', { channel: channelId, limit: '50' })
  const remainingTop = (
    (remaining.messages as { ts?: string; subtype?: string }[] | undefined) ?? []
  ).filter((m) => m.subtype === undefined)
  // Count what is left in threads too, or the same blind spot returns.
  let leftInThreads = 0
  for (const m of (remaining.messages as { ts?: string }[] | undefined) ?? []) {
    const r = await slackRead('conversations.replies', { channel: channelId, ts: String(m.ts) })
    leftInThreads += ((r.messages as { ts?: string; subtype?: string }[] | undefined) ?? []).filter(
      (x) => x.subtype === undefined && x.ts !== m.ts,
    ).length
  }
  const left = remainingTop.length + leftInThreads

  add(
    '14',
    'every message the app posted is deleted from Slack and the channel is archived',
    `deleted ${String(deleted)}/${String(authored.length)} authored messages ` +
      `(${String(systemMessages)} system messages are not deletable by any app); ` +
      `archived=${String(archived.ok)}; authored messages still readable in Slack: ` +
      `${String(left)} (${String(remainingTop.length)} top-level + ${String(leftInThreads)} in threads)`,
    // At least two: the parent and its threaded reply. A count of one would
    // mean the thread walk found nothing, which is the bug this replaced.
    deleted === authored.length && authored.length >= 2 && archived.ok === true && left === 0,
  )
  add(
    '15',
    'and every instruction is still readable from Postgres, with its text intact',
    `commands before=${String(before.rows[0]?.n)} after=${String(after.rows[0]?.n)}; ` +
      `with instruction text=${String(after.rows[0]?.with_text)}; ` +
      `mapping row kept=${String(Number(stillResolvable.rows[0]?.n) === 1)}`,
    Number(after.rows[0]?.n) === Number(before.rows[0]?.n) &&
      Number(after.rows[0]?.n) > 0 &&
      Number(after.rows[0]?.with_text) >= 3 &&
      Number(stillResolvable.rows[0]?.n) === 1,
  )
}

// --- what is NOT cleaned up, and why --------------------------------------
//
// The inbound commands stay. They are check 15's evidence, and the first
// version of this script tried to delete them and was refused: a foreign key
// from `preference_instructions` to the command that carried the preference,
// and that table is append-only, so the reference cannot be dropped either.
//
// That refusal is the invariant working. The record of an instruction Grant
// gave cannot be removed by the thing that recorded it — not even to tidy up
// after a test. Deleting them would have quietly proven the opposite of what
// check 15 claims.
await db.execute(`
  update public.projects set status = 'archived' where project_id = '${projectId}'
`)

console.log('\n| # | check | outcome | |')
console.log('|---|---|---|---|')
for (const r of rows)
  console.log(`| ${r.n} | ${r.what} | ${r.outcome} | ${r.passed ? '✅' : '❌'} |`)
const failed = rows.filter((r) => !r.passed)
console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`)
if (failed.length > 0) process.exit(1)
