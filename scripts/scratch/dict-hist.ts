import { cleanDictation } from '../../src/agents/dictation.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const rows = (
  await db.execute(
    `select distinct c.instruction, c.origin_channel ch, app.harness_job(c.job_id) h from inbound_commands c where c.job_id is not null`,
  )
).rows as { instruction: string; ch: string; h: boolean }[]
let n = 0
for (const r of rows) {
  const c = cleanDictation(r.instruction)
  if (c !== r.instruction.trim().replace(/\s{2,}/g, ' ')) {
    n++
    if (n <= 25)
      console.log(
        `${r.h ? 'H' : 'REAL'}/${r.ch}: ${JSON.stringify(r.instruction.slice(0, 110))}\n     -> ${JSON.stringify(c.slice(0, 110))}`,
      )
  }
}
console.log(`${rows.length} instructions, ${n} changed`)
