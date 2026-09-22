/**
 * The live "Make that urgent" turn that did nothing (v731, run oozsj1jy).
 *
 * The recogniser accepts the sentence and the model's clause reading passes it
 * through 10/10, so the veto is one of the four conditions in front of the
 * change path — or the turn is stochastic. This drives the same four turns in
 * process so each answer can be read.
 */

import { resolveAgainstThread } from '../../src/agents/thread.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

const run = Date.now().toString(36)
const WORKER = `poc-urgent-${run}`
const THREAD = `poc-urg-${run}`
const pass = await buildPass(db, WORKER, { max: 1, canTranscribe: false, canSubprocess: false })

/*
  A REAL router. `buildPass` does not expose one, and the first version of
  this probe passed `router` — which is `undefined`, not null, so
  `resolveAgainstThread` went past its own null guard, threw inside, was
  caught, and returned the instruction untouched every single time. It
  reported "(unchanged)" three times and very nearly stood as a refutation
  of the defect it was written to find.
*/
const orKey = String(
  (
    await one(`select coalesce(app.resolve_secret(secret_ref), '') as v
                 from public.providers
                where provider = 'openrouter' and secret_ref is not null limit 1`)
  ).v ?? '',
)
const router = new ProviderRouter(db, orKey)

let n = 0
const say = async (text: string): Promise<string> => {
  n += 1
  const cmd = String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key)
        values ('teamhq', ${lit(`${THREAD}:${String(n)}`)}, ${lit(`verify-urg-${run}`)},
                ${lit(text)}, ${lit(`teamhq:message:${THREAD}_${String(n)}`)})
        returning command_id::text as v`)
    ).v ?? '',
  )
  /*
    What the office will actually recognise against. `instruction` is
    overwritten by this rewrite at instruction.ts:2057, so every deterministic
    reader downstream sees this sentence rather than what he typed.
  */
  const seen = await resolveAgainstThread(db, router, cmd, text)
  const enq = (await one(`select app.enqueue_inbound(${lit(cmd)}::uuid) as v`)).v
  const parsed = (typeof enq === 'string' ? JSON.parse(enq) : enq) as { job_id?: string }
  const jobId = String(parsed.job_id ?? '')
  /* Take THIS job and settle anything else that arrives (#273). */
  for (let i = 0; i < 12; i += 1) {
    const got = await dequeue(db, WORKER, false, false, undefined, `teamhq:verify-urg-${run}`)
    if (got === null) {
      await new Promise((r) => setTimeout(r, 1_000))
      continue
    }
    if (got.jobId !== jobId) {
      await db.execute(`
        update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
          state_reason = 'not this probe''s job' where job_id = ${lit(got.jobId)}::uuid`)
      continue
    }
    await runJob(db, got, pass.handlers, pass.review)
    break
  }
  const row = await one(`
    select j.state, coalesce(o.body, '') as body from public.jobs j
      left join public.outputs o on o.job_id = j.job_id where j.job_id = ${lit(jobId)}::uuid`)
  console.log(`\n  Grant : ${text}`)
  if (seen.changed) console.log(`  (read as: ${seen.instruction})`)
  console.log(`  office: [${String(row.state)}] ${String(row.body).slice(0, 150)}`)
  return String(row.body ?? '')
}

await say('Morning — what is on my list?')

const made = (
  await one(`
  select app.my_task_add(${lit(`Ring the caterers ${run}`)},
    p_due_on => (current_date + 5)) ->> 'id' as v`)
).v
console.log(`\n  (he adds "Ring the caterers ${run}" himself, due in five days)`)

await say('Actually make that Monday')
await say('Make that urgent')

const now = await one(`
  select title, due_on::text as due, priority from public.tasks
   where task_id = ${lit(String(made ?? ''))}::uuid`)
console.log(
  `\n  CANONICAL: "${String(now.title)}" due ${String(now.due)} priority ${String(now.priority)}`,
)
console.log(
  `  ${Number(now.priority) === 10 ? 'the priority moved' : '>>> THE PRIORITY DID NOT MOVE'}`,
)

const extra = await one(`
  select count(*)::int as n, coalesce(max(title), '') as title from public.tasks
   where title ilike ${lit(`%${run}%`)} and task_id <> ${lit(String(made ?? ''))}::uuid`)
console.log(
  Number(extra.n) === 0
    ? '  and nothing else was created'
    : `  >>> IT ALSO CREATED ${String(extra.n)}: "${String(extra.title)}"`,
)

await db.execute(`delete from public.tasks where title ilike ${lit(`%${run}%`)}`)
await db.execute(`delete from public.inbound_commands where origin_ref like ${lit(`${THREAD}:%`)}`)
