/**
 * Slack Events API endpoint.
 *
 * Deployed to Supabase Edge Functions (ADR-0010). The same narrow contract as
 * the Telegram webhook, per §5: *"Channel adapters may only translate. They may
 * never decide."* Authenticate, normalize, persist, 200. No intent
 * classification, no agent selection, no model call.
 *
 * Slack's retry behaviour makes speed a correctness property, not a nicety:
 * anything slower than 3 seconds is retried, and Slack disables an endpoint
 * that fails repeatedly. So the handler writes one row and returns.
 *
 * `verify_jwt` is false because Slack cannot present a Supabase JWT. The
 * request signature is the whole of the authentication, which is why it is
 * verified over the **raw** body — `JSON.stringify(JSON.parse(x))` is not `x`,
 * and verifying a re-serialised body verifies a different string.
 *
 * The adapter and the signature check are imported from `src/slack/`, the same
 * files the unit tests drive. The Telegram webhook shipped once with a Node-only
 * `Buffer.from()` that passed 31 unit tests and threw on every production
 * request; uploading the tested file rather than a copy is what made that a
 * one-line fix.
 */

import type { SlackEnvelope } from './events.ts'
import { asUrlVerification, toCanonicalCommand, UnsupportedSlackEventError } from './events.ts'
import { verifySlackRequest } from './signature.ts'

const SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET') ?? ''
const BOT_USER_ID = Deno.env.get('SLACK_BOT_USER_ID') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Never echo a reason to an unauthenticated caller — it is a probing aid. */
const unauthorized = (): Response => new Response('unauthorized', { status: 401 })

const rest = async (
  path: string,
  body: unknown,
  prefer = 'resolution=ignore-duplicates,return=minimal',
): Promise<Response> =>
  fetch(`${DB_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  })

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'GET') {
    return Response.json({
      ok: true,
      endpoint: 'slack-events',
      signing_secret_configured: SIGNING_SECRET !== '',
      bot_user_configured: BOT_USER_ID !== '',
    })
  }

  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // Read once, as text. Reading it as JSON first would consume the body and
  // leave nothing to verify the signature over.
  const rawBody = await request.text()

  // An absent secret rejects everything rather than waving requests through:
  // a misconfigured deploy must fail closed, and "no secret means no checking"
  // is the shape of every accidentally-public endpoint.
  if (SIGNING_SECRET === '') return unauthorized()

  const verified = await verifySlackRequest(
    SIGNING_SECRET,
    {
      signature: request.headers.get('X-Slack-Signature'),
      timestamp: request.headers.get('X-Slack-Request-Timestamp'),
    },
    rawBody,
  )
  if (!verified.ok) return unauthorized()

  let envelope: SlackEnvelope
  try {
    envelope = JSON.parse(rawBody) as SlackEnvelope
  } catch {
    return new Response('bad request', { status: 400 })
  }

  // The handshake. Answered before anything else, because until it is answered
  // the app cannot be configured at all — and it is answered only for a
  // *signed* request, so this is not an unauthenticated echo.
  const handshake = asUrlVerification(envelope)
  if (handshake !== null) {
    return Response.json({ challenge: handshake.challenge })
  }

  // Lifecycle events change what the application knows about itself, so they
  // are handled here rather than normalized into an instruction. Gate 4 asks
  // for token revocation and reinstall to be proven, and both arrive this way.
  const eventType = envelope.event?.type ?? envelope.type
  if (eventType === 'tokens_revoked' || eventType === 'app_uninstalled') {
    await fetch(`${DB_URL}/rest/v1/slack_workspaces?team_id=eq.${String(envelope.team_id ?? '')}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        installed: false,
        uninstalled_at: new Date().toISOString(),
        revocation_reason: eventType === 'tokens_revoked' ? 'tokens_revoked' : 'app_uninstalled',
      }),
    })
    return Response.json({ ok: true, lifecycle: eventType })
  }

  let command: ReturnType<typeof toCanonicalCommand>
  try {
    command = toCanonicalCommand(envelope, BOT_USER_ID)
  } catch (error) {
    if (error instanceof UnsupportedSlackEventError) {
      // 200, not 4xx. Slack retries non-2xx and disables an endpoint that keeps
      // failing, so an event we will never act on must be acknowledged.
      return Response.json({ ok: true, ignored: error.message })
    }
    throw error
  }

  // `return=representation` on this one insert, because the side table needs the
  // command_id and a second round trip to look it up would double the latency
  // inside Slack's 3-second budget.
  const stored = await rest(
    'inbound_commands',
    {
      origin_channel: command.origin_channel,
      origin_ref: command.origin_ref,
      actor: command.actor,
      instruction: command.instruction,
      dedupe_key: command.dedupe_key,
      callback_action: command.callback_action,
      compensates_event_id: command.compensates_event_id,
      received_at: command.received_at,
    },
    'resolution=merge-duplicates,return=representation',
  )

  // A duplicate is not a failure. `merge-duplicates` returns the existing row,
  // but *concurrent* duplicates can still surface as 409 from the unique index
  // — which is the index doing its job. The Gate 4 run produced exactly that:
  // one of five simultaneous redeliveries came back 409, the handler returned
  // 503, and Slack was told to retry an event that had already been stored
  // correctly. 409 is success.
  if (!stored.ok && stored.status !== 409) {
    return new Response('storage failed', { status: 503 })
  }
  if (stored.status === 409) {
    return Response.json({ ok: true, dedupe_key: command.dedupe_key, duplicate: true })
  }

  const returned = (await stored.json()) as { command_id?: string }[]
  const commandId = returned[0]?.command_id

  if (commandId !== undefined) {
    // The Slack-specific half. Best effort *in the response sense only*: if it
    // fails the canonical command is still stored, which is the row that must
    // never be lost. Slack routing can be re-derived; an instruction cannot.
    await rest('inbound_commands_slack', {
      command_id: commandId,
      team_id: command.slack.team_id,
      channel_id: command.slack.channel_id,
      thread_ts: command.slack.thread_ts,
      is_dm: command.slack.is_dm,
      reaction: command.slack.reaction,
    })
  }

  return Response.json({ ok: true, dedupe_key: command.dedupe_key })
})
