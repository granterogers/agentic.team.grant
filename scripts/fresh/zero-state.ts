/**
 * ZERO-STATE PROOF — §10 of the fresh-install master prompt.
 *
 *   npm run fresh:zero-state              create a blank database, apply every
 *                                         migration through the REAL runner
 *   npm run fresh:zero-state -- --keep    leave the database behind to inspect
 *   npm run fresh:zero-state -- --resume  do not drop first; apply what is
 *                                         pending (journeys D, H and I)
 *
 * ## What this proves, and what it does not
 *
 * It proves the migration corpus applies, in order, to a database that has no
 * application schema and no data, using the same `runMigrations` the real
 * `npm run migrate` uses — not a psql loop, which is not the same thing. That
 * distinction is not pedantry: migration 0524 reads `app.schema_migrations` to
 * find when 0523 was applied, so a replay that does not record the ledger fails
 * there for a reason that has nothing to do with the product.
 *
 * It does NOT prove anything about PostgREST, GoTrue, Storage, Realtime or the
 * Supabase Vault's encryption, none of which exist here. See
 * `scripts/fresh/sql/supabase-shim.sql` for the full list of what is faked and
 * why that is still the strongest equivalent available without an account.
 *
 * ## Safety
 *
 * Loopback only, `fresh_alex_*` databases only, and Grant's production project
 * ref refused by name. The harness drops databases; every guard exists because
 * dropping the wrong one is the worst thing in this workstream's reach.
 */
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PostgresExecutor } from '../../src/db/postgres-executor.ts'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { ledgerExists, readApplied, runMigrations } from '../../src/migrations/runner.ts'
import {
  HARNESS_DB_PREFIX,
  refuseForeignDatabase,
  refuseProductionRef,
  refuseRemoteHost,
} from '../../src/fresh/forbidden.ts'

const MIGRATIONS_DIR = 'migrations'
const SHIM = 'scripts/fresh/sql/supabase-shim.sql'
const STUBS = 'scripts/fresh/sql/stub-extensions'

const keep = process.argv.includes('--keep')
const resume = process.argv.includes('--resume')
const stopAfterArg = process.argv.find((a) => a.startsWith('--stop-after='))
const stopAfter = stopAfterArg === undefined ? null : (stopAfterArg.split('=')[1] ?? null)

const db = process.env.FRESH_DB ?? `${HARNESS_DB_PREFIX}zero_state`
const superuser = process.env.FRESH_PG_SUPERUSER ?? 'postgres'

refuseForeignDatabase(db)
refuseProductionRef(process.env.FRESH_DB, 'FRESH_DB')
refuseProductionRef(process.env.DATABASE_URL, 'DATABASE_URL')

/*
  The harness connects as its own role, not as the cluster's `postgres`.

  `pg` speaks TCP and the cluster wants a password there, so something has to
  supply one. A fixed password in the repository would be a credential in the
  repository, which CLAUDE.md forbids outright and which would be true even
  though the database is disposable — the next person to copy the line would
  not know which kind it was. A per-run random password is not a credential at
  all: it exists for the length of one process, is never written down, and is
  never printed. `scripts/fresh/sql/supabase-shim.sql` already refuses to be
  anywhere but loopback, so the blast radius of the role is one throwaway
  database on this machine.

  SUPERUSER because the migrations create extensions and roles, which nothing
  less can do.
*/
const HARNESS_ROLE = 'fresh_alex_harness'
const runPassword = randomBytes(24).toString('hex')

const url = `postgresql://${HARNESS_ROLE}:${runPassword}@127.0.0.1/${db}`
refuseRemoteHost(url, 'the harness connection string')

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

/** Run a psql/createdb/dropdb command as the cluster superuser. */
function asSuperuser(command: string): string {
  return execFileSync('su', [superuser, '-c', command], { encoding: 'utf8', stdio: 'pipe' })
}

function installStubExtensions(): void {
  // 0121 writes `create extension if not exists pg_cron`, which Postgres
  // answers from a control file on disk. A schema of the same name does not
  // satisfy it, so the stubs go where the cluster looks. They record and never
  // act — see the files themselves.
  const shareDir = execFileSync('pg_config', ['--sharedir'], { encoding: 'utf8' }).trim()
  const target = join(shareDir, 'extension')
  execFileSync('sh', ['-c', `cp ${STUBS}/pg_cron* ${STUBS}/pg_net* ${target}/`])
}

async function main(): Promise<void> {
  console.log(`zero-state target: ${db} (local, disposable)\n`)

  // The role is (re)given this run's password whether or not the database is
  // being recreated, because a resume needs to connect too.
  asSuperuser(
    `psql -q -v ON_ERROR_STOP=1 -d postgres -c "do \\$\\$ begin ` +
      `if not exists (select 1 from pg_roles where rolname = '${HARNESS_ROLE}') then ` +
      `create role ${HARNESS_ROLE} login superuser password '${runPassword}'; ` +
      `else alter role ${HARNESS_ROLE} password '${runPassword}'; end if; end \\$\\$;"`,
  )

  if (!resume) {
    installStubExtensions()
    asSuperuser(`dropdb --if-exists ${db}`)
    asSuperuser(`createdb ${db} --owner=${HARNESS_ROLE}`)
    asSuperuser(`psql -q -v ON_ERROR_STOP=1 -d ${db} -f ${process.cwd()}/${SHIM}`)
    console.log('blank database created and the Supabase shim applied')
  } else {
    console.log('resuming against the existing database — nothing dropped')
  }

  const names = await readdir(MIGRATIONS_DIR)
  let files: MigrationFile[] = await Promise.all(
    names
      .filter((n) => n.toLowerCase().endsWith('.sql'))
      .map(async (name) => ({ name, sql: await readFile(join(MIGRATIONS_DIR, name), 'utf8') })),
  )
  files.sort((a, b) => a.name.localeCompare(b.name))

  if (stopAfter !== null) {
    // Journey D needs a run that stops halfway without being told to tidy up.
    const cut = files.findIndex((f) => f.name.startsWith(stopAfter))
    if (cut === -1) throw new Error(`--stop-after names no migration: ${stopAfter}`)
    files = files.slice(0, cut + 1)
    const last = files[files.length - 1]
    console.log(`stopping after ${last === undefined ? stopAfter : last.name}`)
  }

  const executor = new PostgresExecutor(url)
  const started = Date.now()
  let applied = 0
  let failedAt: string | null = null
  let failure: string | null = null

  try {
    const result = await runMigrations(files, executor, sha256, () => {})
    applied = result.applied.length
    console.log(
      `\napplied ${result.applied.length}, skipped ${result.skipped.length} ` +
        `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // MigrationError names the file; SqlExecutionError does not, so the runner's
    // message is the only thing that can.
    const named = /migrations\/(\d{4}_[a-z0-9_]+\.sql)|(\d{4}_[a-z0-9_]+\.sql)/.exec(message)
    failedAt = named?.[1] ?? named?.[2] ?? null
    failure = message
  }

  const present = await ledgerExists(executor)
  const recorded = present ? await readApplied(executor) : []
  console.log(`app.schema_migrations records ${recorded.length} migration(s)`)

  if (failure !== null) {
    console.log(`\nFAILED${failedAt === null ? '' : ` at ${failedAt}`}`)
    console.log(failure.split('\n').slice(0, 6).join('\n'))
  }

  await executor.close()

  if (!keep && !resume) {
    // Left in place on purpose when the run failed: the state at the moment of
    // failure is the evidence, and dropping it is throwing the evidence away.
    if (failure === null) asSuperuser(`dropdb --if-exists ${db}`)
    else console.log(`\ndatabase ${db} left in place for inspection`)
  }

  console.log(
    `\nRESULT: ${failure === null ? 'ZERO-STATE PASS' : 'ZERO-STATE FAIL'} ` +
      `(${recorded.length}/${files.length} migrations recorded, ${applied} applied this run)`,
  )
  process.exit(failure === null ? 0 : 1)
}

await main()
