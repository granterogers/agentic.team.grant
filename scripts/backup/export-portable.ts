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

import '../../src/safety/require-production-checks.ts'
import { writeFile } from 'node:fs/promises'
import { buildArchive } from '../../src/backup/portable.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, token)

const archive = await buildArchive(db, ref)
await writeFile(archive.name, archive.bytes)
// A checksum, so a corrupted copy is detectable rather than merely disappointing.
await writeFile(`${archive.name}.sha256`, `${archive.sha256}  ${archive.name}\n`)

console.log(archive.name)
console.log(`  ${String(archive.rows)} rows across ${String(archive.tables)} tables`)
console.log(
  `  ${String(Math.round(archive.rawBytes / 1024))}KB raw → ` +
    `${String(Math.round(archive.bytes.length / 1024))}KB gzipped`,
)
console.log(`  sha256 ${archive.sha256.slice(0, 16)}…`)
console.log(`  latest migration: ${archive.latestMigration}`)
console.log(
  '\nThe nightly duty puts this same archive in a private bucket. ' + 'This copy is for holding.',
)
