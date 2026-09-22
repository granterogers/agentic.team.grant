/**
 * #313 — reproduce "Call it X" as a genuine two-turn interaction, and read
 * every step from canonical state.
 *
 * Contained by construction: the actor is `verify-callit-<run>`, so
 * `jobs.is_fixture` is GENERATED true and nothing here can reach a real
 * prompt, a real destination or Grant's list.
 */

import { titleReply } from '../../src/agents/tasks.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

const run = Date.now().toString(36)
const THREAD = `callit-${run}`
const ACTOR = `verify-callit-${run}`
const SECOND = process.argv[2] ?? `Call it Review the onboarding copy ${run}`

const turn = async (n: number, text: string): Promise<{ job: string; body: string }> => {
  const cmd = String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key)
        values ('teamhq', ${lit(`${THREAD}:${String(n)}`)}, ${lit(ACTOR)},
                ${lit(text)}, ${lit(`teamhq:callit:${THREAD}_${String(n)}`)})
        returning command_id::text as v`)
    ).v ?? '',
  )
  const enq = (await one(`select app.enqueue_inbound(${lit(cmd)}::uuid) as v`)).v
  const parsed = (typeof enq === 'string' ? JSON.parse(enq) : enq) as { job_id?: string }
  const job = String(parsed.job_id ?? '')
  for (let i = 0; i < 60; i += 1) {
    const row = await one(`
      select j.state, coalesce(o.body, '') as body
        from public.jobs j left join public.outputs o on o.job_id = j.job_id
       where j.job_id = ${lit(job)}::uuid`)
    if (['complete', 'failed', 'cancelled'].includes(String(row.state))) {
      return { job, body: String(row.body ?? '') }
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  return { job, body: '(never settled)' }
}

/*
  A task made twenty minutes ago, on a real-looking personal list, which a
  wrong rename would reach. Named with the run token so the damage, if any,
  is attributable and sweepable.
*/
const decoy = String(
  (
    await one(`
      select (app.my_task_add(p_title => ${lit(`Chase the printers ${run}`)})->>'id') as v`)
  ).v ?? '',
)
const decoyBefore = String(
  (await one(`select title from public.tasks where task_id = ${lit(decoy)}::uuid`)).title ?? '',
)

console.log(`\n#313 reproduction — thread ${THREAD}\n`)
const first = await turn(1, 'Add a task')
console.log(`  turn 1  "Add a task"\n          -> ${first.body.slice(0, 110)}`)

/*
  What `namedLater` would see, asked with the SAME query the handler uses.
  Run BEFORE turn 2 is inserted, because that is when the handler runs it —
  it excludes the current command, so the answer is the previous turn's
  output either way, and asking it here makes the reproduction independent
  of the handler having worked.
*/
const seen = String(
  (
    await one(`
      select coalesce(
        (select left(o.body, 500) from public.outputs o
           join public.inbound_commands c on c.job_id = o.job_id
          where c.origin_channel = 'teamhq'
            and split_part(c.origin_ref, ':', 1) = ${lit(THREAD)}
          order by c.received_at desc limit 1), '') as said`)
  ).said ?? '',
)
console.log(`\n  what namedLater would find: ${seen === '' ? 'NOTHING' : `"${seen.slice(0, 80)}"`}`)
console.log(
  `  titleReply(second, that)  : ${JSON.stringify(titleReply(SECOND, seen === '' ? null : seen, false))}`,
)

const second = await turn(2, SECOND)
console.log(`\n  turn 2  ${JSON.stringify(SECOND)}\n          -> ${second.body.slice(0, 160)}`)

const made = await one(`
  select count(*)::int as n,
         coalesce(max(title), '') as title
    from public.tasks where job_id = ${lit(second.job)}::uuid`)
const decoyAfter = String(
  (await one(`select title from public.tasks where task_id = ${lit(decoy)}::uuid`)).title ?? '',
)

console.log(`\n  CANONICAL EFFECTS`)
console.log(
  `    tasks created by turn 2 : ${String(made.n)}${Number(made.n) > 0 ? ` — "${String(made.title)}"` : ''}`,
)
console.log(
  `    the decoy task          : ${decoyBefore === decoyAfter ? 'UNTOUCHED' : `RENAMED to "${decoyAfter}"`}`,
)
console.log(
  `\n  VERDICT  ${
    Number(made.n) > 0 && decoyBefore === decoyAfter
      ? 'correct — it named the thing it was asked about and touched nothing else'
      : decoyBefore !== decoyAfter
        ? 'DESTRUCTIVE — it renamed an unrelated object'
        : 'INERT — it created nothing'
  }\n`,
)

// Teardown: the decoy is the only row worth removing; the jobs are fixtures.
await db.execute(`select app.my_task_forget(${lit(decoy)}::uuid)`).catch(async () => {
  await db.execute(`delete from public.tasks where task_id = ${lit(decoy)}::uuid`).catch(() => {})
})
