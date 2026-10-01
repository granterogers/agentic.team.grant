/**
 * Pause or resume the worker's heartbeat around a signature-changing release (multi-user P3).
 *   npx tsx scripts/p3/worker-heartbeat.ts pause     # stops new ticks; waits (up to 3 min) for running jobs to finish
 *   npx tsx scripts/p3/worker-heartbeat.ts resume
 * A migration that changes a function's signature and a worker built before it cannot both be live: the worker would call
 * a function that is gone and burn job attempts. The pause is the window between "migration applied" and "worker deployed".
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const verb = process.argv[2]
if (verb !== 'pause' && verb !== 'resume')
  throw new Error('usage: worker-heartbeat.ts pause|resume')
await db.execute(
  `select cron.alter_job((select jobid from cron.job where jobname = 'worker-heartbeat'), active := ${verb === 'resume' ? 'true' : 'false'})`,
)
if (verb === 'pause') {
  for (let i = 0; i < 18; i += 1) {
    const r = (
      await db.execute(`select count(*)::int as n from public.jobs where state = 'running'`)
    ).rows[0] as { n: number }
    if (r.n === 0) break
    await new Promise((res) => setTimeout(res, 10_000))
  }
}
const s = (
  await db.execute(
    `select active, (select count(*)::int from public.jobs where state = 'running') as running from cron.job where jobname = 'worker-heartbeat'`,
  )
).rows[0] as { active: boolean; running: number }
console.log(
  `worker heartbeat ${s.active ? 'ACTIVE' : 'PAUSED'}; ${String(s.running)} job(s) running`,
)
