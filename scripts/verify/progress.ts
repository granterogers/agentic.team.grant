/**
 * FIVE MINUTES OF SILENCE MUST BE IMPOSSIBLE — and a finished job must not
 * still be "working" (#282).
 *
 *   npm run verify:progress
 *
 * ## Measured before it was built
 *
 * 335 real `office.instruction` jobs over fourteen days: median 21s, p90 259s,
 * **30 of them over five minutes**, worst fifteen hours. And nothing covered
 * it: `announceStart` speaks only when the roster NAMES somebody with a bot,
 * and #70 retired the staff bots, so two "on it" messages had been sent in the
 * system's history — five days apart.
 *
 * ## Why this needs a real subject AND a seam
 *
 * `sayStillWorking` filters harness traffic through `app.harness_job`, so #45
 * sends it a REAL job — and a real job with a real note is a real Telegram
 * message to Grant. The two rules pull against each other, and a transport
 * seam is what settles it: the real query, the real freshness re-read and the
 * real dedupe all run against a real row, and what would have been sent is
 * recorded instead. `verify:slack` uses the same shape.
 *
 * Every subject is swept, and the sweep is asserted — a teardown that matched
 * nothing looks exactly like one that worked.
 */

import type { SendRequest, SendResult } from '../../src/channels/delivery.ts'
import { sayStillWorking } from '../../src/channels/progress.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

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

const checks: { what: string; said: string; ok: boolean }[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push({ what, said, ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

/** Records what would have gone to Telegram. Nothing leaves the building. */
const sent: { text: string; to: string }[] = []
const recorder = {
  channel: 'telegram' as const,
  send: async (request: SendRequest): Promise<SendResult> => {
    sent.push({
      text: String((request.body as { text?: string }).text ?? ''),
      to: request.targetRef,
    })
    return { messageRef: `recorded-${String(sent.length)}` }
  },
}

const run = Math.random().toString(36).slice(2, 10)
console.log('progress on long work (#282) —\n')

/*
  A REAL job, because the reader filters fixtures (#45), parked as though it
  had been running for eleven minutes. `office.instruction` with no parent is
  what the reader looks for: his request, not a duty.

  It lands in the reserved Unnamed project (0334) rather than a new one, for
  the reason `verify:equivalence` states: a real job makes a project permanent,
  and a project created per run is CLAUDE.md's pile of archived debris being
  rebuilt.
*/
const projectId = String((await one('select app.unnamed_project()::text as v')).v ?? '')
const job = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, pinned_config,
     started_at, created_at, recipient_agent, correlation_id)
  values ('office.instruction', 'running', ${lit(projectId)}::uuid, 'telegram:grant',
          ${lit(`progress-proof-${run}`)},
          jsonb_build_object('instruction', ${lit(`What is the state of play on ${run}?`)}),
          now() - interval '11 minutes', now() - interval '11 minutes', 'chief-of-staff',
          gen_random_uuid())
  returning job_id::text as id, correlation_id::text as corr`)
const jobId = String(job.id)

const real = await one(`
  select app.harness_job(${lit(jobId)}::uuid) as harness, state::text as s
    from public.jobs where job_id = ${lit(jobId)}::uuid`)
check(
  'the subject is a REAL job, because the reader filters harness traffic',
  `harness_job=${String(real.harness)}, state ${String(real.s)}`,
  real.harness === false && real.s === 'running',
)

// --- it speaks --------------------------------------------------------------
const first = await sayStillWorking(db, 5, () => recorder as never)
const mine = sent.length
check(
  'a job quiet for eleven minutes gets a note',
  mine === 0
    ? 'SILENT'
    : `${String(mine)} note(s): ${sent
        .map((x) => x.text.split('\n')[0])
        .join(' | ')
        .slice(0, 160)}`,
  mine > 0 && first.some((f) => f.jobId === jobId),
)
check(
  'and it says how long, from the clock rather than from a guess',
  sent
    .map((x) => x.text)
    .join(' ')
    .match(/\d+ minutes in/)?.[0] ?? 'no elapsed time',
  /\b(?:10|11) minutes in/.test(sent.map((x) => x.text).join(' ')),
)

// --- it does not repeat ------------------------------------------------------
const before = sent.length
await sayStillWorking(db, 5, () => recorder as never)
check(
  'a second pass in the same ten minutes says nothing again',
  `${String(sent.length - before)} further note(s)`,
  sent.length === before,
)

/*
  THE INVARIANT THAT MATTERS.

  A note telling Grant work is under way AFTER he has the answer is worse than
  silence. The state is re-read immediately before the send, so settling the
  job between the query and the send must stop it — and the bucket is advanced
  so dedupe cannot be what stops it, which would pass for the wrong reason.
*/
await db.execute(`
  update public.jobs
     set started_at = now() - interval '25 minutes', created_at = now() - interval '25 minutes'
   where job_id = ${lit(jobId)}::uuid`)
const beforeTerminal = sent.length
const wouldHave = await sayStillWorking(db, 5, () => recorder as never)
check(
  'CONTROL: a new ten-minute bucket DOES speak again, so dedupe is not doing the work below',
  `${String(sent.length - beforeTerminal)} note(s) in the new bucket`,
  sent.length > beforeTerminal && wouldHave.some((w) => w.jobId === jobId),
)

/*
  THE INVARIANT THAT MATTERS, AND THE RACE IT IS ACTUALLY ABOUT.

  A note telling Grant work is under way AFTER he has the answer is worse than
  silence. The first version of this check settled the job and then called —
  and that passes for the WRONG REASON, because the query itself filters
  settled states, so the freshness re-read was never reached. Removing the
  guard entirely left this suite green, which is exactly why a detector gets
  broken on purpose before it is believed.

  The guard exists for the RACE: the drain and this pass run in the same
  minute, so a job can settle BETWEEN the query that selected it and the send.
  Reproduced faithfully with two quiet jobs — while the first is being sent,
  the recorder settles the second, which by then has already passed the query.
*/
const second = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, pinned_config,
     started_at, created_at, recipient_agent, correlation_id)
  values ('office.instruction', 'running', ${lit(projectId)}::uuid, 'telegram:grant',
          ${lit(`progress-race-${run}`)},
          jsonb_build_object('instruction', ${lit(`And the second one, ${run}`)}),
          now() - interval '12 minutes', now() - interval '12 minutes', 'chief-of-staff',
          gen_random_uuid())
  returning job_id::text as id`)
const raceId = String(second.id)

/*
  Settling it from inside the FIRST send is what makes this a race rather than
  a re-run: both rows come back from one query, and the second is terminal by
  the time the loop reaches it.
*/
let settled = false
const racing = {
  channel: 'telegram' as const,
  send: async (request: SendRequest): Promise<SendResult> => {
    if (!settled) {
      settled = true
      await db.execute(`
        update public.jobs set state = 'cancelled', finished_at = now(),
          state_reason = 'verify:progress settled mid-pass to prove no note follows'
         where job_id = ${lit(raceId)}::uuid`)
    }
    sent.push({
      text: String((request.body as { text?: string }).text ?? ''),
      to: request.targetRef,
    })
    return { messageRef: `recorded-${String(sent.length)}` }
  },
}

/*
  A fresh bucket for both, so dedupe cannot be what keeps either quiet — and
  ORDERED, so the race is the one intended. The reader takes `started_at asc`,
  so the older job is sent first and the recorder settles the younger one while
  that send is in flight. Left equal, the first draft settled whichever row it
  happened to be sending, which is not a race at all.

  Both in a bucket neither has used. At 25 minutes the first job was already in
  bucket 2 from the control above, so `deliveries` deduped its send, the
  recorder was never called for it, and the race job ended up settling ITSELF
  and then being the only thing sent — the harness reporting a defect that was
  its own arithmetic.
*/
await db.execute(`
  update public.jobs
     set started_at = now() - interval '45 minutes', created_at = now() - interval '45 minutes'
   where job_id = ${lit(jobId)}::uuid;
  update public.jobs
     set started_at = now() - interval '44 minutes', created_at = now() - interval '44 minutes'
   where job_id = ${lit(raceId)}::uuid;`)

const beforeRace = sent.length
const raced = await sayStillWorking(db, 5, () => racing as never)
check(
  'CONTROL: the job that stayed running DID get its note, so the query reached both',
  `${String(sent.length - beforeRace)} note(s) sent`,
  raced.some((r) => r.jobId === jobId && r.outcome === 'sent'),
)
check(
  'a job that settles DURING the pass gets no note — the state is re-read at the send',
  raced.find((r) => r.jobId === raceId)?.outcome ?? 'never considered',
  raced.some((r) => r.jobId === raceId && r.outcome.startsWith('settled as')) &&
    !sent.some((x) => x.text.includes('second one')),
)

// --- and harness traffic never reaches him -----------------------------------
const fixture = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, pinned_config,
     started_at, created_at, recipient_agent, correlation_id)
  values ('office.instruction', 'running', ${lit(projectId)}::uuid,
          ${lit(`telegram:verify-progress-${run}`)},
          ${lit(`progress-fixture-${run}`)},
          jsonb_build_object('instruction', 'harness traffic'),
          now() - interval '20 minutes', now() - interval '20 minutes', 'chief-of-staff',
          gen_random_uuid())
  returning job_id::text as id`)
const fixtureId = String(fixture.id)
const isHarness = await one(`select app.harness_job(${lit(fixtureId)}::uuid) as h`)
const beforeFixture = sent.length
const onFixture = await sayStillWorking(db, 5, () => recorder as never)
check(
  'CONTROL: harness traffic is quiet, and is harness traffic by construction',
  `harness_job=${String(isHarness.h)}, ${String(sent.length - beforeFixture)} note(s)`,
  isHarness.h === true &&
    sent.length === beforeFixture &&
    !onFixture.some((o) => o.jobId === fixtureId),
)

// --- teardown ----------------------------------------------------------------
console.log('')
/*
  A job can never be DELETED (ADR-0022: `job_state_transitions` holds it), so
  both are settled and the notes this run recorded are removed. The deliveries
  are real rows — the dedupe is what the run was testing — and they are this
  run's own correlation, so they go.
*/
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:progress teardown'
   where job_id in (${lit(jobId)}::uuid, ${lit(fixtureId)}::uuid, ${lit(raceId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.deliveries
   where job_id in (${lit(jobId)}::uuid, ${lit(fixtureId)}::uuid, ${lit(raceId)}::uuid);
`)
const left = await one(`
  select count(*)::int as n from public.jobs
   where job_id in (${lit(jobId)}::uuid, ${lit(fixtureId)}::uuid, ${lit(raceId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed')`)
const notes = await one(`
  select count(*)::int as n from public.deliveries
   where job_id in (${lit(jobId)}::uuid, ${lit(fixtureId)}::uuid, ${lit(raceId)}::uuid)`)
check(
  'teardown — nothing of this run is left running or queued to send',
  `${String(left.n)} live job(s), ${String(notes.n)} delivery row(s)`,
  Number(left.n) === 0 && Number(notes.n) === 0,
)

const failed = checks.filter((c) => !c.ok)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
