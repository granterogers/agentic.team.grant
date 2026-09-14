/**
 * Can the office reach all eight of its people, or only three?
 *
 *   npm run verify:roster
 *
 * Issue #230. Grant asked *"are we sure the sub agents are being used?"* and the
 * routing ledger says no. All 505 routing decisions ever recorded:
 *
 *     {research-director}   Emma    269
 *     {chief-of-staff}      Claire  146
 *     {}                    nobody   70
 *     {strategy-director}   Tom      20
 *
 * **Oliver, Daniel, Ruby, Marcus and Grace have never been selected once.** Five
 * of eight. They have prompts, they hold 15-16 tools each in `staff_tools`, and
 * no job has ever gone to any of them. `delegation_depth` is 0 on every row, so
 * nothing has ever handed work onward either.
 *
 * ## The two hypotheses this settles
 *
 * Both explain the ledger and they demand opposite fixes:
 *
 *   1. **Demand.** Grant asks questions, and a question is the shape Claire or
 *      Emma absorbs alone. Nobody has asked a finance question, so Daniel has
 *      never been needed. Nothing to fix — but prove it.
 *   2. **The router cannot reach them.** A finance question arrives and Emma
 *      takes it anyway, and every specialist the office has is dead weight.
 *
 * Reading the router cannot tell these apart. Asking it can.
 *
 * ## How it asks
 *
 * Eight instructions, each shaped so a person would obviously route it to one
 * specific member of the team, injected through `inbound_commands` — the one
 * canonical door (§5), the same one Telegram and Slack write to.
 *
 * Then it reads `routing_decisions.roster`, not the answer text. Output
 * attribution is not proof of delegation, which is the whole reason
 * `verify:handoff` exists.
 *
 * ## It cannot message Grant, and that is enforced rather than hoped
 *
 * `jobs.announce` DEFAULTS TO TRUE, so an enqueued instruction would reach him
 * on Telegram. The enqueue and the `announce = false` happen in ONE statement,
 * so the worker — which ticks every minute — cannot see the job until the
 * transaction commits with the flag already down. Setting it afterwards would
 * be a race with a sixty-second window against Grant's actual phone.
 *
 * The actor is `verify-roster-…`, so `requested_by` is `teamhq:verify-roster-…`,
 * which matches the `%:verify-%` branch of `jobs.is_fixture` (0342) — this
 * traffic cannot reach his health readings.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const ACTOR = `verify-roster-${run}`

/**
 * One ask per person, each written the way Grant writes.
 *
 * `wants` is who a person would send it to, and it is a JUDGEMENT rather than a
 * contract — the office may have a defensible reason to route differently, and
 * a suite that failed on every disagreement would be asserting my opinion of
 * the roster. What is ASSERTED further down is the property: that the office
 * can reach more than the three it has ever used. The mapping is printed so a
 * person can judge the rest.
 */
const ASKS: ReadonlyArray<{ readonly wants: string; readonly ask: string }> = [
  {
    wants: 'finance-director',
    ask: 'If we drop the middle tier price by fifteen percent, what does that do to our gross margin and how many extra sales would we need to stand still?',
  },
  {
    wants: 'growth-director',
    ask: 'Which acquisition channel should we be doubling down on for the coaching course, and which one should we stop spending on?',
  },
  {
    wants: 'operations-director',
    ask: 'Our onboarding takes eleven days and it should take three. Where is the bottleneck and what would you cut first?',
  },
  {
    wants: 'communications-director',
    ask: 'Draft the announcement for the pricing change. Confident, not apologetic, and short enough to read on a phone.',
  },
  {
    wants: 'quality-director',
    ask: 'What could go wrong if we ship the payment change on a Friday afternoon, and what would you want in place before we did?',
  },
  {
    wants: 'research-director',
    ask: 'Find out what the three biggest competitors are charging for equivalent coaching and how they package it.',
  },
  {
    wants: 'strategy-director',
    ask: 'Should we go after the enterprise market next year or stay where we are with smaller customers? Make the case either way.',
  },
  {
    wants: 'chief-of-staff',
    ask: 'What is on my plate this week, and what should I be worrying about that I probably am not?',
  },
]

console.log(`\nverify:roster — can the office reach all eight? (${ACTOR})\n`)

/*
  A fixture project to hang the asks on. `inbound_commands.project_id` is NOT
  NULL, and using a real one would file eight probe jobs against Grant's work.
  Paused rather than active: ADR-0014 refuses an active project with no enabled
  attachment.
*/
const project = await one(`
  insert into public.projects (name, slug, status)
  values (${lit(`Fixture roster probe ${run}`)}, ${lit(`fixture-roster-${run}`)}, 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)

/*
  Enqueue and silence in ONE statement. See the header: announce defaults to
  true and the worker ticks every minute, so doing this in two statements is a
  race against Grant's phone.
*/
const jobs: { wants: string; jobId: string }[] = []
for (const [i, a] of ASKS.entries()) {
  /*
    A real transaction, not a CTE.

    The first draft did the insert, the enqueue and the silencing as three CTEs
    in one statement, and every job came back null: a data-modifying CTE is NOT
    visible to its siblings, so `enqueue_inbound` looked for the command row and
    found nothing. Statements inside a transaction do see each other, and the
    transaction is what gives the same guarantee the CTE was for — the worker
    cannot see the job until commit, by which time announce is already down.
  */
  const key = `teamhq:roster_probe:${run}-${String(i)}`
  const row = await one(`
    begin;
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
    values ('teamhq', ${lit(`roster-${run}`)}, ${lit(ACTOR)}, ${lit(a.ask)},
            ${lit(key)}, app.now_utc(), ${lit(projectId)}::uuid);
    create temp table _j as
      select (app.enqueue_inbound(
                (select command_id from public.inbound_commands where dedupe_key = ${lit(key)})
              ) ->> 'job_id')::uuid as id;
    update public.jobs set announce = false where job_id = (select id from _j);
    select (select id from _j)::text as id;
    commit;`)
  jobs.push({ wants: a.wants, jobId: String(row.id) })
  console.log(`       queued for ${a.wants}: ${String(row.id).slice(0, 8)}`)
}

ok(
  'all eight asks became jobs through the canonical inbound path',
  jobs.every((j) => j.jobId !== 'null' && j.jobId !== ''),
  `${String(jobs.filter((j) => j.jobId !== 'null').length)}/8 enqueued`,
)

/*
  And the safety property, asserted rather than trusted. If any of these is
  still announce = true, this suite is one worker tick from messaging Grant
  eight times.
*/
const loud = await one(`
  select count(*)::int as n from public.jobs
   where job_id = any(array[${jobs.map((j) => `${lit(j.jobId)}::uuid`).join(',')}])
     and announce`)
ok(
  'none of them can announce — this suite cannot message Grant',
  Number(loud.n) === 0,
  `${String(loud.n)} job(s) still announcing`,
)

const fixtures = await one(`
  select count(*)::int as n from public.jobs
   where job_id = any(array[${jobs.map((j) => `${lit(j.jobId)}::uuid`).join(',')}])
     and app.harness_job(job_id)`)
ok(
  'and all eight read as harness traffic, so they cannot reach his health readings',
  Number(fixtures.n) === jobs.length,
  `${String(fixtures.n)}/${String(jobs.length)}`,
)

/*
  Wait for the worker. It ticks every minute on pg_cron, so this is exercising
  the real path rather than driving the handler directly — which matters,
  because the question is what the OFFICE does, not what a function does.
*/
const DEADLINE_MS = 12 * 60 * 1000
const started = Date.now()
let decided = 0
process.stdout.write('\n       waiting for the worker')
while (Date.now() - started < DEADLINE_MS) {
  const seen = await one(`
    select count(*)::int as n from public.routing_decisions
     where job_id = any(array[${jobs.map((j) => `${lit(j.jobId)}::uuid`).join(',')}])`)
  decided = Number(seen.n)
  if (decided >= jobs.length) break
  process.stdout.write('.')
  await new Promise((r) => setTimeout(r, 15_000))
}
console.log(
  `\n       ${String(decided)}/${String(jobs.length)} routed after ${String(Math.round((Date.now() - started) / 1000))}s\n`,
)

ok(
  'the worker picked them up and routed them',
  decided > 0,
  `${String(decided)} of ${String(jobs.length)} have a routing decision`,
)

const decisions = await all(`
  select j.job_id::text as id,
         coalesce(array_to_string(r.roster, ','), '(none)') as roster,
         coalesce(r.intent_class, '?') as intent,
         coalesce(left(r.roster_reason, 72), '') as why,
         j.state::text as state
    from public.jobs j
    left join public.routing_decisions r on r.job_id = j.job_id
   where j.job_id = any(array[${jobs.map((j) => `${lit(j.jobId)}::uuid`).join(',')}])`)

const byId = new Map(decisions.map((d) => [String(d.id), d]))
console.log('| asked for | chosen | intent | state |')
console.log('|---|---|---|---|')
const chosen = new Set<string>()
for (const j of jobs) {
  const d = byId.get(j.jobId)
  const got = String(d?.roster ?? '(not routed)')
  for (const who of got.split(',')) if (who !== '' && who !== '(none)') chosen.add(who)
  const mark = got === j.wants ? '' : got.includes(j.wants) ? ' (+others)' : ' ←'
  console.log(
    `| ${j.wants} | ${got}${mark} | ${String(d?.intent ?? '?')} | ${String(d?.state ?? '?')} |`,
  )
}

/*
  THE QUESTION. Not "was each ask routed to the person I would have picked" —
  that is my opinion of the roster and the office may have a better one. The
  question is whether the office CAN reach the five it never has.
*/
const NEVER_USED = [
  'finance-director',
  'growth-director',
  'operations-director',
  'communications-director',
  'quality-director',
]
const reached = NEVER_USED.filter((who) => chosen.has(who))
ok(
  'at least one specialist the office has NEVER used is reachable',
  reached.length > 0,
  reached.length > 0
    ? `reached: ${reached.join(', ')}`
    : 'NONE of the five was chosen, by any of five asks written for them — the router cannot reach them',
)

console.log(
  `\n       distinct people chosen across eight asks: ${chosen.size === 0 ? 'none' : [...chosen].sort().join(', ')}`,
)
ok(
  'the office reaches more than the three it has used in its whole history',
  chosen.size > 3,
  `${String(chosen.size)} distinct`,
)

// ---------------------------------------------------------------------------
console.log('\nteardown')
// ---------------------------------------------------------------------------

await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:roster probe, cancelled in teardown'
   where job_id = any(array[${jobs.map((j) => `${lit(j.jobId)}::uuid`).join(',')}])
     and state not in ('complete','cancelled','failed','committing','committed','notifying')`)
await db.execute(
  `delete from public.inbound_commands where actor = ${lit(ACTOR)} and job_id is null`,
)
await db.execute(
  `update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid`,
)

/*
  The project cannot be DELETED — it now holds eight jobs, and a job can never
  be removed because job_state_transitions is append-only. Archived is the
  correct end state, and `fixture-` named so purge:fixtures can account for it.
  Asserting that rather than pretending the row is gone.
*/
const left = await one(`
  select status::text as status,
         (select count(*)::int from public.jobs where project_id = ${lit(projectId)}::uuid) as jobs
    from public.projects where project_id = ${lit(projectId)}::uuid`)
ok(
  'the probe project is archived and out of the project list',
  left.status === 'archived',
  `status=${String(left.status)}, holds ${String(left.jobs)} job(s) so it cannot be deleted`,
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
