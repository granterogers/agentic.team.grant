/** How often a text detector fires on real delivered answers. */

import * as q from '../../src/agents/quality.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const name = process.argv[2] ?? 'claimsToHaveChangedTask'
const fn = (q as unknown as Record<string, (b: string) => string | null>)[name]
const rows = (
  await db.execute(`select o.body, j.kind from outputs o join jobs j on j.job_id=o.job_id
  where (${process.env.ALL ? 'true' : 'not app.harness_job(j.job_id)'}) and o.body is not null order by o.created_at desc limit 4000`)
).rows as { body: string; kind: string }[]
let n = 0
for (const r of rows) {
  const h = fn?.(r.body)
  if (h) {
    n++
    console.log(`[${r.kind}] ${h} :: ${r.body.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
}
console.log(`fired ${n} / ${rows.length}`)
