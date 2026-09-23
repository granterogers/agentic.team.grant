/**
 * What the office actually does, measured from canonical state.
 *
 *   npm run measure                 # print, and append to the durable record
 *   npm run measure -- --label x    # name this snapshot
 *   npm run measure -- --compare    # this snapshot against the previous one
 *
 * Issue #176 (workstream I of #231). Grant's requirement, verbatim:
 *
 *   > The system must distinguish "this mechanism works when a test forces it"
 *   > from "the office actually uses this mechanism appropriately."
 *
 * Every number here is the second kind. Nothing in this file runs a suite or
 * asks whether a mechanism exists; it reads what happened.
 *
 * ## Why it exists at all
 *
 * On 14 September, five of eight agents turned out never to have been selected
 * once in 505 routing decisions, and `delegation_depth` was 0 throughout.
 * Nobody knew. It was found by hand-querying `routing_decisions` because Grant
 * asked a direct question. **The measurement in this file is what would have
 * surfaced that without anybody asking**, and its absence is why a defect sat
 * in the commonest code path in the office for months.
 *
 * ## Harness traffic is separated, never mixed
 *
 * `app.harness_job` decides. CLAUDE.md records three separate occasions when
 * test traffic was about to be reported to Grant as the office collapsing, so
 * every count here is reported twice — real, and harness — and the real number
 * is the one that means anything about the office.
 *
 * ## Appended, never overwritten
 *
 * `.out/measurements.jsonl`, one line per snapshot. A single-snapshot file
 * cannot answer "is this better than yesterday", which is the only question a
 * measurement is for. Same reasoning as `.out/e2e-history.jsonl` (#226).
 */

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import type { SqlExecutor } from '../src/db/executor.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const RECORD = '.out/measurements.jsonl'
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? undefined : argv[i + 1]
}

const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

/* Real work only. Everything this file reports about the office excludes the harness. */
const REAL = 'not app.harness_job(j.job_id)'

const depth = await all(`
  select coalesce(r.delegation_depth, -1)::int as depth,
         count(*) filter (where ${REAL})::int as real_n
    from public.routing_decisions r
    join public.jobs j on j.job_id = r.job_id
   group by 1 order by 1`)

/*
  FANNING WORK OUT, which is a different thing from handing it ON.

  The block below reported `routing_decisions.delegation_depth` under the
  heading "delegation", and that number is ACCURATE and means something much
  narrower than the heading: a routing decision exists only for an
  `office.instruction` job, so depth counts one specialist passing an
  INSTRUCTION to another (#128's hand-off). Real traffic: 2, ever.

  What the office actually does constantly is fan a plan out into capability
  jobs — `office.execute_plan`, `notebook.collect`, `artifact.report`. Real
  traffic: **30 parents, 56 children, every one of them complete**, and none
  of it visible here. CLAUDE.md's own headline, "delegation_depth 0 across
  every real job", has been read for weeks as "the office never delegates".

  So both are reported, each named for what it is. The numbers are not
  changed; the missing one is added and the ambiguous heading is retired.
*/
const fanout = await one(`
  select count(*) filter (where ${REAL})::int as children,
         count(distinct case when ${REAL} then j.parent_job_id end)::int as parents,
         count(*) filter (where ${REAL} and j.state = 'complete')::int as finished,
         count(*) filter (where ${REAL} and j.state in ('failed', 'cancelled'))::int as failed
    from public.jobs j
   where j.parent_job_id is not null`)

const intents = await all(`
  select coalesce(r.intent_class, '(none)') as intent,
         count(*) filter (where ${REAL})::int as real_n
    from public.routing_decisions r
    join public.jobs j on j.job_id = r.job_id
   group by 1 order by 2 desc`)

const staff = await all(`
  select s.slug,
         (select count(*)::int from public.routing_decisions r
            join public.jobs j on j.job_id = r.job_id
           where s.slug = any(r.roster) and ${REAL}) as chosen_real,
         (select count(*)::int from public.staff_tools t where t.staff_slug = s.slug) as tools
    from public.staff s where s.active order by s.slug`)

const totals = await one(`
  /*
    REAL consultations, which this was not.

    Every other number in this file is filtered by app.harness_job — the
    header says so and says why, three times over — and this one counted the
    whole table. 2,110 against 20 real ones, divided by a REAL instruction
    count, which printed "consultation rate 854.3% of real instructions": a
    percentage with a harness numerator and a real denominator, in the file
    written to stop harness traffic being reported as the office's behaviour.

    No backticks in this comment: it lives inside a template literal.
  */
  select (select count(*)::int from public.consultations c
           where not app.harness_job(c.job_id)) as consultations,
         (select count(*)::int from public.job_traces) as traces,
         (select count(*)::int from public.outputs) as outputs,
         (select count(*)::int from public.jobs j where ${REAL}) as real_jobs,
         (select count(*)::int from public.jobs j where not (${REAL})) as harness_jobs,
         (select count(*)::int from public.jobs j
           where ${REAL} and j.state = 'failed') as real_failed,
         (select count(*)::int from public.jobs j
           where ${REAL} and j.kind = 'office.instruction') as real_instructions`)

const latency = await one(`
  select count(*)::int as n,
         round(percentile_cont(0.5) within group (order by s))::int as median_s,
         round(percentile_cont(0.95) within group (order by s))::int as p95_s,
         round(max(s))::int as worst_s,
         round(percentile_cont(0.5) within group (order by wait_s))::int as median_wait_s,
         round(max(wait_s))::int as worst_wait_s
    from (
      select extract(epoch from (j.finished_at - j.created_at)) as s,
             extract(epoch from (coalesce(j.started_at, j.finished_at) - j.created_at)) as wait_s
        from public.jobs j
       where j.kind = 'office.instruction' and j.state = 'complete' and ${REAL}
         and j.created_at > app.now_utc() - interval '14 days') z`)

const queue = await one(`
  select count(*)::int as waiting,
         coalesce(round(max(extract(epoch from (app.now_utc() - j.created_at)) / 60))::int, 0) as oldest_min
    from public.jobs j where j.state in ('queued','retrying') and ${REAL}`)

/*
  WHICH GATE STOPPED AN ANSWER, counted by the thing that recorded it (#345).

  This line used to read `kind = 'missing_data'` under the label "the
  anti-hallucination gate firing", and reported **0** for the life of the
  measure. No gate in `src/jobs/worker.ts` has ever written `missing_data`:
  all four write `not_capable` and distinguish themselves by `noticed_by`.
  `missing_data` holds 112 rows, none of them real, so the number was zero by
  construction and read as an office that never hallucinates. The truth on
  real traffic is 8 refusals by the quality gate and 46 by the output
  constraints - 54 turns where Grant asked and a gate stopped the answer.

  Counted by `noticed_by` rather than by `kind`, because `kind` is the
  vocabulary of what was MISSING and `noticed_by` is the gate itself. The
  four markers come from the four `app.cannot` call sites in `worker.ts`.

  It is printed as a LIST rather than one number: a line that can only be a
  single hardcoded category is a line that goes silently to zero the next time
  a gate is added or renamed, which is exactly what happened here.
*/
const gates = await all(`
  select coalesce(nullif(btrim(i.noticed_by), ''), 'unattributed') as noticed_by,
         (j.kind = 'office.instruction') as his_turn,
         count(*)::int as n
    from public.job_impediments i
    join public.jobs j on j.job_id = i.job_id
   where ${REAL} and not coalesce(i.is_fixture, false)
   group by 1, 2 order by n desc`)

const reachable = staff.filter((s) => Number(s.chosen_real) > 0)
const dormant = staff.filter((s) => Number(s.chosen_real) === 0)
const maxDepth = Math.max(...depth.map((d) => Number(d.depth)), -1)
const delegated = depth.filter((d) => Number(d.depth) > 0).reduce((a, d) => a + Number(d.real_n), 0)

const snapshot = {
  at: new Date().toISOString(),
  label: flag('label') ?? 'unlabelled',
  agentsActive: staff.length,
  agentsEverChosen: reachable.length,
  dormant: dormant.map((s) => String(s.slug)),
  selection: Object.fromEntries(staff.map((s) => [String(s.slug), Number(s.chosen_real)])),
  maxDelegationDepth: maxDepth,
  delegatedDecisions: delegated,
  consultations: Number(totals.consultations),
  realJobs: Number(totals.real_jobs),
  harnessJobs: Number(totals.harness_jobs),
  realFailed: Number(totals.real_failed),
  realInstructions: Number(totals.real_instructions),
  outputs: Number(totals.outputs),
  traces: Number(totals.traces),
  gateRefusals: Object.fromEntries(gates.map((g) => [String(g.noticed_by), Number(g.n)])),
  medianSeconds: Number(latency.median_s ?? 0),
  p95Seconds: Number(latency.p95_s ?? 0),
  worstSeconds: Number(latency.worst_s ?? 0),
  medianWaitSeconds: Number(latency.median_wait_s ?? 0),
  worstWaitSeconds: Number(latency.worst_wait_s ?? 0),
  queueWaiting: Number(queue.waiting),
  queueOldestMin: Number(queue.oldest_min),
}

console.log(`\noffice measurements — ${snapshot.label} — ${snapshot.at.slice(0, 19)}\n`)

console.log('who the office actually chooses (real traffic only)')
for (const s of staff) {
  const n = Number(s.chosen_real)
  console.log(
    `  ${String(s.slug).padEnd(24)} ${String(n).padStart(5)}  ${n === 0 ? 'NEVER CHOSEN' : '█'.repeat(Math.min(40, Math.ceil(n / 8)))}  (${String(s.tools)} tools)`,
  )
}
console.log(
  `\n  ${String(reachable.length)}/${String(staff.length)} agents have ever been chosen` +
    (dormant.length === 0 ? '' : ` — dormant: ${dormant.map((s) => String(s.slug)).join(', ')}`),
)

console.log('\nwork the office fanned out (real)')
console.log(`  parent jobs               ${String(Number(fanout.parents ?? 0))}`)
console.log(`  child jobs                ${String(Number(fanout.children ?? 0))}`)
console.log(
  `  of those, finished        ${String(Number(fanout.finished ?? 0))}` +
    `${Number(fanout.failed ?? 0) > 0 ? `  (${String(Number(fanout.failed ?? 0))} failed or cancelled)` : ''}`,
)

console.log('\nwork one specialist handed to another (real)')
console.log(`  max depth observed        ${String(maxDepth)}`)
console.log(`  decisions with depth > 0  ${String(delegated)}`)
console.log(`  consultations             ${String(snapshot.consultations)}`)
console.log(
  `  consultation rate         ${snapshot.realInstructions === 0 ? 'n/a' : `${((snapshot.consultations / snapshot.realInstructions) * 100).toFixed(1)}% of real instructions`}`,
)

console.log('\nintent classes (real)')
for (const i of intents) console.log(`  ${String(i.intent).padEnd(20)} ${String(i.real_n)}`)

console.log('\nlatency of a real instruction, last 14 days')
console.log(`  completed          ${String(latency.n)}`)
console.log(`  median             ${String(snapshot.medianSeconds)}s`)
console.log(`  p95                ${String(snapshot.p95Seconds)}s`)
console.log(`  worst              ${String(snapshot.worstSeconds)}s`)
console.log(`  median queue wait  ${String(snapshot.medianWaitSeconds)}s`)
console.log(`  worst queue wait   ${String(snapshot.worstWaitSeconds)}s`)

console.log('\nthe office now')
console.log(
  `  real jobs          ${String(snapshot.realJobs)} (${String(snapshot.realFailed)} failed)`,
)
console.log(`  harness jobs       ${String(snapshot.harnessJobs)} — never mixed into the above`)
console.log(
  `  queue waiting      ${String(snapshot.queueWaiting)}, oldest ${String(snapshot.queueOldestMin)}m`,
)
/*
  Named, and never a bare zero.

  `npm run space` already learned this the hard way: a measure whose selector
  matches nothing prints a number that reads as health. So when there is
  genuinely nothing to report this says so in words.
*/
console.log('\nwhen a gate stopped an answer (real)')
if (gates.length === 0) {
  console.log('  NO IMPEDIMENTS FOUND — check the query before reading this as a quiet office')
} else {
  /*
    WHOSE turn, which the first version of this line did not say.

    0574 reclassified 35 suite turns as harness and the quality gate's eight
    refusals went with them - they were never his. What is left is 46, and
    every one is a DUTY, from the three days the provenance-order defect was
    live. "A gate stopped an answer" and "a gate stopped an answer OF HIS" are
    different claims and the first was being made in the second's words.
  */
  for (const g of gates) {
    console.log(
      `  ${String(g.noticed_by).padEnd(24)}${String(g.n).padEnd(5)}` +
        `${g.his_turn === true ? 'a turn of his' : 'a duty'}`,
    )
  }
}

await mkdir('.out', { recursive: true })
await appendFile(RECORD, `${JSON.stringify(snapshot)}\n`)

if (argv.includes('--compare') && existsSync(RECORD)) {
  const lines = (await readFile(RECORD, 'utf8')).trim().split('\n')
  const prev =
    lines.length >= 2 ? (JSON.parse(lines[lines.length - 2] ?? '{}') as typeof snapshot) : null
  if (prev !== null) {
    console.log(`\nagainst "${prev.label}" (${prev.at.slice(0, 19)})`)
    const rows: [string, number, number][] = [
      ['agents ever chosen', prev.agentsEverChosen, snapshot.agentsEverChosen],
      ['max delegation depth', prev.maxDelegationDepth, snapshot.maxDelegationDepth],
      ['consultations', prev.consultations, snapshot.consultations],
      ['real jobs', prev.realJobs, snapshot.realJobs],
      /*
        The quality gate specifically, because that is the one the old
        `evidence blocks` line CLAIMED to be reporting. A comparison against a
        snapshot written before this fix finds no such key and reads 0 for the
        earlier side, which is honest: the old measure genuinely did not know.
      */
      [
        'quality-gate refusals',
        Number(prev.gateRefusals?.['the quality gate'] ?? 0),
        Number(snapshot.gateRefusals['the quality gate'] ?? 0),
      ],
      ['median seconds', prev.medianSeconds, snapshot.medianSeconds],
    ]
    for (const [what, was, now] of rows) {
      const d = now - was
      console.log(
        `  ${what.padEnd(24)} ${String(was).padStart(6)} -> ${String(now).padStart(6)}  ${d === 0 ? '' : d > 0 ? `+${String(d)}` : String(d)}`,
      )
    }
  }
}
console.log(`\nappended to ${RECORD}`)
