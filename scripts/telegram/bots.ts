/**
 * Create Telegram bots without BotFather, and assign them to staff.
 *
 *   npm run telegram:bots -- --status
 *   npm run telegram:bots -- --create <username> [--name "Display name"] [--for <staff-slug>]
 *   npm run telegram:bots -- --create-missing        # every role whose bot was never made
 *   npm run telegram:bots -- --spares 3              # make N unassigned bots, ready for hiring
 *
 * ## Why this exists
 *
 * Two rows in `telegram_bots` carried the reason "BotFather is the only way to
 * make one". Grant asked whether that was really true, because he wants to add
 * and remove staff without a manual step. It was not true: `bots.createBot` has
 * been in the MTProto API since layer 224.
 *
 * ## Why spares
 *
 * Creating a bot is a Telegram write with a ceiling of twenty per account, and
 * a username is claimed permanently once used. Making a few spares up front
 * turns "hire someone" into assigning an existing bot — instant, reversible,
 * and it does not spend the ceiling one hire at a time on names that a rename
 * would then strand.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  connect,
  createBot,
  putSecret,
  readAccount,
  TelegramAccountMissing,
  UsernameTaken,
} from '../../src/telegram/mtproto.ts'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

interface Capacity {
  has_api_credentials: boolean
  has_user_session: boolean
  owned: number
  spare: number
  limit: number
  unfilled_roles: { staff_slug: string | null; username: string }[]
}
const capacity = async (): Promise<Capacity> => {
  const raw = (await db.execute(`select app.telegram_capacity() as j`)).rows[0]?.j
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Capacity
}

const cap = await capacity()

/**
 * Ask Telegram which of our bots actually exist, and fix the record.
 *
 * `disabled_reason` said two roles had no bot and that "BotFather is the only
 * way to make one". Both were stale: Grant made them in BotFather afterwards
 * and nothing cleared the note, so `--create-missing` would have tried to
 * create two bots that already answer and failed on a taken username.
 *
 * A stored flag about an external system is a guess about that system. This
 * asks it. Runs before every other action here for that reason — acting on the
 * flag without checking is how the stale note survived a week.
 */
const reconcile = async (): Promise<void> => {
  const rows = (
    await db.execute(
      `select bot_id, username, app.resolve_secret(token_ref) as token,
              disabled_reason
         from public.telegram_bots where enabled`,
    )
  ).rows
  for (const row of rows) {
    const token = String(row.token ?? '')
    if (token === '') continue
    let alive = false
    try {
      const body = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json()) as {
        ok?: boolean
      }
      alive = body.ok === true
    } catch {
      // Unreachable is not the same as absent, and a network blip must never
      // mark a working bot as missing. Left alone.
      continue
    }
    if (alive && row.disabled_reason !== null) {
      await db.execute(
        `update public.telegram_bots
            set disabled_reason = null, updated_at = app.now_utc()
          where bot_id = ${lit(String(row.bot_id))}`,
      )
      console.log(`@${String(row.username)}: exists after all — cleared the stale note`)
    }
    if (!alive && row.disabled_reason === null) {
      await db.execute(
        `update public.telegram_bots
            set disabled_reason = 'getMe says this bot does not exist',
                updated_at = app.now_utc()
          where bot_id = ${lit(String(row.bot_id))}`,
      )
      console.log(`@${String(row.username)}: does NOT exist — flagged`)
    }
  }
}

await reconcile()
const cap2 = await capacity()
cap.owned = cap2.owned
cap.spare = cap2.spare
cap.unfilled_roles = cap2.unfilled_roles

if (process.argv.includes('--status') || process.argv.length <= 2) {
  console.log(`api credentials : ${cap.has_api_credentials ? 'stored' : 'MISSING'}`)
  console.log(`signed in       : ${cap.has_user_session ? 'yes' : 'NO'}`)
  console.log(`bots owned      : ${cap.owned} of ${cap.limit}`)
  console.log(`spare (unassigned): ${cap.spare}`)
  if (cap.unfilled_roles.length > 0) {
    console.log('\nroles whose bot was never actually made:')
    for (const r of cap.unfilled_roles) {
      console.log(`  ${String(r.staff_slug ?? '(pager)')} — wants @${r.username}`)
    }
  }
  if (!cap.has_user_session) {
    console.log(
      '\nTo create bots from here, sign in once:' +
        '\n  1. https://my.telegram.org/apps → create an application' +
        '\n  2. npm run telegram:login -- --api-id <id> --api-hash <hash>' +
        '\n  3. npm run telegram:login -- --phone +<your number>' +
        '\n  4. npm run telegram:login -- --code <the code Telegram sends>',
    )
  }
  process.exit(0)
}

// Everything past here needs the account.
let account: Awaited<ReturnType<typeof readAccount>>
try {
  account = await readAccount(db)
} catch (error) {
  if (error instanceof TelegramAccountMissing) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}
if (account.session === '') {
  console.error('not signed in — run `npm run telegram:login -- --phone +<number>`')
  process.exit(1)
}

/**
 * The pager manages every bot this makes: it is the one never retired.
 *
 * Read as a USERNAME. A numeric id cannot be resolved by a session that has
 * never seen the peer — MTProto addresses peers by (id, access_hash) — and the
 * first real run failed on exactly that.
 */
const managerUsername = String(
  (await db.execute(`select username from public.telegram_bots where is_pager limit 1`)).rows[0]
    ?.username ?? '',
)
if (managerUsername === '') {
  console.error('no pager bot recorded — one bot must exist to manage the others')
  process.exit(1)
}

const client = await connect(account)

/** Create one bot, store its token in the vault, record the row. */
const make = async (username: string, name: string, staffSlug: string | null): Promise<void> => {
  const room = cap.limit - cap.owned
  if (room <= 0) {
    console.error(
      `at Telegram's ceiling: ${cap.owned} of ${cap.limit} bots. Retire one, or set ` +
        '`telegram.bot_limit` to 40 if this account has Premium.',
    )
    process.exit(1)
  }

  try {
    const bot = await createBot(client, { name, username, managerUsername })
    // Token to the vault BEFORE the row, so a crash between them leaves a
    // secret nobody reads rather than a row pointing at a secret that is not
    // there — the second would make the roster try to send through it.
    const ref = `telegram.bot.${bot.username}`
    await putSecret(db, ref, bot.token, `Bot API token for @${bot.username}.`)
    const idRow = (
      await db.execute(`select id::text as id from vault.secrets where name = ${lit(ref)}`)
    ).rows[0]
    await db.execute(
      `select app.telegram_bot_created(${lit(bot.botId)}, ${lit(bot.username)},
         ${lit(String(idRow?.id))}::uuid, ${staffSlug === null ? 'null' : lit(staffSlug)})`,
    )
    cap.owned += 1
    console.log(`created @${bot.username}${staffSlug === null ? ' (spare)' : ` for ${staffSlug}`}`)
  } catch (error) {
    if (error instanceof UsernameTaken) {
      console.error(`@${username} is taken — pick another`)
      return
    }
    throw error
  }
}

const one = arg('create')
if (one !== undefined) {
  await make(one, arg('name') ?? one, arg('for') ?? null)
}

if (process.argv.includes('--create-missing')) {
  const missing = (
    await db.execute(
      `select b.username, b.staff_slug, coalesce(s.name, b.staff_slug) as display
         from public.telegram_bots b
         left join public.staff s on s.slug = b.staff_slug
        where b.disabled_reason is not null
        order by b.staff_slug`,
    )
  ).rows
  if (missing.length === 0) console.log('every role already has a bot.')
  for (const row of missing) {
    await make(String(row.username), String(row.display ?? row.username), String(row.staff_slug))
  }
}

const spares = arg('spares')
if (spares !== undefined) {
  const want = Number(spares)
  if (!Number.isInteger(want) || want < 1 || want > 10) {
    console.error('--spares takes 1 to 10')
    process.exit(2)
  }
  for (let i = 0; i < want; i++) {
    // Numbered from the current total so re-running does not collide with a
    // name already claimed. A username is claimed for good once used, even if
    // the bot is later deleted, so guessing low costs a name each time.
    const n = cap.owned + 1
    await make(`atg_spare_${String(n)}_bot`, `Team HQ spare ${String(n)}`, null)
  }
}

await client.disconnect()
const after = await capacity()
console.log(`\n${after.owned} of ${after.limit} bots owned, ${after.spare} spare.`)
console.log('Run `npm run telegram:webhooks` so the new ones start listening.')
