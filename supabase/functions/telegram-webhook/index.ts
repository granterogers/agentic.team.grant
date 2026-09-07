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
import { secretMatches, toCanonicalCommand, UnsupportedUpdateError } from './telegram.ts'

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
/** Who the private chats reaching this bot belong to. One human, for V1. */
const SUBJECT = Deno.env.get('TELEGRAM_SUBJECT') ?? 'grant'
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Never echo a reason to an unauthenticated caller — it is a probing aid. */
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
  const speakers = (await (
    await fetch(`${DB_URL}/rest/v1/rpc/staff_for_bot`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_bot_id: claimed }),
    })
  ).json()) as { staff_slug?: string | null; staff_name?: string | null; username?: string }[]
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

  // Register the chat BEFORE normalizing, and outside the try that drops
  // unsupported updates.
  //
  // This is the only moment the chat id exists: Telegram forbids a bot
  // messaging anyone who has not messaged it, so there is no other way to learn
  // where to page (0041). An update we cannot turn into an instruction — a
  // sticker, a join notice — still proves the chat is reachable, and dropping
  // it inside the normalizer's catch would throw that away.
  const chat = update.message?.chat ?? update.callback_query?.message?.chat
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
          // Attributed only for a private chat. A group is not one person, and
          // saying it is would page a room.
          p_subject: chat.type === 'private' ? SUBJECT : null,
        }),
      })
      registration = response.ok ? 'ok' : `http_${String(response.status)}`
    } catch {
      registration = 'unreachable'
    }
  }

  let command: ReturnType<typeof toCanonicalCommand>
  try {
    command = toCanonicalCommand(update)
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
    const commandId = stored[0]?.command_id
    if (commandId !== undefined) {
      const enqueued = (await (
        await fetch(`${DB_URL}/rest/v1/rpc/enqueue_inbound`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_command_id: commandId }),
        })
      ).json()) as { job_id?: string; error?: string }
      queued = enqueued.job_id ?? enqueued.error ?? null
    }
  }

  return Response.json({
    ok: true,
    dedupe_key: command.dedupe_key,
    registration,
    addressed_to: speaker.staff_slug ?? '(the pager)',
    spoken: command.voice_file_id !== null,
    queued,
  })
})
