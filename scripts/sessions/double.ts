/**
 * The same message twice, a few seconds apart, through the real door.
 *
 *   npx tsx scripts/sessions/double.ts "<message>" [gapSeconds]
 *
 * A re-sent Telegram message or a double submit arrives as two commands with
 * two dedupe keys. Harness actor, announce closed in the enqueue transaction,
 * fixture project. Prints both answers and every task the pair wrote.
 */
import { db, lit } from './run.ts'

const say = process.argv[2] ?? 'Add a task to ring the plumber tomorrow'
const gap = Number(process.argv[3] ?? '3')
const run = Math.random().toString(36).slice(2, 8)
const chat = `sess-double-${run}`
const actor = 'verify-sess-double'
const one = async (sql: string) =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const proj = String(
  (
    await one(
      `select project_id::text as id from public.projects where slug = 'fixture-sess-alpha-rem-continuity'`,
    )
  ).id,
)
const send = async (i: number): Promise<string> =>
  String(
    (
      await one(`
    begin;
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
      values ('teamhq', ${lit(`${chat}:${String(i)}`)}, ${lit(actor)}, ${lit(say)}, ${lit(`teamhq:sess_double:${chat}-${String(i)}`)}, app.now_utc(), ${lit(proj)}::uuid);
    create temp table _j on commit drop as select (app.enqueue_inbound((select command_id from public.inbound_commands where dedupe_key = ${lit(`teamhq:sess_double:${chat}-${String(i)}`)})) ->> 'job_id')::uuid as id;
    update public.jobs set announce = false where job_id = (select id from _j);
    select (select id from _j)::text as id;
    commit;`)
    ).id,
  )
const a = await send(1)
await new Promise((r) => setTimeout(r, gap * 1000))
const b = await send(2)
for (let t = 0; t < 60; t++) {
  const s = await one(
    `select count(*) filter (where state in ('complete','failed','cancelled'))::int as n from public.jobs where job_id in (${lit(a)}::uuid, ${lit(b)}::uuid)`,
  )
  if (Number(s.n) === 2) break
  await new Promise((r) => setTimeout(r, 8000))
}
for (const j of [a, b]) {
  const r =
    await one(`select j.state::text as state, coalesce(j.recipient_agent,'') as agent, app.harness_job(j.job_id) as harness,
      coalesce((select left(o.body, 400) from public.outputs o where o.job_id = j.job_id order by o.created_at desc limit 1), '') as body
      from public.jobs j where job_id = ${lit(j)}::uuid`)
  console.log(
    `${j} ${String(r.state)} ${String(r.agent)} harness=${String(r.harness)}\n  => ${String(r.body).replace(/\s+/g, ' ')}`,
  )
}
const tasks = (
  await db.execute(`select title, coalesce(due_on::text,'') due, job_id::text job from public.tasks
   where job_id in (select job_id from public.jobs where job_id in (${lit(a)}::uuid, ${lit(b)}::uuid) or parent_job_id in (${lit(a)}::uuid, ${lit(b)}::uuid))`)
).rows
console.log(`tasks written by the pair: ${String(tasks.length)}`, JSON.stringify(tasks))
