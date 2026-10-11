/**
 * Mint or retire the credentials of a Hermes bridge host (Hermes, M2). An OPERATOR command: it writes to production.
 *
 *   npm run engine:bridge-credential -- --office=<office id|operator> "Grant's laptop"
 *   npm run engine:bridge-credential -- --retire=<bridge id> --office=<office id|operator> "why"
 *
 * Minting makes two credentials, stores only their hashes (engine_bridges and an mcp_clients row of kind engine, read scope only),
 * and hands the clear values to the person over the pager, as TWO separate messages (the vault export's rule), never printing them
 * here. This project has already rotated a credential because a script printed it into a transcript, and a transcript is durable.
 * If the pager cannot be reached the credentials are NOT delivered anywhere and the bridge is retired again at once: a bridge nobody
 * holds the token of is a dead row, and leaving it enabled would block the next mint (one enabled bridge per office).
 *
 * Nothing here switches Hermes on. The setting engine.hermes.offices is a separate, deliberate act, so minting a bridge changes no
 * behaviour of the office.
 */
import '../../src/safety/require-production-writes.ts'
import { createHash } from 'node:crypto'
import { DeliveryService } from '../../src/channels/delivery.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  generateCredentials,
  isUuid,
  mintStatement,
  retireStatement,
} from '../../src/engines/hermes/credentials.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { escapeHtml } from '../../src/telegram/message.ts'
import { pagerBot } from '../../src/telegram/roster.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const words = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'))
  .join(' ')
  .trim()
const officeArg = flag('office')
if (officeArg === undefined || words === '') {
  console.error(
    'usage: --office=<office id|operator> "<name for the host, or the reason when retiring>" [--retire=<bridge id>]',
  )
  process.exit(2)
}
const officeId =
  officeArg === 'operator'
    ? String((await db.execute('select app.operator_office()::text as o')).rows[0]?.o ?? '')
    : officeArg
if (!isUuid(officeId)) {
  console.error('the office is not an office id')
  process.exit(2)
}

const retire = flag('retire')
if (retire !== undefined) {
  if (!isUuid(retire)) {
    console.error('--retire needs a bridge id')
    process.exit(2)
  }
  const out = (await db.execute(retireStatement(officeId, retire, words))).rows[0]?.r
  console.log(`retire: ${JSON.stringify(out)}`)
  process.exit(0)
}

const creds = generateCredentials()
const minted = (await db.execute(mintStatement(officeId, words, creds))).rows[0]?.r as
  | { bridge_id?: string; mcp_client_id?: string }
  | string
  | undefined
const parsed = (typeof minted === 'string' ? JSON.parse(minted) : minted) as
  | { bridge_id?: string; mcp_client_id?: string }
  | undefined
if (parsed?.bridge_id === undefined) {
  console.error('the bridge was not created')
  process.exit(1)
}
console.log(
  `bridge ${parsed.bridge_id} (MCP client ${String(parsed.mcp_client_id)}) created for office ${officeId}`,
)

const pager = await pagerBot(db)
const chat =
  pager === null
    ? null
    : (await db.execute(`select app.operator_chat(${lit(pager.botId)}) as c`)).rows[0]?.c
if (pager === null || chat === null || chat === undefined) {
  await db.execute(
    retireStatement(
      officeId,
      parsed.bridge_id,
      'the credentials could not be delivered, so this bridge was retired',
    ),
  )
  console.error(
    '\nThe credentials could not be delivered (no pager chat), so the bridge was retired again. Nothing was printed. Re-run once the pager is reachable.',
  )
  process.exit(1)
}

const service = new DeliveryService(db, new TelegramTransport(new TelegramClient(pager.token)))
const tag = createHash('sha256').update(parsed.bridge_id).digest('hex').slice(0, 12)
const send = async (key: string, text: string): Promise<string> =>
  (
    await service.deliver({
      dedupeKey: `engine-credential:${tag}:${key}`,
      accountRef: pager.botId,
      targetRef: String(chat),
      purpose: 'notice',
      body: { text, silent: false },
    })
  ).outcome
const first = await send(
  'bridge',
  `<b>Hermes host · bridge token</b> (1 of 2)\n\nPut this in the host's .env as ENGINE_BRIDGE_TOKEN:\n\n<code>${escapeHtml(creds.bridgeToken)}</code>\n\n<i>Delete this message once it is set up.</i>`,
)
const second = await send(
  'mcp',
  `<b>Hermes host · office tool token</b> (2 of 2)\n\nPut this in the host's .env as OFFICE_ENGINE_MCP_TOKEN:\n\n<code>${escapeHtml(creds.mcpToken)}</code>\n\n<i>It can only read, and only while Hermes is working on a message you chose to send it. Delete this message once it is set up.</i>`,
)
console.log(
  `credentials delivered on Telegram: ${first}, ${second} (deliberately not printed here)`,
)
if (first !== 'sent' || second !== 'sent') {
  await db.execute(
    retireStatement(
      officeId,
      parsed.bridge_id,
      'a credential was not delivered, so this bridge was retired',
    ),
  )
  console.error('A message was not delivered, so the bridge was retired again. Re-run.')
  process.exit(1)
}
console.log('Hermes is still OFF for this office until engine.hermes.offices names it.')
