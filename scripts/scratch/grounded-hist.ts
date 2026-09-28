import { groundedIn } from '../../src/agents/named.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const rows = (
  await db.execute(
    `select t.title, c.instruction, app.harness_job(c.job_id) h from tasks t join inbound_commands c on c.job_id = t.job_id`,
  )
).rows as { title: string; instruction: string; h: boolean }[]
let n = 0
for (const r of rows)
  if (!groundedIn(r.title, r.instruction)) {
    n++
    console.log(
      `${r.h ? 'H' : 'REAL'} "${r.title}"  <=  ${r.instruction.replace(/\s+/g, ' ').slice(0, 100)}`,
    )
  }
console.log(`${rows.length} conversational tasks, ${n} with a title not grounded in the message`)
