import { mentionsWithoutAsking } from '../../src/agents/not-a-request.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const rows = (
  await db.execute(
    `select distinct c.instruction, app.harness_job(c.job_id) h, exists (select 1 from tasks t where t.job_id=c.job_id) made from inbound_commands c where c.job_id is not null and c.instruction ~* '\\m(add|put|make|create|set up|raise|log|stick|file|remind)\\M'`,
  )
).rows as { instruction: string; h: boolean; made: boolean }[]
let n = 0
for (const r of rows)
  if (mentionsWithoutAsking(r.instruction)) {
    n++
    console.log(
      `${r.h ? 'H' : 'REAL'} made_task=${r.made}: ${r.instruction.replace(/\s+/g, ' ').slice(0, 130)}`,
    )
  }
console.log(
  `${rows.length} instructions with a making verb, ${n} now read as mentioning without asking`,
)
