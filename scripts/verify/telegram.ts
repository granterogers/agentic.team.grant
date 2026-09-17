/**
 * The Telegram pager, against the live bot and the live database.
 *
 *   npm run verify:telegram
 *
 * There is a hard limit on what can be proven here, and it is worth stating
 * before the checks rather than as a footnote: **nobody has ever messaged this
 * bot.** Telegram forbids a bot messaging anyone who has not messaged it first,
 * so there is no chat id, and no message can be sent to a real person.
 *
 * That is not a reason to skip the suite, and it is emphatically not a reason
 * to fake a chat id and assert that the code "would have worked". What it means
 * is that the checks split in two:
 *
 *   - Everything up to the send is exercised for real, including the decision
 *     not to page and the claim/lease machinery shared with Slack.
 *   - The send itself is exercised against the real API with a chat that does
 *     not exist, which proves the token, the request shape, the error
 *     classification and the failure recording — everything except a human
 *     receiving something.
 *
 * The moment Grant says anything to @agenticteamgrantbot, the registration path
 * runs in the webhook and this suite gains a real destination. Until then the
 * pager's correct behaviour is to page nobody and say so, and that is checked
 * too.
 */

import { DeliveryService } from '../../src/channels/delivery.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'
import type { HandlerOutput, Job } from '../../src/jobs/worker.ts'
import { ACTIONS } from '../../src/slack/blocks.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { callbackData, inlineKeyboard, pagerText } from '../../src/telegram/message.ts'
import { TelegramPager } from '../../src/telegram/pager.ts'
import { botForStaff, pagerBot, roster } from '../../src/telegram/roster.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
const botToken = process.env.TELEGRAM_CHIEF_BOT_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
if (botToken === undefined || botToken === '') {
  console.error('TELEGRAM_CHIEF_BOT_TOKEN is not set — this suite talks to the real bot')
  process.exit(2)
}

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabaseToken,
)
const telegram = new TelegramClient(botToken)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async <T>(sql: string): Promise<T | undefined> =>
  (await db.execute(sql)).rows[0] as T | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const stamp = String(Date.now()).slice(-8)

// ===========================================================================
// Who the bot is
// ===========================================================================

const me = (await telegram.call('getMe')).result as { id?: number; username?: string }
const BOT_ID = String(me.id)
record(
  'the bot token works and identifies the bot the chats will belong to',
  `@${String(me.username)} (${BOT_ID})`,
  me.id !== undefined,
)

// ===========================================================================
// The registry, and why it can be empty
// ===========================================================================

const registered = await one<{ n: number }>(
  `select count(*)::int as n from public.telegram_chats where bot_id = ${lit(BOT_ID)}`,
)
const realChat = await one<{ chat_id: string | null }>(
  `select app.telegram_chat_for('grant', ${lit(BOT_ID)}) as chat_id`,
)
record(
  'the chat registry reports honestly whether there is anywhere to page',
  realChat?.chat_id === null || realChat?.chat_id === undefined
    ? `no chat registered (${String(registered?.n)} rows) — Grant has not messaged the bot`
    : `chat ${String(realChat.chat_id)} registered`,
  true, // Either answer is correct; what is checked is that it HAS an answer.
)
const HAS_REAL_CHAT = realChat?.chat_id !== null && realChat?.chat_id !== undefined

// A fixture chat, so registration and lookup are exercised without inventing a
// destination. Its id is in Telegram's supergroup range and does not exist —
// which is exactly what makes it safe to send to.
const FIXTURE_CHAT = `-100${stamp}0`

const first = await one<{ r: string }>(`
  select app.record_telegram_chat(${lit(FIXTURE_CHAT)}, 'private', ${lit(BOT_ID)},
    'fixture-subject', 'Fixture chat', 'fixture') as r
`)
const again = await one<{ r: string }>(`
  select app.record_telegram_chat(${lit(FIXTURE_CHAT)}, 'private', ${lit(BOT_ID)},
    'fixture-subject') as r
`)
record(
  'a chat is registered on first sight and updated on every one after',
  `first=${String(first?.r)} second=${String(again?.r)}`,
  first?.r === 'registered' && again?.r === 'updated',
)

const preserved = await one<{ title: string | null }>(
  `select title from public.telegram_chats where chat_id = ${lit(FIXTURE_CHAT)}`,
)
record(
  'a later update that omits the title does not erase it',
  `title=${String(preserved?.title)}`,
  preserved?.title === 'Fixture chat',
)

const found = await one<{ chat_id: string | null }>(
  `select app.telegram_chat_for('fixture-subject', ${lit(BOT_ID)}) as chat_id`,
)
record(
  'the pager can find the chat for a subject',
  `chat=${String(found?.chat_id)}`,
  found?.chat_id === FIXTURE_CHAT,
)

// A group must never become the pager by accident.
const GROUP_CHAT = `-100${stamp}1`
await db.execute(`
  select app.record_telegram_chat(${lit(GROUP_CHAT)}, 'supergroup', ${lit(BOT_ID)},
    'group-subject', 'A group the bot was added to')
`)
const groupLookup = await one<{ chat_id: string | null }>(
  `select app.telegram_chat_for('group-subject', ${lit(BOT_ID)}) as chat_id`,
)
record(
  'a group the bot was added to is recorded but is NEVER the pager',
  `lookup returned ${String(groupLookup?.chat_id)}`,
  groupLookup?.chat_id === null || groupLookup?.chat_id === undefined,
)

const wrongBot = await one<{ chat_id: string | null }>(
  `select app.telegram_chat_for('fixture-subject', '999999999') as chat_id`,
)
record(
  'CONTROL: a chat is only offered for the bot that holds it',
  `lookup on another bot returned ${String(wrongBot?.chat_id)}`,
  wrongBot?.chat_id === null || wrongBot?.chat_id === undefined,
)

// ===========================================================================
// The deployed webhook, which is the only thing that can register a real chat
// ===========================================================================
//
// Everything above proves the registry works when something calls it. This
// proves the thing that WILL call it: the live endpoint, with a correctly
// authenticated update, registering a chat it has never seen.
//
// Worth its round trip because the registration is the single step between
// "the pager cannot page" and "the pager works", and it runs exactly once per
// human — the first time Grant says anything. A path that runs once and has
// never been exercised is a path that fails the one time it matters.

const webhookSecret = String(
  (
    await one<{ v: string }>(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'telegram.webhook_secret'`,
    )
  )?.v ?? '',
)
const WEBHOOK = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/telegram-webhook`

const WEBHOOK_CHAT = `-100${stamp}2`
// Returns the body as well as the status, because the status is 200 whatever
// happens — Telegram retries anything else — and the first version of this
// check believed a 200 meant the chat had been registered. It had not.
const deliverUpdate = async (
  body: unknown,
  authenticate = true,
): Promise<{ status: number; registration: string }> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authenticate) headers['X-Telegram-Bot-Api-Secret-Token'] = webhookSecret
  const response = await fetch(WEBHOOK, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await response.text()
  let registration = 'unknown'
  try {
    registration = String((JSON.parse(text) as { registration?: string }).registration ?? 'absent')
  } catch {
    registration = 'non_json'
  }
  return { status: response.status, registration }
}

const status = await deliverUpdate({
  update_id: Number(stamp),
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    text: 'hello',
    chat: { id: Number(WEBHOOK_CHAT), type: 'private' },
    from: { id: 4242, username: 'grant' },
  },
})
const registeredByWebhook = await one<{ subject: string | null; bot_id: string }>(`
  select subject, bot_id from public.telegram_chats where chat_id = ${lit(WEBHOOK_CHAT)}
`)
record(
  'the deployed webhook registers a chat the first time it hears from it',
  `http ${String(status.status)} registration=${status.registration} subject=${String(registeredByWebhook?.subject)} bot=${String(registeredByWebhook?.bot_id)}`,
  status.status === 200 &&
    status.registration === 'ok' &&
    registeredByWebhook !== undefined &&
    registeredByWebhook.bot_id === BOT_ID,
)
record(
  'and it REPORTS whether registration worked, rather than 200-ing over a silent failure',
  `registration=${status.registration}`,
  status.registration === 'ok',
)

// An update the adapter cannot turn into an instruction still proves the chat
// is reachable. Registering before normalizing is what keeps that.
const STICKER_CHAT = `-100${stamp}3`
const stickerStatus = await deliverUpdate({
  update_id: Number(stamp) + 1,
  message: {
    message_id: 2,
    date: Math.floor(Date.now() / 1000),
    chat: { id: Number(STICKER_CHAT), type: 'private' },
    from: { id: 4242 },
  },
})
const stickerChat = await one<{ n: number }>(
  `select count(*)::int as n from public.telegram_chats where chat_id = ${lit(STICKER_CHAT)}`,
)
record(
  'an update carrying no instruction still registers the chat — it is still proof of reach',
  `http ${String(stickerStatus.status)} registration=${stickerStatus.registration} registered=${String(stickerChat?.n)}`,
  stickerStatus.status === 200 && Number(stickerChat?.n) === 1,
)

const unauthenticated = await deliverUpdate(
  {
    update_id: Number(stamp) + 2,
    message: {
      message_id: 3,
      date: Math.floor(Date.now() / 1000),
      text: 'hello',
      chat: { id: -100999999999, type: 'private' },
      from: { id: 4242 },
    },
  },
  false,
)
const unauthenticatedChat = await one<{ n: number }>(
  `select count(*)::int as n from public.telegram_chats where chat_id = '-100999999999'`,
)
record(
  'an unauthenticated update registers nothing — anyone could POST a chat id otherwise',
  `http ${String(unauthenticated.status)} registered=${String(unauthenticatedChat?.n)}`,
  unauthenticated.status === 401 && Number(unauthenticatedChat?.n) === 0,
)

// A button press, all the way through the deployed adapter.
//
// This is the check that would have caught the worst bug in this file's
// history. The composer originally invented one-character wire codes for
// `callback_data`, and the adapter has parsed `<action>:<payload>` since Phase
// 3 — so every button would have arrived unrecognised and done nothing, with
// the unit tests on both sides passing, because neither side had ever been
// tested against the other.
const pressUpdate = await deliverUpdate({
  update_id: Number(stamp) + 3,
  callback_query: {
    id: `cb-${stamp}`,
    data: callbackData('feedback.useful', '00000000-0000-0000-0000-0000000000ff'),
    from: { id: 4242, username: 'grant' },
    message: { message_id: 9, chat: { id: Number(WEBHOOK_CHAT), type: 'private' } },
  },
})
const pressRow = await one<{ action: string; compensates: string | null }>(`
  select callback_action as action, compensates_event_id::text as compensates
  from public.inbound_commands where dedupe_key = ${lit(`telegram:callback:${BOT_ID}:cb-${stamp}`)}
`)
record(
  'a button press composed here is understood by the deployed adapter',
  `http ${String(pressUpdate.status)} action=${String(pressRow?.action)}`,
  pressUpdate.status === 200 && pressRow?.action === 'useful',
)

const undoUpdate = await deliverUpdate({
  update_id: Number(stamp) + 4,
  callback_query: {
    id: `cb-undo-${stamp}`,
    data: callbackData('undo', '00000000-0000-0000-0000-0000000000ff'),
    from: { id: 4242 },
    message: { message_id: 10, chat: { id: Number(WEBHOOK_CHAT), type: 'private' } },
  },
})
const undoRow = await one<{ action: string; compensates: string | null }>(`
  select callback_action as action, compensates_event_id::text as compensates
  from public.inbound_commands where dedupe_key = ${lit(`telegram:callback:${BOT_ID}:cb-undo-${stamp}`)}
`)
record(
  'an Undo press stores WITHOUT writing a correlation into the events foreign key',
  `http ${String(undoUpdate.status)} action=${String(undoRow?.action)} compensates=${String(undoRow?.compensates)}`,
  undoUpdate.status === 200 && undoRow?.action === 'undo' && undoRow.compensates === null,
)

// And the processor acts on it — the same one Slack presses go through, which
// is the payoff from the generalised deliveries table: one implementation of
// "what does a press mean", for both channels.
const { processCallbacks } = await import('../../src/channels/callbacks.ts')
const acted = (await processCallbacks(db, { subject: 'grant' })).filter(
  (p) => p.commandId !== undefined,
)
const usefulPress = acted.find((p) => p.action === 'useful')
record(
  'and the SAME processor Slack presses go through acts on it',
  `${String(acted.length)} press(es) processed; useful=${String(usefulPress?.outcome)}`,
  usefulPress !== undefined,
)

// Retired immediately, not at the end. The webhook attributes a private chat to
// the configured subject — 'grant' — so leaving these rows in place would make
// the pager believe it had somewhere to page, and the checks below would be
// measuring a fixture rather than the real state of the world. It did exactly
// that on the first run.
await db.execute(`
  delete from public.telegram_chats
   where chat_id in (${lit(WEBHOOK_CHAT)}, ${lit(STICKER_CHAT)})
`)

// ===========================================================================
// The send, against the real API
// ===========================================================================

const delivery = new DeliveryService(db, new TelegramTransport(telegram))
const sendKey = `verify:tg:${stamp}:send`
const attempted = await delivery.deliver({
  dedupeKey: sendKey,
  accountRef: BOT_ID,
  targetRef: FIXTURE_CHAT,
  purpose: 'notice',
  body: {
    text: pagerText({
      staffName: 'Research Director',
      staffTitle: 'Research Director',
      body: 'A verification message that cannot be delivered, sent to prove it cannot.',
      metadata: {
        confidence: 'medium',
        evidence: 'inferred',
        reviewed: true,
        sources: [],
        contradictions: null,
      },
      correlationId: '00000000-0000-0000-0000-000000000000',
      actions: [...ACTIONS],
    }),
    keyboard: inlineKeyboard([...ACTIONS], '00000000-0000-0000-0000-000000000000'),
    silent: true,
  },
})
record(
  'a send to a chat that does not exist reaches the API and is classified, not crashed on',
  `${attempted.outcome} error=${String(attempted.errorCode)}`,
  attempted.outcome === 'failed' && attempted.errorCode === 'chat_not_found',
)

const parked = await one<{ state: string; channel: string; error_code: string }>(`
  select state::text as state, channel, error_code from public.deliveries
  where dedupe_key = ${lit(sendKey)}
`)
record(
  'and it is recorded in the SAME deliveries table Slack uses, under its own channel',
  `channel=${String(parked?.channel)} state=${String(parked?.state)} error=${String(parked?.error_code)}`,
  parked?.channel === 'telegram' && parked?.state === 'failed',
)

const secondAttempt = await delivery.deliver({
  dedupeKey: sendKey,
  accountRef: BOT_ID,
  targetRef: FIXTURE_CHAT,
  purpose: 'notice',
  body: { text: 'Should not be attempted again.' },
})
record(
  'a terminal failure is not retried under the same key — the claim remembers',
  `${secondAttempt.outcome} error=${String(secondAttempt.errorCode)}`,
  secondAttempt.outcome === 'failed' && secondAttempt.errorCode === 'previous_attempt_failed',
)

// The property that made generalising the table worth doing: the same
// concurrency guarantee, on a second channel, from one implementation.
const raceKey = `verify:tg:${stamp}:race`
const racers = await Promise.all(
  Array.from({ length: 6 }, () =>
    delivery
      .deliver({
        dedupeKey: raceKey,
        accountRef: BOT_ID,
        targetRef: FIXTURE_CHAT,
        purpose: 'notice',
        body: { text: 'One of these, at most, may reach the API.' },
      })
      .then((r) => r.outcome)
      .catch((e: unknown) => `ERROR:${(e as Error).message.slice(0, 30)}`),
  ),
)
const attempts = await one<{ n: number }>(
  `select count(*)::int as n from public.deliveries where dedupe_key = ${lit(raceKey)}`,
)
record(
  'six concurrent sends of one message produce ONE delivery row and one attempt',
  `outcomes: ${[...new Set(racers)].join(', ')}; ${String(attempts?.n)} row(s)`,
  Number(attempts?.n) === 1 && racers.filter((r) => r === 'failed').length === 1,
)

// ===========================================================================
// Reconciliation, which Telegram cannot do
// ===========================================================================

const indeterminateKey = `verify:tg:${stamp}:indeterminate`
const amnesiac = new DeliveryService(
  db,
  new TelegramTransport(
    new TelegramClient(botToken, {
      fetchImpl: (async () => {
        throw new TypeError('socket hang up (injected)')
      }) as unknown as typeof fetch,
    }),
  ),
)
const lost = await amnesiac.deliver({
  dedupeKey: indeterminateKey,
  accountRef: BOT_ID,
  targetRef: FIXTURE_CHAT,
  purpose: 'notice',
  body: { text: 'Sent, or not. We will never know.' },
})
record(
  'an interrupted send is indeterminate here too, and is never retried',
  `${lost.outcome}`,
  lost.outcome === 'indeterminate',
)

const resolution = await amnesiac.resolveIndeterminate({
  deliveryId: String(lost.deliveryId),
  targetRef: FIXTURE_CHAT,
  dedupeKey: indeterminateKey,
})
record(
  'and it stays unresolvable, because a bot cannot read its own sent messages back',
  `resolution=${resolution.resolution}`,
  resolution.resolution === 'unreconcilable',
)

const stillParked = await one<{ state: string }>(
  `select state::text as state from public.deliveries where dedupe_key = ${lit(indeterminateKey)}`,
)
record(
  'which leaves it parked for good — never sending twice is the only guarantee available',
  `state=${String(stillParked?.state)}`,
  stillParked?.state === 'failed',
)

// ===========================================================================
// The pager's own decisions
// ===========================================================================

// Pointed at the FIXTURE subject, not at Grant. Two reasons, and the second
// was learned the hard way: it makes these checks independent of whether a real
// chat exists, and it exercises the whole path — lookup, preference check,
// compose, send, classify, mark undeliverable — instead of stopping at "nobody
// to page". An earlier version asked for 'grant', found a leftover fixture chat
// from a crashed run, and reported a delivery failure as though it were a
// defect in the pager.
const pager = new TelegramPager(db, telegram, { botId: BOT_ID, subject: 'fixture-subject' })

// A REAL job, because `deliveries.job_id` is a foreign key and a made-up uuid
// fails the insert. Worth the two extra statements: a fixture that cannot be
// stored is a fixture that proves the delivery path was never reached.
const fixtureProject = await one<{ id: string }>(`
  with created as (
    insert into public.projects (slug, name)
    values (${lit(`fixture-telegram-${stamp}`)}, 'Telegram pager verification fixture')
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
const fixtureJob = await one<{ id: string; correlation_id: string }>(`
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  values (gen_random_uuid(), ${lit(String(fixtureProject?.id))}::uuid,
          ${lit(`verify-tg-${stamp}`)}, 'research.conclusion', 'verify:telegram', 100)
  returning job_id::text as id, correlation_id::text as correlation_id
`)
const fakeJob: Job = {
  jobId: String(fixtureJob?.id),
  kind: 'research.conclusion',
  correlationId: String(fixtureJob?.correlation_id),
  projectId: String(fixtureProject?.id),
  idempotencyKey: `verify-tg-${stamp}`,
  attempt: 1,
}
const fakeOutput: HandlerOutput = {
  body: 'A finding that would page, if there were anywhere to page.',
  confidence: 'medium',
  evidence: 'inferred',
  sources: [],
  contradictions: null,
  path: 'inference',
  model: 'verify:telegram/fixture',
}
const pageInput = {
  job: fakeJob,
  output: fakeOutput,
  // `notification_events.subject_ref` has no foreign key by design (0031: the
  // feedback outlives the thing it is about), so a synthetic id is honest here.
  outputId: '00000000-0000-0000-0000-000000000000',
  staffName: 'Research Director',
  staffTitle: 'Research Director',
  staffId: null,
  reviewed: true,
  actions: [...ACTIONS],
}

const routine = await pager.page({ ...pageInput, severity: 'routine' })
record(
  'a routine result does NOT page — a phone that buzzes for everything gets ignored',
  routine.note,
  !routine.delivered && routine.note.includes('below the pager floor'),
)

const important = await pager.page({ ...pageInput, severity: 'important' })
record(
  'an important result goes all the way to the API, and reports what came back',
  `${important.note} chat=${String(important.chatId)}`,
  important.chatId === FIXTURE_CHAT && important.note.includes('chat_not_found'),
)

// The same call for a subject nobody has registered, which is the state Grant's
// own pager is in until he messages the bot.
const nobodyPager = new TelegramPager(db, telegram, { botId: BOT_ID, subject: 'nobody-here' })
const unpaged = await nobodyPager.page({ ...pageInput, severity: 'blocker' })
record(
  'and with nobody registered it says so — even a blocker, which is the loudest thing there is',
  unpaged.note,
  !unpaged.delivered && unpaged.note.includes('no telegram chat registered'),
)

// ===========================================================================
// Undeliverable is durable information
// ===========================================================================

// The pager itself marked this chat undeliverable when Telegram said
// `chat_not_found` — durable information, not a transient failure, because
// every future page would fail the same way. So the check is that the marking
// already happened, not that a second call can do it.
const afterBlock = await one<{ chat_id: string | null }>(
  `select app.telegram_chat_for('fixture-subject', ${lit(BOT_ID)}) as chat_id`,
)
const reason = await one<{ deliverable: boolean; undeliverable_reason: string | null }>(
  `select deliverable, undeliverable_reason from public.telegram_chats where chat_id = ${lit(FIXTURE_CHAT)}`,
)
record(
  'an unreachable chat stops being offered, and the reason is kept rather than the row deleted',
  `deliverable=${String(reason?.deliverable)} reason=${String(reason?.undeliverable_reason)} lookup=${String(afterBlock?.chat_id)}`,
  reason?.deliverable === false &&
    reason.undeliverable_reason === 'chat_not_found' &&
    (afterBlock?.chat_id === null || afterBlock?.chat_id === undefined),
)

const restored = await one<{ r: string }>(`
  select app.record_telegram_chat(${lit(FIXTURE_CHAT)}, 'private', ${lit(BOT_ID)},
    'fixture-subject') as r
`)
const afterUnblock = await one<{ chat_id: string | null }>(
  `select app.telegram_chat_for('fixture-subject', ${lit(BOT_ID)}) as chat_id`,
)
record(
  'and speaking again restores it — being unblocked produces no event of its own',
  `${String(restored?.r)}, lookup=${String(afterUnblock?.chat_id)}`,
  afterUnblock?.chat_id === FIXTURE_CHAT,
)

// ===========================================================================
// What the application role may do
// ===========================================================================

const asApp = async (sql: string): Promise<string> => {
  try {
    await db.execute(`set local role ai_team_app; ${sql}`)
    return '(no error — it was ACCEPTED)'
  } catch (error) {
    return (error as Error).message.replace(/\s+/g, ' ').slice(0, 160)
  }
}
const directWrite = await asApp(`
  insert into public.telegram_chats (chat_id, chat_type, bot_id)
  values ('-100000000009', 'private', ${lit(BOT_ID)})
`)
record(
  'the app role cannot invent a chat to page — a row here is evidence a human spoke',
  directWrite.slice(0, 110),
  directWrite.includes('permission denied'),
)
const canLookUp = await asApp(`select app.telegram_chat_for('grant', ${lit(BOT_ID)})`)
record(
  'CONTROL: but it CAN look one up, so the pager is not locked out',
  canLookUp.slice(0, 80),
  canLookUp.includes('no error'),
)

// ===========================================================================
// The bot roster (0054): seven voices, not one
// ===========================================================================

const entries = await roster(db)
record(
  'the roster holds every bot the design names, existing or not',
  `${String(entries.length)} entr(ies): ${String(entries.filter((e) => e.hasToken).length)} with a token`,
  entries.length === 8,
)

// §12 gives Telegram ONE interrupting voice. This is the constraint, not a
// convention: the second pager would be added by someone who had not read §12,
// and the symptom would be Grant's phone buzzing seven times.
let secondPagerCode = 'nothing was refused'
try {
  await db.execute(`
    update public.telegram_bots set is_pager = true
     where staff_slug = 'research-director'
  `)
} catch (error) {
  secondPagerCode =
    error instanceof SqlExecutionError
      ? (error.message.match(/\b\d{5}\b/)?.[0] ?? 'unknown')
      : 'wrong error type'
}
record(
  'a SECOND pager is impossible — §12 gives Telegram one interrupting voice',
  `refused with ${secondPagerCode}`,
  secondPagerCode === '23505',
)

// A bot with no token cannot send, so calling it enabled would be a promise
// the system cannot keep.
//
// Its own fixture, not a placeholder row that happened to be lying about. The
// first version updated `pending:quality-director`, which existed only while
// Grant had not yet made that bot. He made it, the UPDATE matched nothing, and
// the check reported the constraint missing when it was the fixture that was.
await db.execute(`
  insert into public.telegram_bots (bot_id, username, expected, enabled, disabled_reason)
  values ('fixture-tokenless', 'fixture_tokenless_bot', false, false, 'fixture')
  on conflict (bot_id) do nothing
`)
let tokenlessCode = 'nothing was refused'
try {
  await db.execute(`
    update public.telegram_bots set enabled = true, disabled_reason = null
     where bot_id = 'fixture-tokenless'
  `)
} catch (error) {
  tokenlessCode =
    error instanceof SqlExecutionError
      ? (error.message.match(/\b\d{5}\b/)?.[0] ?? 'unknown')
      : 'wrong error type'
}
record(
  'a bot with no token cannot be enabled — an enabled bot is a promise to send',
  `refused with ${tokenlessCode}`,
  tokenlessCode === '23514',
)
await db.execute(`delete from public.telegram_bots where bot_id = 'fixture-tokenless'`)

/*
  The subject is the CHIEF OF STAFF, and the assertion is a property.

  It was `research-director` against a hard-coded bot id, and #70 retired that
  bot on 14 September — so the check asserted that a bot Grant had just
  deliberately turned off still existed. That is the second time this exact
  check has gone stale in the same way: the comment below records the first,
  when it named `quality-director` and Grant then MADE that bot.

  CLAUDE.md's rule is to pick a control subject the change under test cannot
  move, and say why. Claire is that subject by definition — Grant's rule is
  "we only need the chief of staff", so she is the one person guaranteed to
  have a bot for as long as Telegram is connected at all. And the property is
  "resolves an enabled bot with a real token", not a particular id: an id is
  an artefact, and asserting one is what made this brittle twice.
*/
const chief = await botForStaff(db, 'chief-of-staff')
record(
  'the one person who speaks resolves to a bot, with its token from the vault',
  chief === null
    ? 'no bot resolved for the chief of staff'
    : `@${chief.username} id=${chief.botId}, token resolved (${String(chief.token.length)} chars)`,
  chief !== null && chief.username.length > 0 && chief.token.length > 20,
)

/*
  And the other half of #70: nobody else does.

  Asserted over the whole roster rather than one name, so it holds when
  somebody is hired and does not need editing when somebody is retired — the
  failure mode this check has had twice already.
*/
const others = [
  'research-director',
  'strategy-director',
  'finance-director',
  'operations-director',
  'growth-director',
  'quality-director',
  'communications-director',
]
const stillSpeaking: string[] = []
for (const slug of others) {
  if ((await botForStaff(db, slug)) !== null) stillSpeaking.push(slug)
}
record(
  'and no other staff member has a bot of their own (#70)',
  stillSpeaking.length === 0
    ? 'seven retired, none resolving'
    : `STILL RESOLVING: ${stillSpeaking.join(', ')}`,
  stillSpeaking.length === 0,
)

// The negative that matters: a resolver that threw would make "Grant has not
// made that bot" indistinguishable from "the database is broken".
//
// A slug with no bot BY CONSTRUCTION. This used to name quality-director,
// which was bot-less until Grant sent that token — after which the check was
// asserting that a bot he had just made did not exist.
const missing = await botForStaff(db, 'nobody-has-this-slug')
record(
  'a staff member with no bot resolves to null rather than raising',
  missing === null ? 'null, as required' : 'resolved something that should not exist',
  missing === null,
)

const registryPager = await pagerBot(db)
record(
  'the pager resolves from the registry, so no sender needs the token in its environment',
  registryPager === null ? 'no pager' : `@${registryPager.username} id=${registryPager.botId}`,
  registryPager !== null && registryPager.botId === BOT_ID,
)

// Every staff bot answers Telegram. A registry row is a claim; getMe is the
// evidence, and a token that was pasted into a chat can be revoked between
// being stored and being used.
const answering: string[] = []
for (const entry of entries) {
  if (!entry.enabled || !entry.hasToken) continue
  const bot = entry.staffSlug === null ? registryPager : await botForStaff(db, entry.staffSlug)
  if (bot === null) continue
  const probe = (await (await fetch(`https://api.telegram.org/bot${bot.token}/getMe`)).json()) as {
    ok?: boolean
    result?: { username?: string }
  }
  if (probe.ok === true && probe.result?.username === entry.username) answering.push(entry.username)
}
record(
  'every registered bot authenticates, and is the bot the registry says it is',
  `${String(answering.length)} of ${String(entries.filter((e) => e.enabled && e.hasToken).length)} answering`,
  answering.length === entries.filter((e) => e.enabled && e.hasToken).length,
)

// Restored: a check that changes real configuration must put it back. Both
// updates above were refused, so nothing changed — asserted rather than
// assumed, because "the constraint held" and "I forgot to clean up" look the
// same until someone looks.
const stillOnePager = await one<{ n: number }>(
  `select count(*)::int as n from public.telegram_bots where is_pager`,
)
record(
  'and the registry is left exactly as it was found',
  `${String(stillOnePager?.n)} pager(s)`,
  Number(stillOnePager?.n) === 1,
)

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)

if (!HAS_REAL_CHAT) {
  console.log(
    '\nNOTE: no real chat is registered, so no message has ever reached a person.\n' +
      `Send anything to @${String(me.username)} and the webhook registers the chat;\n` +
      'this suite then proves the send end to end on its next run.',
  )
}

try {
  await db.execute(`
    delete from public.deliveries where dedupe_key like ${lit(`verify:tg:${stamp}:%`)};
    delete from public.telegram_chats
     where chat_id in (${lit(FIXTURE_CHAT)}, ${lit(GROUP_CHAT)}, ${lit(WEBHOOK_CHAT)}, ${lit(STICKER_CHAT)});
    delete from public.feedback where given_by = '4242';
    delete from public.inbound_commands where actor in ('4242', 'telegram:4242');
    delete from public.notification_events where project_id = ${lit(String(fixtureProject?.id))}::uuid;
    -- The job before the project, and explicitly: a fixture job left live holds
    -- queue capacity, and the queue is global and small.
    update public.jobs
       set state = 'cancelled', state_reason = 'verify:telegram fixture retired'
     where project_id = ${lit(String(fixtureProject?.id))}::uuid
       and state not in ('complete', 'cancelled', 'failed');
    update public.projects set status = 'archived'
     where project_id = ${lit(String(fixtureProject?.id))}::uuid;
  `)
  console.log('fixtures retired.')
} catch (error) {
  console.log(`cleanup did not complete: ${(error as Error).message.slice(0, 160)}`)
}

if (failed.length > 0) process.exit(1)
