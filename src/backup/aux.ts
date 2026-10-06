/**
 * What a working system needs that is NOT a row in `public` or `app` (G-2 of the 6 October audit).
 *
 * The folder backup holds `public` and `app` and nothing else, so on its own a restore yields a database that cannot
 * log anybody in (`auth.users`), has no uploaded file (Storage bytes), does not wake itself (`cron.job`) and has an
 * empty vault. This file records, INSIDE the manifest, the part of that which can be recorded safely as data:
 *
 *   sequences       last values, so identity and serial columns continue where they were (restore sets them)
 *   cron_jobs       the schedule rows, so the heartbeat can be re-created (command text is secret-redacted)
 *   vault_names     the NAMES of the secrets, never a value: it is the checklist of what to re-enter
 *   auth_users      a WHITELISTED set of columns: enough to re-create each login with the same id; never a password
 *                   hash, a token or a one-time code
 *   storage         the bucket list and, per object, path, size, type and the etag Storage itself computed
 *                   (the `backups` bucket is left out: a backup does not list itself)
 *   extensions      what the schema needs installed
 *   schema          a fingerprint of the structure the rows were taken from, so a restore can refuse a target built
 *                   from different migrations
 *
 * What it cannot record, and docs/ops/restore-procedure.md says so: the secret VALUES, the Storage object BYTES, edge
 * function secrets, webhook registrations at Telegram and Slack, and the Auth service's own configuration.
 *
 * Each section is read on its own and reports `{ok:false, error}` rather than failing the backup: a role that cannot
 * read `auth.users` must not stop the nightly copy of the office, and the manifest then SAYS the section is missing
 * instead of leaving a restore to find out.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { redactSecrets } from '../text/secrets.ts'

export interface AuxSection<T> {
  readonly ok: boolean
  readonly error?: string
  readonly rows: readonly T[]
  /** True when a row limit cut the section short. */
  readonly truncated?: boolean
}

export interface Aux {
  readonly aux_version: 1
  readonly sequences: AuxSection<{
    schema: string
    name: string
    last_value: string | null
    increment_by: string
    min_value: string
    max_value: string
  }>
  readonly cron_jobs: AuxSection<{
    jobname: string | null
    schedule: string
    command: string
    active: boolean
  }>
  readonly vault_names: AuxSection<{ name: string; description: string | null }>
  readonly auth_users: AuxSection<Record<string, unknown>>
  readonly storage_buckets: AuxSection<Record<string, unknown>>
  readonly storage_objects: AuxSection<{
    bucket_id: string
    name: string
    size: string | null
    mimetype: string | null
    etag: string | null
  }>
  readonly extensions: AuxSection<{ extname: string; extversion: string }>
  readonly structure: StructureFingerprint | null
}

/** The only `auth.users` columns that are ever read. A column is added here by a person, never discovered. */
export const AUTH_COLUMN_WHITELIST = [
  'id',
  'email',
  'phone',
  'email_confirmed_at',
  'created_at',
  'last_sign_in_at',
  'raw_user_meta_data',
  'raw_app_meta_data',
  'is_anonymous',
  'banned_until',
] as const

/** Columns that must NEVER be read, so a test can assert none is in the whitelist or in a built query. */
export const AUTH_COLUMNS_NEVER_READ = [
  'encrypted_password',
  'confirmation_token',
  'recovery_token',
  'email_change_token_new',
  'email_change_token_current',
  'phone_change_token',
  'reauthentication_token',
  'email_change',
  'phone_change',
] as const

export interface StructureFingerprint {
  readonly tables: number
  readonly columns: number
  readonly columns_md5: string
  readonly constraints: number
  readonly foreign_keys: number
  readonly triggers: number
  readonly policies: number
  readonly indexes: number
  readonly rls_tables: number
}

export const STRUCTURE_SQL = `
  select
    (select count(*) from information_schema.tables where table_schema in ('public','app') and table_type = 'BASE TABLE')::int as tables,
    (select count(*) from information_schema.columns where table_schema in ('public','app'))::int as columns,
    (select md5(string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable,
                           '|' order by table_schema, table_name, ordinal_position))
       from information_schema.columns where table_schema in ('public','app')) as columns_md5,
    (select count(*) from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace
      where n.nspname in ('public','app'))::int as constraints,
    (select count(*) from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace
      where n.nspname in ('public','app') and c.contype = 'f')::int as foreign_keys,
    (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class r on r.oid = t.tgrelid
       join pg_catalog.pg_namespace n on n.oid = r.relnamespace
      where n.nspname in ('public','app') and not t.tgisinternal)::int as triggers,
    (select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class r on r.oid = p.polrelid
       join pg_catalog.pg_namespace n on n.oid = r.relnamespace where n.nspname in ('public','app'))::int as policies,
    (select count(*) from pg_catalog.pg_indexes where schemaname in ('public','app'))::int as indexes,
    (select count(*) from pg_catalog.pg_class r join pg_catalog.pg_namespace n on n.oid = r.relnamespace
      where n.nspname in ('public','app') and r.relkind = 'r' and r.relrowsecurity)::int as rls_tables
`

const section = async <T>(
  read: () => Promise<readonly unknown[]>,
  limit?: number,
): Promise<AuxSection<T>> => {
  try {
    const rows = (await read()) as readonly T[]
    return limit !== undefined && rows.length > limit
      ? { ok: true, rows: rows.slice(0, limit), truncated: true }
      : { ok: true, rows }
  } catch (error) {
    // the message, clipped and redacted: a failed read must say why without ever echoing a credential
    return {
      ok: false,
      error: redactSecrets(String((error as Error).message)).slice(0, 200),
      rows: [],
    }
  }
}

const STORAGE_OBJECT_LIMIT = 20_000

type Seq = Aux['sequences']['rows'][number]
type Cron = Aux['cron_jobs']['rows'][number]
type Vault = Aux['vault_names']['rows'][number]
type Obj = Aux['storage_objects']['rows'][number]
type Ext = Aux['extensions']['rows'][number]
type Loose = Record<string, unknown>

export async function collectAux(db: SqlExecutor): Promise<Aux> {
  const sequences = await section<Seq>(
    async () =>
      (
        await db.execute(`
          select schemaname as schema, sequencename as name, last_value::text, increment_by::text,
                 min_value::text, max_value::text
            from pg_catalog.pg_sequences where schemaname in ('public','app') order by schemaname, sequencename`)
      ).rows,
  )
  const cron_jobs = await section<Cron>(async () =>
    (
      (await db.execute(`select jobname, schedule, command, active from cron.job order by jobid`))
        .rows as unknown as Cron[]
    ).map((r) => ({ ...r, command: redactSecrets(String(r.command)) })),
  )
  // NAMES only. `secret` and `decrypted_secret` are never selected, here or anywhere a backup runs.
  const vault_names = await section<Vault>(
    async () =>
      (await db.execute(`select name, description from vault.secrets order by name`)).rows,
  )
  const auth_users = await section<Loose>(async () => {
    const present = new Set(
      (
        await db.execute(
          `select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users'`,
        )
      ).rows.map((r) => String(r.column_name)),
    )
    const cols = AUTH_COLUMN_WHITELIST.filter((c) => present.has(c))
    if (!cols.includes('id')) throw new Error('auth.users has no id column visible to this role')
    return (
      await db.execute(`select ${cols.map((c) => `"${c}"`).join(', ')} from auth.users order by id`)
    ).rows
  })
  const storage_buckets = await section<Loose>(
    async () =>
      (
        await db.execute(
          `select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,
        )
      ).rows,
  )
  const storage_objects = await section<Obj>(
    async () =>
      (
        await db.execute(`
          select bucket_id, name, metadata ->> 'size' as size, metadata ->> 'mimetype' as mimetype,
                 metadata ->> 'eTag' as etag
            from storage.objects where bucket_id is distinct from 'backups'
           order by bucket_id, name limit ${String(STORAGE_OBJECT_LIMIT + 1)}`)
      ).rows,
    STORAGE_OBJECT_LIMIT,
  )
  const extensions = await section<Ext>(
    async () =>
      (await db.execute(`select extname, extversion from pg_catalog.pg_extension order by extname`))
        .rows,
  )
  let structure: StructureFingerprint | null = null
  try {
    structure = (await db.execute(STRUCTURE_SQL)).rows[0] as unknown as StructureFingerprint
  } catch {
    structure = null
  }
  return {
    aux_version: 1,
    sequences,
    cron_jobs,
    vault_names,
    auth_users,
    storage_buckets,
    storage_objects,
    extensions,
    structure,
  }
}
