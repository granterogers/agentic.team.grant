/**
 * Telegram webhook endpoint.
 *
 * Deployed to Supabase Edge Functions (ADR-0010), which gives a stable HTTPS
 * URL without a second hosting provider or a second credential.
 *
 * What this endpoint is allowed to do is deliberately narrow, per §5:
 * *"Channel adapters may only translate. They may never decide."* It
 * authenticates, normalizes, persists the canonical command, and returns 200.
 * No intent classification, no agent selection, no model call, no work.
 *
 * Returning 200 quickly matters for a second reason: Telegram retries on
 * anything else, and a slow handler turns one update into several.
 *
 * `verify_jwt` is false at deploy time because Telegram cannot present a
 * Supabase JWT. The `X-Telegram-Bot-Api-Secret-Token` header is the ONLY
 * authentication a Telegram webhook has, so it carries the whole burden — which
 * is why it is compared in constant time and why an absent secret rejects
 * everything rather than waving requests through.
 *
 * The adapter is imported from `./telegram.ts`, the same file the unit tests
 * drive. Re-implementing it for Deno would mean the tested code and the running
 * code were different code.
 */

import type { TelegramUpdate } from './telegram.ts'
import { secretMatches, senderOf, toCanonicalCommand, UnsupportedUpdateError } from './telegram.ts'

const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
/**
 * The Chief of Staff bot, used only when a request names no bot.
 *
 * Seven bots share this one function and each registers its own URL with its
 * own `?bot=` (0072). The id in the query string is never trusted — it is
 * looked up in `telegram_bots`, and an unknown or disabled id is refused,
 * because otherwise the query string would be a way to file an instruction as
 * any staff member.
 */
const DEFAULT_BOT_ID = Deno.env.get('TELEGRAM_BOT_ID') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
/**
 * Where to kick the worker, and what to present when kicking it.
 *
 * Grant: *"I need the response to be pretty much instant whenever I send a
 * message to one of the bots."* It was not: the job reached the queue in under
 * a second and then waited for a GitHub Actions cron that claims every five
 * minutes and, over the fourteen hours before he said so, ran six times.
 * Actions schedules are best-effort and GitHub drops the frequent ones first.
 *
 * So the thing that receives the message starts the work. Empty means no kick,
 * and the queue still drains on the slower paths — a missing secret must
 * degrade to "late", never to "lost" (§18).
 */
const WORKER_URL = Deno.env.get('WORKER_URL') ?? ''
const WORKER_KICK_SECRET = Deno.env.get('WORKER_KICK_SECRET') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Never echo a reason to an unauthenticated caller — it is a probing aid. */

/**
 * Call one `public.*` RPC with the service key and return its JSON.
 *
 * Returns null on any failure rather than throwing. Every caller here is
 * optional extra behaviour on a webhook that must answer Telegram quickly and
 * must never lose a message — a configuration read that raises would turn a
 * missing setting into a dropped voice note.
 */
const rpcOne = async (fn: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  try {
    const response = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

const unauthorized = (): Response => new Response('unauthorized', { status: 401 })

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'GET') {
    // A liveness probe, deliberately saying nothing about configuration beyond
    // whether a secret is present at all.
    return Response.json({
      ok: true,
      endpoint: 'telegram-webhook',
      secret_configured: WEBHOOK_SECRET !== '',
    })
  }

  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

  if (!secretMatches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), WEBHOOK_SECRET)) {
    return unauthorized()
  }

  // Which bot was written to, resolved rather than believed.
  const claimed = new URL(request.url).searchParams.get('bot') ?? DEFAULT_BOT_ID
  /*
    FAILING TO ASK IS NOT AN ANSWER (#388). This used to read the reply's body without looking at its
    status, so a database error, a throttle or a non-JSON body all came out as "no such bot" and were
    acknowledged with 200 - Telegram does not retry a 200, and the message was gone. Only a successful
    answer that names nobody is an unknown bot.
  */
  const asked = await fetch(`${DB_URL}/rest/v1/rpc/staff_for_bot`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_bot_id: claimed }),
  }).catch(() => null)
  const answered = asked !== null && asked.ok ? await asked.json().catch(() => null) : null
  if (!Array.isArray(answered)) {
    return new Response('could not resolve the bot', { status: 503 })
  }
  const speakers = answered as {
    staff_slug?: string | null
    staff_name?: string | null
    username?: string
  }[]
  const speaker = speakers[0]
  if (speaker === undefined) {
    // An unregistered or disabled bot. 200 rather than 4xx: Telegram retries a
    // non-2xx forever, and an update for a bot we have turned off is one we
    // will never accept however many times it arrives.
    return Response.json({ ok: true, ignored: 'unknown or disabled bot' })
  }
  const BOT_ID = claimed

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return new Response('bad request', { status: 400 })
  }

  /*
    WHO SENT THIS, according to the office and not according to Telegram.

    The shared secret proves the request came from Telegram; it says nothing
    about the person, and a bot's username is public. Until this check every
    private chat that reached a bot was recorded as Grant's own (so the pager
    could be pointed at a stranger, 0607) and everything it said became a job
    from `telegram:<their id>`.

    `public.sender_admitted` reads `subject_identities`, the list of which
    Telegram user is which person (0056), and whether the conversation is a
    declared test origin (0605). Anyone else is acknowledged with a 200 and
    NOTHING is stored: no chat registered, no command, no job, no lesson. A
    200 rather than a 4xx because Telegram retries a non-2xx forever, and a
    stranger's message is one we will never accept however often it arrives.

    Identity that cannot be established is a refusal: an update with no
    `from`, or a `from.id` that is not a user id, never reaches storage.

    But a LOOKUP that fails is not a stranger. If the office cannot be asked,
    Grant's own message must not be dropped as though he were one, so that is
    a 503 and Telegram retries it.
  */
  const sender = senderOf(update)
  const claimedChat =
    update.message?.chat ?? update.callback_query?.message?.chat ?? update.my_chat_member?.chat
  let subject: string | null = null
  let declaredTest = false
  if (sender !== null) {
    let admitted: Response
    try {
      admitted = await fetch(`${DB_URL}/rest/v1/rpc/sender_admitted`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_channel: 'telegram',
          p_actor: sender,
          p_conversation: claimedChat === undefined ? null : String(claimedChat.id),
        }),
      })
    } catch {
      return new Response('sender lookup failed', { status: 503 })
    }
    if (!admitted.ok) return new Response('sender lookup failed', { status: 503 })
    const who = (await admitted.json().catch(() => null)) as {
      subject?: string | null
      declared_test?: boolean
    } | null
    if (who === null) return new Response('sender lookup failed', { status: 503 })
    subject = typeof who.subject === 'string' && who.subject !== '' ? who.subject : null
    declaredTest = who.declared_test === true
  }
  if (subject === null && !declaredTest) {
    return Response.json({ ok: true, ignored: 'unrecognised sender' })
  }

  // Register the chat BEFORE normalizing, and outside the try that drops
  // unsupported updates.
  //
  // This is the only moment the chat id exists: Telegram forbids a bot
  // messaging anyone who has not messaged it, so there is no other way to learn
  // where to page (0041). An update we cannot turn into an instruction — a
  // sticker, a join notice — still proves the chat is reachable, and dropping
  // it inside the normalizer's catch would throw that away.
  // `my_chat_member` last, and it matters that it is there at all. Group
  // privacy is on by default, so a bot added to the office group never sees an
  // ordinary message in it and would otherwise have no way to learn the room
  // exists. Being added IS the registration event (0136).
  const chat =
    update.message?.chat ?? update.callback_query?.message?.chat ?? update.my_chat_member?.chat
  //
  // Best effort in the RESPONSE sense only: failing to register must not make
  // Telegram retry an update that was otherwise handled. The first version
  // implemented that as `.catch(() => undefined)` and returned 200 having
  // silently done nothing — "must not fail the request" is not the same as
  // "must not be noticed". The outcome is now carried in the response body, so
  // a probe can see it and the check that found this can keep finding it.
  let registration = 'skipped'
  if (chat !== undefined && BOT_ID !== '') {
    try {
      // `public`, not `app`: PostgREST exposes only the schemas it is
      // configured for, and exposing the internal one to fix a single call
      // would put every function in it behind nothing but the anon key (0042).
      const response = await fetch(`${DB_URL}/rest/v1/rpc/record_telegram_chat`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_chat_id: String(chat.id),
          p_chat_type: String(chat.type ?? 'private'),
          p_bot_id: BOT_ID,
          // Attributed only for a private chat, and only to the person the
          // office's own list says this Telegram user is (0607). A group is
          // not one person, and saying it is would page a room.
          p_subject: chat.type === 'private' ? subject : null,
          // A group has a name and Grant will recognise it by that, not by a
          // negative fourteen-digit id.
          p_title: chat.title ?? null,
        }),
      })
      registration = response.ok ? 'ok' : `http_${String(response.status)}`
    } catch {
      registration = 'unreachable'
    }
  }

  let command: ReturnType<typeof toCanonicalCommand>
  try {
    // The bot, so the dedupe key can tell his first message to Emma from his
    // first message to Tom. They are the same chat id and the same message
    // number, and without this the second was discarded as a redelivery.
    command = toCanonicalCommand(update, new Date(), BOT_ID)
  } catch (error) {
    if (error instanceof UnsupportedUpdateError) {
      // 200, not 4xx. Telegram retries non-2xx, and an update we will never
      // understand would be retried forever. Acknowledged and dropped.
      return Response.json({ ok: true, ignored: error.message, registration })
    }
    throw error
  }

  // Persist through PostgREST. `dedupe_key` carries a unique index, so a
  // redelivered update collides rather than enqueueing the same instruction
  // twice — §6 requires that to be structural, not a guard in a handler.
  const response = await fetch(`${DB_URL}/rest/v1/inbound_commands`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify({
      origin_channel: command.origin_channel,
      origin_ref: command.origin_ref,
      actor: command.actor,
      instruction: command.instruction,
      dedupe_key: command.dedupe_key,
      callback_action: command.callback_action,
      // Spoken rather than typed. The handle only — the audio stays with
      // Telegram until the worker fetches it, transcribes it on our own
      // hardware and throws it away (0075).
      voice_file_id: command.voice_file_id,
      voice_seconds: command.voice_seconds,
      compensates_event_id: command.compensates_event_id,
      received_at: command.received_at,
      // Who it was sent TO. Opening @atg_research_bot addresses Ines, and that
      // is a clearer signal than any classifier could produce from the text.
      addressed_to: speaker.staff_slug ?? null,
    }),
    // `return=representation`, because the command_id is needed to turn this
    // into work and a `return=minimal` insert hands back nothing.
  })

  /*
    Answer the button, now.

    Issue #59. `answerCallbackQuery` was listed as idempotent in the Telegram
    client and called from nowhere, so pressing a button left the spinner
    turning until Telegram gave up. The press WAS recorded — the insert above
    is what records it, and the worker acts within the minute — but nothing
    said so, and the only honest reading of a spinner that never resolves is
    "it did not work". Grant pressed them and reasonably concluded they were
    dead.

    It has to happen here rather than in the worker: Telegram wants the answer
    within a few seconds and the duty pass runs every minute.

    After the insert, deliberately. The toast says the press was taken, so
    saying it before the row exists would be a lie in the one case that
    matters. Best effort thereafter — a toast that fails must not make Telegram
    retry an update that was stored.
  */
  if (command.callback_action !== null && command.callback_action !== undefined) {
    const queryId = update.callback_query?.id
    if (typeof queryId === 'string' && queryId !== '') {
      const ack = (await rpcOne('callback_ack', {
        p_bot_id: claimed,
        p_action: command.callback_action,
      })) as { token?: string; text?: string } | null
      if (typeof ack?.token === 'string' && ack.token !== '') {
        try {
          await fetch(`https://api.telegram.org/bot${ack.token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: queryId,
              text: ack.text ?? 'Got it',
              // A toast, not an alert. An alert is a modal he has to dismiss,
              // which is a heavier interruption than the press deserved.
              show_alert: false,
            }),
          })
        } catch {
          // See above: never fail the request over an acknowledgement.
        }
      }
    }
  }

  if (!response.ok && response.status !== 409) {
    // A 5xx here means Telegram should retry, so say so. A 409 is the
    // idempotency index doing its job and is success.
    return new Response('storage failed', { status: 503 })
  }

  // An instruction becomes work. Storing it was the whole of the inbound path
  // until now: `inbound_commands` had a writer and, for text, no consumer, so a
  // message to a bot went into a table and nothing happened — which from
  // Grant's side is indistinguishable from the bot being broken.
  let queued: string | null = null
  if (
    (command.instruction !== null && command.instruction.trim() !== '') ||
    command.voice_file_id !== null
  ) {
    const stored = (await response.json().catch(() => [])) as { command_id?: string }[]
    let commandId = stored[0]?.command_id
    /*
      A REDELIVERY OF A MESSAGE WHOSE JOB WAS NEVER MADE (#388). The insert ignores a duplicate and
      returns nothing, so when the first delivery stored the row and then failed to enqueue it, every
      retry found the row, made no job, and answered 200: the instruction was stored and never worked.
      A duplicate that has no job yet is finished here; `enqueue_inbound` is idempotent, so one that
      already has a job answers `already` and makes none.
    */
    if (commandId === undefined) {
      const existing = await fetch(
        `${DB_URL}/rest/v1/inbound_commands?dedupe_key=eq.${encodeURIComponent(command.dedupe_key)}&select=command_id,job_id&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      ).catch(() => null)
      const rows =
        existing !== null && existing.ok
          ? ((await existing.json().catch(() => [])) as {
              command_id?: string
              job_id?: string | null
            }[])
          : []
      if (rows[0]?.command_id !== undefined && (rows[0].job_id ?? null) === null) {
        commandId = rows[0].command_id
      }
    }
    if (commandId !== undefined) {
      const call = await fetch(`${DB_URL}/rest/v1/rpc/enqueue_inbound`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_command_id: commandId }),
      }).catch(() => null)
      // The instruction is stored; if it could not be turned into work, say so, so Telegram tries again.
      // Only a failure on OUR side is worth Telegram's retry. A 4xx is the database refusing this
      // message for good (a sender it does not admit, a malformed row); retrying it is a storm, so it
      // is answered 200 and recorded as refused (review of Run 3, F8).
      if (call === null || call.status >= 500) {
        return new Response('could not queue it', { status: 503 })
      }
      if (!call.ok) return Response.json({ ok: true, refused: 'not accepted', queued: null })
      const enqueued = (await call.json().catch(() => ({}))) as {
        job_id?: string
        error?: string
        already?: boolean
      }
      // A redelivery that finds its job already made must not say anything a second time (the voice
      // refusal, the kick): only the delivery that made the job speaks for it.
      queued = enqueued.already === true ? null : (enqueued.job_id ?? enqueued.error ?? null)
    }
  }

  // Start the work now, without waiting for it.
  //
  // Deliberately NOT awaited. Telegram retries a webhook that does not answer
  // within seconds, and a retried update is a second copy of the same message;
  // a pass can take a minute. `waitUntil` keeps the runtime alive for the
  // request after the response has gone, which is exactly the shape needed:
  // Grant gets his reply in the time one model call takes, and Telegram gets
  // its 200 immediately.
  //
  // Failures are swallowed on purpose. The kick is an accelerator, not the
  // delivery mechanism — pg_cron runs the same pass every minute and Actions
  // behind that, so a kick that fails costs latency and nothing else.
  // A voice note needs something that can hear, and right now there may be
  // nothing.
  //
  // Grant asked to stop using GitHub Actions for any process, and
  // transcription is the one thing with nowhere else to go: faster-whisper is
  // Python in a subprocess, and the edge runtime has neither. So rather than
  // accept the note, queue it, and leave it unanswered — which is exactly the
  // ten-minute silence he complained about this morning — the bot says so, at
  // once, in the chat he sent it to.
  //
  // 0133's `voice.transcription` decides. 'none' means say so; anything else
  // means carry on and let the runner path below handle it.
  // Only the delivery that STORED (or finished) the command says so: Telegram redelivers an update it
  // was not answered promptly, and a refusal sent on every redelivery is the same message N times.
  if (command.voice_file_id !== null && queued !== null) {
    const refusal = (await rpcOne('voice_refusal', { p_bot_id: claimed })) as {
      refuse?: boolean
      token?: string
    } | null
    if (refusal?.refuse === true && typeof refusal.token === 'string' && refusal.token !== '') {
      const [chatId, messageId] = String(command.origin_ref).split(':')
      await fetch(`https://api.telegram.org/bot${refusal.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          ...(messageId !== undefined && /^\d+$/.test(messageId)
            ? { reply_to_message_id: Number(messageId), allow_sending_without_reply: true }
            : {}),
          text:
            '🎧 I cannot turn voice notes into words at the moment — the machine ' +
            'that did the listening has been switched off to stop it running up a ' +
            'bill.\n\nSend it as text and I will act on it straight away. Ask Claude to ' +
            'turn transcription back on when you have decided how.',
        }),
      }).catch(() => undefined)
      return Response.json({ ok: true, refused: 'no transcription available', queued: null })
    }
  }

  // A voice note needs a worker that can hear.
  //
  // The Edge worker cannot: transcription shells out to faster-whisper so
  // Grant's voice never leaves our own compute, and that runtime has no
  // subprocesses and no Python — it says so itself at GET /worker. 0125 stops
  // it claiming the job; this starts something that can take it.
  //
  // `repository_dispatch` is the one Actions trigger that is not a schedule:
  // a POST starts a run in seconds, where the cron ran six times in fourteen
  // hours. Skipped silently when no token is configured — the note is then
  // picked up on the next cron, which is late but never lost (§18).
  let woke = false
  if (queued !== null && command.voice_file_id !== null) {
    const gh = (await rpcOne('github_dispatch')) as { repository?: string; token?: string }
    if (typeof gh?.token === 'string' && gh.token !== '' && typeof gh.repository === 'string') {
      woke = true
      const dispatch = fetch(`https://api.github.com/repos/${gh.repository}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gh.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'ai-team-hq-webhook',
        },
        // No payload beyond the type. The job is already in the queue; the
        // runner's job is to drain it, not to be told what is in it.
        body: JSON.stringify({ event_type: 'voice-note' }),
      }).catch(() => undefined)
      const keep = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
        .EdgeRuntime?.waitUntil
      if (keep === undefined) void dispatch
      else keep(dispatch)
    }
  }

  let kicked = false
  if (queued !== null && WORKER_URL !== '' && WORKER_KICK_SECRET !== '') {
    kicked = true
    const kick = fetch(WORKER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WORKER_KICK_SECRET}` },
    }).catch(() => undefined)
    const keepAlive = (
      globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }
    ).EdgeRuntime?.waitUntil
    if (keepAlive === undefined) void kick
    else keepAlive(kick)
  }

  return Response.json({
    ok: true,
    kicked,
    woke,
    dedupe_key: command.dedupe_key,
    registration,
    addressed_to: speaker.staff_slug ?? '(the pager)',
    spoken: command.voice_file_id !== null,
    queued,
  })
})
