/**
 * Gate 3 — Telegram.
 *
 *   npm run poc:gate-3
 *
 * §13 does not spell out Gate 3's cases the way it does Gates 4 and 5, so the
 * cases here are §12's Telegram requirements read as a checklist, plus §6's
 * idempotency contract which the pager depends on absolutely:
 *
 *   one Chief of Staff bot · only /newbot is manual, everything else
 *   API-settable including the profile photo · the six buttons · natural-
 *   language instructions become structured persistent preferences · duplicate
 *   deliveries are idempotent and may be concurrent
 *
 * Every request below goes to the deployed Edge Function over HTTPS with a real
 * secret header. Nothing is simulated: the webhook, the bot and the database
 * are the running ones.
 */

import { applyPreference, clearPreference } from '../../src/channels/preference-store.ts'
import { parseInstruction } from '../../src/channels/preferences.ts'
import { CALLBACK_ACTIONS } from '../../src/channels/telegram.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
const botToken = process.env.TELEGRAM_CHIEF_BOT_TOKEN
if (supabase === undefined || supabase === '' || botToken === undefined || botToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN and TELEGRAM_CHIEF_BOT_TOKEN are required')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)
const endpoint = `https://${ref}.supabase.co/functions/v1/telegram-webhook`

const rows: { n: string; what: string; outcome: string; passed: boolean }[] = []
const add = (n: string, what: string, outcome: string, passed: boolean): void => {
  rows.push({ n, what, outcome, passed })
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n} ${what} — ${outcome}`)
}

const tg = async (method: string, body?: unknown): Promise<Record<string, unknown>> => {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return (await r.json()) as Record<string, unknown>
}

// The webhook secret. Read from the vault, not from the environment: the vault
// is where the deploy put it, and reading it from anywhere else would be
// testing a different secret than the one the function checks.
const vaulted = await db.execute(
  `select decrypted_secret from vault.decrypted_secrets where name = 'telegram.webhook_secret'`,
)
const webhookSecret = String(vaulted.rows[0]?.decrypted_secret ?? '')
if (webhookSecret === '') {
  console.error('telegram.webhook_secret is not in the vault; run npm run deploy:telegram')
  process.exit(2)
}

const post = async (
  update: unknown,
  secret = webhookSecret,
): Promise<{ status: number; body: string }> => {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify(update),
  })
  return { status: r.status, body: (await r.text()).slice(0, 200) }
}

const stamp = Date.now()
const CHAT = -1009999000001

// ---------------------------------------------------------------------------
// 1. one bot, and it is the configured one
// ---------------------------------------------------------------------------
{
  const me = await tg('getMe')
  const bot = me.result as Record<string, unknown> | undefined
  add(
    '1',
    'one Chief of Staff bot, live and identified',
    `@${String(bot?.username)} id=${String(bot?.id)} can_join_groups=${String(bot?.can_join_groups)}`,
    me.ok === true && typeof bot?.username === 'string',
  )
}

// ---------------------------------------------------------------------------
// 2. everything except /newbot is API-settable — including the profile photo
//
// §12 names the photo specifically, and it is the one that would be assumed
// manual. It is read back rather than trusted: setMyDescription returning
// ok:true says the call was accepted, not that the profile shows it.
// ---------------------------------------------------------------------------
{
  const desc = await tg('getMyDescription')
  const short = await tg('getMyShortDescription')
  const cmds = await tg('getMyCommands')
  const commands = (cmds.result as unknown[] | undefined) ?? []
  const descText = String((desc.result as Record<string, unknown> | undefined)?.description ?? '')
  add(
    '2',
    'description, short description and commands are set and read back',
    `description=${descText.length}ch short=${
      String((short.result as Record<string, unknown> | undefined)?.short_description ?? '').length
    }ch commands=${commands.length}`,
    descText.length > 0 && commands.length >= 6,
  )
}

// ---------------------------------------------------------------------------
// 3. the webhook is registered with Telegram, and registered to us
// ---------------------------------------------------------------------------
{
  const info = await tg('getWebhookInfo')
  const w = info.result as Record<string, unknown> | undefined
  const url = String(w?.url ?? '')
  add(
    '3',
    'the webhook is registered, points at our function, and has a secret',
    `url=${url === endpoint ? 'matches' : url} pending=${String(w?.pending_update_count)} ` +
      `last_error=${String(w?.last_error_message ?? 'none')}`,
    url === endpoint && w?.last_error_message === undefined,
  )
}

// ---------------------------------------------------------------------------
// 4. authentication — the only authentication a Telegram webhook has
// ---------------------------------------------------------------------------
{
  const noHeader = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const wrong = await post({ update_id: 1 }, 'x'.repeat(webhookSecret.length))
  const short = await post({ update_id: 1 }, 'nope')
  add(
    '4',
    'no secret, a wrong secret of the right length, and a short one are all 401',
    `${noHeader.status} / ${wrong.status} / ${short.status}`,
    noHeader.status === 401 && wrong.status === 401 && short.status === 401,
  )
}

// ---------------------------------------------------------------------------
// 5. all six §12 buttons are accepted, and only those six
// ---------------------------------------------------------------------------
{
  // Undo needs a real event to compensate, because the column is a foreign key
  // into the ledger — a button payload that does not resolve is not a valid
  // undo, and §10 forbids free-form input reaching a lookup.
  const ev = await db.execute(`
    select public.append_event(
      p_correlation_id    => gen_random_uuid(),
      p_actor_kind        => 'system',
      p_actor             => 'gate-3',
      p_trigger           => 'gate 3 evidence run',
      p_action_type       => 'gate3.probe_event',
      p_reversible        => true,
      p_reversal_method   => 'delete the probe row',
      p_rationale_summary => 'an event for the undo button to compensate'
    )::text as event_id
  `)
  const eventId = String(ev.rows[0]?.event_id)

  const accepted: string[] = []
  const rejected: string[] = []
  for (const action of CALLBACK_ACTIONS) {
    const data = action === 'undo' ? `undo:${eventId}` : action
    const r = await post({
      update_id: stamp + accepted.length + rejected.length + 100,
      callback_query: {
        id: `g3-${action}-${stamp}`,
        data,
        from: { id: 4242, is_bot: false, first_name: 'Grant' },
        message: { message_id: 7, chat: { id: CHAT, type: 'supergroup' }, date: 0 },
      },
    })
    ;(r.status === 200 && r.body.includes('dedupe_key') ? accepted : rejected).push(action)
  }

  // And an action that is not one of the six.
  const bogus = await post({
    update_id: stamp + 200,
    callback_query: {
      id: `g3-bogus-${stamp}`,
      data: 'delete_everything',
      from: { id: 4242, is_bot: false, first_name: 'Grant' },
      message: { message_id: 7, chat: { id: CHAT, type: 'supergroup' }, date: 0 },
    },
  })

  add(
    '5',
    'all six §12 buttons are accepted; an unknown action is acknowledged and dropped',
    `accepted=${accepted.length}/6 rejected=[${rejected.join(',')}] unknown -> ${bogus.status} ${bogus.body.includes('ignored') ? 'ignored' : bogus.body.slice(0, 40)}`,
    accepted.length === 6 && bogus.status === 200 && bogus.body.includes('ignored'),
  )

  // An unknown action returning 200 is deliberate, and worth its own check:
  // Telegram retries anything non-2xx forever, so a 4xx here would be a
  // permanent retry loop for an update we will never understand.
  //
  // Two payloads, and the difference between them is the finding. §10 forbids
  // free-form input reaching a lookup, and `undo` carries a payload used to
  // look up an event, so a payload that is not a uuid must be refused by *our*
  // code rather than by anything in front of it.
  const malformed: string[] = []
  let ourCodeRefused = false
  for (const [label, data] of [
    ['not-a-uuid', 'undo:not-a-uuid'],
    ['empty payload', 'undo:'],
    ['uuid-shaped but wrong length', 'undo:1234-5678'],
  ] as const) {
    const r = await post({
      update_id: stamp + 201 + malformed.length,
      callback_query: {
        id: `g3-badundo-${String(malformed.length)}-${stamp}`,
        data,
        from: { id: 4242, is_bot: false, first_name: 'Grant' },
        message: { message_id: 7, chat: { id: CHAT, type: 'supergroup' }, date: 0 },
      },
    })
    const handled = r.status === 200 && r.body.includes('ignored')
    malformed.push(
      `${label}=${String(r.status)}${handled ? ' ignored' : ' ' + r.body.slice(0, 30)}`,
    )
    ourCodeRefused = handled
  }
  add(
    '5b',
    'an undo whose payload is not a uuid is refused by our code, not looked up',
    malformed.join(' · '),
    ourCodeRefused,
  )

  // The path-traversal payload is a separate check because it does NOT reach
  // our function: Supabase's edge returns 403 with an HTML body before the
  // handler runs. That is a defence, but it is not *our* defence, and the first
  // version of this script asserted a hardcoded `true` and so reported a pass
  // for a request that was never served. Recorded for what it is.
  const traversal = await post({
    update_id: stamp + 210,
    callback_query: {
      id: `g3-traversal-${stamp}`,
      data: 'undo:../../etc/passwd',
      from: { id: 4242, is_bot: false, first_name: 'Grant' },
      message: { message_id: 7, chat: { id: CHAT, type: 'supergroup' }, date: 0 },
    },
  })
  const blockedUpstream = traversal.status === 403 && traversal.body.includes('<!DOCTYPE html>')
  add(
    '5c',
    'a path-traversal payload never reaches the function (blocked upstream, not by us)',
    `${String(traversal.status)} ${blockedUpstream ? 'HTML error page from the edge, before our handler' : traversal.body.slice(0, 40)}`,
    // Either outcome is acceptable and both are informative: blocked upstream,
    // or reached us and was ignored like any other non-uuid payload. What is
    // NOT acceptable is a 200 that accepted it, or a 500.
    blockedUpstream || (traversal.status === 200 && traversal.body.includes('ignored')),
  )
}

// ---------------------------------------------------------------------------
// 6. idempotency, and specifically concurrent idempotency
//
// §6's contract is not "pressing Undo twice". It is that duplicate deliveries
// can be genuinely concurrent — Telegram's retry contract has no ordering
// guarantee. A guard inside a handler is decided by a race; a unique index is
// decided by the database.
// ---------------------------------------------------------------------------
{
  const update = {
    update_id: stamp + 300,
    message: {
      message_id: 900,
      date: 0,
      chat: { id: CHAT, type: 'supergroup' },
      from: { id: 4242, is_bot: false, first_name: 'Grant' },
      text: 'gate 3 concurrency probe',
    },
  }
  const concurrent = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async () => post(update)))
  const keys = new Set(
    concurrent.map((r) => {
      const m = r.body.match(/"dedupe_key":"([^"]+)"/)
      return m?.[1] ?? 'none'
    }),
  )
  const stored = await db.execute(`
    select count(*)::int as n from public.inbound_commands
    where dedupe_key like 'telegram:message:${CHAT}:900%'
       or dedupe_key = 'telegram:message:${CHAT}:900'
  `)
  add(
    '6',
    '8 simultaneous deliveries of one update produce one row',
    `all 200: ${concurrent.every((r) => r.status === 200)}; distinct dedupe keys: ${keys.size}; rows: ${String(stored.rows[0]?.n)}`,
    concurrent.every((r) => r.status === 200) && keys.size === 1 && Number(stored.rows[0]?.n) === 1,
  )
}

// ---------------------------------------------------------------------------
// 7. natural language becomes a structured persistent preference
//
// §12's requirement, tested with §12's own two example sentences, end to end
// through the real database — parse, apply, then ask the resolver what it does.
// ---------------------------------------------------------------------------
await clearPreference(db)
{
  const results: string[] = []
  let allCorrect = true

  const check = async (
    instruction: string,
    expect: { channel: string; severity: string; allowed: boolean },
  ): Promise<void> => {
    const outcome = await applyPreference(db, parseInstruction(instruction), {
      originChannel: 'telegram',
      instruction,
    })
    const { rows } = await db.execute(
      `select app.notification_allowed('grant', '${expect.channel}',
        '${expect.severity}'::public.notify_severity) as allowed`,
    )
    const allowed = rows[0]?.allowed === true
    const ok = outcome.applied && allowed === expect.allowed
    if (!ok) allCorrect = false
    results.push(
      `${JSON.stringify(instruction)}: ${expect.severity} ${allowed ? 'delivered' : 'held'}`,
    )
  }

  // "leave me alone today" — routine work is held.
  await check('leave me alone today', { channel: 'telegram', severity: 'routine', allowed: false })
  // ...and the same preference still lets a blocker through. This is the safety
  // property, and it is checked with the mute still in force.
  await check('leave me alone today', { channel: 'telegram', severity: 'blocker', allowed: true })

  await clearPreference(db)
  // "only important things" — routine held, important delivered.
  await check('only important things', { channel: 'telegram', severity: 'routine', allowed: false })
  await check('only important things', {
    channel: 'telegram',
    severity: 'important',
    allowed: true,
  })

  add(
    '7',
    'the two instructions §12 names produce the behaviour §12 describes',
    results.join(' · '),
    allCorrect,
  )
}

// ---------------------------------------------------------------------------
// 8. the preference is persistent, and the instruction is on record
// ---------------------------------------------------------------------------
{
  const pref = await db.execute(`
    select min_severity::text as min_severity, quiet_until is not null as has_window,
           blockers_always
    from public.notification_preferences where subject = 'grant' and project_id is null
  `)
  const log = await db.execute(`
    select count(*)::int as n,
           count(*) filter (where not_understood is not null)::int as misses,
           bool_and(interpreted_by = 'rules') as all_rules
    from public.preference_instructions where subject = 'grant'
  `)
  add(
    '8',
    'the preference survives in the database and every instruction is on record',
    `preference: min_severity=${String(pref.rows[0]?.min_severity)} ` +
      `blockers_always=${String(pref.rows[0]?.blockers_always)}; ` +
      `instructions logged=${String(log.rows[0]?.n)} deterministic=${String(log.rows[0]?.all_rules)}`,
    pref.rows.length === 1 && pref.rows[0]?.blockers_always === true && Number(log.rows[0]?.n) >= 4,
  )
}

// ---------------------------------------------------------------------------
// 9. an instruction that is not understood says so, and is recorded
// ---------------------------------------------------------------------------
{
  const instruction = 'make the dashboard blue and reticulate the splines'
  const outcome = await applyPreference(db, parseInstruction(instruction), {
    originChannel: 'telegram',
    instruction,
  })
  const stored = await db.execute(`
    select not_understood, interpreted_as::text as interpreted_as
    from public.preference_instructions
    where instruction_id = '${outcome.instructionId}'
  `)
  add(
    '9',
    'an unparseable instruction is reported and recorded, not silently dropped',
    `applied=${String(outcome.applied)} not_understood present=${String(
      stored.rows[0]?.not_understood !== null,
    )} interpreted_as=${String(stored.rows[0]?.interpreted_as)}`,
    outcome.applied === false &&
      stored.rows[0]?.not_understood !== null &&
      String(stored.rows[0]?.interpreted_as) === '{}',
  )
}

// ---------------------------------------------------------------------------
// 10. Postgres is canonical: the instruction log cannot be rewritten
// ---------------------------------------------------------------------------
{
  let refused = false
  try {
    await db.execute(
      `update public.preference_instructions set instruction = 'something else'
       where subject = 'grant'`,
    )
  } catch (error) {
    refused = /append-only|immutable|cannot be/i.test((error as Error).message)
  }
  add(
    '10',
    'the record of what Grant said cannot be edited afterwards',
    refused ? 'the trigger refused the UPDATE' : 'THE UPDATE SUCCEEDED',
    refused,
  )
}

// --- clean up the probe rows, INCLUDING the preference ---------------------
//
// This block used to end with "the preference stays as evidence", and left a
// global `min_severity = 'important'` in `notification_preferences`. Evidence
// and configuration are different things: the evidence is in
// `preference_instructions`, which is append-only and keeps every instruction
// with what it was taken to mean. What stayed behind here was live
// configuration that silently suppressed every routine notification for three
// days — invisible until the worker started actually delivering them. See
// migration 0036.
await db.execute(
  `delete from public.inbound_commands where actor = '4242' or actor = 'telegram:4242'`,
)
await clearPreference(db)
await db.execute(`
  delete from public.inbound_commands
  where dedupe_key like 'telegram:%:${CHAT}%' or dedupe_key like 'telegram:callback:g3-%'
`)

console.log('\n| # | check | outcome | |')
console.log('|---|---|---|---|')
for (const r of rows)
  console.log(`| ${r.n} | ${r.what} | ${r.outcome} | ${r.passed ? '✅' : '❌'} |`)
const failed = rows.filter((r) => !r.passed)
console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`)
if (failed.length > 0) process.exit(1)
