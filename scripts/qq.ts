/**
 * A query whose output is not truncated.
 *
 *   npm run qq -- "select pg_get_functiondef(oid) from pg_proc where ..."
 *
 * `npm run q` prints a table, which is right for twenty short columns and
 * useless for the one thing you most often need from this database: the body
 * of a function you are about to change. An 8,000-character definition
 * arriving as "CREATE OR REPLACE FUNCTION app.enqueue_child(p_parent uuid, "
 * is how somebody transcribes a predicate from memory and gets it wrong.
 *
 * So this prints every value of every row, whole, one per line, and formats
 * nothing.
 */

import { ManagementApiExecutor } from '../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const result = await db.execute(process.argv.slice(2).join(' '))
for (const row of result.rows as Record<string, unknown>[]) {
  console.log(Object.values(row).join('\n'))
}
