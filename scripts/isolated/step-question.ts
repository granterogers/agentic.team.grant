/**
 * A question asked INSIDE an approved plan is answered as itself, not as the plan's approval (review F1, 0636).
 *
 *   npx tsx scripts/isolated/step-question.ts <replica-db>
 *
 * The real `app.request_approval`, `app.hq_answer_blocker`, `app.answer_generation_approval` and `app.pause_job`.
 * Approving a plan creates the job that performs it; that job then asks a STEP question ("Write the summary into
 * Notion?") and is parked on it. Before 0636 the job inherited `approval_next`, so answering the step question took
 * the plan-approval branch, judged "Yes, do it" by a list of English words it is not on, recorded a DECLINE, and left
 * the job parked - while the office told him it was going ahead. Every earlier proof built its step questions on plain
 * fixture children with an empty config, which is why they stayed green.
 */
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'step636')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const parent = await realParent(db)
const planBlocker = String(
  (
    await one(
      `select app.request_approval(${lit(parent)}::uuid, 'Run the plan', 'it writes into the notebook', 'office.execute_plan')::text as b`,
    )
  ).b,
)
const opts = (await one(
  `select approval_options as o, decline_option as d from public.blockers where blocker_id = ${lit(planBlocker)}::uuid`,
)) as { o: string[]; d: string | null }
const yes = opts.o[0] as string
const answered = json(
  (
    await one(
      `select app.hq_answer_blocker(${lit(planBlocker)}::uuid, ${lit(yes)}, 'grant')::text as r`,
    )
  ).r,
)
check(
  'control: approving the plan starts the job that performs it',
  typeof answered.job_id === 'string' || answered.approved === true,
  JSON.stringify(answered).slice(0, 100),
)
const child = String(
  (
    await one(
      `select job_id::text as id from public.jobs where parent_job_id = ${lit(parent)}::uuid and idempotency_key = ${lit(`approved-${planBlocker}`)}`,
    )
  ).id,
)
const cfg = json(
  (await one(`select pinned_config::text as c from public.jobs where job_id = ${lit(child)}::uuid`))
    .c,
)
check(
  'the job an approval starts does not inherit approval_next (it is the action, not an asker)',
  cfg.approval_next === undefined,
  JSON.stringify(Object.keys(cfg)),
)

// The child runs, asks a step question and parks on it, as perform.ts does.
await db.execute(
  `update public.jobs set state = 'running', leased_by = 'step-proof', leased_until = now() + interval '1 hour', attempt = 1 where job_id = ${lit(child)}::uuid`,
)
await db.execute(
  `select app.pause_job(${lit(child)}::uuid, 'awaiting_approval', 'asks before it writes', 'his answer', true, null, null, ${lit('a'.repeat(64))})`,
)
const step = String(
  (
    await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, decline_option, originating_agent, work_can_continue)
      values ((select project_id from public.jobs where job_id = ${lit(child)}::uuid), ${lit(child)}::uuid, 'Write the summary into Notion', 'it is outside the office', 'waits',
              array['Yes, do it', 'No, leave it'], 'No, leave it', 'chief-of-staff', false) returning blocker_id::text as id`)
  ).id,
)
const r = json(
  (await one(`select app.hq_answer_blocker(${lit(step)}::uuid, 'Yes, do it', 'grant')::text as r`))
    .r,
)
const row = await one(
  `select state::text as s, resolution, answered_option from public.blockers where blocker_id = ${lit(step)}::uuid`,
)
const job = await one(`select state::text as s from public.jobs where job_id = ${lit(child)}::uuid`)
check(
  'a YES to a step question is recorded as a yes: the resolution and the option chosen agree',
  row.s === 'resolved' &&
    row.answered_option === 'Yes, do it' &&
    !/declined/i.test(String(row.resolution)),
  `${String(row.s)} / ${String(row.answered_option)} / ${String(row.resolution)}`,
)
check(
  'and the parked job is released to run, not left parked',
  job.s !== 'paused',
  `job ${String(job.s)}; answer ${JSON.stringify(r).slice(0, 80)}`,
)
check(
  'and no second execute_plan was started by the answer',
  Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where parent_job_id = ${lit(child)}::uuid and kind = 'office.execute_plan'`,
      )
    ).n,
  ) === 0,
  'none',
)

// The generation answer, on its own terms: a recorded decline option decides, not English.
const p2 = await realParent(db)
await one(
  `select app.request_approval(${lit(p2)}::uuid, 'Run the plan', 'it writes', 'office.execute_plan')::text as b`,
)
const b2 = String(
  (
    await one(
      `select blocker_id::text as b from public.blockers where job_id = ${lit(p2)}::uuid and state = 'open' limit 1`,
    )
  ).b,
)
const o2 = (await one(
  `select approval_options as o, decline_option as d from public.blockers where blocker_id = ${lit(b2)}::uuid`,
)) as { o: string[]; d: string | null }
const no = json(
  (
    await one(
      `select app.hq_answer_blocker(${lit(b2)}::uuid, ${lit(o2.d ?? (o2.o[1] as string))}, 'grant')::text as r`,
    )
  ).r,
)
check(
  'control: declining the plan still declines it and starts nothing',
  no.approved === false,
  JSON.stringify(no).slice(0, 80),
)
const failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1
