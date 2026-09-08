/**
 * Sign this installation into Grant's Telegram account, once.
 *
 *   npm run telegram:login -- --api-id 1234567 --api-hash <hash>   # step 0, once
 *   npm run telegram:login -- --phone +30...                        # step 1: send a code
 *   npm run telegram:login -- --code 12345                          # step 2: finish
 *   npm run telegram:login -- --code 12345 --password <2fa>         # if 2FA is on
 *   npm run telegram:login -- --status                              # what is stored
 *
 * ## Why this is three commands and not one prompt
 *
 * Every MTProto example does this interactively: it asks for the phone, waits,
 * asks for the code. That needs one process alive from the request to the
 * reply, and the person running this is not sitting at the same terminal — the
 * code arrives on Grant's phone and comes back through a conversation, minutes
 * later, in a different process.
 *
 * So the intermediate state (`phone_code_hash` and the half-built session) goes
 * to the vault between the two steps. Telegram gives that hash a short life, so
 * step 2 has to follow step 1 within a few minutes; if it expires, run step 1
 * again.
 *
 * ## What is stored, and what is never printed
 *
 * `telegram.user_session` is a session string for Grant's WHOLE Telegram
 * account — not a bot token, not a scoped credential. Anything holding it can
 * read his messages and act as him. It is written straight to the vault (§15)
 * and this script never prints it, never logs it, and has no flag that would.
 * The only output is whether a step worked.
 */
import { Api } from 'teleproto'
import type { StringSession } from 'teleproto/sessions/index.js'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  connect,
  putSecret,
  readAccount,
  TelegramAccountMissing,
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
const has = async (name: string): Promise<boolean> =>
  (
    await db.execute(
      `select 1 as x from vault.decrypted_secrets where name = ${lit(name)} and decrypted_secret <> ''`,
    )
  ).rows.length > 0

// --- step 0: the application credentials -----------------------------------

const apiId = arg('api-id')
const apiHash = arg('api-hash')
if (apiId !== undefined || apiHash !== undefined) {
  if (apiId === undefined || apiHash === undefined) {
    console.error('give both --api-id and --api-hash, from https://my.telegram.org/apps')
    process.exit(2)
  }
  if (!/^\d+$/.test(apiId)) {
    console.error('--api-id must be the number my.telegram.org shows, not the app title')
    process.exit(2)
  }
  await putSecret(db, 'telegram.api_id', apiId, 'Telegram app api_id from my.telegram.org.')
  await putSecret(db, 'telegram.api_hash', apiHash, 'Telegram app api_hash from my.telegram.org.')
  console.log('stored. Now: npm run telegram:login -- --phone +<your number>')
  process.exit(0)
}

// --- status ----------------------------------------------------------------

if (process.argv.includes('--status')) {
  console.log(`api credentials: ${(await has('telegram.api_hash')) ? 'stored' : 'MISSING'}`)
  console.log(`code in flight:  ${(await has('telegram.login_state')) ? 'yes' : 'no'}`)
  console.log(`signed in:       ${(await has('telegram.user_session')) ? 'yes' : 'no'}`)
  console.log('\nNothing above is the credential itself. None of it is printable from here.')
  process.exit(0)
}

let account: Awaited<ReturnType<typeof readAccount>>
try {
  account = await readAccount(db)
} catch (error) {
  if (error instanceof TelegramAccountMissing) {
    console.error(error.message)
    console.error(
      '\n  1. Open https://my.telegram.org/apps and log in with your Telegram number.' +
        '\n  2. Create an application (any name; "Team HQ" is fine).' +
        '\n  3. Run: npm run telegram:login -- --api-id <App api_id> --api-hash <App api_hash>',
    )
    process.exit(1)
  }
  throw error
}

// --- step 1: ask Telegram to send a code ------------------------------------

const phone = arg('phone')
if (phone !== undefined) {
  const client = await connect({ ...account, session: '' })
  const sent = (await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: account.apiId,
      apiHash: account.apiHash,
      settings: new Api.CodeSettings({}),
    }),
  )) as {
    phoneCodeHash?: string
    type?: { className?: string; length?: number }
    nextType?: { className?: string }
    timeout?: number
  }

  // WHERE Telegram sent it, which is the whole diagnosis when it does not
  // arrive. Grant got nothing twice and the runs both reported success,
  // because success here means "Telegram accepted the request" and says
  // nothing about the channel it chose. `SentCodeTypeApp` means a message
  // inside Telegram itself and never an SMS; `SentCodeTypeSms` means a text;
  // `SentCodeTypeEmailCode` means his Telegram account email. Those are three
  // different places to look, and telling him the wrong one wastes his time.
  //
  // The className and the LENGTH are printed. The code is not, and there is no
  // flag that would print it.
  const where: Record<string, string> = {
    SentCodeTypeApp:
      'as a message INSIDE Telegram — open the app and look for the chat named "Telegram"',
    SentCodeTypeSms: 'by SMS text message to your phone',
    SentCodeTypeCall: 'by an automated phone call that reads the digits out',
    SentCodeTypeFlashCall: 'as a flash call — the code is the last digits of the calling number',
    SentCodeTypeMissedCall: 'as a missed call — the code is the last digits of the calling number',
    SentCodeTypeFragmentSms: 'via Fragment (fragment.com) rather than normal SMS',
    SentCodeTypeEmailCode: 'to the email address on your Telegram account',
    SentCodeTypeSetUpEmailRequired:
      'nowhere yet — Telegram wants an email set up on the account first',
  }
  const kind = String(sent.type?.className ?? 'unknown')
  console.log(`Telegram sent the code ${where[kind] ?? `by an unrecognised method (${kind})`}.`)
  console.log(`  code length: ${String(sent.type?.length ?? '?')} digits`)
  if (sent.nextType?.className !== undefined) {
    console.log(
      `  if it does not arrive, Telegram will fall back to: ${String(sent.nextType.className)}`,
    )
  }
  if (sent.timeout !== undefined) console.log(`  valid for about ${String(sent.timeout)}s`)

  const hash = String(sent.phoneCodeHash ?? '')
  if (hash === '') {
    console.error('Telegram sent no phone_code_hash — cannot continue')
    process.exit(1)
  }

  // The half-built session matters as much as the hash: `auth.signIn` must run
  // on the same session that asked for the code, and this is a different
  // process. Both go to the vault together, as one JSON value, so they cannot
  // get out of step.
  await putSecret(
    db,
    'telegram.login_state',
    JSON.stringify({
      phone,
      hash,
      session: (client.session as StringSession).save(),
      at: new Date().toISOString(),
    }),
    'In-flight Telegram login. Short-lived; deleted the moment sign-in succeeds.',
  )
  await client.disconnect()

  console.log(
    'Finish within a few minutes:\n' +
      '  npm run telegram:login -- --code 12345\n' +
      'and add --password <your 2FA password> if you have two-step verification on.',
  )
  process.exit(0)
}

// --- step 2: sign in --------------------------------------------------------

const code = arg('code')
if (code === undefined) {
  console.error(
    'nothing to do. One of:\n' +
      '  --api-id <n> --api-hash <h>   store the app credentials (once)\n' +
      '  --phone +<number>             ask Telegram for a code\n' +
      '  --code <digits> [--password]  finish signing in\n' +
      '  --status                      what is stored',
  )
  process.exit(2)
}

const stateRow = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'telegram.login_state'`,
  )
).rows[0]
if (stateRow?.v === undefined) {
  console.error('no login in flight — run `npm run telegram:login -- --phone +<number>` first')
  process.exit(1)
}
const state = JSON.parse(String(stateRow.v)) as { phone: string; hash: string; session: string }

const client = await connect({ ...account, session: state.session })
try {
  await client.invoke(
    new Api.auth.SignIn({
      phoneNumber: state.phone,
      phoneCodeHash: state.hash,
      phoneCode: code,
    }),
  )
} catch (error) {
  const message = (error as Error).message
  if (/SESSION_PASSWORD_NEEDED/i.test(message)) {
    const password = arg('password')
    if (password === undefined) {
      console.error(
        'Two-step verification is on. Re-run with:\n' +
          '  npm run telegram:login -- --code <the same code> --password <your 2FA password>',
      )
      await client.disconnect()
      process.exit(1)
    }
    // `signInWithPassword` does the SRP exchange; the password never goes over
    // the wire and never reaches this script's output.
    await client.signInWithPassword(
      { apiId: account.apiId, apiHash: account.apiHash },
      {
        password: () => Promise.resolve(password),
        onError: (e) => {
          console.error(`two-step verification refused: ${e.message}`)
          return Promise.resolve(true)
        },
      },
    )
  } else if (/PHONE_CODE_EXPIRED/i.test(message)) {
    console.error('that code expired — run the --phone step again')
    await client.disconnect()
    process.exit(1)
  } else if (/PHONE_CODE_INVALID/i.test(message)) {
    console.error('that code is not right')
    await client.disconnect()
    process.exit(1)
  } else {
    throw error
  }
}

const session = (client.session as StringSession).save()
const me = (await client.getMe()) as { username?: string; firstName?: string }
await client.disconnect()

await putSecret(
  db,
  'telegram.user_session',
  session,
  'Telegram USER session. This is the whole account, not one bot — never print it.',
)
// The in-flight state is spent. Leaving it would leave a usable half-credential
// lying about for no reason.
await db.execute(`delete from vault.secrets where name = 'telegram.login_state'`)

console.log(`signed in as ${String(me.firstName ?? '')}${me.username ? ` (@${me.username})` : ''}.`)
console.log('The session is in the vault as `telegram.user_session` and was not printed.')
console.log('\nNow: npm run telegram:bots -- --status')
