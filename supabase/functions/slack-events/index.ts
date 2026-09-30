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
import { parseInteractionBody, toCanonicalInteraction } from './interactions.ts'
import { verifySlackRequest } from './signature.ts'

const SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET') ?? ''
const BOT_USER_ID = Deno.env.get('SLACK_BOT_USER_ID') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
/**
 * Where to kick the worker, and what to present when kicking it.
 *
 * The Telegram webhook has done this since Grant said *"I need the response to
 * be pretty much instant"*. Slack never did, so a message typed in the office
 * waited for the next pg_cron tick — up to a minute before the pass even
 * starts, and longer than that end to end.
 *
 * Grant, on both surfaces: *"I need any messages that I send either in
 * Telegram or in Slack to be responded to within, say, a minute."* One
 * mechanism, both doors.
 *
 * Empty means no kick, and the queue still drains on the slower path — a
 * missing secret must degrade to "late", never to "lost" (§18).
 */
const WORKER_URL = Deno.env.get('WORKER_URL') ?? ''
const WORKER_KICK_SECRET = Deno.env.get('WORKER_KICK_SECRET') ?? ''

/**
 * Start the work now, without waiting for it.
 *
 * Deliberately not awaited. Slack retries an event it does not get a 200 for
 * within three seconds, and a retried event is a second copy of the message;
 * a pass can take a minute. `waitUntil` keeps the runtime alive after the
 * response has gone, which is exactly the shape needed.
 *
 * Failures are swallowed: the kick is an accelerator, not the delivery
 * mechanism.
 */
const kickWorker = (): boolean => {
  if (WORKER_URL === '' || WORKER_KICK_SECRET === '') return false
  const kick = fetch(WORKER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_KICK_SECRET}` },
  }).catch(() => undefined)
  const keepAlive = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil
  if (keepAlive === undefined) void kick
  else keepAlive(kick)
  return true
}

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

/*
  IS THIS SENDER SOMEBODY THE OFFICE ANSWERS (#388, 0615).

  A valid Slack signature proves the request came from Slack. It says nothing
  about which person in that workspace typed it: any member, and any Slack Connect
  guest in a channel the bot is in, produces a correctly signed event. Until now
  every one of them became an instruction from `slack:<their id>`, trusted as a
  production door, with the same reach as anyone (a stranger could read the
  project's documents through the office, and teach it a standing rule that
  read as Grant's).

  Telegram has refused a stranger at the door since 0607, from the same list
  (`public.subject_identities`). This asks it for Slack, before anything is
  stored: a stranger's message is acknowledged with 200 and nothing else (Slack
  retries a non-2xx, and there is no reason to tell a stranger anything). A
  failure to ASK is not a refusal, and answers 503 so Slack tries again.
*/
type Admission = 'admitted' | 'stranger' | 'unknown'
const admission = async (actor: string, conversation: string): Promise<Admission> => {
  const asked = await fetch(`${DB_URL}/rest/v1/rpc/sender_admitted`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_channel: 'slack', p_actor: actor, p_conversation: conversation }),
  }).catch(() => null)
  if (asked === null || !asked.ok) return 'unknown'
  const said = (await asked.json().catch(() => null)) as {
    subject?: string | null
    declared_test?: boolean
  } | null
  if (said === null) return 'unknown'
  return (typeof said.subject === 'string' && said.subject !== '') || said.declared_test === true
    ? 'admitted'
    : 'stranger'
}

/**
 * Persist a canonical command and its Slack routing.
 *
 * Shared by the events path and the interactivity path, because they differ
 * only in how the command was derived — and two copies of an insert is how the
 * two paths start disagreeing about what a duplicate is.
 *
 * Returns the outcome rather than a Response: the two callers owe Slack
 * different replies (an event wants JSON, a button press wants an empty body
 * or the message is replaced).
 */
const storeCommand = async (
  command: ReturnType<typeof toCanonicalCommand>,
): Promise<'stored' | 'duplicate' | 'failed'> => {
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
  if (!stored.ok && stored.status !== 409) return 'failed'
  if (stored.status === 409) return 'duplicate'

  const returned = (await stored.json()) as { command_id?: string }[]
  const commandId = returned[0]?.command_id
  if (commandId !== undefined) {
    // The Slack-specific half. Best effort *in the response sense only*: if it
    // fails the canonical command is still stored, which is the row that must
    // never be lost. Slack routing can be re-derived; an instruction cannot.
    // And the thing that makes it WORK.
    //
    // This call was missing entirely. A message typed in Slack was stored as a
    // canonical command and nothing ever turned it into a job — 30 of them
    // going back three days, filed and never answered. The Telegram webhook
    // has called this since 0072 and the voice endpoint since 0102; Slack, the
    // surface §12 calls "the office", never did.
    //
    // Only for something that IS an instruction: a reaction, a join notice and
    // a button press are canonical commands too, and none of them is work.
    // Button presses go through `processCallbacks` at the top of every pass.
    if (command.instruction !== null && command.instruction.trim() !== '') {
      await rest('rpc/enqueue_inbound', { p_command_id: commandId })
    }

    await rest('inbound_commands_slack', {
      command_id: commandId,
      team_id: command.slack.team_id,
      channel_id: command.slack.channel_id,
      thread_ts: command.slack.thread_ts,
      is_dm: command.slack.is_dm,
      reaction: command.slack.reaction,
    })
  }
  return 'stored'
}

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

  // Interactivity arrives at the SAME URL as events and is not JSON: Slack
  // form-encodes it as `payload=<json>`. Checked before the JSON parse, because
  // otherwise every button press is a 400 — and a 400 here is shown to the
  // person who clicked, not quietly retried.
  //
  // The signature was already verified over the raw body above, which is the
  // only correct place to do it either way.
  const interaction = parseInteractionBody(rawBody)
  if (interaction !== null) {
    let pressed: ReturnType<typeof toCanonicalInteraction>
    try {
      pressed = toCanonicalInteraction(interaction)
    } catch {
      // An unknown action id is our own older message meeting our newer code.
      // 200 and nothing, so Slack does not show the clicker an error for
      // something they cannot fix.
      return Response.json({ ok: true, ignored: 'unrecognised interaction' })
    }
    // A stranger's press is nobody's answer: not stored, so it cannot claim an undo offer,
    // record feedback or answer a question (#388).
    const presser = await admission(pressed.actor, pressed.slack.channel_id ?? '')
    if (presser === 'unknown') return new Response('could not check the sender', { status: 503 })
    if (presser === 'stranger') return new Response('', { status: 200 })
    await storeCommand(pressed)
    // An empty 200 leaves the message exactly as it is. Slack treats a body
    // here as a REPLACEMENT for the message, so returning anything chatty would
    // overwrite the result the button is attached to.
    return new Response('', { status: 200 })
  }

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

  const sender = await admission(command.actor, command.slack.channel_id ?? '')
  if (sender === 'unknown') return new Response('could not check the sender', { status: 503 })
  if (sender === 'stranger') return Response.json({ ok: true, ignored: 'unrecognised sender' })

  const outcome = await storeCommand(command)
  if (outcome === 'failed') return new Response('storage failed', { status: 503 })
  if (outcome === 'duplicate') {
    return Response.json({ ok: true, dedupe_key: command.dedupe_key, duplicate: true })
  }

  // Only for a message that was actually stored. Kicking on a duplicate would
  // start a pass for work already queued or already done.
  return Response.json({ ok: true, dedupe_key: command.dedupe_key, kicked: kickWorker() })
})
