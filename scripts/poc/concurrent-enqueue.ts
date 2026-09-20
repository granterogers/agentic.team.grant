// Measures the 0528 race directly: N concurrent duplicate pairs, how many error.
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const PAIRS = 15
let errors = 0
let mismatched = 0
const made: string[] = []

for (let i = 0; i < PAIRS; i += 1) {
  const ref = `race-${Date.now()}-${String(i)}`
  const { rows } = await db.execute(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key)
    values ('telegram', ${lit(ref)}, 'verify-race',
            'Go through the material and work out what is out of date in it.',
            ${lit(`telegram:message:${ref}`)})
    returning command_id::text as id`)
  const id = String((rows[0] as { id: string }).id)
  const call = async (): Promise<string> => {
    const r = await db.execute(`select app.enqueue_inbound(${lit(id)}::uuid) as j`)
    const raw = (r.rows[0] as { j?: unknown })?.j
    const v = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as { job_id?: string }
    return String(v.job_id ?? '')
  }
  const [a, b] = await Promise.all([call().catch(() => 'ERROR'), call().catch(() => 'ERROR')])
  if (a === 'ERROR' || b === 'ERROR') errors += 1
  else if (a !== b) mismatched += 1
  else made.push(a)
}

await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'concurrent-enqueue probe'
   where requested_by = 'telegram:verify-race'
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.inbound_commands where actor = 'verify-race';`)

console.log(
  `${String(PAIRS)} concurrent duplicate pairs — errors: ${String(errors)}, ` +
    `different job ids: ${String(mismatched)}, clean: ${String(made.length)}`,
)
process.exit(errors === 0 && mismatched === 0 ? 0 : 1)
