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
 * **Nondeterminism.** The same prompt twice is not the same answer, and the
 * JUDGE is not deterministic either -- the first build of this harness scored
 * each answer 1-5 and subtracted, and on one run the same text scored 1 and
 * then 5. Differencing two noisy numbers is noise, and the degradation control
 * proved it by coming back "better 1, worse 0" on a sabotaged set.
 *
 * So the judge compares the two answers DIRECTLY instead, blind, and is asked
 * twice with the sides exchanged. Agreement is the verdict; a reversal is
 * reported as unscoreable, which is #133's own third outcome. A direction is
 * only called when more than one case moved that way. And the run opens by
 * showing the judge one answer as BOTH sides: anything but a tie there is
 * position bias, and a run with it concludes nothing.
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

import '../src/safety/require-production-checks.ts'
import { writeFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { direction, makeComparer } from '../src/eval/judge.ts'
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
  /** For the written report, which must carry no message text. See REDACTION. */
  intent_class: string | null
  words: number
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
    select distinct on (btrim(lower(j.pinned_config->>'instruction')))
           j.job_id::text as job_id, j.project_id::text as project_id,
           j.created_at::text as created_at, j.requested_by,
           j.pinned_config->>'instruction' as instruction,
           j.pinned_config as config,
           j.intent_class,
           array_length(regexp_split_to_array(btrim(j.pinned_config->>'instruction'), '\\s+'), 1) as words,
           o.body
      from public.jobs j
      join lateral (
        select body from public.outputs
         where job_id = j.job_id order by created_at desc limit 1
      ) o on true
     where j.kind = 'office.instruction'
       /*
         THREE filters, because one of them was not enough and the first run
         proved it: a default replay picked a probe from an earlier session,
         "Asked nowhere in particular", and scored it as real history.

         No backticks anywhere in this comment. It is a SQL comment inside a JS
         template literal, and CLAUDE.md records that exact combination costing
         five separate sessions; it cost this one too, as three TS1005 errors
         pointing at the comment rather than at the string it ended.

         The is_fixture column is GENERATED from requested_by and cannot see a
         job whose PROJECT is a fixture -- 0355 wrote app.harness_job for
         exactly that, and it excludes 46 of the 195 rows this query first
         returned. A real request also came through a real surface, so the
         channel prefix is a second, independent witness; origin_channel is a
         closed vocabulary of four, so this cannot go stale the way a list of
         probe names would. Per 0304's asymmetry both filters can only ever
         EXCLUDE, which is the safe direction: dropping a real case costs one
         case, and keeping a probe measures the harness.
       */
       and not j.is_fixture
       and not app.harness_job(j.job_id)
       and (j.requested_by like 'telegram:%' or j.requested_by like 'voice:%'
            or j.requested_by like 'slack:%' or j.requested_by like 'teamhq:%')
       /*
         The third witness, and the only one that is not a naming convention:
         the answer was actually SENT to somebody.

         Chasing probe names one suite at a time failed three times in a row
         here -- verify:history, then verify:transport, then a second shape
         from the same suite -- because it is an enumeration of what harnesses
         happen to write today. Delivery is a property of the REQUEST instead:
         a person asked, the office answered, and the answer went to them
         through a channel. A harness almost never gets that far, and the two
         suites that deliberately do now name themselves (0460, 0463).

         It costs recall -- 148 candidates become 113 -- and the cases it drops
         are ones where the office answered and nothing was sent, which is
         exactly the population most likely to be a probe.
       */
       and exists (select 1 from public.deliveries d
                    where d.job_id = j.job_id and d.sent_at is not null)
       /*
         A fourth witness and a deduplication, both structural rather than a
         list of names.

         Every harness in this repository labels its run with
         Math.random().toString(36).slice(2, 10), so a trailing eight-character
         token after a space is the one CONVENTION shared by all of them --
         "transport proof s3e3hott", "Simultaneous probe rzjktst2". That is a
         property of how harnesses are written here, not of which harnesses
         exist, so it does not go stale when somebody writes the next one.

         And a harness repeats itself where a person does not: the
         cross-interface suite sends one identical sentence through all four
         surfaces, nine times each, which put eighteen copies of the same
         request into a corpus of a hundred. DISTINCT ON the text keeps the
         most recent of each, which both drops that and makes the sample
         broader, since a replay of the same sentence twenty times measures one
         thing twenty times.
       */
       and coalesce(j.pinned_config->>'instruction', '') !~ '\\s[a-z0-9]{8}$'
       and j.state = 'complete'
       and coalesce(j.pinned_config->>'instruction', '') <> ''
       and length(coalesce(o.body, '')) > ${DEGRADE ? '400' : '40'}
       /*
         The control needs cases where a degradation can SHOW.

         No backticks in this comment. It is a SQL comment inside a template
         literal, which is the trap CLAUDE.md records and which cost this file
         twice in one afternoon.

         The first degrade run reported "better 1, worse 1" and read as the
         harness being blind. It was not: verify:judge scores the pinned judge
         5/5 on clear pairs, and the sabotage was verified to work -- the
         office answered "Ready for request." and "Plan posted to Slack." in
         four words. The problem was the sample. Two of the four cases were
         /start and a link-attachment confirmation, whose HONEST answer is
         already one line, so a four-word answer is barely different from the
         right one and the judge was correct to call it close. Requiring a
         substantive original answer under the degrade flag is not weakening
         the control: one that cannot distinguish its own treatment from its
         baseline is measuring nothing.
       */
       ${ONE_CASE === null ? '' : `and j.job_id = ${lit(ONE_CASE)}::uuid`}
     order by btrim(lower(j.pinned_config->>'instruction')), j.created_at desc
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
const compare = makeComparer(router)

/*
  THE POSITION-BIAS CONTROL, measured before anything is compared.

  The first version of this harness scored each answer 1-5 and subtracted. It
  could not work and the degradation control proved it: the same text scored 1
  and then 5 on one run, and a deliberately sabotaged set came back "better 1,
  worse 0". Differencing two noisy absolute judgements produces noise.

  The comparison is blind and asked twice with the sides exchanged, so the
  control for it is the one that matters here: show the judge the SAME answer
  as both A and B. There is no correct preference, so anything but a tie is the
  judge preferring a position. Reported either way, and a run where it prefers
  a side is a run whose verdicts are worth less -- which is why it prints
  rather than merely gating.
*/
const first = corpus[0] as Original
const biasA = await compare(first.instruction, first.body, first.body)
await pause(4_000)
const biasB = await compare(first.instruction, first.body, first.body)
const biased = [biasA, biasB].filter((c) => c !== null && c.better !== 'tie').length
console.log(
  biasA === null && biasB === null
    ? 'position control: the judge could not be read at all — treat this run as unmeasured\n'
    : biased === 0
      ? 'position control: the same answer against itself is a tie both ways\n'
      : `position control: the judge preferred a POSITION on ${String(biased)} of 2 identical pairs — verdicts below are weaker than they look\n`,
)

interface Result {
  job: string
  /** Never the text. See REDACTION above the report. */
  intent: string
  words: number
  verdict: 'better' | 'worse' | 'unchanged' | 'unscoreable'
  why: string
  identical: boolean
}

const results: Result[] = []
/** Follow-on jobs the replays caused and this run stopped. Reported, never hidden. */
let childrenStopped = 0
/** Documents the replays' children wrote into real projects, and this run removed. */
let documentsSwept = 0

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
    /*
      Stop the follow-on work this replay caused.

      "Write me a PDF report" makes the office enqueue `artifact.report`
      children, which is the office working correctly and is not what a replay
      measures: the thing being compared is the PARENT'S answer, and the
      children are consequences that were already had the first time. Left
      queued they would be drained by the deployed worker, spend tokens and
      write documents into a real project for a request nobody made today.

      Cancelled, not deleted -- a job can never be removed -- and only from a
      non-terminal state, because `enforce_job_transition` refuses
      complete -> cancelled and is right to. Migration 0461 is the half of this
      that cannot race: it forces announce = false on anything in this
      namespace at INSERT, so a child drained before this statement still
      cannot reach Grant.
    */
    const stopped = await one(`
      with cancelled as (
        update public.jobs
           set state = 'cancelled', finished_at = app.now_utc(),
               state_reason = 'follow-on work from a replay; not re-done'
         where requested_by = ${lit(MINE)}
           and job_id <> ${lit(replayId)}::uuid
           and state not in ('complete', 'cancelled', 'failed', 'committing',
                             'committed', 'notifying')
        returning 1
      ) select count(*)::int as n from cancelled`)
    if (Number(stopped.n) > 0) childrenStopped += Number(stopped.n)

    /*
      And take back what the children already WROTE.

      Cancelling the queue is not enough, and three drafts in Grant's real
      Legacy Coaching Course project proved it: an `artifact.report` child that
      had already finished before the cancellation had written a PDF and a
      `documents` row. 0461 and 0462 stopped a replay DELIVERING; nothing
      stopped it depositing.

      It matters more than "an extra row". `app.search_documents` excludes
      archived material and NOT drafts, so three near-duplicate status reports
      written for a test were retrievable — and an answer citing two of them as
      separate sources is the provenance defect this repository keeps paying
      for, manufactured by the harness that measures it.

      Deleted rather than archived: a replay's output is not history. Nothing
      asked for it and nobody should be able to find it later and wonder.
    */
    const swept = await one(`
      with gone as (
        delete from public.documents d
         using public.jobs j
         where j.job_id = d.produced_by_job
           and j.requested_by = ${lit(MINE)}
        returning 1
      ) select count(*)::int as n from gone`)
    if (Number(swept.n) > 0) documentsSwept += Number(swept.n)
  } catch (e) {
    failure = (e as Error).message.slice(0, 100)
  }

  if (failure !== null) {
    console.log(`unscoreable`)
    results.push({
      job: orig.job_id,
      intent: orig.intent_class ?? 'unclassified',
      words: orig.words,
      verdict: 'unscoreable',
      why: failure,
      identical: false,
    })
    continue
  }

  const identical = newBody.trim() === orig.body.trim()
  /*
    Both answers cut at the same point, or neither.

    A replayed report runs to thousands of characters and the judge is a
    reasoning model that spends its ceiling thinking before it emits anything.
    Truncation changes what is read, so what matters is that it is SYMMETRIC:
    the same rule cuts both sides, so the comparison -- which is the entire
    measurement -- is unaffected.
  */
  const READABLE = 4_000
  const cut = (t: string): string =>
    t.length <= READABLE ? t : `${t.slice(0, READABLE)}\n\n[cut for grading]`

  /*
    Asked twice, with the sides exchanged, and agreement is the verdict.

    `then` puts the NEW answer second; `swapped` puts it first. A judge that
    says the new answer is better in both orders has said something about the
    answers. One that changes its mind has said something about the order, and
    that is reported as unscoreable -- #133's own third outcome, *"a change the
    judge cannot rank is the interesting one"* -- rather than resolved by a
    tie-break, which would be inventing a verdict out of a disagreement.
  */
  const then = identical ? null : await compare(orig.instruction, cut(orig.body), cut(newBody))
  if (!identical) await pause(4_000)
  const swapped = identical ? null : await compare(orig.instruction, cut(newBody), cut(orig.body))

  /*
    The rule lives in `direction`, and is unit-tested exhaustively there.

    All sixteen combinations of two comparisons are enumerated in
    `tests/eval/direction.test.ts`, because this is nine lines of conditional
    that decides every verdict the harness reports and an earlier draft of it
    counted one tie plus one preference as agreement.
  */
  const verdict: Result['verdict'] = identical ? 'unchanged' : direction(then, swapped)

  const why =
    verdict === 'unscoreable' && then !== null && swapped !== null
      ? `the judge reversed when the sides were swapped (${then.better} then ${swapped.better})`
      : (then?.reason ?? 'the answer is byte-identical to the one Grant received')

  console.log(
    verdict === 'unchanged' && identical
      ? 'unchanged (identical text)'
      : `${verdict}${verdict === 'unscoreable' ? ' — ' : ''}${verdict === 'unscoreable' ? why.slice(0, 60) : ''}`,
  )
  results.push({
    job: orig.job_id,
    intent: orig.intent_class ?? 'unclassified',
    words: orig.words,
    verdict,
    why,
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

/*
  The verdict, which refuses to be dramatic about one case.

  #133: *"Never report a single replay as a regression."* With a pairwise
  judge there is no scale to compare against a noise floor, so the rule is
  stated directly: a direction is only called when MORE THAN ONE case moved
  that way and they outnumber the other direction. One case moving is one
  case, and it is printed as such.

  A run where the position control failed cannot conclude anything, and says
  so instead of quietly reporting the bias as a finding about the office.
*/
const decided =
  biased > 0
    ? 'UNMEASURED — the judge preferred a position on identical text, so no direction can be read from this run'
    : better > 1 && better > worse
      ? 'BETTER than the history'
      : worse > 1 && worse > better
        ? 'WORSE than the history'
        : 'NO DIRECTION — nothing moved far enough, or not enough cases moved together'

console.log(
  `\n  better ${String(better)} · worse ${String(worse)} · unchanged ${String(same)} · unscoreable ${String(unscoreable)}`,
)
console.log(`  ${decided}`)
console.log(
  hygienic
    ? `  hygiene: ${String(mine.all_of_them)} replay job(s), all fixtures, none announced`
    : `  HYGIENE FAILED: ${String(mine.fixtures)} of ${String(mine.all_of_them)} are fixtures, ${String(mine.announced)} announced`,
)
if (childrenStopped > 0) {
  console.log(
    `  ${String(childrenStopped)} follow-on job(s) the replays caused were cancelled rather than re-done`,
  )
}
if (documentsSwept > 0) {
  console.log(
    `  ${String(documentsSwept)} document(s) a replay wrote into a real project were removed`,
  )
}
/*
  Asserted, not assumed. A sweep that matched nothing looks exactly like a
  sweep that worked, and this one runs against Grant's real projects.
*/
const leftBehind = await one(`
  select count(*)::int as n from public.documents d
    join public.jobs j on j.job_id = d.produced_by_job
   where j.requested_by = ${lit(MINE)}`)
if (Number(leftBehind.n) > 0) {
  console.error(
    `  DEBRIS: ${String(leftBehind.n)} document(s) this run wrote are still in a real project`,
  )
  process.exitCode = 1
}

/*
  The degradation control, asserted rather than eyeballed.

  #133: *"a deliberately degraded prompt shows up as worse."* The first build
  of this harness failed exactly here -- sabotage came back "better 1, worse
  0" -- and the failure is the reason the judge is pairwise now. So the check
  runs inside the command: under --degrade, a run that does not come back
  WORSE exits non-zero, because a detector that cannot be made to go red is
  not evidence of anything.
*/
if (DEGRADE) {
  const detected = worse > better
  console.log(
    detected
      ? `  CONTROL PASSED — sabotage was detected as worse (${String(worse)} worse against ${String(better)} better)`
      : `  CONTROL FAILED — sabotage was NOT detected (${String(worse)} worse against ${String(better)} better). This harness cannot currently see a regression.`,
  )
  if (!detected) process.exitCode = 1
}

const report = [
  '# Replay against real history',
  '',
  `Generated by \`npm run replay\` on ${new Date().toISOString().slice(0, 10)}. Issue #133.`,
  '',
  DEGRADE
    ? '**CONTROL RUN (`--degrade`).** Every request was deliberately sabotaged before it was replayed. A run that does not come back WORSE means this harness cannot detect a regression.'
    : '**Real run.** Each request below is a real thing Grant asked, replayed against current code, with the same judge scoring the old answer and the new one.',
  '',
  `**${decided}** — better ${String(better)}, worse ${String(worse)}, unchanged ${String(same)}, unscoreable ${String(unscoreable)}.`,
  '',
  'The judge compares the two answers directly, blind, and is asked twice with the',
  'sides exchanged; agreement is the verdict and a reversal is reported as',
  'unscoreable. Absolute 1-5 scoring was tried first and could not detect a',
  'deliberately sabotaged run, which is why it is gone.',
  '',
  'What this does NOT hold constant: the documents. They are retrieved as they are',
  'now, not as they were, because nothing stored what was retrieved. A document added',
  'since is a real difference in what the office can answer with.',
  '',
  '## REDACTION — why this table names no request',
  '',
  'Every row below is a real thing Grant asked, and the answer is about his own',
  'business. A committed report is the wrong place for either: this file is in the',
  'repository, it is read by people and by models, and #172 is about to put mail in',
  'the same corpus. So the table carries the job id, what the office classified the',
  'request as, and the scores -- enough to pull the case up with',
  '`npm run replay -- --case <job>` and read it in the terminal, and not enough to',
  'leak anything by being read.',
  '',
  "The judge's reasoning quotes the answer, so it stays on the console too.",
  '',
  '| job | intent | words | verdict |',
  '|---|---|---|---|',
  ...results.map(
    (r) => `| \`${r.job.slice(0, 8)}\` | ${r.intent} | ${String(r.words)} | ${r.verdict} |`,
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
