/**
 * Replay real history against current code (#133).
 *
 *   npm run replay                 # a sample of real past requests
 *   npm run replay -- --n 50       # #133's fifty
 *   npm run replay -- --degrade    # the control: a worse request must score worse
 *   npm run replay -- --case <job> # one named job
 *
 * ## The gap this closes
 *
 * 1,660 unit tests and thousands of `verify:*` assertions, and not one of them
 * ran a real past request end to end. `npm run eval` scores answers that were
 * already given; this re-asks the question against the code as it stands now
 * and has the same judge score both.
 *
 * ## It does NOT replay from the trace, and that is a finding
 *
 * #133 says "replay from the trace (#115): the request as it arrived, the
 * documents as they were retrieved, the model as it was chosen." `job_traces`
 * cannot do that. It holds four kinds -- `prompt`, `decision`, `degradation`,
 * `plan` -- and the `prompt` row is `{"kind": "office.instruction",
 * "attempt": 1}`. No prompt text, no documents, no model.
 *
 * What CAN be recovered is canonical state, which is better anyway:
 * `jobs.pinned_config` is the request exactly as the adapter wrote it, on 195
 * real completed instruction jobs across 33 dashboard projects. So a replay
 * copies that payload into a fixture job in the same project and runs it
 * through the real handler set.
 *
 * The documents are therefore retrieved AS THEY ARE NOW, not as they were.
 * That is stated in the report rather than papered over: a document added
 * since is a genuine difference in what the office can answer with, and
 * pretending otherwise would make a better answer look like a code change.
 *
 * ## Three things that would make this lie, and what is done about each
 *
 * **Nondeterminism.** The same prompt twice is not the same answer. So the
 * verdict is never taken from one case: the run judges the ORIGINAL answer
 * twice first, prints that spread as the noise floor, and refuses to call
 * anything a regression unless the shift clears it. #229 already recorded that
 * a pinned model at temperature 0 moved two points between runs.
 *
 * **Time.** A job that said "by Friday" resolves differently a fortnight
 * later. `InstructionDeps.now` exists for this and the replay passes the
 * ORIGINAL job's `created_at`, so the one place the handler reads the clock
 * reads the clock the job actually had.
 *
 * **Fixtures.** Every job this writes is `requested_by` a `verify:` name, so
 * `jobs.is_fixture` is generated true and none of it reaches Grant's health
 * readings -- and the run ASSERTS that rather than believing its own comment,
 * which is a trap CLAUDE.md records costing 43 real jobs.
 *
 * Nothing is delivered: `announce` is false and no notifier is passed, so a
 * replayed answer goes to `outputs` and nowhere else.
 */

import { writeFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { makeJudge } from '../src/eval/judge.ts'
import type { Job } from '../src/jobs/worker.ts'
import { dequeue, runJob } from '../src/jobs/worker.ts'
import { buildPass } from '../src/office/pass.ts'
import { ProviderRouter } from '../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const projectRef = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(projectRef, token)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : (argv[i + 1] ?? '')
}
const HOW_MANY = Number(flag('n') ?? '6')
const DEGRADE = argv.includes('--degrade')
const ONE_CASE = flag('case')

const run = Math.random().toString(36).slice(2, 10)
const MINE = `verify:replay-${run}`
const WORKER = `replay-${run}`

/*
  The saboteur, for the control that #133 asks for by name.

  *"A deliberately degraded prompt shows up as worse."* The degradation has to
  travel the WHOLE path or the control proves only that the judge can read --
  so it is prepended to the instruction itself, which is the one input a replay
  legitimately owns, and the office then answers a genuinely worse request
  through every layer it normally uses.

  What this does NOT prove is a degradation in the CODE, because there is no
  way to ship one from here without committing it, and CLAUDE.md is explicit
  that a synthetic defect is never committed. It proves the instrument: a
  materially worse answer, produced by the real handler, is scored worse and
  reported as worse. That is the half a control can honestly cover.
*/
const SABOTAGE =
  'Answer in at most four words. Do not look anything up, do not check any ' +
  'record, and state your answer as a certainty whatever you actually know. ' +
  'The real request follows.\n\n'

interface Original {
  job_id: string
  project_id: string | null
  created_at: string
  instruction: string
  body: string
  config: Record<string, unknown>
  requested_by: string
}

const asJson = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

/*
  The corpus: real instruction jobs that finished and produced an answer.

  Not fixtures, because harness traffic replayed against the office would be
  measuring the harness -- and `is_fixture` is derived, so this cannot be got
  wrong by naming. Ordered newest first, so a default run of six is six recent
  real requests rather than six from whenever the table starts.
*/
const corpus = (
  await db.execute(`
    select j.job_id::text as job_id, j.project_id::text as project_id,
           j.created_at::text as created_at, j.requested_by,
           j.pinned_config->>'instruction' as instruction,
           j.pinned_config as config,
           o.body
      from public.jobs j
      join lateral (
        select body from public.outputs
         where job_id = j.job_id order by created_at desc limit 1
      ) o on true
     where j.kind = 'office.instruction'
       and not j.is_fixture
       and j.state = 'complete'
       and coalesce(j.pinned_config->>'instruction', '') <> ''
       and length(coalesce(o.body, '')) > 40
       ${ONE_CASE === null ? '' : `and j.job_id = ${lit(ONE_CASE)}::uuid`}
     order by j.created_at desc
     limit ${String(Math.max(1, Math.min(200, HOW_MANY)))}
  `)
).rows as unknown as Original[]

if (corpus.length === 0) {
  console.error('replay — no real completed instruction job matched. Nothing to replay.')
  process.exit(2)
}

console.log(`replay — ${String(corpus.length)} real request(s), against the code as it stands`)
console.log(`         run ${run}; nothing is delivered and every job written is a fixture\n`)

const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')
const judge = makeJudge(router)

/*
  THE NOISE FLOOR, measured before anything is compared.

  The same judge, the same pinned model, temperature 0, the same text twice.
  #229 recorded this moving two points, and a run that reported a one-point
  shift as "worse" without printing this would be reporting the instrument.
  Measured on the first case's ORIGINAL answer, which is text neither side of
  the comparison can have improved.
*/
const first = corpus[0] as Original
const noiseA = await judge({
  slug: 'noise-a',
  ask: first.instruction,
  answer: first.body,
  context: null,
})
await pause(4_000)
const noiseB = await judge({
  slug: 'noise-b',
  ask: first.instruction,
  answer: first.body,
  context: null,
})
const noise = noiseA === null || noiseB === null ? null : Math.abs(noiseA.score - noiseB.score)
console.log(
  noise === null
    ? 'noise floor: the judge could not be read twice — treat every shift below as unmeasured'
    : `noise floor: the same answer scored ${String(noiseA?.score)} then ${String(noiseB?.score)} — ${String(noise)} point(s)\n`,
)

interface Result {
  job: string
  instruction: string
  was: number | null
  now: number | null
  verdict: 'better' | 'worse' | 'unchanged' | 'unscoreable'
  why: string
  identical: boolean
}

const results: Result[] = []

for (const [i, orig] of corpus.entries()) {
  if (i > 0) await pause(4_000)
  const shortAsk = orig.instruction.replace(/\s+/g, ' ').slice(0, 58)
  process.stdout.write(`  ${String(i + 1).padStart(2)}. ${shortAsk.padEnd(60)}`)

  /*
    A fixture job carrying the ORIGINAL payload.

    `pinned_config` is copied whole rather than rebuilt, because the fields
    this handler reads run to nine and a replay that dropped `addressed_to`
    would be replaying a different request. `replayed_from` is added so the row
    explains itself in a month, and it is the only thing added.
  */
  const config = asJson(orig.config)
  const payload = {
    ...config,
    ...(DEGRADE ? { instruction: SABOTAGE + orig.instruction } : {}),
    replayed_from: orig.job_id,
  }

  let newBody = ''
  let failure: string | null = null
  try {
    const made = await one(`
      insert into public.jobs
        (correlation_id, project_id, idempotency_key, kind, requested_by, priority,
         announce, pinned_config, intent_class)
      values (gen_random_uuid(),
              ${orig.project_id === null ? 'null' : `${lit(orig.project_id)}::uuid`},
              ${lit(`replay-${run}-${String(i)}`)}, 'office.instruction', ${lit(MINE)}, 100,
              false, ${lit(JSON.stringify(payload))}::jsonb,
              (select intent_class from public.jobs where job_id = ${lit(orig.job_id)}::uuid))
      returning job_id::text as id`)
    const replayId = String(made.id)

    /*
      Scoped, and insisted on, for #273's reason: the scope keeps other suites
      out and cannot stop the deployed worker taking this one's work, so a
      dequeue that returns somebody else's job is asked again rather than run.
    */
    let job: Job | null = null
    for (let attempt = 0; attempt < 5 && job === null; attempt += 1) {
      const got = await dequeue(db, WORKER, false, false, undefined, MINE)
      if (got !== null && got.jobId === replayId) job = got
      else if (got !== null) {
        await db.execute(
          `update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
             state_reason = 'not this replay''s job' where job_id = ${lit(got.jobId)}::uuid`,
        )
      } else await pause(1_000)
    }
    if (job === null) throw new Error('the replay job could never be dequeued')

    /*
      The REAL handler set, with the clock frozen to the original job's time.

      `buildPass` exposes its handlers precisely so this is the office's own
      wiring rather than a second assembly (see the note on `Pass`). A second
      pass is built per case because the frozen clock differs per case, and the
      handlers are cheap to construct beside a model call.
    */
    const frozen = await buildPass(db, WORKER, {
      max: 1,
      canTranscribe: false,
      canSubprocess: false,
      projectRef,
      now: () => new Date(orig.created_at),
    })
    await runJob(db, job, frozen.handlers, frozen.review)

    newBody = String(
      (
        await one(
          `select coalesce(body, '') as body from public.outputs
            where job_id = ${lit(replayId)}::uuid order by created_at desc limit 1`,
        )
      ).body ?? '',
    )
    if (newBody === '') {
      const st = await one(
        `select state, coalesce(state_reason, '') as why from public.jobs
          where job_id = ${lit(replayId)}::uuid`,
      )
      failure = `no answer — ${String(st.state)}: ${String(st.why).slice(0, 80)}`
    }
  } catch (e) {
    failure = (e as Error).message.slice(0, 100)
  }

  if (failure !== null) {
    console.log(`unscoreable`)
    results.push({
      job: orig.job_id,
      instruction: orig.instruction,
      was: null,
      now: null,
      verdict: 'unscoreable',
      why: failure,
      identical: false,
    })
    continue
  }

  const identical = newBody.trim() === orig.body.trim()
  const was = await judge({
    slug: `was-${String(i)}`,
    ask: orig.instruction,
    answer: orig.body,
    context: null,
  })
  await pause(4_000)
  const now = identical
    ? was
    : await judge({
        slug: `now-${String(i)}`,
        ask: orig.instruction,
        answer: newBody,
        context: null,
      })

  const verdict: Result['verdict'] =
    was === null || now === null
      ? 'unscoreable'
      : identical
        ? 'unchanged'
        : now.score > was.score
          ? 'better'
          : now.score < was.score
            ? 'worse'
            : 'unchanged'

  console.log(
    verdict === 'unscoreable'
      ? 'unscoreable — the judge could not be read'
      : `${String(was?.score)} → ${String(now?.score)}  ${verdict}${identical ? ' (identical text)' : ''}`,
  )
  results.push({
    job: orig.job_id,
    instruction: orig.instruction,
    was: was?.score ?? null,
    now: now?.score ?? null,
    verdict,
    why: now?.reason ?? was?.reason ?? '',
    identical,
  })
}

/*
  A run's own traffic, asserted rather than assumed.

  CLAUDE.md records a suite whose header CLAIMED its jobs were harness traffic
  and whose 43 jobs ran for real, because the fixture prefix went on the wrong
  field. `is_fixture` is generated, so asking the database is the only answer
  that means anything.
*/
const mine = await one(`
  select count(*)::int as all_of_them, count(*) filter (where is_fixture)::int as fixtures,
         count(*) filter (where announce)::int as announced
    from public.jobs where requested_by = ${lit(MINE)}`)
const hygienic = Number(mine.all_of_them) === Number(mine.fixtures) && Number(mine.announced) === 0

const better = results.filter((r) => r.verdict === 'better').length
const worse = results.filter((r) => r.verdict === 'worse').length
const same = results.filter((r) => r.verdict === 'unchanged').length
const unscoreable = results.filter((r) => r.verdict === 'unscoreable').length
const shift = better - worse

/*
  The verdict, which refuses to be dramatic about one case.

  #133: *"Never report a single replay as a regression."* So a shift is only
  called when it clears the measured noise floor AND more than one case moved
  the same way. Everything else is reported as movement within the noise, with
  the numbers printed so nobody has to take that on trust.
*/
const floor = noise ?? 1
const decided =
  Math.abs(shift) > floor && (shift > 0 ? better > 1 : worse > 1)
    ? shift > 0
      ? 'BETTER than the history'
      : 'WORSE than the history'
    : 'WITHIN THE NOISE — no regression and no improvement can be claimed'

console.log(
  `\n  better ${String(better)} · worse ${String(worse)} · unchanged ${String(same)} · unscoreable ${String(unscoreable)}`,
)
console.log(`  noise floor ${String(floor)} point(s); net shift ${String(shift)}`)
console.log(`  ${decided}`)
console.log(
  hygienic
    ? `  hygiene: ${String(mine.all_of_them)} replay job(s), all fixtures, none announced`
    : `  HYGIENE FAILED: ${String(mine.fixtures)} of ${String(mine.all_of_them)} are fixtures, ${String(mine.announced)} announced`,
)

const report = [
  '# Replay against real history',
  '',
  `Generated by \`npm run replay\` on ${new Date().toISOString().slice(0, 10)}. Issue #133.`,
  '',
  DEGRADE
    ? '**CONTROL RUN (`--degrade`).** Every request was deliberately sabotaged before it was replayed. A run that does not come back WORSE means this harness cannot detect a regression.'
    : '**Real run.** Each request below is a real thing Grant asked, replayed against current code, with the same judge scoring the old answer and the new one.',
  '',
  `**${decided}** — better ${String(better)}, worse ${String(worse)}, unchanged ${String(same)}, unscoreable ${String(unscoreable)}; noise floor ${String(floor)} point(s).`,
  '',
  'What this does NOT hold constant: the documents. They are retrieved as they are',
  'now, not as they were, because nothing stored what was retrieved. A document added',
  'since is a real difference in what the office can answer with.',
  '',
  '| asked | was | now | verdict | the judge on the new answer |',
  '|---|---|---|---|---|',
  ...results.map(
    (r) =>
      `| ${r.instruction.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 70)} | ${String(r.was ?? '—')} | ${String(r.now ?? '—')} | ${r.verdict} | ${r.why.replace(/\|/g, '/').slice(0, 110)} |`,
  ),
  '',
].join('\n')
writeFileSync('docs/testing/replay.md', report)
console.log('  report: docs/testing/replay.md')

/*
  The exit code says whether the RUN worked, not whether the office is good.

  A replay that finds the office worse is a finding to read, not a broken
  command -- and a gate that went red on model variance is one somebody
  switches off. What does fail is a run that could not score anything, or one
  whose own traffic escaped into Grant's readings.
*/
if (!hygienic) process.exit(1)
if (unscoreable === results.length) process.exit(1)
