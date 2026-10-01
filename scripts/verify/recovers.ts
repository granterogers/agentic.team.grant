/**
 * What the office does when things go wrong, asserted against canonical state.
 *
 *   npm run verify:recovers
 *
 * ## Why this exists beside `verify:chaos` and `verify:failures`
 *
 * They answer different questions, and neither answers this one.
 * `verify:chaos` injects a broken integration and proves the OTHERS still
 * work. `verify:failures` proves a failure is classified and counted. Both are
 * about the system staying up.
 *
 * This is about the JOB, and about six properties that only matter to the
 * person waiting for an answer:
 *
 *   1. **no fabricated success** — a failure never reports as done;
 *   2. **no duplicate action** — the same inbound twice is one job, and a
 *      retry does not do the work again;
 *   3. **no lost successful mutation** — a partial failure keeps what
 *      genuinely happened and says so;
 *   4. **no stranded work** — nothing sits in a state whose only exit is a
 *      person noticing;
 *   5. **truthful final status** — the state and the sentence agree;
 *   6. **coherent canonical state** — no output row for a refused answer, no
 *      orphaned child, no silent gap.
 *
 * ## Why it needs no model
 *
 * Every handler here is a stub, the way `verify:attests` does it. That is the
 * point rather than a compromise: a recovery property must hold for ANY
 * handler outcome, so a stub that fails on demand is a better instrument than
 * a real one that fails when the weather does. It also means this suite runs
 * when the provider is out — which is precisely when somebody is most likely
 * to be asking whether recovery works.
 *
 * ## It cancels its own debris, and everything it writes is a fixture
 *
 * `requested_by` is `verify:recovers`, so `jobs.is_fixture` is generated true
 * (0342) and none of this reaches Grant's health readings. Asserted rather
 * than assumed, at the end, because CLAUDE.md records three occasions where
 * harness traffic was about to be reported to him as the office failing.
 */

import { combinedNotifier } from '../../src/channels/notify.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Handler, HandlerOutput, Job, NotifyOutcome, Reviewer } from '../../src/jobs/worker.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: { what: string; outcome: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
const MINE = 'verify:recovers'
const WORKER = `recovers-${run}`
const KIND = `recovery.probe_${run}`

console.log(`\nverify:recovers — ${run}\n`)

// Debris from a crashed earlier run, scoped to this suite's own name.
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
         state_reason = 'verify:recovers debris from an earlier run'
   where requested_by = ${lit(MINE)} and state not in ('complete', 'cancelled', 'failed')`)

/*
  ONE project, reused, rather than one per run.

  This created `fixture-recovers-<run>` every time. Each run hangs four jobs
  on it, a job can never be deleted, so `app.project_delete` refuses the
  project for ever — **ten permanent active fixture projects accumulated in
  two days**, one per gate run, all of them in Grant's project switcher. That
  is CLAUDE.md's twenty-five-project pile rebuilding itself, by a suite whose
  teardown cancelled its jobs and never looked at what it had created.

  A stable slug fixes it at the cause rather than sweeping the symptom: the
  suite's scoping is `requested_by = MINE`, which carries the run token, so
  reusing one project across runs cannot confuse it. `on conflict` makes the
  setup idempotent, and the attachment insert is guarded the same way because
  ADR-0014's trigger runs on the second visit too.

  The existing ten are archived by 0494 — they hold jobs, so archiving is the
  only honest thing available.
*/
const projectId = String(
  (
    await one(`
      with created as (
        insert into public.projects (slug, name, status)
        values ('fixture-recovers', 'Fixture: recovers', 'active')
        on conflict (office_id, slug) do update set status = 'active'
        returning project_id
      ),
      -- ADR-0014: an active project reads from and writes to somewhere real,
      -- and the trigger enforces it in the same statement.
      attached as (
        insert into public.project_attachments
          (project_id, connector, external_ref, display_name, role)
        select project_id, 'upload', 'fixture', 'Verification fixture', 'source'
          from created
        on conflict do nothing
        returning project_id
      )
      select project_id::text as id from created`)
  ).id,
)

const enqueue = async (key: string): Promise<string> =>
  String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, priority, announce)
        values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(key)}, ${lit(KIND)},
                ${lit(MINE)}, 100, false)
        returning job_id::text as id`)
    ).id,
  )

const approve: Reviewer = async () => ({ status: 'approved', notes: 'fixture reviewer' })

/** A handler with a scripted outcome. The instrument of this whole suite. */
const stub = (behave: () => Promise<HandlerOutput>): Handler => ({ kind: KIND, handle: behave })

const good = (body: string): HandlerOutput => ({
  body,
  confidence: 'high',
  evidence: 'verified',
  sources: ['job:fixture'],
  contradictions: null,
  path: 'deterministic_retrieval',
  model: null,
})

const sent: HandlerOutput[] = []
const recorder = {
  name: 'recorder',
  notify: async (_j: Job, o: HandlerOutput): Promise<NotifyOutcome> => {
    sent.push(o)
    return { delivered: true, note: 'recorded' }
  },
}

/*
  The suite's own job, and it INSISTS (#244).

  Section 5 failed once in three runs on identical code, both failing lines
  downstream of one fact: the partial-success job was still `queued` when the
  section asserted on it. The cause was never established, and the reason it
  could stay unestablished is right here — every caller wrote
  `if (job !== null)` and then carried on. A dequeue that returned nothing
  SILENTLY skipped the work and the checks two lines later reported the office
  as having failed to do something nothing had asked it to do.

  Three candidate causes were listed at the time — a lease from an earlier
  section, the deployed worker's drain, a visibility window between enqueue and
  the scoped dequeue — and this removes all three without needing to know which
  it was: ask again, five times over five seconds. If it is still nothing, that
  is now a NAMED failure at the point it happens rather than two misleading
  ones further down.

  The scope itself is #184's and stays: `MINE` keeps this suite from taking
  another suite's work. What it cannot do is stop the deployed worker taking
  this suite's, which is one of the three candidates and is also why insisting
  beats explaining.
*/
const mine = async (expect: string, why = 'the suite'): Promise<Job | null> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const job = await dequeue(db, WORKER, true, true, undefined, MINE)
    if (job !== null && job.jobId === expect) return job
    if (job !== null) {
      /*
        #273. The scope keeps OTHER suites out; it cannot stop this one taking
        its OWN earlier work, and that is what went wrong. Section 2 parks a
        job in `retrying` on purpose, `recoverStalled` calls
        `requeue_retrying` on every deployed worker tick, and the parked job
        comes back as `queued` — so a later section dequeued it instead of the
        job it had just made. The stub ran against the wrong job, the output
        landed on the wrong job, and TWO checks then described a job nothing
        had run, while the dequeue check two lines above said "dequeued".

        Asking for a specific job is the property every one of these sections
        actually wants. When something else arrives it is put back rather than
        run, because running it would corrupt whatever section owns it.
      */
      /*
        Ended, not returned. `running -> retrying` is legal and would put it
        back in the pool, which is an infinite shuffle: the next call takes it
        again. Anything arriving here is this suite's own earlier work that a
        deployed worker requeued, it has already been asserted, and the
        teardown would cancel it anyway — this only happens sooner.

        Scoped to `requested_by` in the SQL, not in the comment. That is what
        makes it impossible for this line to touch another suite's job or a
        real one, whatever a future change to the dequeue does.
      */
      await db.execute(`
        update public.jobs
           set state = 'cancelled', finished_at = app.now_utc(),
               state_reason = 'verify:recovers — already asserted; settled so it '
                              'cannot be dequeued by a later section (#273)'
         where job_id = ${lit(job.jobId)}::uuid
           and requested_by = ${lit(MINE)}
           and state = 'running'`)
      console.log(`  --   settled ${job.jobId.slice(0, 8)}, which is not the job ${why} made`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.log(`  --   nothing to dequeue for ${why} after five tries`)
  return null
}

const stateOf = async (id: string): Promise<{ state: string; reason: string; attempt: number }> => {
  const r = await one(`
    select state, coalesce(state_reason, '') as reason, attempt
      from public.jobs where job_id = ${lit(id)}::uuid`)
  return {
    state: String(r.state ?? ''),
    reason: String(r.reason ?? ''),
    attempt: Number(r.attempt ?? 0),
  }
}

const outputsFor = async (id: string): Promise<number> =>
  Number(
    (await one(`select count(*)::int as n from public.outputs where job_id = ${lit(id)}::uuid`)).n,
  )

const impedimentsFor = async (id: string): Promise<number> =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.job_impediments where job_id = ${lit(id)}::uuid`,
      )
    ).n,
  )

let crashed = false
try {
  // =======================================================================
  console.log('\n1. a handler that throws never reports success')
  const threwId = await enqueue(`recovers-${run}-threw`)
  const threw = await mine(threwId, 'the throwing job')
  const threwResult =
    threw === null
      ? null
      : await runJob(
          db,
          threw,
          [
            stub(async () => {
              throw new Error('the supplier API returned 503')
            }),
          ],
          approve,
          combinedNotifier([recorder], db),
        )
  const afterThrew = await stateOf(threwId)
  check(
    'the job does not end complete',
    `${afterThrew.state}${threwResult === null ? ' (nothing dequeued)' : ''}`,
    afterThrew.state !== 'complete',
  )
  check(
    'and no output row was written',
    `${String(await outputsFor(threwId))} row(s)`,
    (await outputsFor(threwId)) === 0,
  )
  check('and nothing was sent', `${String(sent.length)} message(s)`, sent.length === 0)
  check(
    'the recorded reason names what actually happened',
    afterThrew.reason.slice(0, 70),
    afterThrew.reason.includes('503') || afterThrew.reason.includes('handler threw'),
  )

  // =======================================================================
  console.log('\n2. a retryable failure is retried, and the attempt is counted')
  check(
    'the attempt counter moved, so a repeated failure runs out rather than looping',
    `attempt ${String(afterThrew.attempt)}`,
    afterThrew.attempt >= 1,
  )
  check(
    'and it is waiting to be retried rather than silently dropped',
    afterThrew.state,
    ['retrying', 'failed'].includes(afterThrew.state),
  )

  /*
    Settled here, the moment it has been asserted — #273's other half.

    A job parked in `retrying` is what every later section was racing: the
    deployed worker requeues it on each tick and it becomes eligible for a
    dequeue that belongs to somebody else. `mine()` now refuses to run the
    wrong job, which turns the race into a named failure; this removes the
    race itself, which is better. The property section 2 exists for has
    already been read out of the row above, so keeping the job live buys
    nothing and costs the isolation of every section after it.
  */
  if (afterThrew.state === 'retrying') {
    await db.execute(`
      update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
             state_reason = 'verify:recovers — asserted, then settled so it cannot be re-dequeued'
       where job_id = ${lit(threwId)}::uuid and state = 'retrying'`)
  }

  // =======================================================================
  console.log('\n3. a semantically invalid answer is refused, and SAYS it was')
  const liarId = await enqueue(`recovers-${run}-liar`)
  const liar = await mine(liarId, 'the refused-answer job')
  if (liar !== null)
    await runJob(
      db,
      liar,
      [
        stub(async () => ({
          /*
            Trips ONE gate, on purpose.

            The first draft opened "I pulled the diary…", which also fires
            `claimsToHaveRead` — so the refusal was real and the check could
            not say WHICH rule produced it, and granting the domains left it
            red for the other reason. A control that cannot discriminate is
            the trap CLAUDE.md records about a check being green on one leg
            for the wrong reason. No retrieval verb here: the only thing wrong
            with this sentence is that nothing was consulted.
          */
          body: 'There are no meetings on Tuesday and four tasks are open.',
          confidence: 'high',
          evidence: 'inferred',
          sources: [],
          contradictions: null,
          path: 'inference',
          model: 'fixture/stub',
          grounding: 'what is on Tuesday?',
          consulted: { consulted: [], complete: [] },
        })),
      ],
      approve,
      combinedNotifier([recorder], db),
    )
  check(
    'no output row for a refused answer',
    `${String(await outputsFor(liarId))} row(s)`,
    (await outputsFor(liarId)) === 0,
  )
  check('nothing reached a channel', `${String(sent.length)} message(s)`, sent.length === 0)
  check(
    'and the refusal is recorded where a person looks',
    `${String(await impedimentsFor(liarId))} impediment(s)`,
    (await impedimentsFor(liarId)) >= 1,
  )

  // =======================================================================
  console.log('\n4. the same inbound twice is ONE job')
  const dupKey = `recovers-${run}-dup`
  const firstId = await enqueue(dupKey)
  let secondFailed = false
  try {
    await enqueue(dupKey)
  } catch {
    secondFailed = true
  }
  const dupCount = Number(
    (
      await one(`
        select count(*)::int as n from public.jobs
         where idempotency_key = ${lit(dupKey)}`)
    ).n,
  )
  check(
    'a repeated idempotency key does not become a second job',
    `${String(dupCount)} job(s)${secondFailed ? ', the duplicate was refused' : ''}`,
    dupCount === 1,
  )
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
           state_reason = 'duplicate-inbound probe, work never needed'
     where job_id = ${lit(firstId)}::uuid and state = 'queued'`)

  // =======================================================================
  console.log('\n5. a partial success keeps what happened and is honest about the rest')
  const partialId = await enqueue(`recovers-${run}-partial`)
  const partial = await mine(partialId, 'the partial-success job')
  check(
    'the partial-success job was actually picked up',
    partial === null
      ? 'NOTHING DEQUEUED — the two checks below describe a job nothing ran'
      : 'dequeued',
    partial !== null,
  )
  const taskName = `recovers ${run} the half that worked`
  if (partial !== null)
    await runJob(
      db,
      partial,
      [
        stub(async () => {
          // The mutation genuinely happens, and then the rest of the work
          // fails. This is the shape that loses data when a handler treats
          // its own failure as a reason to roll everything back.
          await db.execute(`
            select app.task_add(${lit(projectId)}::uuid, ${lit(taskName)}, null, null,
                                null, false, ${lit(MINE)}, ${lit(partialId)}::uuid)`)
          return good(
            `I created the task "${taskName}". I could not reach the supplier to fill in the due date, so that part is still open.`,
          )
        }),
      ],
      approve,
      combinedNotifier([recorder], db),
    )
  const taskLanded = Number(
    (
      await one(`
        select count(*)::int as n from public.tasks
         where project_id = ${lit(projectId)}::uuid and title = ${lit(taskName)}`)
    ).n,
  )
  check(
    'the mutation that succeeded is still there',
    `${String(taskLanded)} task(s)`,
    taskLanded === 1,
  )
  /*
    And then remove it, because the task it proves is one Grant can see.

    `check:leaks` counts fixture tasks on purpose — harness rows on a table he
    reads are how the office once reported itself as collapsing — and this
    suite left exactly one behind on every run, which is why the gate's last
    red was this file rather than anything in the product. The assertion above
    has already happened by this point, so removing the row costs the check
    nothing; asserting the removal is what stops a teardown that matches
    nothing looking exactly like one that worked.
  */
  await db.execute(`
    delete from public.tasks
     where project_id = ${lit(projectId)}::uuid and title = ${lit(taskName)}`)
  const taskSwept = Number(
    (
      await one(`
        select count(*)::int as n from public.tasks
         where project_id = ${lit(projectId)}::uuid and title = ${lit(taskName)}`)
    ).n,
  )
  check(
    'and the suite takes it back off the table Grant reads',
    `${String(taskSwept)} left`,
    taskSwept === 0,
  )

  const partialState = await stateOf(partialId)
  check(
    'and the job is honestly complete rather than failed',
    partialState.state,
    partialState.state === 'complete',
  )
  /*
    Read from `outputs`, not from the recorder.

    Every job this suite writes has `announce = false` so nothing can reach
    Grant, which means the notifier legitimately sends nothing — asserting on
    it would be asserting that the safety measure works. The row is the
    canonical thing anyway.
  */
  const partialBody = String(
    (
      await one(`
        select coalesce(body, '') as body from public.outputs
         where job_id = ${lit(partialId)}::uuid order by created_at desc limit 1`)
    ).body ?? '',
  )
  check(
    'and the answer says which half did not happen',
    partialBody.slice(0, 60) || '(no output row)',
    /could not|still open|not reach/i.test(partialBody),
  )

  // =======================================================================
  console.log('\n6. nothing is left in a state whose only exit is a person noticing')
  const stranded = Number(
    (
      await one(`
        select count(*)::int as n from public.jobs
         where requested_by = ${lit(MINE)}
           -- The states whose only forward exit is another machine step, so
           -- a job left in one waits for nobody. There is no leased STATE --
           -- a lease is a column on a queued job -- which is CLAUDE.md's
           -- trap about guessing a name instead of reading the enum. And no
           -- backticks in a comment inside a template literal: that is the
           -- oldest trap in the file and this is its fourth location.
           and state in ('output_created', 'quality_review', 'committing',
                         'committed', 'notifying', 'paused')`)
    ).n,
  )
  check('no job of this run is stranded mid-flight', `${String(stranded)}`, stranded === 0)

  const stale = Number(
    (
      await one(`
        select count(*)::int as n from public.jobs
         where requested_by = ${lit(MINE)} and state = 'queued'
           and created_at < app.now_utc() - interval '10 minutes'`)
    ).n,
  )
  check('and nothing of this run is queued and forgotten', `${String(stale)}`, stale === 0)

  // =======================================================================
  console.log('\n7. every state this run reached is one the machine allows')
  const illegal = Number(
    (
      await one(`
        select count(*)::int as n from public.jobs
         where requested_by = ${lit(MINE)}
           and state not in ('queued','retrying','failed','complete','cancelled')`)
    ).n,
  )
  check('no job of this run sits in an unexpected state', `${String(illegal)}`, illegal === 0)

  // =======================================================================
  console.log('\n8. CONTROL: and all of it is harness traffic')
  const notFixture = Number(
    (
      await one(`
        select count(*)::int as n from public.jobs
         where requested_by = ${lit(MINE)} and not app.harness_job(job_id)`)
    ).n,
  )
  check(
    'nothing this suite wrote can reach Grant health readings',
    `${String(notFixture)} real-looking job(s)`,
    notFixture === 0,
  )
} catch (error) {
  crashed = true
  console.log(`\n  CRASHED: ${(error as Error).message.slice(0, 200)}`)
} finally {
  console.log('\nteardown')
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
           state_reason = 'verify:recovers teardown'
     where requested_by = ${lit(MINE)} and state in ('queued', 'retrying')`)
  const left = Number(
    (
      await one(`
        select count(*)::int as n from public.jobs
         where requested_by = ${lit(MINE)} and state not in ('complete','failed','cancelled')`)
    ).n,
  )
  console.log(
    `  ${left === 0 ? 'ok  ' : 'FAIL'} nothing of this run is still live — ${String(left)}`,
  )

  /*
    And the project goes back to sleep.

    0494 made this ONE stable `fixture-recovers` rather than a new
    `fixture-recovers-<run>` each time, which stopped the debris pile — and
    left the project ACTIVE between runs. `check:leaks` then warns, correctly
    by its own rule, that an active fixture project holding jobs can never be
    deleted: eight jobs and counting, for ever.

    A warning that fires on correct behaviour is one somebody learns to
    ignore, and this repository has already paid for that twice. Archiving it
    here costs nothing: the setup above re-activates it with
    `on conflict (office_id, slug) do update set status = 'active'`, so the next run
    finds it exactly as it expects.
  */
  const slept = await one(`
    update public.projects set status = 'archived'
     where slug = 'fixture-recovers' and status <> 'archived'
    returning slug`)
  console.log(
    `  ok   the fixture project is asleep again — ${slept.slug === undefined ? 'already archived' : 'archived'}`,
  )
  if (left !== 0)
    checks.push({ what: 'teardown left nothing live', outcome: String(left), passed: false })
}

const passed = checks.filter((c) => c.passed).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (crashed || passed !== checks.length) process.exit(1)
