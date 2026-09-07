/**
 * Deploy the MCP endpoint, and mint a client token.
 *
 *   npm run deploy:mcp                  # deploy, no new client
 *   npm run deploy:mcp -- --client=claude "Claude"
 *
 * ADR-0014: one token per client, so ChatGPT's access can be withdrawn without
 * touching Claude's. A token is generated here, hashed into `mcp_clients`, and
 * **delivered over Telegram** — never printed. This project has already had to
 * rotate one credential because a deploy script printed it into a transcript,
 * and a transcript is durable, copied and searchable.
 *
 * The endpoint is verified by its answers rather than its status code, for the
 * reason the HQ deploy carries: a Vercel deploy here once returned 200 with
 * 339,010 bytes of auth wall.
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DeliveryService } from '../../src/channels/delivery.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { escapeHtml } from '../../src/telegram/message.ts'
import { pagerBot } from '../../src/telegram/roster.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, supabaseToken)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

// --- deploy -----------------------------------------------------------------

const entrypoint = await readFile('supabase/functions/mcp/index.ts', 'utf8')
const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: 'mcp', entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append('file', new File([entrypoint], 'index.ts', { type: 'application/typescript' }))

const deployed = await fetch(`${api}/functions/deploy?slug=mcp`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/mcp`
console.log(`mcp v${String(result.version)} ${String(result.status)} — ${endpoint}`)

// --- a client, if asked for --------------------------------------------------

const clientArg = process.argv.find((a) => a.startsWith('--client='))
let token: string | null = null
let clientId = ''

if (clientArg !== undefined) {
  clientId = clientArg.slice('--client='.length)
  const displayName =
    process.argv
      .filter((a) => !a.startsWith('--'))
      .slice(2)
      .join(' ') || clientId
  // Read AND write by default. Read-only was the original choice, by analogy
  // with Team HQ, where it is right because a dashboard is for looking at. An
  // MCP client is a working surface: a conversation that cannot leave anything
  // behind is one you transcribe by hand afterwards, which is the job this
  // system exists to remove. `--read-only` is there for a client that should
  // not write.
  const scopes = process.argv.includes('--read-only') ? "array['read']" : "array['read','write']"
  // 32 bytes of urandom, base64url. `mcp_` so a leaked one is recognisable in a
  // log and the secret scanner can be taught its shape.
  token = `mcp_${randomBytes(32).toString('base64url')}`
  const hash = createHash('sha256').update(token, 'utf8').digest('hex')

  await db.execute(`
    insert into public.mcp_clients (client_id, display_name, token_sha256, scopes)
    values (${lit(clientId)}, ${lit(displayName)}, ${lit(hash)}, ${scopes})
    on conflict (client_id) do update
      set token_sha256 = excluded.token_sha256,
          display_name = excluded.display_name,
          scopes = excluded.scopes,
          enabled = true,
          disabled_reason = null
  `)
  console.log(
    `client "${clientId}" registered ${scopes.includes('write') ? 'read+write' : 'read-only'} ` +
      '(rotates the token if it existed)',
  )
}

// --- verify, by its answers ---------------------------------------------------

const unauth = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
})
console.log(`  unauthenticated: http ${String(unauth.status)} (must be 401)`)

let toolCount = 0
if (token !== null) {
  const listed = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  })
  const listing = (await listed.json()) as { result?: { tools?: unknown[] } }
  toolCount = listing.result?.tools?.length ?? 0
  console.log(`  authenticated:   http ${String(listed.status)}, ${String(toolCount)} tool(s)`)
}

if (unauth.status !== 401 || (token !== null && toolCount < 5)) {
  console.error('the endpoint did not behave as required')
  process.exit(1)
}

// --- deliver the token, never print it ----------------------------------------

if (token !== null) {
  const pager = await pagerBot(db)
  const chat =
    pager === null
      ? null
      : (await db.execute(`select app.telegram_chat_for('grant', ${lit(pager.botId)}) as c`))
          .rows[0]?.c
  if (pager === null || chat === null || chat === undefined) {
    console.error(
      '\nThe client is registered but the token could not be delivered: no Telegram chat.\n' +
        'It is not printed here on purpose. Re-run once the pager is reachable.',
    )
    process.exit(1)
  }

  const service = new DeliveryService(db, new TelegramTransport(new TelegramClient(pager.token)))
  const sent = await service.deliver({
    dedupeKey: `mcp-token:${clientId}:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`,
    accountRef: pager.botId,
    targetRef: String(chat),
    purpose: 'notice',
    body: {
      text:
        `<b>MCP · ${escapeHtml(clientId)}</b>\n\nAdd this as a remote MCP server:\n\n` +
        `URL\n<code>${escapeHtml(endpoint)}</code>\n\n` +
        `Authorization header\n<code>Bearer ${escapeHtml(token)}</code>\n\n` +
        `<i>${String(toolCount)} tools: read the projects, the corpus, the staff and ` +
        `recent work; add documents; ask the notebook to generate things. Delete this ` +
        `message once it is set up. Revoke with ` +
        `npm run mcp:revoke -- --client=${escapeHtml(clientId)}.</i>`,
      silent: false,
    },
  })
  console.log(`  token delivered on Telegram: ${sent.outcome}`)
  console.log('  (deliberately not printed here — a transcript is durable and searchable)')
}
