/**
 * Configure the Telegram bot, and mint its webhook secret.
 *
 *   npm run telegram:configure
 *
 * §14: *"Never ask Grant to edit source code or type commands Claude can
 * execute."* §12 notes that only `/newbot` is genuinely manual — name,
 * description, commands and profile photo are all API-settable. So they are set
 * here rather than appearing in HUMAN_ONLY_PREREQUISITES.md.
 *
 * Also mints the webhook secret token and stores it in the vault. Telegram's
 * webhook carries **no signature**: `secret_token`, echoed back in the
 * `X-Telegram-Bot-Api-Secret-Token` header, is the only authentication there is.
 * Minting it now means deploying later is one call with nothing to decide.
 *
 * `setWebhook` itself is deliberately NOT called — it needs a deployed HTTPS
 * URL that does not exist yet, and registering a webhook pointing nowhere would
 * make Telegram queue updates against a dead endpoint.
 */
import { randomBytes } from 'node:crypto'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const botToken = process.env.TELEGRAM_CHIEF_BOT_TOKEN
const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (botToken === undefined || botToken === '' || supabase === undefined || supabase === '') {
  console.error('TELEGRAM_CHIEF_BOT_TOKEN and SUPABASE_ACCESS_TOKEN are required')
  process.exit(2)
}

const api = async (method: string, body: unknown): Promise<Record<string, unknown>> => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await response.json()) as Record<string, unknown>
}

const report = (label: string, result: Record<string, unknown>): boolean => {
  const ok = result.ok === true
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — ${String(result.description)}`}`)
  return ok
}

console.log('configuring @agenticteamgrantbot:')

// Shown on the bot's profile. Kept factual: §12 makes Telegram the *pager*, not
// the office, and the description should not promise a conversation surface
// Slack owns.
report(
  'description',
  await api('setMyDescription', {
    description:
      'Private pager for AI Team HQ. Sends briefings, alerts and things needing ' +
      'your decision. Full conversations live in Slack and Team HQ.',
  }),
)

report(
  'short description',
  await api('setMyShortDescription', {
    short_description: 'AI Team HQ — briefings, alerts and approvals.',
  }),
)

// §12's controls, as slash commands. Natural-language equivalents still work —
// these exist so the surface is discoverable, not to replace conversation.
report(
  'commands',
  await api('setMyCommands', {
    commands: [
      { command: 'status', description: 'What the team is working on right now' },
      { command: 'needsme', description: 'Anything waiting on your decision' },
      { command: 'today', description: "Today's briefing" },
      { command: 'mute', description: 'Mute non-urgent notifications for 24 hours' },
      { command: 'unmute', description: 'Resume notifications' },
      { command: 'usage', description: 'What is being spent, and against which limits' },
    ],
  }),
)

// --- webhook secret --------------------------------------------------------
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const existing = await db.execute(
  `select count(*)::int as n from vault.secrets where name = 'telegram.webhook_secret'`,
)
if (existing.rows[0]?.n === 0) {
  // Telegram permits 1–256 chars of A-Z a-z 0-9 _ and -. Hex keeps it inside
  // that set with no encoding to get wrong.
  const secret = randomBytes(32).toString('hex')
  await db.execute(`
    select app.store_secret('telegram.webhook_secret', '${secret}',
      'X-Telegram-Bot-Api-Secret-Token — the ONLY authentication a Telegram webhook has')
  `)
  console.log('  ✅ webhook secret minted and vaulted (64 hex chars)')
} else {
  console.log('  ✅ webhook secret already in the vault (left alone)')
}

const info = (await api('getWebhookInfo', {})).result as { url?: string } | undefined
console.log(`\nwebhook url: ${info?.url === '' || info?.url === undefined ? '(none)' : info.url}`)
console.log(
  'setWebhook is deliberately not called: it needs a deployed HTTPS URL, and\n' +
    'registering one that points nowhere makes Telegram queue updates against a\n' +
    'dead endpoint. The secret is ready, so deployment is a single call.',
)
