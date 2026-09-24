/**
 * EVERYTHING THE SETUP CAN DO WITHOUT YOU.
 *
 *   npm run fresh:configure
 *
 * Run it whenever. It does what it can, says what it did, and says what it
 * could not do and why. Running it twice changes nothing the second time —
 * which is journey H of the acceptance, and the reason it is safe to tell
 * somebody to "just run it again" after any interruption.
 *
 * ## What it deliberately does not do
 *
 * It does not create accounts, fetch tokens or click consent screens. §8's
 * filter puts exactly three things on a person's list for a core install — a
 * Supabase project, an access token and an OpenRouter key — and each is there
 * because of identity, a one-time secret, or both. Everything else in the
 * contract is here.
 */
import { randomBytes } from 'node:crypto'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PostgresExecutor } from '../../src/db/postgres-executor.ts'
import { isHarnessDb, localConnection } from '../../src/fresh/local-db.ts'

interface Step {
  readonly what: string
  readonly outcome: 'did it' | 'already done' | 'cannot yet'
  readonly detail: string
}

function connect(): { db: SqlExecutor; where: string; ref: string | null } {
  const ref = process.env.SUPABASE_PROJECT_REF
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (ref !== undefined && ref !== '' && token !== undefined && token !== '') {
    return { db: new ManagementApiExecutor(ref, token), where: `Supabase project ${ref}`, ref }
  }
  const local = process.env.FRESH_DB
  if (isHarnessDb(local)) {
    return {
      db: new PostgresExecutor(localConnection(local)),
      where: `local database ${local}`,
      ref: null,
    }
  }
  throw new Error(
    'No office to configure. Run npm run fresh:doctor — it will tell you what is missing.',
  )
}

const quote = (v: string): string => `'${v.replace(/'/g, "''")}'`

async function value(db: SqlExecutor, sql: string): Promise<unknown> {
  const { rows } = await db.execute(sql)
  const row = rows[0] as Record<string, unknown> | undefined
  return row === undefined ? undefined : Object.values(row)[0]
}

async function main(): Promise<void> {
  const { db, where, ref } = connect()
  console.log(`configuring ${where}\n`)
  const steps: Step[] = []

  // 1. The office's own address.
  const currentRef = String(
    (await value(
      db,
      `select coalesce(nullif(btrim(value #>> '{}'), ''), '') as v
         from public.system_config where key = 'db.project_ref'`,
    )) ?? '',
  )
  if (ref === null) {
    steps.push({
      what: 'the office’s own address',
      outcome: 'cannot yet',
      detail:
        'this is a local database, which has no Supabase address. On a real ' +
        'project this is set from SUPABASE_PROJECT_REF.',
    })
  } else if (currentRef === ref) {
    steps.push({ what: 'the office’s own address', outcome: 'already done', detail: ref })
  } else {
    await db.execute(
      `update public.system_config set value = to_jsonb(${quote(ref)}::text)
        where key = 'db.project_ref'`,
    )
    steps.push({ what: 'the office’s own address', outcome: 'did it', detail: ref })
  }

  // 2. The office's API token.
  const hasToken = Number(
    await value(
      db,
      `select (select count(*)::int from vault.secrets where name = 'hq.api_token') as n`,
    ),
  )
  if (hasToken > 0) {
    steps.push({
      what: 'the office’s API token',
      outcome: 'already done',
      detail: 'in the vault — deliberately not shown',
    })
  } else {
    /*
      Generated, never chosen.

      256 bits from a CSPRNG. A token a person picks is a token a person can
      remember, and the master spec's §15 calls the service-role key the
      highest-blast-radius credential in the system — this one guards the same
      surface. It goes straight into the vault and is not printed: `npm run
      hq:token` is the one path that ever reveals it, and it sends it to you
      rather than putting it on a screen somebody could be looking over.
    */
    await db.execute(
      `select app.store_secret('hq.api_token', ${quote(randomBytes(32).toString('base64url'))},
              'The single bearer token guarding everything this office exposes over HTTP.') as r`,
    )
    steps.push({
      what: 'the office’s API token',
      outcome: 'did it',
      detail: 'generated and stored in the vault — not shown here, by design',
    })
  }

  // 3. Connect a stored inference key to the provider that uses it.
  const wired = await value(
    db,
    `select (select secret_ref is not null from public.providers where provider = 'openrouter') as w`,
  )
  const storedKey = Number(
    await value(
      db,
      `select (select count(*)::int from vault.secrets where name = 'openrouter.api_key') as n`,
    ),
  )
  if (wired === true) {
    steps.push({
      what: 'the office’s ability to think',
      outcome: 'already done',
      detail: 'OpenRouter is pointed at a key in the vault',
    })
  } else if (storedKey === 0) {
    steps.push({
      what: 'the office’s ability to think',
      outcome: 'cannot yet',
      detail:
        'no OpenRouter key stored yet. This is one of the three things only you can do: ' +
        'get a key at https://openrouter.ai/keys, then run ' +
        'npm run fresh:secret -- openrouter.api_key',
    })
  } else {
    await db.execute(`select app.connect_provider_key('openrouter', 'openrouter.api_key') as r`)
    steps.push({
      what: 'the office’s ability to think',
      outcome: 'did it',
      detail: 'OpenRouter now reads the key you stored',
    })
  }

  for (const s of steps) {
    console.log(`  ${s.outcome.padEnd(12)} ${s.what}`)
    console.log(`               ${s.detail}`)
  }

  const blocked = steps.filter((s) => s.outcome === 'cannot yet')
  console.log(
    blocked.length === 0
      ? '\nEverything that could be done automatically is done.'
      : `\n${blocked.length} thing(s) still need you. Run npm run fresh:doctor for the next one.`,
  )
}

await main()
