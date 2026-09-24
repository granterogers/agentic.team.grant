import { notARuleForTheOffice, readTeaching } from '../../src/agents/teaching.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const rows = (
  await db.execute(`select distinct body, learned_by from lessons where learned_by = 'grant'`)
).rows as { body: string; learned_by: string }[]
let n = 0
for (const r of rows)
  if (notARuleForTheOffice(r.body)) {
    n++
    console.log(`  DECLINED: ${r.body.slice(0, 140)}`)
  }
console.log(`${rows.length} rules Grant taught, ${n} would now be declined`)
const cmds = (
  await db.execute(
    `select distinct c.instruction from inbound_commands c where c.job_id is not null and not app.harness_job(c.job_id)`,
  )
).rows as { instruction: string }[]
let m = 0
for (const c of cmds) {
  const t = readTeaching(c.instruction)
  if (
    t === null &&
    /\b(always|never)\b/i.test(c.instruction) &&
    notARuleForTheOffice(c.instruction)
  ) {
    m++
    console.log(`  real msg now not a rule: ${c.instruction.slice(0, 120)}`)
  }
}
console.log(`${cmds.length} real messages, ${m} with always/never now not read as a rule`)
