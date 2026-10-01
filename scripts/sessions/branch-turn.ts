/**
 * One conversation turn answered by THIS CHECKOUT's handlers, in-process.
 *
 *   npx tsx scripts/sessions/branch-turn.ts <session> <projectSlug> "<message>" ["<message>" ...]
 *
 * The behavioural remediation run may not deploy the worker, so a fix in the
 * handler can only be driven end to end by running the handler here, the way
 * verify:unified does: enqueue through the real door (harness actor, announce
 * closed in the same transaction), claim it at once with a scoped dequeue, and
 * run it with `buildPass`. The deployed worker can still win the race; when it
 * does the turn says so, because that answer is PRODUCTION's, not the branch's.
 *
 * Turns share one chat, so a later message sees the earlier ones.
 */
import { dequeue, type Job, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'
import { db, lit } from './run.ts'

const [session, slug, ...says] = process.argv.slice(2)
const run = Math.random().toString(36).slice(2, 8)
// CHAT=<chat> resumes an existing conversation; START=<n> numbers its turns from there.
const chat = process.env.CHAT ?? `branch-${String(session)}-${run}`
const actor = `verify-branch-${String(session)}`
const MINE = `teamhq:${actor}`
const WORKER = `branch-${run}`
const one = async (sql: string) =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const proj = String(
  (
    await one(
      `select project_id::text as id from public.projects where slug = ${lit(String(slug))}`,
    )
  ).id ?? '',
)
if (proj === '') throw new Error(`no project ${String(slug)}`)
const pass = await buildPass(db, WORKER, {
  max: 1,
  canTranscribe: false,
  canSubprocess: false,
  projectRef: process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
})

let i = Number(process.env.START ?? '0')
for (const say of says) {
  i += 1
  const key = `teamhq:branch_turn:${chat}-${String(i)}`
  const jobId = String(
    (
      await one(`
    begin;
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
      values ('teamhq', ${lit(`${chat}:${String(i)}`)}, ${lit(actor)}, ${lit(say)}, ${lit(key)}, app.now_utc(), ${lit(proj)}::uuid);
    create temp table _j on commit drop as select (app.enqueue_inbound((select command_id from public.inbound_commands where dedupe_key = ${lit(key)})) ->> 'job_id')::uuid as id;
    /*
      Not runnable for three seconds, so the deployed worker - which is kicked
      on enqueue - finds nothing to take, and this process claims it once it
      is due. Without it the kick won about half the races.
    */
    update public.jobs set announce = false, not_before = app.now_utc() + interval '3 seconds'
     where job_id = (select id from _j);
    select (select id from _j)::text as id;
    commit;`)
    ).id,
  )
  await pause(3_200)
  let job: Job | null = null
  for (let t = 0; t < 6 && job === null; t++) {
    const got = await dequeue(db, WORKER, false, false, undefined, MINE)
    if (got?.jobId === jobId) job = got
    else if (got !== null) {
      /*
        Another job of THIS conversation - a child the previous turn started
        inherits the actor, so the scope admits it. Run it here rather than
        dropping it: a dequeued job left alone holds its lease and strands,
        which is exactly what the first version of this driver did to a
        pursuit (CLAUDE.md: settle anything else that arrives).
      */
      await runJob(db, got, pass.handlers, pass.review).catch(() => undefined)
    } else await pause(500)
  }
  let ranHere = job !== null
  for (let attempt = 1; job !== null && attempt <= 3; attempt++) {
    await runJob(db, job, pass.handlers, pass.review)
    const st = String(
      (await one(`select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`)).s,
    )
    // No attempt left to run: dequeuing again would claim it and strand it.
    if (st !== 'retrying' || attempt === 3) break
    await db.execute(`select app.requeue_retrying()`)
    job = null
    for (let t = 0; t < 6 && job === null; t++) {
      const got = await dequeue(db, WORKER, false, false, undefined, MINE)
      if (got?.jobId === jobId) job = got
      else if (got !== null)
        await runJob(db, got, pass.handlers, pass.review).catch(() => undefined)
      else await pause(500)
    }
  }
  if (!ranHere) {
    for (let w = 0; w < 40; w++) {
      const st = String(
        (await one(`select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`))
          .s,
      )
      if (['complete', 'failed', 'cancelled'].includes(st)) break
      await pause(5000)
    }
  }
  const r =
    await one(`select j.state::text as state, coalesce(j.recipient_agent,'') as agent, app.harness_job(j.job_id) as harness,
      coalesce((select array_to_string(r.roster, ',') from public.routing_decisions r where r.job_id = j.job_id order by decided_at desc limit 1), '') as roster,
      coalesce((select o.body from public.outputs o where o.job_id = j.job_id order by o.created_at desc limit 1), '') as body
      from public.jobs j where job_id = ${lit(jobId)}::uuid`)
  console.log(
    `\n#${String(i)} ${say}\n   ${jobId} ${ranHere ? 'BRANCH CODE' : 'DEPLOYED WORKER'} ${String(r.state)} ${String(r.agent)} roster=${String(r.roster)} harness=${String(r.harness)}\n   => ${String(r.body).replace(/\s+/g, ' ').slice(0, 900)}`,
  )
  ranHere = false
}

/*
  Sweep what this run's jobs put on Grant's personal list, and say so. Until
  0592 is applied a harness turn's task is stamped `added_by grant` and so is
  not a fixture: 26 of them sat on his real list after one evening of these
  drives (ledger R37 reconciliation). KEEP=1 leaves them for inspection.
*/
if (process.env.KEEP !== '1') {
  const swept = await one(`
    with x as (select t.task_id from public.tasks t join public.jobs j on j.job_id = t.job_id
                where j.requested_by = ${lit(MINE)} and t.assigned_to_human and t.parent_task_id is null)
    select count(*) filter (where (app.my_task_delete(app.test_office(), task_id::text, 'branch driver sweep')) ->> 'ok' = 'true')::int as gone,
           count(*)::int as n from x`)
  const left =
    await one(`select count(*)::int as n from public.tasks t join public.jobs j on j.job_id = t.job_id
                           where j.requested_by = ${lit(MINE)} and t.assigned_to_human`)
  console.log(
    `\nswept ${String(swept.gone)} of ${String(swept.n)} personal task(s) this run made; ${String(left.n)} left`,
  )
}
