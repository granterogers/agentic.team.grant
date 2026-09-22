/**
 * INSTALL THE OFFICE INTO AN EMPTY DATABASE.
 *
 *   npm run fresh:install
 *
 * This is the step a new person runs. It applies the baseline — the schema
 * after every migration, plus the seed that is the product — and records those
 * migrations as applied, so `npm run migrate` afterwards behaves exactly as it
 * does on an installation that replayed the whole corpus.
 *
 * ## Why not just run the migrations
 *
 * Because they cannot run. Nine of them assert the contents of the database
 * they were written against — a project of a particular name holding material,
 * a chat that has received real deliveries, at least a hundred historical
 * mistakes — and a blank database has none of it. `npm run migrate` on a fresh
 * project stops at migration 54 of 535. That is F-002, it cannot be repaired in
 * place because applied migrations are immutable, and the baseline is the way
 * round it.
 *
 * ## Where it runs
 *
 * Either transport. A new person with their own Supabase project sets
 * `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` and it goes over the
 * Management API, exactly as `npm run migrate` does. With neither set it looks
 * for a local disposable database instead, which is how the acceptance journeys
 * run with no account at all.
 *
 * ## It is one statement, so an interruption leaves nothing
 *
 * The schema, the seed and the migration ledger go in as a SINGLE execute.
 * `SqlExecutor`'s atomicity contract is that the whole string is applied
 * all-or-nothing, over either transport, so a person who presses Ctrl-C
 * halfway — or whose laptop sleeps, or whose network drops — is left with the
 * empty database they started with rather than a half-built one. Running it
 * again then simply works.
 *
 * The alternative shapes are all worse. Three separate calls would leave a
 * database with a schema and no seed, which looks installed and is not; a
 * resume flag would have to know which of the three got through, and would be
 * wrong the first time somebody interrupted it somewhere new. Journey D asks
 * for safe resume with no duplication, and the cheapest way to resume safely is
 * to have nothing to resume from.
 *
 * ## What it refuses
 *
 * An installation that already exists. `app.schema_migrations` holding rows
 * means somebody's office is already there, and writing a baseline over it
 * would replace a working system with a blank one. There is no --force: the
 * safe recovery from "I meant a different database" is to name the other
 * database, and the safe recovery from "I want to start again" is a new one.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PostgresExecutor } from '../../src/db/postgres-executor.ts'
import { HARNESS_DB_PREFIX, refuseForeignDatabase } from '../../src/fresh/forbidden.ts'
import {
  asSuperuser,
  createDatabase,
  databaseExists,
  ensureRole,
  localConnection,
} from '../../src/fresh/local-db.ts'

const BASELINE = 'migrations/baseline'
const SHIM = 'scripts/fresh/sql/supabase-shim.sql'

const sha256 = (c: string): string => createHash('sha256').update(c, 'utf8').digest('hex')

interface Target {
  readonly executor: SqlExecutor
  readonly describe: string
  readonly local: boolean
  readonly db: string | null
}

function chooseTarget(): Target {
  const ref = process.env.SUPABASE_PROJECT_REF
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (ref !== undefined && ref !== '' && token !== undefined && token !== '') {
    return {
      executor: new ManagementApiExecutor(ref, token),
      // The ref is the public half of a URL, not a credential — and a person
      // installing into the wrong project needs to see which one this is.
      describe: `Supabase project ${ref}`,
      local: false,
      db: null,
    }
  }
  const db = process.env.FRESH_DB ?? `${HARNESS_DB_PREFIX}install`
  refuseForeignDatabase(db)
  return {
    executor: new PostgresExecutor(localConnection(db)),
    describe: `local disposable database ${db}`,
    local: true,
    db,
  }
}

async function alreadyInstalled(executor: SqlExecutor): Promise<number | null> {
  try {
    const { rows } = await executor.execute(
      `select case when to_regclass('app.schema_migrations') is null then -1
                   else (select count(*)::int from app.schema_migrations) end as n`,
    )
    const n = Number(rows[0]?.n ?? -1)
    return n < 0 ? null : n
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const target = chooseTarget()
  console.log(`installing into: ${target.describe}\n`)

  if (target.local) {
    // A local target has to exist and has to look like Supabase before the
    // baseline will apply — the schema references roles, a vault and an
    // extensions schema that Supabase provides and stock Postgres does not.
    ensureRole()
    if (!databaseExists(target.db ?? '')) {
      createDatabase(target.db ?? '')
      console.log(`created ${target.db}`)
    }
    asSuperuser(`psql -q -v ON_ERROR_STOP=1 -d ${target.db} -f ${process.cwd()}/${SHIM}`)
  }

  const existing = await alreadyInstalled(target.executor)
  if (existing !== null && existing > 0) {
    console.error(
      `\nREFUSED: ${target.describe} already has an office in it — ` +
        `app.schema_migrations records ${existing} migration(s).\n\n` +
        'Installing the baseline over it would replace a working system with a blank one.\n' +
        'If you meant a different database, name it. If you want to start again, make a new one.\n' +
        'To bring an existing installation up to date instead, run: npm run migrate',
    )
    process.exit(1)
  }

  const schema = await readFile(join(BASELINE, 'schema.sql'), 'utf8')
  const seed = await readFile(join(BASELINE, 'seed.sql'), 'utf8')

  /*
    Record the migrations the baseline represents.

    Without this the next `npm run migrate` would try to apply all of them from
    the beginning against a database that already has them, and fail
    immediately and confusingly. With it, a fresh installation and one that
    replayed the corpus are indistinguishable to the runner — which is the
    property that makes journey I, the upgrade, work at all.

    Checksums are computed from the files on disk, which is what the runner
    compares against. Anything else would be a second copy of the truth.
  */
  const names = (await readdir('migrations')).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()
  const values: string[] = []
  for (const name of names) {
    const sql = await readFile(join('migrations', name), 'utf8')
    values.push(`(${quote(name)}, ${quote(sha256(sql))})`)
  }

  console.log(`applying the schema, the seed and ${names.length} ledger entries, in one step…`)
  await target.executor.execute(
    `${schema}\n${seed}\n` +
      `insert into app.schema_migrations (name, checksum) values ${values.join(',')} ` +
      'on conflict (name) do nothing;',
  )

  const after = await alreadyInstalled(target.executor)
  console.log(`\nINSTALLED — app.schema_migrations records ${after ?? 0} migration(s)`)
  console.log('next: npm run fresh:doctor')
}

function quote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

await main()
