/** Like getdef.ts but retries when the Management API throttles: npx tsx scripts/p3/getdef-retry.ts <outdir> app.x ... */
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
  for (let i = 0; i < 10; i++) {
    try {
      const rows = (
        await db.execute(
          `select pg_get_functiondef(p.oid) as d from pg_proc p where p.pronamespace = '${schema}'::regnamespace and p.proname = '${name}'`,
        )
      ).rows as { d: string }[]
      rows.forEach((r, j) =>
        writeFileSync(`${out}/${schema}.${name}${rows.length > 1 ? `.${String(j)}` : ''}.sql`, r.d),
      )
      console.log(n, rows.length)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 6000))
    }
  }
}
