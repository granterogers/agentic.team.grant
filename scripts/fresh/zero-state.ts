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

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PostgresExecutor } from '../../src/db/postgres-executor.ts'
import {
  HARNESS_DB_PREFIX,
  refuseForeignDatabase,
  refuseProductionRef,
  refuseRemoteHost,
} from '../../src/fresh/forbidden.ts'
import {
  ensureRole,
  localConnection,
  asSuperuser as runAsSuperuser,
} from '../../src/fresh/local-db.ts'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { ledgerExists, readApplied, runMigrations } from '../../src/migrations/runner.ts'

const MIGRATIONS_DIR = 'migrations'
const SHIM = 'scripts/fresh/sql/supabase-shim.sql'
const PRECONDITIONS = 'scripts/fresh/sql/preconditions'
const STUBS = 'scripts/fresh/sql/stub-extensions'

const keep = process.argv.includes('--keep')
const resume = process.argv.includes('--resume')
// Replaying the historical corpus needs the state Grant's database already had.
// Only the baseline build asks for this; a fresh-install proof must not.
const preconditions = process.argv.includes('--preconditions')
const stopAfterArg = process.argv.find((a) => a.startsWith('--stop-after='))
const stopAfter = stopAfterArg === undefined ? null : (stopAfterArg.split('=')[1] ?? null)

const db = process.env.FRESH_DB ?? `${HARNESS_DB_PREFIX}zero_state`

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
const connection = localConnection(db)
refuseRemoteHost(`postgres://${connection.host}/${connection.database}`, 'the harness target')

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

const asSuperuser = runAsSuperuser

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

  ensureRole()

  if (!resume) {
    installStubExtensions()
    asSuperuser(`dropdb --if-exists ${db}`)
    asSuperuser(`createdb ${db} --owner=fresh_alex_harness`)
    asSuperuser(`psql -q -v ON_ERROR_STOP=1 -d ${db} -f ${process.cwd()}/${SHIM}`)
    console.log(
      `blank database created and the Supabase shim applied` +
        (preconditions ? ' (+ historical preconditions)' : ''),
    )
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

  /*
    Preconditions are STAGED.

    A precondition is a statement about the database at a moment in its history,
    not a fixture loaded up front: the scaffold project 0167 needs cannot be
    inserted before 0002 has created the table to put it in. So each file is
    named for the migration it precedes, and the corpus is applied in segments
    that stop at each of those points.

    The runner's own idempotency is what makes this safe to express as repeated
    calls: a migration already recorded in `app.schema_migrations` is skipped,
    so a segment ending at 0167 followed by a segment of everything applies each
    file exactly once.
  */
  const stages: { before: string; sql: string }[] = []
  if (preconditions) {
    for (const name of (await readdir(PRECONDITIONS)).sort()) {
      const matched = /^before-(\d{4})\.sql$/.exec(name)
      if (matched?.[1] === undefined) continue
      stages.push({
        before: matched[1],
        sql: await readFile(join(PRECONDITIONS, name), 'utf8'),
      })
    }
  }

  const executor = new PostgresExecutor(connection)
  const started = Date.now()
  let applied = 0
  let failedAt: string | null = null
  let failure: string | null = null

  try {
    for (const stage of stages) {
      const upto = files.filter((f) => f.name < stage.before)
      if (upto.length > 0)
        applied += (await runMigrations(upto, executor, sha256, () => {})).applied.length
      await executor.execute(stage.sql)
      console.log(`precondition applied before ${stage.before}`)
    }
    const result = await runMigrations(files, executor, sha256, () => {})
    applied += result.applied.length
    console.log(
      `\napplied ${applied}, skipped ${result.skipped.length} ` +
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
