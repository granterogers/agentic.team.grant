/**
 * A message Grant sent does not disappear because a provider was down.
 *
 *   npm run verify:transport
 *
 * Issue #202, whose principle is 0014's canonical-store claim under load:
 * *"could the application be rebuilt from Postgres alone, with an empty Slack
 * workspace?"* Losing a channel loses a DELIVERY SURFACE, not data. Slack
 * rate-limits, Telegram times out, an edge function cold-starts (#189). None
 * of that may cost a message.
 *
 * ## What is simulated and what is real
 *
 * The provider is simulated — there is no way to make Slack fall over on
 * demand, and a suite that waited for a real outage would never run. Everything
 * else is the office's own code: `claim_delivery`, `record_delivery_failure`,
 * `retry_delivery`, `retry_job_deliveries`, `undelivered` and
 * `conversation_history`, called exactly as the edge functions call them.
 *
 * The simulation is one line: report a retryable failure. That is precisely
 * what a transport handler does when a provider times out, so the path under
 * test is the real one.
 *
 * ## Fixtures, and which rule applies
 *
 * CLAUDE.md's deciding question is whether the thing under test FILTERS
 * fixtures. `app.undelivered` does — it excludes fixture jobs, so an outage
 * invented by a suite never reads as a real one on Grant's screen. That makes
 * this the OPPOSITE of #45: the subject must be a fixture, or the assertion
 * "the harness cannot pollute the reading" is untestable, and the run would
 * leave a permanent fake outage behind.
 *
 * So the job is a fixture job, and both facts are asserted rather than assumed:
 * that the fixture is invisible to the reader, and that the same mechanism is
 * visible when the job is real. A suite that only proved the first would pass
 * on a reader that returned nothing at all.
 *
 * ## Deliveries cannot be deleted the easy way
 *
 * `deliveries` is not append-only, so teardown is a real DELETE — and it is
 * asserted, because a teardown that matches nothing looks exactly like a
 * teardown that worked.
 */

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

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
/*
  The dedupe key has a shape, enforced by `inbound_dedupe_key_shaped` on the
  inbound side and matched here for consistency: lowercase segments separated
  by colons. A key that does not match is refused, which is a five-minute
  detour the first time.
*/
const KEY = (n: number): string => `slack:verify_transport:${run}-${String(n)}`

/*
  The target references have SHAPES, enforced by `deliveries_target_shaped`:
  a Slack channel matches `^[CDG][A-Z0-9]{6,}$` and a Telegram chat is digits
  with an optional minus. A plausible-looking `C_verify` is refused, and the
  refusal arrives from inside `claim_delivery` several frames from the caller.
  Read from `pg_constraint` rather than guessed — the whole table's checks in
  one query, which is faster than meeting them one at a time.
*/

let jobId = ''
let deliveryId = ''
/*
  The addressee check goes through `app.say_in_project`, which is the studio's
  real writer — and a real writer makes a REAL job, because `jobs.is_fixture`
  is generated from `requested_by` and the writer sets that itself. So the run
  is torn down: the command row is deleted and the job is cancelled, which is
  the teardown for one left QUEUED (cancelling a `complete` job is refused by
  `enforce_job_transition`, and rightly).
*/
let saidJob = ''
let saidCommand = ''

try {
  /*
    A fixture job to hang the deliveries off.

    `jobs.is_fixture` is GENERATED from `requested_by`, and 0342 widened the
    expression to include `%:verify-%` precisely so a suite driving the real
    path can produce fixture traffic. Before that, no suite going through
    `enqueue_inbound` could make a fixture job at all, and `verify:addressing`
    ran 43 real ones without knowing.
  */
  /*
    Columns read from `information_schema` rather than guessed. There is no
    `payload` on `jobs` — the first draft assumed one, which is the trap
    CLAUDE.md names first among the wasted hours. `idempotency_key` and
    `correlation_id` are both NOT NULL and neither defaults.
  */
  const made = await one(`
    insert into public.jobs (kind, state, requested_by, correlation_id, idempotency_key)
    values ('note', 'queued', 'slack:verify-transport-${run}', gen_random_uuid(),
            'verify-transport-${run}')
    returning job_id::text as id, is_fixture`)
  jobId = String(made.id ?? '')
  check(
    'a fixture job to hang the deliveries off',
    made.is_fixture === true
      ? `fixture job ${jobId.slice(0, 8)}`
      : 'NOT A FIXTURE — this run would leave real debris',
    jobId !== '' && made.is_fixture === true,
  )
  if (made.is_fixture !== true) throw new Error('refusing to continue with a real job')

  /*
    Register this suite's two fabricated destinations, or nothing below tests
    what it says it tests.

    0523 made `app.claim_delivery` default-deny for harness traffic: a fixture
    job may only be delivered to a destination registered in
    `public.test_destinations`, and that table has never held a row. It landed
    on 20 September at 08:49 and **nine of this suite's checks have been red
    ever since** — every one of them reporting `suppressed`, which is the
    guard working and not the transport failing. This suite is IN the gate,
    so the gate has been red for a day and a half about a thing that is not
    broken. A check that fails for the wrong reason is worse than no check:
    it teaches whoever reads it to discount the colour.

    Safe, and not a weakening of 0523:

      * `CVERIFY001` and `12345` are fabricated. Nothing in this file performs
        a network send at all — the provider is simulated by reporting a
        retryable failure, and every call is to the office's own SQL.
      * 0523's trigger refuses any destination that has ever received a real
        delivery, so this cannot be aimed at Grant by mistake.

    Removed in teardown, and the removal is asserted like every other.
  */
  await db.execute(`
    insert into public.test_destinations (channel, target_ref, why) values
      ('slack', 'CVERIFY001',
       'verify:transport — a fabricated channel; this suite performs no network send'),
      ('telegram', '12345',
       'verify:transport — a fabricated chat; this suite performs no network send')
    on conflict (channel, target_ref) do nothing`)

  // --- the claim ----------------------------------------------------------
  const claimed = await one(`
    select * from app.claim_delivery(
      'slack', ${lit(KEY(1))}, 'T_verify', 'CVERIFY001', 'result',
      null, null, null, ${lit(jobId)}::uuid, interval '2 minutes')`)
  deliveryId = String(claimed.delivery_id ?? '')
  check(
    'a delivery is claimed before anything is sent',
    `${String(claimed.outcome)}, attempt ${String(claimed.attempt)}`,
    claimed.outcome === 'claimed' && claimed.attempt === 1,
  )

  /*
    #195, used rather than reimplemented: claiming the same key twice does not
    make a second delivery. This is what makes a retry safe, so it is asserted
    HERE rather than assumed by the retry checks below.
  */
  const again = await one(`
    select * from app.claim_delivery(
      'slack', ${lit(KEY(1))}, 'T_verify', 'CVERIFY001', 'result',
      null, null, null, ${lit(jobId)}::uuid, interval '2 minutes')`)
  check(
    'claiming the same key twice does not make a second delivery',
    `${String(again.outcome)} — same row: ${String(again.delivery_id) === deliveryId}`,
    String(again.delivery_id) === deliveryId && again.outcome === 'held',
  )

  // --- the provider falls over --------------------------------------------
  /*
    Bounded backoff, and the bound is a stated number (#202). The policy lives
    in `system_config` so Grant can change it without a migration, so the suite
    READS it rather than hard-coding five — a check that asserts a constant the
    product can legitimately change is the "index asserted by name" mistake.
  */
  const policy = await one(`
    select
      coalesce((select value::int from public.system_config where key='delivery.max_attempts'),5) as max,
      coalesce((select value::int from public.system_config where key='delivery.backoff_seconds'),30) as base`)
  const max = Number(policy.max ?? 5)
  const base = Number(policy.base ?? 30)
  check(
    'the retry bound is a stated number, not a hard-coded one',
    `${String(max)} attempts, first wait ${String(base)}s`,
    max >= 2 && base >= 1,
  )

  const outcomes: string[] = []
  for (let i = 1; i <= max + 1; i += 1) {
    const said = await one(`
      select app.record_delivery_failure(${lit(deliveryId)}::uuid, 'timeout (simulated)', true) as v`)
    outcomes.push(String(said.v))
    if (String(said.v) === 'gave_up') break
    /*
      Expire the lease so the next claim reclaims rather than reporting 'held'.
      In production the wait is real; here it is skipped, because a suite that
      slept for half an hour to prove a backoff would never be run — and the
      backoff INTERVAL is asserted separately, from the row, below.
    */
    await db.execute(
      `update public.deliveries set lease_expires_at = app.now_utc() - interval '1 second'
        where delivery_id = ${lit(deliveryId)}::uuid`,
    )
    await one(`
      select * from app.claim_delivery(
        'slack', ${lit(KEY(1))}, 'T_verify', 'CVERIFY001', 'result',
        null, null, null, ${lit(jobId)}::uuid, interval '2 minutes')`)
  }

  check(
    'a failing send is retried, and then gives up',
    outcomes.join(' → '),
    outcomes.some((o) => o.startsWith('retry_in_')) && outcomes.at(-1) === 'gave_up',
  )

  /*
    The backoff grows. Asserted on the retry outcomes themselves, which name
    the wait in seconds — so this is the real computed interval and not a
    restatement of the formula.
  */
  const waits = outcomes
    .filter((o) => o.startsWith('retry_in_'))
    .map((o) => Number(o.slice('retry_in_'.length)))
  check(
    'and each wait is longer than the last, up to a ceiling',
    `${waits.join('s, ')}s`,
    waits.length >= 2 && waits.every((w, i) => i === 0 || w >= (waits[i - 1] ?? 0)),
  )

  const row = await one(`
    select state::text as state, attempt, error_code
      from public.deliveries where delivery_id = ${lit(deliveryId)}::uuid`)
  check(
    'the failure is recorded against the delivery, not swallowed',
    `${String(row.state)}, attempt ${String(row.attempt)}, "${String(row.error_code)}"`,
    row.state === 'failed' && String(row.error_code).includes('timeout'),
  )

  /*
    And the loop does not change its mind. `claim_delivery` must refuse to
    reclaim a failed row: the worker that gave up must not silently start
    again, or "gave up" means nothing and the bound is not a bound.
  */
  const afterGiveUp = await one(`
    select * from app.claim_delivery(
      'slack', ${lit(KEY(1))}, 'T_verify', 'CVERIFY001', 'result',
      null, null, null, ${lit(jobId)}::uuid, interval '2 minutes')`)
  check(
    'a delivery that gave up is not quietly retried by the worker',
    String(afterGiveUp.outcome),
    afterGiveUp.outcome === 'failed',
  )

  // --- one surface failing does not stop the others ------------------------
  /*
    #202's fifth outbound criterion, and the one most easily broken by a
    well-meaning error handler: Slack being down must not prevent the Telegram
    delivery or the canonical record.
  */
  const telegram = await one(`
    select * from app.claim_delivery(
      'telegram', ${lit(KEY(2))}, 'bot_verify', '12345', 'result',
      null, null, null, ${lit(jobId)}::uuid, interval '2 minutes')`)
  await one(
    `select app.record_delivery_sent(${lit(String(telegram.delivery_id))}::uuid, 'msg_1', null)`,
  )
  const both = await one(`
    select
      count(*) filter (where state = 'failed') as failed,
      count(*) filter (where state = 'sent') as sent
      from public.deliveries where job_id = ${lit(jobId)}::uuid`)
  check(
    'one surface failing does not stop another',
    `${String(both.sent)} sent, ${String(both.failed)} failed, on the same job`,
    Number(both.sent) === 1 && Number(both.failed) === 1,
  )

  // --- it is visible, and it can be tried again ----------------------------
  /*
    Fixture traffic must NOT read as a real outage. This is the assertion that
    makes the whole suite safe to run against the live office — and it is the
    reason the subject is a fixture at all, which is the opposite of #45's
    usual advice and correct here because `undelivered` filters them.
  */
  const hidden = await one(`
    select jsonb_array_length(app.undelivered(null, 200)) as n,
           (select count(*) from jsonb_array_elements(app.undelivered(null, 200)) e
             where e->>'delivery_id' = ${lit(deliveryId)}) as mine`)
  check(
    "this run's simulated outage is invisible to the real reading",
    `${String(hidden.mine)} of ${String(hidden.n)} rows are this run's`,
    Number(hidden.mine) === 0,
  )

  /*
    Nothing the reader shows Grant belongs to a FIXTURE PROJECT (#212).

    Asserted as a property, not a count, and that distinction is the whole
    lesson of the third instance. 0342 taught `jobs.is_fixture` about
    `%:verify-%`; 0351 corrected `telegram:4242`. Both fixed the rows that
    existed at that moment, and a count of them goes stale the moment the
    harness runs again — which is exactly how this came back, as 85 jobs in
    fixture projects whose own generated flag says real, two of them showing
    on this list under a project literally named `fixture-conversation-…`.

    `jobs.is_fixture` is GENERATED and cannot see the project, so 0355 derives
    it in `app.harness_job`. This holds whatever the harness does next.
  */
  const fromFixtures = await one(`
    select count(*)::int as n,
           coalesce(string_agg(distinct p.slug, ', '), '') as which
      from jsonb_array_elements(app.undelivered(null, 200)) e
      join public.projects p on p.project_id = (e->>'project')::uuid
     where p.is_fixture`)
  check(
    'no row it shows Grant belongs to a fixture project',
    Number(fromFixtures.n) === 0
      ? 'none'
      : `${String(fromFixtures.n)}: ${String(fromFixtures.which)}`,
    Number(fromFixtures.n) === 0,
  )

  /*
    And the same mechanism IS visible for a real job. Without this the check
    above passes on a reader that returns nothing at all — the "teardown that
    matched nothing looks exactly like a teardown that worked" mistake, in a
    different costume.
  */
  /*
    The reader agrees with what "real" MEANS, rather than with a count.

    This compared `undelivered` against every non-fixture failure over a LEFT
    join — which was the reader's own old definition, so the two agreed by
    construction and the check could only fail if the reader broke in some
    other way. 0351 narrowed "real" to attributable-and-not-fixture, and this
    went red: the check was still counting the eight orphaned fault injections
    the reader had just, correctly, stopped reporting.

    The counterpart query is now the same definition, written independently, so
    a disagreement means one of them is wrong rather than that somebody edited
    one and not the other.

    And when there is nothing to see it SAYS so rather than passing quietly on
    0 == 0 — a teardown that matches nothing looks exactly like a teardown that
    worked, and this is the same shape: the strongest form of this check needs
    a real failure to exist, and today there is none.
  */
  const visible = await one(`
    select jsonb_array_length(app.undelivered(null, 200)) as n,
           (select count(*) from public.deliveries d
              join public.jobs j on j.job_id = d.job_id
             -- The same definition of real the reader uses, written
             -- independently so a disagreement means one of them is wrong.
             -- Updated for #212: a job in a FIXTURE PROJECT is harness
             -- traffic, which the generated is_fixture column cannot see.
             -- This going red on 0355 is the check doing its job: the reader
             -- had just stopped showing two rows from a fixture project and
             -- this side still counted them. No backticks in here - the whole
             -- query is a template literal.
             where d.state = 'failed'
               and not app.harness_job(j.job_id)) as real_failed`)
  const shown = Number(visible.n)
  const real = Number(visible.real_failed)
  check(
    'and the reader shows exactly the failures a person could act on',
    real === 0
      ? 'nothing real is failing — this check cannot discriminate today'
      : `${String(shown)} shown, ${String(real)} exist`,
    shown === real,
  )

  /*
    Nothing on the real reading is harness traffic (#202, and the reason 0351
    exists).

    Not "this run's rows are hidden" — that is checked above and it passed
    while twenty-one OTHER harness rows sat on the same reading calling
    Telegram degraded. gate-3 impersonates Grant as Telegram user 4242, the
    adapter composes `requested_by` as `telegram:4242`, and the generated
    `gate-%` branch never fires because the channel prefix is in front of it.
    Twenty-seven jobs accumulated, and the two features built to make the
    office legible reported them to Grant as the office failing.

    So the assertion is about the WHOLE reading rather than about this suite:
    no entry may name a probe, a gate, a fixture or a verification. Written as
    a property so it holds for harnesses nobody has written yet — a count would
    have said "21" and meant nothing, and a list of known offenders would need
    editing every time somebody adds one.
  */
  const readingNow = (await one(`select app.undelivered(null, 200) as v`)).v as {
    delivery_id?: string
    error_code?: string
    channel?: string
  }[]
  const harnessy = readingNow.filter((d) =>
    /probe|fixture|verify|gate-|injected|simulated/i.test(
      `${String(d.error_code ?? '')} ${String(d.channel ?? '')}`,
    ),
  )
  check(
    'nothing on the real undelivered reading is harness traffic',
    harnessy.length === 0
      ? `${String(readingNow.length)} entries, none of them ours`
      : `${String(harnessy.length)} HARNESS ROWS ARE BEING REPORTED AS REAL: ${harnessy
          .slice(0, 2)
          .map((d) => String(d.error_code))
          .join(' · ')}`,
    harnessy.length === 0,
  )

  /*
    And every entry can be acted on. A delivery with no job has no project, no
    requester and nothing to retry into — reporting it asks Grant to do
    something about a thing with no handle. Eight of those were on the reading,
    all of them fault injections, all counted as real because the reader said
    `coalesce(is_fixture, false) = false` over a LEFT join: absence of a
    fixture flag treated as presence of a real one, which is 0304's asymmetry
    lesson in a different costume.
  */
  const orphans = readingNow.filter((d) => d.delivery_id !== undefined).length
  const unattributable = Number(
    (
      await one(`
        select count(*) as n from public.deliveries d
         where d.state = 'failed' and d.job_id is null`)
    ).n ?? 0,
  )
  check(
    'and every entry on it can actually be acted on',
    `${String(orphans)} shown, ${String(unattributable)} unattributable deliveries excluded`,
    readingNow.every((d) => d.delivery_id !== undefined),
  )

  const retried = await one(
    `select app.retry_job_deliveries(app.test_office(), ${lit(jobId)}::uuid) as v`,
  )
  const r = (retried.v ?? {}) as { queued?: number; skipped?: number; says?: string }
  check(
    'a person can send it again, and only the failed one is queued',
    `${String(r.queued)} queued, ${String(r.skipped)} skipped — "${String(r.says)}"`,
    Number(r.queued) === 1 && Number(r.skipped) === 0,
  )

  const afterRetry = await one(`
    select state::text as state, attempt
      from public.deliveries where delivery_id = ${lit(deliveryId)}::uuid`)
  check(
    'and it gets a fresh budget rather than one more go',
    `${String(afterRetry.state)}, attempt ${String(afterRetry.attempt)}`,
    afterRetry.state === 'claimed' && Number(afterRetry.attempt) === 1,
  )

  /*
    The retry must not resend what already arrived. The Telegram delivery on
    this job is `sent`; if the retry had touched it, the same message would go
    out twice — which is the failure #195 exists to prevent and the one a retry
    button is most likely to cause.
  */
  const tg = await one(`
    select state::text as state from public.deliveries
     where delivery_id = ${lit(String(telegram.delivery_id))}::uuid`)
  check(
    'the one that already arrived is left alone, so nothing is sent twice',
    String(tg.state),
    tg.state === 'sent',
  )

  // --- never let a secondary attribute destroy the primary content ---------
  /*
    The `addressed_to` lesson, generalised (#202's third inbound criterion).
    `inbound_commands.addressed_to` references `staff`, so a slug naming nobody
    does not route badly — the INSERT fails and everything Grant typed is lost
    because of who he addressed it to.

    Asserted at the layer that decides, which is the writer: `app.say_in_project`
    validates the addressee against the active roster and DROPS it, reporting
    that it did, rather than losing the message.
  */
  const kept = await one(`
    select app.say_in_project(app.test_office(), app.unnamed_project(),
      ${lit(`transport proof ${run}`)}, 'nobody-by-that-name') as v`)
  /*
    `addressee_dropped` is the SLUG that was dropped, not a boolean. The first
    draft asserted `=== true` and reported "THE MESSAGE MAY HAVE BEEN LOST"
    about a writer that had behaved perfectly — a literal-shape assumption
    standing in for the property, which is the fourth instance of that mistake
    in this repository's notes. The property is: the addressee did not survive,
    the words did, and the writer said which.
  */
  const said = (kept.v ?? {}) as {
    addressee_dropped?: string | readonly string[] | null
    addressed_to?: string | null
    command?: string
    job?: string
  }
  /*
    A LIST since 0411, because #26 let Grant address two people and one of
    them can be unroutable while the other is not. This check asserted
    `typeof === 'string'` and went red on a correct change — the fifth
    instance in this repository of an assertion locked to a SHAPE rather than
    to the property, and the second time this very check has done it: the
    first draft asserted `=== true` against a slug.

    The property has not moved: the addressee did not survive, the words did,
    and the writer said which. Read as a list of whatever arrived, so neither
    shape can break it again.
  */
  const droppedNames = (
    Array.isArray(said.addressee_dropped)
      ? said.addressee_dropped
      : typeof said.addressee_dropped === 'string'
        ? [said.addressee_dropped]
        : []
  ).filter((n) => String(n).trim() !== '')
  saidJob = typeof said.job === 'string' ? said.job : ''
  saidCommand = typeof said.command === 'string' ? said.command : ''
  check(
    'an unroutable addressee costs the addressee, never the message',
    droppedNames.length > 0
      ? `dropped ${droppedNames.map((n) => `"${String(n)}"`).join(', ')} and kept the words`
      : `THE MESSAGE MAY HAVE BEEN LOST — ${JSON.stringify(said).slice(0, 90)}`,
    droppedNames.length > 0 && said.addressed_to === null && saidCommand !== '',
  )
  if (saidCommand !== '') {
    const stored = await one(`
      select instruction from public.inbound_commands
       where command_id = ${lit(saidCommand)}::uuid`)
    check(
      'and the words are in the record, exactly as he said them',
      `"${String(stored.instruction).slice(0, 40)}"`,
      String(stored.instruction).includes(run),
    )
  }
} finally {
  // --- teardown, asserted ---------------------------------------------------
  /*
    A teardown that matches nothing looks exactly like a teardown that worked,
    so it is counted. `deliveries` is not append-only; `jobs` is — a job can
    never be deleted, because `job_state_transitions` refuses — so the job is
    cancelled instead, which is the teardown for one left QUEUED.
  */
  if (saidCommand !== '') {
    await db
      .execute(`delete from public.inbound_commands where command_id = ${lit(saidCommand)}::uuid`)
      .catch(() => undefined)
    const left = await one(
      `select count(*) as n from public.inbound_commands where command_id = ${lit(saidCommand)}::uuid`,
    )
    check(
      'teardown — the addressee probe left no message behind',
      `${String(left.n)} left`,
      Number(left.n) === 0,
    )
  }
  if (saidJob !== '') {
    /*
      Its attribution, too, and not only its state (#133, migration 0463).

      `app.say_in_project` is the real writer on purpose, so the job it makes is
      `requested_by` teamhq:grant -- which is what Grant looks like. Twenty-nine
      of these had accumulated reading as things he asked, invisible to
      `is_fixture` (generated from that same string) and to `app.harness_job`
      (the project is real). `npm run replay` selected one as real history,
      which is how they were found.

      Corrected rather than named correctly at birth because the actor belongs
      to the function under test: this suite is asserting what
      `say_in_project` does with an addressee, and changing who appears to be
      speaking would change the thing being asserted.
    */
    await db
      .execute(
        `update public.jobs set requested_by = 'verify:transport'
          where job_id = ${lit(saidJob)}::uuid and not is_fixture`,
      )
      .catch(() => undefined)
    await db
      .execute(
        `update public.jobs set state = 'cancelled' where job_id = ${lit(saidJob)}::uuid and state = 'queued'`,
      )
      .catch(() => undefined)
    const attributed = await one(
      `select is_fixture as f from public.jobs where job_id = ${lit(saidJob)}::uuid`,
    )
    check(
      'teardown — its job is no longer counted as something Grant asked',
      attributed.f === true ? 'harness traffic' : 'STILL READS AS REAL',
      attributed.f === true,
    )
    const st = await one(
      `select state::text as s from public.jobs where job_id = ${lit(saidJob)}::uuid`,
    )
    check(
      'teardown — and its job is cancelled rather than left in the queue',
      String(st.s),
      st.s === 'cancelled' || st.s === 'complete',
    )
  }
  if (jobId !== '') {
    await db.execute(`delete from public.deliveries where job_id = ${lit(jobId)}::uuid`)
    await db.execute(`
      select app.retire_test_destination('slack', 'CVERIFY001');
      select app.retire_test_destination('telegram', '12345')`)
    const left = await one(
      `select count(*) as n from public.deliveries where job_id = ${lit(jobId)}::uuid`,
    )
    check(
      'teardown — every delivery this run made is gone',
      `${String(left.n)} left`,
      Number(left.n) === 0,
    )
    await db
      .execute(
        `update public.jobs set state = 'cancelled' where job_id = ${lit(jobId)}::uuid and state = 'queued'`,
      )
      .catch(() => undefined)
  }
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exitCode = 1
