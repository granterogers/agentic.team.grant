/**
 * Add a bot scope to the Slack app, by manifest rather than by browser.
 *
 *   npm run slack:add-scope -- channels:join
 *
 * Issue #270. §31 of the frontend standard: *treat an avoidable request for
 * manual configuration as a design failure*, and prefer API → CLI → automated
 * configuration → manual UI. #270's instructions asked Grant for six steps in
 * the Slack admin UI; five of them are this script.
 *
 * ## What this can and cannot do
 *
 * It can put the scope in the manifest. It CANNOT grant it: a scope added to
 * an installed app takes effect only when the app is reinstalled to the
 * workspace, and that is an OAuth consent screen. So the honest outcome is
 * "the scope is requested, and one reinstall away", and this script says
 * exactly that rather than reporting success for half a job.
 *
 * ## Read back, always
 *
 * `apps.manifest.update` answering `ok: true` means the call was accepted.
 * Only an export shows what the app is configured to ask for — the same rule
 * `slack:configure-events` follows, and the reason it exists.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const wanted = process.argv.slice(2).filter((a) => a.includes(':'))
if (wanted.length === 0) {
  console.error('name at least one scope, e.g. npm run slack:add-scope -- channels:join')
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

const exported = await slack('apps.manifest.export', { app_id: APP_ID })
if (exported.ok !== true) {
  console.error(`export failed: ${JSON.stringify(exported)}`)
  process.exit(1)
}
const manifest = exported.manifest as Record<string, unknown>
const oauth = (manifest.oauth_config ?? {}) as Record<string, unknown>
const scopeBlock = (oauth.scopes ?? {}) as Record<string, unknown>
const bot = (scopeBlock.bot as string[] | undefined) ?? []

const already = wanted.filter((s) => bot.includes(s))
const adding = wanted.filter((s) => !bot.includes(s))
console.log(`app ${APP_ID}: ${String(bot.length)} bot scope(s) today`)
for (const s of already) console.log(`  already asked for: ${s}`)
if (adding.length === 0) {
  console.log('nothing to add. If the capability still does not work, the app needs a reinstall.')
  process.exit(0)
}

const updated = {
  ...manifest,
  oauth_config: { ...oauth, scopes: { ...scopeBlock, bot: [...bot, ...adding].sort() } },
}

const valid = await slack('apps.manifest.validate', { app_id: APP_ID, manifest: updated })
if (valid.ok !== true) {
  console.error(`validation failed: ${JSON.stringify(valid)}`)
  process.exit(1)
}
console.log('manifest validates')

const applied = await slack('apps.manifest.update', { app_id: APP_ID, manifest: updated })
if (applied.ok !== true) {
  console.error(`update failed: ${JSON.stringify(applied)}`)
  process.exit(1)
}

/*
  Read back. An accepted call is not a configured app, and this repository has
  a rule about believing a write it has not read.
*/
const after = await slack('apps.manifest.export', { app_id: APP_ID })
const nowHas =
  (((after.manifest as Record<string, unknown>).oauth_config as Record<string, unknown>)
    .scopes as Record<string, unknown>) ?? {}
const nowBot = (nowHas.bot as string[] | undefined) ?? []
const stuck = adding.filter((s) => !nowBot.includes(s))
if (stuck.length > 0) {
  console.error(`applied, but the export does not show: ${stuck.join(', ')}`)
  process.exit(1)
}

console.log(`\nadded to the manifest: ${adding.join(', ')}`)
console.log(`${String(nowBot.length)} bot scope(s) now requested`)
console.log(
  '\nNOT YET GRANTED. A scope added to an installed app takes effect only on reinstall,\n' +
    'which is an OAuth consent screen and cannot be done from here:\n' +
    `  1. https://api.slack.com/apps/${APP_ID}/oauth\n` +
    '  2. Reinstall to Workspace, then Allow.\n' +
    'A scope-only reinstall does not change the bot token, so nothing needs re-storing.\n' +
    'If Slack does issue a new xoxb- token, put it in the Settings page Slack field —\n' +
    'never into chat.',
)
