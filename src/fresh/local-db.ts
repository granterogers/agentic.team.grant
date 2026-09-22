/**
 * The disposable local database the fresh-install harness runs against.
 *
 * ## Why a password file exists, and why it is not a secret
 *
 * `pg` speaks TCP, and the cluster wants a password there. Every harness
 * command — zero-state, install, doctor, the acceptance run — needs the SAME
 * one, so a per-process random password (which is what this started as) means
 * the doctor cannot read the database the installer just made.
 *
 * So there is one password, in one file, and the file is not a credential in
 * any sense that matters:
 *
 *   * it is for a database on loopback, on this machine, that the harness
 *     created and will drop;
 *   * everything in that database is invented — the shim's vault stores
 *     plaintext, which is exactly why nothing real may ever go in it;
 *   * it is generated on first use, never chosen, never shown;
 *   * it is gitignored and written 0600.
 *
 * That last one is the part to keep true. CLAUDE.md's rule is absolute — no
 * secret in the repository — and the way this stays on the right side of it is
 * that the value protects nothing. If a future change makes this database hold
 * anything real, this file becomes a credential and must move to the vault.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { HARNESS_DB_PREFIX, refuseForeignDatabase } from './forbidden.ts'

const PASSWORD_FILE = '.fresh-install/local-db-password'
export const HARNESS_ROLE = 'fresh_alex_harness'

/** The cluster superuser the harness uses for createdb/dropdb. */
const SUPERUSER = process.env.FRESH_PG_SUPERUSER ?? 'postgres'

export function asSuperuser(command: string): string {
  return execFileSync('su', [SUPERUSER, '-c', command], { encoding: 'utf8', stdio: 'pipe' })
}

/** Read the harness password, generating it the first time. */
export function localPassword(): string {
  if (existsSync(PASSWORD_FILE)) return readFileSync(PASSWORD_FILE, 'utf8').trim()
  mkdirSync(dirname(PASSWORD_FILE), { recursive: true })
  const generated = randomBytes(24).toString('hex')
  writeFileSync(PASSWORD_FILE, `${generated}\n`, { mode: 0o600 })
  chmodSync(PASSWORD_FILE, 0o600)
  return generated
}

/** Make sure the harness role exists and holds the password in the file. */
export function ensureRole(): void {
  const password = localPassword()
  asSuperuser(
    `psql -q -v ON_ERROR_STOP=1 -d postgres -c "do \\$\\$ begin ` +
      `if not exists (select 1 from pg_roles where rolname = '${HARNESS_ROLE}') then ` +
      `create role ${HARNESS_ROLE} login superuser password '${password}'; ` +
      `else alter role ${HARNESS_ROLE} password '${password}'; end if; end \\$\\$;"`,
  )
}

/** The connection string for a harness database. Loopback, always. */
export function localUrl(db: string): string {
  refuseForeignDatabase(db)
  return `postgresql://${HARNESS_ROLE}:${localPassword()}@127.0.0.1/${db}`
}

/** Is this name one of ours? */
export function isHarnessDb(name: string | undefined): name is string {
  return name !== undefined && name.startsWith(HARNESS_DB_PREFIX)
}

export function databaseExists(db: string): boolean {
  refuseForeignDatabase(db)
  return asSuperuser(`psql -tAd postgres -c "select 1 from pg_database where datname='${db}'"`).trim() !== ''
}

export function createDatabase(db: string): void {
  refuseForeignDatabase(db)
  ensureRole()
  asSuperuser(`createdb ${db} --owner=${HARNESS_ROLE}`)
}

export function dropDatabase(db: string): void {
  refuseForeignDatabase(db)
  asSuperuser(`dropdb --if-exists ${db}`)
}
