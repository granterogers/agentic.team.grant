/**
 * Take a backup now, without waiting for tonight.
 *
 *   npm run backup:now
 *
 * The same code the nightly duty runs — `src/backup/portable.ts`, called
 * through the same handler — so this is not a second implementation that might
 * work when the scheduled one does not. It exists because "run it now and
 * watch" is how you find out a scheduled thing works, and because the first
 * copy has to come from somewhere before `backup:rehearse` has anything to
 * restore.
 */

import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { backupHandler } from '../../src/handlers/backup.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const serviceKey = String(
  (
    await db.execute(
      `select coalesce(decrypted_secret, '') as k from vault.decrypted_secrets
        where name = 'supabase.service_role_key'`,
    )
  ).rows[0]?.k ?? '',
)
if (serviceKey === '') {
  console.error(
    'No `supabase.service_role_key` in the vault, so there is nowhere to put the copy.\n' +
      '\n' +
      'Get it from:\n' +
      `  https://supabase.com/dashboard/project/${ref}/settings/api-keys\n` +
      '  → "service_role" → Reveal → copy\n' +
      '\n' +
      'Then store it WITHOUT printing it:\n' +
      "  SUPABASE_SERVICE_ROLE_KEY='…' npm run backup:store-key",
  )
  process.exit(2)
}

const handler = backupHandler({ db, projectRef: ref, serviceKey })
const output = await handler.handle(
  {
    jobId: '00000000-0000-0000-0000-000000000000',
    kind: 'office.backup',
    correlationId: '00000000-0000-0000-0000-000000000000',
    projectId: null,
    idempotencyKey: 'backup:manual',
    attempt: 1,
  },
  db,
)

console.log(output.body)
