/**
 * Subscribe the Slack app to the events the application needs.
 *
 *   npm run slack:configure-events
 *
 * Done by manifest update rather than in the browser, per §14: a step is only
 * Grant's if it cannot be done by CLI, API or by inspecting configuration. This
 * one can.
 *
 * The event list is chosen to stay inside the scopes the app **already has**.
 * Adding a scope forces a reinstall, which needs Grant in a browser, and the
 * only event that would require one is `app_mention` (`app_mentions:read`).
 * `message.channels` already delivers a mention in a channel as a message, so
 * the capability is covered and the reinstall is not needed. The adapter still
 * handles an `app_mention` envelope if the scope is ever added.
 *
 * The manifest is validated before it is applied, and exported afterwards and
 * compared against intent. A create/update response saying `ok: true` means the
 * call was accepted; only a read-back shows what the app is actually configured
 * to do.
 */
import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const APP_ID = process.env.SLACK_APP_ID ?? 'A0BUFRVSSLD'
const db = new ManagementApiExecutor(ref, supabase)

const configToken = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'slack.config_token'`,
    )
  ).rows[0]?.v ?? '',
)
if (configToken === '') {
  console.error('no slack.config_token in the vault — run `npm run slack:rotate`')
  process.exit(1)
}

const slack = async (method: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${configToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  return (await r.json()) as Record<string, unknown>
}

/**
 * Events we can subscribe to with the scopes already granted.
 *
 * `tokens_revoked` and `app_uninstalled` need no scope and are the two Gate 4
 * asks for by name — without them, revocation is discovered by a call failing,
 * which is a worse way to learn it.
 */
const EVENTS = [
  'message.channels',
  'message.groups',
  'message.im',
  'reaction_added',
  'tokens_revoked',
  'app_uninstalled',
]

const endpoint = `https://${ref}.supabase.co/functions/v1/slack-events`

// --- export what is there now ---------------------------------------------
const exported = await slack('apps.manifest.export', { app_id: APP_ID })
if (exported.ok !== true) {
  console.error(`export failed: ${JSON.stringify(exported)}`)
  process.exit(1)
}
const manifest = exported.manifest as Record<string, unknown>
const settings = (manifest.settings ?? {}) as Record<string, unknown>
const scopes =
  ((
    (manifest.oauth_config as Record<string, unknown> | undefined)?.scopes as
      | Record<string, unknown>
      | undefined
  )?.bot as string[] | undefined) ?? []

console.log(`app ${APP_ID}: ${String(scopes.length)} bot scopes`)

// Refuse to request an event the app lacks the scope for. Slack would reject
// the manifest, but the failure would name the manifest rather than the reason.
const REQUIRED_SCOPE: Readonly<Record<string, string | null>> = {
  'message.channels': 'channels:history',
  'message.groups': 'groups:history',
  'message.im': 'im:history',
  reaction_added: 'reactions:read',
  tokens_revoked: null,
  app_uninstalled: null,
}
const missing = EVENTS.filter((e) => {
  const need = REQUIRED_SCOPE[e]
  return need !== null && need !== undefined && !scopes.includes(need)
})
if (missing.length > 0) {
  console.error(
    `these events need scopes the app does not have, which would force a reinstall: ${missing.join(', ')}`,
  )
  process.exit(1)
}

// --- the manifest we want --------------------------------------------------
const updated = {
  ...manifest,
  settings: {
    ...settings,
    event_subscriptions: { request_url: endpoint, bot_events: EVENTS },
  },
}

// Validate first. A rejected manifest applied halfway is a partial-state
// problem worth never creating.
const valid = await slack('apps.manifest.validate', { app_id: APP_ID, manifest: updated })
if (valid.ok !== true) {
  console.error(`validation failed: ${JSON.stringify(valid)}`)
  process.exit(1)
}
console.log('manifest validates')

// --- apply -----------------------------------------------------------------
// Slack sends a url_verification challenge to the request_url at this point.
// The endpoint must already be deployed and must answer a *signed* handshake,
// which `npm run deploy:slack` verifies before this script is ever useful.
const applied = await slack('apps.manifest.update', { app_id: APP_ID, manifest: updated })
if (applied.ok !== true) {
  console.error(`update failed: ${JSON.stringify(applied)}`)
  process.exit(1)
}
console.log(`applied (permissions_updated=${String(applied.permissions_updated)})`)

// --- read back, and compare against intent --------------------------------
const after = await slack('apps.manifest.export', { app_id: APP_ID })
const afterSettings = ((after.manifest as Record<string, unknown> | undefined)?.settings ??
  {}) as Record<string, unknown>
const subs = afterSettings.event_subscriptions as
  | { request_url?: string; bot_events?: string[] }
  | undefined

const urlOk = subs?.request_url === endpoint
const eventsOk = EVENTS.every((e) => subs?.bot_events?.includes(e) === true)

console.log(`\nread-back:`)
console.log(`  request_url: ${urlOk ? '✅ matches' : `❌ ${String(subs?.request_url)}`}`)
console.log(
  `  bot_events : ${eventsOk ? '✅' : '❌'} ${String(subs?.bot_events?.length ?? 0)} subscribed`,
)
for (const e of subs?.bot_events ?? []) console.log(`    - ${e}`)

if (!urlOk || !eventsOk) {
  console.error('\nthe app is not configured as intended')
  process.exit(1)
}
console.log('\n✅ event subscriptions configured and verified by read-back')
