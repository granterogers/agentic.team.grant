/**
 * Set the sign-in PIN for one login (owner decision, 15 October 2026).
 *
 *   npm run pin:set -- grant.e.rogers@gmail.com
 *
 * It asks for the PIN twice, with nothing shown on the screen, and stores only a salted PBKDF2 hash in
 * public.sign_in_pins. The PIN is never printed, never written to a file and never sent anywhere but the hash.
 * The login must already exist: the command refuses an address with no login.
 */
import '../../src/safety/require-production-writes.ts'
import { hashPin, newSalt, PIN_PATTERN } from '../../src/auth/pin.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/

const readHidden = (prompt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Run this in a terminal, so the PIN is typed and not shown.'))
      return
    }
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let typed = ''
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.removeListener('data', onData)
          process.stdout.write('\n')
          resolve(typed)
          return
        }
        if (ch === '\u0003') {
          process.stdin.setRawMode(false)
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1)
        else typed += ch
      }
    }
    process.stdin.on('data', onData)
  })

const main = async (): Promise<void> => {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) {
    console.error('usage: npm run pin:set -- <the login email>')
    process.exit(2)
  }
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    process.env.SUPABASE_ACCESS_TOKEN ?? '',
  )
  const login = await db.execute(
    `select count(*)::int as n from auth.users where lower(email) = '${email}'`,
  )
  if ((login.rows[0] as { n: number } | undefined)?.n !== 1) {
    console.error(`No login exists for ${email}. Nothing was changed.`)
    process.exit(1)
  }

  const first = await readHidden('New PIN (4 to 8 digits): ')
  if (!PIN_PATTERN.test(first)) {
    console.error('A PIN is 4 to 8 digits. Nothing was changed.')
    process.exit(1)
  }
  const again = await readHidden('Type it again: ')
  if (again !== first) {
    console.error('The two PINs do not match. Nothing was changed.')
    process.exit(1)
  }

  const salt = newSalt()
  const hash = await hashPin(first, salt)
  await db.execute(`
    insert into public.sign_in_pins (email, salt, hash, fails, locked_until, updated_at)
    values ('${email}', '${salt}', '${hash}', 0, null, now())
    on conflict (email) do update
      set salt = excluded.salt, hash = excluded.hash, fails = 0, locked_until = null, updated_at = now()
  `)
  console.log(`PIN set for ${email}. It is stored as a hash only.`)
}

await main()
