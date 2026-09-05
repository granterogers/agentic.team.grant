/**
 * A copy of everything, in a file a human can hold.
 *
 *   npm run export:portable
 *
 * ## Why this exists alongside a perfectly good pg_dump
 *
 * The nightly dump is better than this in every technical respect: it is a real
 * `pg_dump`, it restores with one command, and its restore is now rehearsed. It
 * has one weakness, and it is not technical — **every copy of it lives behind an
 * account.** Backblaze, and GitHub artifacts for ninety days. On 2026-09-04 the
 * Google account that four of this project's vendors were signed up with was
 * disabled without warning, which is a good reminder that "behind an account" is
 * a real dependency and not a filing detail.
 *
 * This produces one gzipped JSON file over plain HTTPS, using the Management API
 * that Claude Code sessions already use. It needs no Postgres wire protocol, no
 * `pg_dump` binary, and no vendor login. It can be handed to a person, dropped
 * in a password manager, or emailed to yourself.
 *
 * It is a *last* resort, not the first: restoring from it means recreating
 * schema from migrations and then loading rows. The migrations are in git, so
 * that is tractable — which is the whole design of this system, and the reason
 * the code and the data have always been kept separately recoverable.
 *
 * ## What it deliberately does not contain
 *
 * Credentials. `vault` is not exported, for the same reason the nightly dump
 * excludes it: a portable file full of decryptable secrets is a worse problem
 * than the one it solves. The manifest lists what would need re-entering.
 */

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, token)

const tables = (
  await db.execute(`
    select table_schema, table_name
    from information_schema.tables
    where table_schema in ('public', 'app')
      and table_type = 'BASE TABLE'
    order by table_schema, table_name
  `)
).rows as { table_schema: string; table_name: string }[]

console.log(`${String(tables.length)} tables`)

const data: Record<string, unknown[]> = {}
let rows = 0
for (const t of tables) {
  const qualified = `${t.table_schema}.${t.table_name}`
  // Whole tables. This is a backup: a WHERE clause here is a row somebody does
  // not get back.
  const result = await db.execute(`select * from ${qualified}`)
  data[qualified] = [...result.rows]
  rows += result.rows.length
  if (result.rows.length > 0) console.log(`  ${qualified}: ${String(result.rows.length)}`)
}

// The schema, so the file is self-describing rather than only meaningful to
// someone holding this repository at the right commit.
const ddl = (
  await db.execute(`
    select table_schema || '.' || table_name as t, column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema in ('public', 'app')
    order by table_schema, table_name, ordinal_position
  `)
).rows

const migrations = (
  await db.execute(`select name from app.schema_migrations order by name`)
).rows.map((r) => String(r.name))

const payload = {
  exported_at: new Date().toISOString(),
  project_ref: ref,
  note:
    'Portable JSON export. NOT a pg_dump — restoring means applying the ' +
    'migrations from git, then loading these rows. Contains no credentials: ' +
    'the vault schema is deliberately excluded.',
  credentials_not_included: [
    'slack.signing_secret, slack.config_token, slack.config_refresh_token — api.slack.com',
    'telegram.webhook_secret — regenerate, then npm run deploy:telegram',
    'hq.api_token — npm run deploy:hq -- --rotate-token',
    'backup.s3_* — Backblaze dashboard',
    'supabase.db_password — reset on the project',
  ],
  latest_migration: migrations[migrations.length - 1],
  migrations,
  row_counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
  schema: ddl,
  data,
}

const json = JSON.stringify(payload, null, 1)
const gz = gzipSync(Buffer.from(json), { level: 9 })
const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
const name = `aiteamhq-portable-${stamp}.json.gz`
await writeFile(name, gz)

// A checksum, so a corrupted copy is detectable rather than merely disappointing.
const sha = createHash('sha256').update(gz).digest('hex')
await writeFile(`${name}.sha256`, `${sha}  ${name}\n`)

console.log(`\n${name}`)
console.log(`  ${String(rows)} rows across ${String(tables.length)} tables`)
console.log(
  `  ${String(Math.round(json.length / 1024))}KB raw → ${String(Math.round(gz.length / 1024))}KB gzipped`,
)
console.log(`  sha256 ${sha.slice(0, 16)}…`)
console.log(`  latest migration: ${String(migrations[migrations.length - 1])}`)
