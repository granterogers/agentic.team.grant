import { split } from '../../src/agents/clauses.ts'
import { namedColleague } from '../../src/agents/named.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const staff = (await db.execute(`select slug, name from staff where active`)).rows as {
  slug: string
  name: string
}[]
const rows = (
  await db.execute(
    `select distinct c.instruction, app.harness_job(c.job_id) h, coalesce(j.recipient_agent,'') a from inbound_commands c join jobs j on j.job_id=c.job_id`,
  )
).rows as { instruction: string; h: boolean; a: string }[]
let n = 0
for (const r of rows) {
  const hits = split(r.instruction)
    .map((c) => namedColleague(c.text, staff))
    .filter((x) => x !== null)
  if (hits.length > 0) {
    n++
    console.log(
      `${r.h ? 'H' : 'REAL'} [answered by ${r.a}] -> ${hits.join(',')}: ${r.instruction.replace(/\s+/g, ' ').slice(0, 110)}`,
    )
  }
}
console.log(`${rows.length} instructions, ${n} name a colleague in a delegation frame`)
