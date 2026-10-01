/** Write the LIVE definition of each named function to a file: npx tsx scripts/p3/getdef.ts <outdir> app.my_tasks ... */
import { mkdirSync, writeFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const [out, ...names] = process.argv.slice(2)
mkdirSync(out as string, { recursive: true })
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
for (const n of names) {
  const [schema, name] = n.split('.')
  const rows = (
    await db.execute(
      `select pg_get_functiondef(p.oid) as d, pg_get_function_identity_arguments(p.oid) as a
         from pg_proc p where p.pronamespace = '${schema}'::regnamespace and p.proname = '${name}'`,
    )
  ).rows as { d: string; a: string }[]
  rows.forEach((r, i) =>
    writeFileSync(`${out}/${schema}.${name}${rows.length > 1 ? `.${String(i)}` : ''}.sql`, r.d),
  )
  console.log(n, rows.length)
}
