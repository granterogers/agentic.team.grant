/**
 * Creating Telegram bots without BotFather.
 *
 * Grant asked whether BotFather is really the only way, because he wants to add
 * and remove staff without a manual step. It is not: since layer 224 the
 * MTProto API exposes `bots.createBot`, and this is the wrapper around it.
 *
 *   https://core.telegram.org/api/bots/managed-bots
 *
 * ## Why this is the only file that touches MTProto
 *
 * Everything else in this project speaks to Telegram over the Bot API — a
 * bearer token and an HTTPS call. MTProto is a different protocol with a
 * different credential: a USER session, which is Grant's whole account rather
 * than one bot. Keeping it to one file means there is exactly one place where
 * that credential is read, and reviewing "what can act as Grant" is reading
 * this file.
 *
 * ## Where this can actually run
 *
 * Not in the environment Claude works in. That tunnels HTTPS through a proxy
 * and nothing else: a socket to a Telegram data centre opens, the first
 * MTProto bytes go out, and nothing ever comes back — measured with a raw
 * socket rather than inferred from a library timeout. MTProto is not HTTP, and
 * a WebSocket transport does not help because the proxy only relays CONNECT
 * tunnels for TLS it recognises.
 *
 * So anything in this file runs on a GitHub runner (`.github/workflows/
 * telegram-login.yml`) or on a machine with ordinary egress. That is a
 * property of where it runs, not of the code, which is why the code says
 * nothing about it and this comment does.
 *
 * ## Why the session is a string in the vault
 *
 * The alternative is a session file on disk, which is what every MTProto
 * example does and which would put the credential outside the vault and into
 * whatever filesystem happened to be running the code — including a CI runner.
 * §15 says the vault; `StringSession` is how that becomes possible.
 */
import { Api, TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface TelegramAccount {
  readonly apiId: number
  readonly apiHash: string
  /** Empty on a first login; a real session afterwards. */
  readonly session: string
}

export class TelegramAccountMissing extends Error {
  constructor(readonly what: string) {
    super(
      `${what} is not in the vault. Get an api_id and api_hash from ` +
        'https://my.telegram.org/apps, then run `npm run telegram:login`.',
    )
    this.name = 'TelegramAccountMissing'
  }
}

/** Read one vault secret, or null. Never logged, never returned to a page. */
const secret = async (db: SqlExecutor, name: string): Promise<string | null> => {
  const { rows } = await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = ${lit(name)}`,
  )
  const v = rows[0]?.v
  return v === undefined || String(v) === '' ? null : String(v)
}

/** Write or replace one vault secret. */
export const putSecret = async (
  db: SqlExecutor,
  name: string,
  value: string,
  description: string,
): Promise<void> => {
  const existing = await db.execute(
    `select id::text as id from vault.secrets where name = ${lit(name)}`,
  )
  const id = existing.rows[0]?.id
  if (id === undefined) {
    await db.execute(`select vault.create_secret(${lit(value)}, ${lit(name)}, ${lit(description)})`)
  } else {
    await db.execute(
      `select vault.update_secret(${lit(String(id))}::uuid, ${lit(value)}, ${lit(name)}, ${lit(description)})`,
    )
  }
}

export const readAccount = async (db: SqlExecutor): Promise<TelegramAccount> => {
  const apiIdRaw = await secret(db, 'telegram.api_id')
  const apiHash = await secret(db, 'telegram.api_hash')
  if (apiIdRaw === null) throw new TelegramAccountMissing('telegram.api_id')
  if (apiHash === null) throw new TelegramAccountMissing('telegram.api_hash')
  const apiId = Number(apiIdRaw)
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new TelegramAccountMissing('telegram.api_id (not a number)')
  }
  return { apiId, apiHash, session: (await secret(db, 'telegram.user_session')) ?? '' }
}

/**
 * A connected client for the stored account.
 *
 * `connect()` rather than `start()`: `start` wants interactive callbacks for
 * phone and code, and every caller here either already has a session or is the
 * login flow doing those steps explicitly.
 */
export const connect = async (account: TelegramAccount): Promise<TelegramClient> => {
  const client = new TelegramClient(
    new StringSession(account.session),
    account.apiId,
    account.apiHash,
    // Modest: this connects to send one or two commands, not to hold a
    // long-lived event loop, and a client that retries five times on a
    // scripted run turns a clear failure into a slow one.
    { connectionRetries: 2 },
  )
  await client.connect()
  return client
}

export interface CreatedBot {
  readonly botId: string
  readonly username: string
  readonly token: string
}

export class UsernameTaken extends Error {
  constructor(readonly username: string) {
    super(`@${username} is not available`)
    this.name = 'UsernameTaken'
  }
}

/**
 * Is this username free for a managed bot?
 *
 * Checked before creating, because `bots.createBot` with a taken username is a
 * failed creation and Telegram counts attempts against rate limits. Telegram
 * requires the name to end in `bot`.
 */
export const usernameFree = async (client: TelegramClient, username: string): Promise<boolean> => {
  const ok = await client.invoke(new Api.bots.CheckUsername({ username }))
  return ok === true
}

/**
 * Create a bot and return its Bot API token.
 *
 * `managerUsername` is the bot that will be allowed to manage this one.
 * Telegram requires one; the pager is the natural choice because it is the one
 * bot guaranteed to exist and not to be retired with a staff member.
 */
export const createBot = async (
  client: TelegramClient,
  options: { name: string; username: string; managerUsername: string },
): Promise<CreatedBot> => {
  if (!/bot$/i.test(options.username)) {
    throw new Error(`Telegram requires a bot username to end in "bot": ${options.username}`)
  }
  if (!(await usernameFree(client, options.username))) throw new UsernameTaken(options.username)

  // The manager is named by USERNAME, not by numeric id.
  //
  // A bare id looks like it should work — the field takes an EntityLike — and
  // it failed on the first real run with "Could not find the input entity for
  // {userId: 8967954396}". MTProto does not address a peer by id alone: it
  // needs an (id, access_hash) pair, and a session created minutes ago has
  // never seen that bot, so it holds no hash for it. A username can be
  // resolved from nothing, via contacts.resolveUsername, which is precisely
  // what usernames are for in this protocol.
  const manager = await client.getInputEntity(options.managerUsername)
  const created = (await client.invoke(
    new Api.bots.CreateBot({
      name: options.name,
      username: options.username,
      managerId: manager,
    }),
  )) as { id?: unknown }

  // The method returns the created bot as a User. Its id is what everything
  // else keys on, so a response without one is a failure however it looks.
  const botId = String((created as { id?: { toString: () => string } }).id ?? '')
  if (botId === '' || botId === 'undefined') {
    throw new Error('bots.createBot returned no bot id')
  }

  // Same reasoning as the manager, and the bot we just made is if anything
  // more certain to have no cached hash — it did not exist a second ago. Its
  // username is the one thing we do know.
  const exported = (await client.invoke(
    new Api.bots.ExportBotToken({ bot: await client.getInputEntity(options.username) }),
  )) as { token?: string }
  const token = String(exported.token ?? '')
  if (token === '') throw new Error('bots.exportBotToken returned no token')

  return { botId, username: options.username, token }
}
