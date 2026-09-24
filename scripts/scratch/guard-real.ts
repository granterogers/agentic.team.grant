import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const rows = (
  await db.execute(
    `select c.instruction from inbound_commands c join jobs j on j.job_id=c.job_id where ${process.env.ALL ? 'true' : 'not app.harness_job(j.job_id)'} and c.instruction ~* '\\m(task|to-?do|reminder)'`,
  )
).rows as { instruction: string }[]
let n = 0
for (const r of rows) {
  const t = r.instruction
  const now = taskRequest(t, classifyIntent(t))
  const def = /\b(?:the|this|that|my|our|his|your)\s+(?:task|to-?do|reminder)\b/i.test(t)
  if (def && now === null) {
    n++
    console.log('DECLINED:', t.replace(/\s+/g, ' ').slice(0, 150))
  }
}
console.log(
  `${rows.length} task-mentioning instructions, ${n} with a definite task noun now declined`,
)
