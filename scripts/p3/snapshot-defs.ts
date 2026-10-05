/**
 * Write every function definition in `app` and `public` to one SQL file: the rollback material for a release that drops
 * signatures (multi-user P3). A migration that drops an overload cannot be reversed by a migration file, because the file that
 * created it has since been superseded; this is the exact text that was live before.
 *
 *   npx tsx scripts/p3/snapshot-defs.ts <output.sql>            # production (read only)
 *   P3_DB=p3_attack_m npx tsx scripts/p3/snapshot-defs.ts <output.sql>
 *
 * The file is meant to live OUTSIDE the repository (the session scratchpad): it is large, and it is evidence for one release
 * rather than source. Restoring a single function is: find it in the file, run it. The privileges are written too, as the
 * `revoke`/`grant` statements that reproduce them.
 */
import { writeFileSync } from 'node:fs'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'

const out = process.argv[2] ?? ''
if (out === '') throw new Error('usage: snapshot-defs.ts <output.sql>')

const local = process.env.P3_DB
let db: SqlExecutor
if (local !== undefined) {
  const pg = new PgExecutor(`postgresql://postgres@/${local}?host=/tmp/pgs&port=55432`)
  await pg.connect()
  db = pg
} else
  db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    process.env.SUPABASE_ACCESS_TOKEN ?? '',
  )

const ids = (
  await db.execute(
    `select p.oid::bigint as oid
       from pg_proc p
      where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace) and p.prokind in ('f', 'p')
      order by p.pronamespace::regnamespace::text, p.proname, p.oid`,
  )
).rows.map((r) => String((r as { oid: string | number }).oid))

const parts: string[] = [
  `-- function definitions as they were live at ${new Date().toISOString()}: ${String(ids.length)} functions\n`,
]
const BATCH = 60
for (let i = 0; i < ids.length; i += BATCH) {
  const chunk = ids.slice(i, i + BATCH)
  let rows: { d: string; g: string }[] = []
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      rows = (
        await db.execute(
          `select pg_get_functiondef(p.oid) as d,
                  format('revoke all on function %s from public;', p.oid::regprocedure) ||
                  case when has_function_privilege('anon', p.oid, 'execute') then format(E'\\ngrant execute on function %s to anon;', p.oid::regprocedure) else '' end ||
                  case when has_function_privilege('authenticated', p.oid, 'execute') then format(E'\\ngrant execute on function %s to authenticated;', p.oid::regprocedure) else '' end ||
                  case when has_function_privilege('service_role', p.oid, 'execute') then format(E'\\ngrant execute on function %s to service_role;', p.oid::regprocedure) else '' end as g
             from pg_proc p where p.oid in (${chunk.join(',')}) order by p.oid`,
        )
      ).rows as { d: string; g: string }[]
      break
    } catch (e) {
      if (attempt === 6) throw e
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
  for (const r of rows) parts.push(`${r.d.trimEnd()};\n${r.g}\n`)
}
writeFileSync(out, parts.join('\n'))
console.log(`wrote ${String(ids.length)} function definitions to ${out}`)
if (db instanceof PgExecutor) await db.end()
