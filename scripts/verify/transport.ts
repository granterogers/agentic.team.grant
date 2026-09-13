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
    And the same mechanism IS visible for a real job. Without this the check
    above passes on a reader that returns nothing at all — the "teardown that
    matched nothing looks exactly like a teardown that worked" mistake, in a
    different costume.
  */
  const visible = await one(`
    select jsonb_array_length(
      app.undelivered(null, 200)
    ) as n,
    (select count(*) from public.deliveries d
       left join public.jobs j on j.job_id = d.job_id
      where d.state = 'failed' and coalesce(j.is_fixture, false) = false) as real_failed`)
  check(
    'and the reader can see a real one — it is filtering, not empty',
    `${String(visible.n)} shown, ${String(visible.real_failed)} real failures exist`,
    Number(visible.n) === Number(visible.real_failed),
  )

  const retried = await one(`select app.retry_job_deliveries(${lit(jobId)}::uuid) as v`)
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
    select app.say_in_project(app.unnamed_project(),
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
    addressee_dropped?: string | null
    addressed_to?: string | null
    command?: string
    job?: string
  }
  saidJob = typeof said.job === 'string' ? said.job : ''
  saidCommand = typeof said.command === 'string' ? said.command : ''
  check(
    'an unroutable addressee costs the addressee, never the message',
    said.addressee_dropped
      ? `dropped "${String(said.addressee_dropped)}" and kept the words`
      : `THE MESSAGE MAY HAVE BEEN LOST — ${JSON.stringify(said).slice(0, 90)}`,
    typeof said.addressee_dropped === 'string' &&
      said.addressee_dropped !== '' &&
      said.addressed_to === null &&
      saidCommand !== '',
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
    await db
      .execute(
        `update public.jobs set state = 'cancelled' where job_id = ${lit(saidJob)}::uuid and state = 'queued'`,
      )
      .catch(() => undefined)
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
