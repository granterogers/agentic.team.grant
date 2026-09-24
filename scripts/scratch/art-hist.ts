import { artifactRequest } from '../../src/agents/actions.ts'
import { mentionsWithoutAsking } from '../../src/agents/not-a-request.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const rows = (
  await db.execute(
    `select distinct c.instruction, app.harness_job(c.job_id) h, exists (select 1 from jobs k where k.parent_job_id=c.job_id and k.kind='artifact.report') made from inbound_commands c where c.job_id is not null`,
  )
).rows as { instruction: string; h: boolean; made: boolean }[]
let before = 0,
  now = 0
for (const r of rows) {
  const blocked = mentionsWithoutAsking(r.instruction)
  const wouldHave = !blocked ? artifactRequest(r.instruction) !== null : true
  if (!wouldHave) continue
  if (blocked) {
    before++
    console.log(
      `${r.h ? 'H' : 'REAL'} report_started=${r.made}: ${r.instruction.replace(/\s+/g, ' ').slice(0, 130)}`,
    )
  } else now++
}
console.log(
  `artifact-shaped instructions still starting a report: ${now}; now declined as mentions: ${before}`,
)
