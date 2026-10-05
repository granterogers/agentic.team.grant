/**
 * Deploy a Supabase Edge Function.
 *
 *   npm run deploy:telegram   telegram-webhook, then register it with Telegram
 *   npm run deploy:voice      voice-token + voice (Gate 1 POC)
 *
 * ADR-0010: webhooks live on Supabase Edge Functions rather than Vercel,
 * because the Management API can deploy them with the token this project
 * already has. No second provider, no second credential, no human step.
 *
 * The adapter is uploaded from `src/channels/telegram.ts` — the same file the
 * unit tests drive — rather than from a copy. A copy would drift, and then the
 * tested code and the running code would be different code.
 */
import '../../src/safety/require-production-writes.ts'
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const botToken = process.env.TELEGRAM_CHIEF_BOT_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const SLUG = 'telegram-webhook'
const api = `https://api.supabase.com/v1/projects/${ref}`

const db = new ManagementApiExecutor(ref, token)

// --- the webhook secret, from the vault ------------------------------------
const secretRow = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'telegram.webhook_secret'`,
  )
).rows[0]
const webhookSecret = secretRow?.v === undefined ? null : String(secretRow.v)
if (webhookSecret === null) {
  console.error('no telegram.webhook_secret in the vault — run `npm run telegram:configure`')
  process.exit(1)
}

// --- the worker kick secret, from the vault --------------------------------
//
// Written by `npm run deploy:worker`. Absent means the worker has never been
// deployed, and the webhook falls back to enqueue-and-wait: correct, and slow
// enough that Grant notices, so it is said out loud rather than left as a
// surprise.
const kickRow = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'worker.kick_secret'`,
  )
).rows[0]
const kickSecret = kickRow?.v === undefined ? '' : String(kickRow.v)
if (kickSecret === '') {
  console.warn(
    'no worker.kick_secret in the vault — run `npm run deploy:worker` first, or replies ' +
      'will wait for the slow schedule instead of arriving in seconds',
  )
}

// --- give the function its secret ------------------------------------------
// Edge Functions receive SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// automatically; anything else has to be set explicitly.
// The bot's own id, so a chat id is recorded against the bot that holds it
// (0041). Read from the live API rather than configured: a hand-copied id that
// disagrees with the token would register chats nothing can ever page.
let botId = ''
if (botToken !== undefined && botToken !== '') {
  const me = (await (await fetch(`https://api.telegram.org/bot${botToken}/getMe`)).json()) as {
    ok?: boolean
    result?: { id?: number; username?: string }
  }
  if (me.ok === true && me.result?.id !== undefined) {
    botId = String(me.result.id)
    console.log(`bot: @${String(me.result.username)} (${botId})`)
  }
}
if (botId === '') {
  // Refuse rather than deploy a webhook that silently registers nothing: the
  // failure would surface weeks later as "the pager never pages".
  console.error(
    'cannot determine the bot id — refusing to deploy a webhook that cannot register chats',
  )
  process.exit(1)
}

const setSecret = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'TELEGRAM_WEBHOOK_SECRET', value: webhookSecret },
    { name: 'TELEGRAM_BOT_ID', value: botId },
    // So the webhook can start the work it just queued. Without these the
    // message still gets answered, just on the slower schedule — which is the
    // ten-minute wait Grant reported, so the deploy warns rather than shrugs.
    { name: 'WORKER_URL', value: `https://${ref}.supabase.co/functions/v1/worker` },
    { name: 'WORKER_KICK_SECRET', value: kickSecret },
  ]),
})
console.log(`function secret set: http ${setSecret.status}`)

// --- deploy ----------------------------------------------------------------
const [entrypoint, adapter] = await Promise.all([
  readFile('supabase/functions/telegram-webhook/index.ts', 'utf8'),
  readFile('src/channels/telegram.ts', 'utf8'),
])

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: SLUG, entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append('file', new File([entrypoint], 'index.ts', { type: 'application/typescript' }))
// Uploaded from src/, so the running adapter IS the tested adapter.
form.append('file', new File([adapter], 'telegram.ts', { type: 'application/typescript' }))

const deployed = await fetch(`${api}/functions/deploy?slug=${SLUG}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
const result = (await deployed.json()) as {
  slug?: string
  version?: number
  status?: string
  message?: string
}
if (!deployed.ok) {
  console.error(`deploy failed: ${deployed.status} ${JSON.stringify(result)}`)
  process.exit(1)
}
console.log(
  `deployed ${String(result.slug)} v${String(result.version)} status=${String(result.status)} verify_jwt=false`,
)

const url = `https://${ref}.supabase.co/functions/v1/${SLUG}`

// --- liveness --------------------------------------------------------------
const live = await fetch(url)
const liveBody = (await live.json()) as { ok?: boolean; secret_configured?: boolean }
console.log(
  `liveness: http ${live.status} ok=${String(liveBody.ok)} secret_configured=${String(liveBody.secret_configured)}`,
)
if (liveBody.secret_configured !== true) {
  console.error('the function is live but has no secret — refusing to register the webhook')
  process.exit(1)
}

// --- register the webhook --------------------------------------------------
if (botToken === undefined || botToken === '') {
  console.log('\nTELEGRAM_CHIEF_BOT_TOKEN not set; skipping setWebhook')
  process.exit(0)
}

const set = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url,
    secret_token: webhookSecret,
    // Only what this adapter understands. Narrowing the subscription means
    // Telegram does not queue updates nothing will ever read.
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    // Anything queued while there was no endpoint is stale by definition.
    drop_pending_updates: true,
  }),
})
const setBody = (await set.json()) as { ok: boolean; description?: string }
console.log(`setWebhook: ok=${String(setBody.ok)} ${setBody.description ?? ''}`)

// This call registers the CHIEF's webhook only, at the bare URL. The seven
// director bots each register the same function with their own `?bot=` (0072),
// and this deploy leaves those untouched — but the bare URL it just set on the
// chief is the one shape that carries no bot id, which is why the reminder is
// printed rather than left to be remembered.
console.log(
  '\nThe seven director bots register their own ?bot= URLs. Run:\n' +
    '  npm run telegram:webhooks\n' +
    'to confirm all eight are listening — it is a set, so it is safe to re-run.',
)

const info = (await (
  await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`)
).json()) as { result?: Record<string, unknown> }
const r = info.result ?? {}
console.log(
  `\nwebhook: ${String(r.url)}\n` +
    `  pending: ${String(r.pending_update_count)}\n` +
    `  allowed: ${JSON.stringify(r.allowed_updates)}\n` +
    `  last error: ${String(r.last_error_message ?? '—')}`,
)
