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

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return new Response('bad request', { status: 400 })
  }

  let command: ReturnType<typeof toCanonicalCommand>
  try {
    command = toCanonicalCommand(update)
  } catch (error) {
    if (error instanceof UnsupportedUpdateError) {
      // 200, not 4xx. Telegram retries non-2xx, and an update we will never
      // understand would be retried forever. Acknowledged and dropped.
      return Response.json({ ok: true, ignored: error.message })
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
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({
      origin_channel: command.origin_channel,
      origin_ref: command.origin_ref,
      actor: command.actor,
      instruction: command.instruction,
      dedupe_key: command.dedupe_key,
      callback_action: command.callback_action,
      compensates_event_id: command.compensates_event_id,
      received_at: command.received_at,
    }),
  })

  if (!response.ok && response.status !== 409) {
    // A 5xx here means Telegram should retry, so say so. A 409 is the
    // idempotency index doing its job and is success.
    return new Response('storage failed', { status: 503 })
  }

  return Response.json({ ok: true, dedupe_key: command.dedupe_key })
})
