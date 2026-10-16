/**
 * Priority 3 (DEC-016) — the conversation's work says which project each piece is for, so a request is only ever
 * weighed against work for the same project.
 *
 *   npx tsx scripts/isolated/work-carries-its-project.ts <replica-db>
 *
 * Drives the real `realParent` (a real turn through the real enqueue path) twice in one chat, then calls the real
 * `app.conversation_work` for the second turn. The first turn is still in flight, so it must be listed, and the entry
 * must carry the project the job belongs to (migration 1081).
 */
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

const first = await realParent(db)
const second = await realParent(db)
// The work a duplicate guard weighs is the HANDED-ON work of the conversation's turns (children), not the turns
// themselves. So the first turn hands a specialist one piece of work, which is still in flight.
const handed = String(
  (
    await one(`select app.enqueue_child_once(app.job_office('${first}'::uuid), '${first}'::uuid, 'office.instruction',
      'research-director: draft the venue summary',
      jsonb_build_object('instruction', 'Draft the venue summary', 'addressed_to', 'research-director',
                         'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff'),
      false, null, null, null, null) ->> 'job_id' as j`)
  ).j,
)

const cmd = await one(`select command_id::text as c from public.inbound_commands
                       where job_id = '${second}'::uuid limit 1`)
const raw = (
  await one(`select app.conversation_work(app.job_office('${second}'::uuid),
             '${String(cmd.c)}'::uuid, interval '24 hours', '${second}'::uuid)::text as r`)
).r
const work = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
  in_flight?: { job?: string; project?: string | null }[]
}
const entry = (work.in_flight ?? []).find((w) => w.job === handed)
const firstProject = String(
  (await one(`select project_id::text as p from public.jobs where job_id = '${first}'::uuid`)).p,
)

check(
  'the work the earlier turn handed on is listed as work in flight',
  entry !== undefined,
  entry === undefined ? 'not listed' : 'listed',
)
// Clear the queued turns and their hand-off this proof made, so no later proof's dequeue can claim them (#184).
await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared'
    where job_id in ('${first}'::uuid, '${second}'::uuid, '${handed}'::uuid) and state = 'queued'`,
)
check(
  'the entry carries the project the job belongs to',
  entry !== undefined && entry.project === firstProject,
  `project=${String(entry?.project ?? 'none')} expected=${firstProject}`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
