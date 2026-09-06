/**
 * Gate 5 — prove paid inference cannot happen accidentally.
 *
 *   npm run poc:gate-5
 *
 * §13 names eight cases and an acceptance sentence, and this script is
 * organised as exactly those eight so the evidence maps one-to-one onto the
 * requirement rather than onto whatever was convenient to test:
 *
 *   valid free model · 429 · outage · malformed response · provider disabled ·
 *   all free providers exhausted · a paid model accidentally returned by model
 *   discovery · router receives a model without verified free status
 *
 * Acceptance: no paid call · non-urgent work queues · blocked urgent work
 * raises a blocker · local usage records stay correct.
 *
 * The router is real and the database is real. Only `fetch` is substituted, and
 * only for the four cases that require the provider to misbehave on demand —
 * there is no way to ask OpenRouter for a 429. Cases 1, 5, 6, 7 and 8 use the
 * live provider or need no request at all.
 *
 * Spend is read before and after from OpenRouter's own key endpoint. That
 * figure, not our own accounting, is the evidence for "no paid call": using our
 * own records to prove our own records would be circular.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { classifyFailure, decide, type JobContext } from '../../src/inference/policy.ts'
import { raiseBlocker, recordUsage, urgentPriorityMax } from '../../src/inference/record.ts'
import { assertModelAllowed, PaidCallPreventedError } from '../../src/providers/guards.ts'
import { NoUsableModelError, ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const orKey = process.env.OPENROUTER_API_KEY
if (token === undefined || token === '' || orKey === undefined || orKey === '') {
  console.error('SUPABASE_ACCESS_TOKEN and OPENROUTER_API_KEY are required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const rows: { n: string; what: string; outcome: string; passed: boolean }[] = []
const add = (n: string, what: string, outcome: string, passed: boolean): void => {
  rows.push({ n, what, outcome, passed })
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n} ${what} — ${outcome}`)
}

const spend = async (): Promise<number> => {
  const r = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${orKey}` },
  })
  const d = (await r.json()) as { data: { usage: number } }
  return d.data.usage
}

/** A fetch that returns a scripted response, so the provider can misbehave. */
const scriptedFetch =
  (script: { status: number; body: string }): typeof fetch =>
  async () =>
    new Response(script.body, {
      status: script.status,
      headers: { 'Content-Type': 'application/json' },
    })

/** A fetch that fails at the transport layer, like a real outage. */
const deadFetch: typeof fetch = async () => {
  throw new TypeError('fetch failed')
}

// ---------------------------------------------------------------------------
// A real job to attach the evidence to.
//
// Two of them: one urgent, one not, because the acceptance sentence draws its
// distinction there and a single job could only demonstrate half of it.
// ---------------------------------------------------------------------------
const stamp = Date.now()
const made = await db.execute(`
  insert into public.jobs
    (correlation_id, idempotency_key, kind, requested_by, priority, recipient_agent)
  values
    (gen_random_uuid(), 'gate5-normal-${stamp}', 'gate5.probe', 'gate-5', 100, 'inference_router'),
    (gen_random_uuid(), 'gate5-urgent-${stamp}', 'gate5.probe', 'gate-5', 5,   'inference_router')
  returning job_id::text as job_id, correlation_id::text as correlation_id, priority
`)
const normal = made.rows.find((r) => Number(r.priority) === 100) as Record<string, string>
const urgent = made.rows.find((r) => Number(r.priority) === 5) as Record<string, string>

const ctx = (row: Record<string, string>, priority: number): JobContext => ({
  jobId: String(row.job_id),
  correlationId: String(row.correlation_id),
  priority,
  attempt: 0,
  maxAttempts: 5,
  kind: 'gate5.probe',
  recipientAgent: 'inference_router',
})

const boundary = await urgentPriorityMax(db)
const before = await spend()
console.log(`\nurgent boundary: priority <= ${boundary}`)
console.log(`spend before: ${before}\n`)

const usageBefore = Number(
  (await db.execute('select count(*)::int as n from public.inference_usage')).rows[0]?.n,
)
const blockersBefore = Number(
  (await db.execute(`select count(*)::int as n from public.blockers where state = 'open'`)).rows[0]
    ?.n,
)

/**
 * Run one failure case end to end: call, classify, decide, record.
 *
 * Returning the disposition rather than asserting inside keeps each case's
 * expectation visible at the call site, which is where a reader checks it
 * against the spec sentence.
 */
const runCase = async (
  fetchImpl: typeof fetch,
  job: JobContext,
): Promise<{ nature: string; action: string; outcome: string; message: string }> => {
  const router = new ProviderRouter(db, orKey, fetchImpl)
  try {
    await router.complete({
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      maxTokens: 512,
      correlationId: job.correlationId,
    })
    return { nature: 'none', action: 'succeeded', outcome: 'ok', message: '' }
  } catch (error) {
    const classification = classifyFailure(error)
    const disposition = decide(classification, job, boundary)
    await recordUsage(db, {
      provider: 'openrouter',
      modelId: 'gate5-probe',
      correlationId: job.correlationId,
      jobId: job.jobId,
      outcome: classification.outcome,
      providerReportedCost: null,
    })
    if (disposition.action === 'blocker') await raiseBlocker(db, disposition.blocker)
    return {
      nature: classification.nature,
      action: disposition.action,
      outcome: classification.outcome,
      message: (error as Error).message.slice(0, 90),
    }
  }
}

// --- 1. valid free model ---------------------------------------------------
{
  const router = new ProviderRouter(db, orKey)
  try {
    const r = await router.complete({
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      maxTokens: 512,
      correlationId: String(normal.correlation_id),
    })
    await recordUsage(db, {
      provider: 'openrouter',
      modelId: r.model,
      correlationId: String(normal.correlation_id),
      jobId: String(normal.job_id),
      outcome: 'ok',
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      // Zero, and reported: OpenRouter returns usage.cost, which is what makes
      // this row authoritative rather than estimated.
      providerReportedCost: 0,
    })
    add(
      '1',
      'valid free model',
      `${r.model} cost=${r.cost} ${r.promptTokens}+${r.completionTokens}tok content=${JSON.stringify(r.content.slice(0, 20))}`,
      r.cost === 0 && r.content.length > 0,
    )
  } catch (error) {
    add('1', 'valid free model', `FAILED: ${(error as Error).message.slice(0, 90)}`, false)
  }
}

// --- 2. 429 ----------------------------------------------------------------
{
  const r = await runCase(
    scriptedFetch({
      status: 429,
      body: JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded' } }),
    }),
    ctx(normal, 100),
  )
  add(
    '2',
    '429 on non-urgent work',
    `${r.outcome}/${r.nature} -> ${r.action}`,
    r.outcome === 'rate_limited' && r.action === 'retry',
  )
}

// --- 3. outage -------------------------------------------------------------
{
  const r = await runCase(deadFetch, ctx(normal, 100))
  add(
    '3',
    'provider outage on non-urgent work',
    `${r.outcome}/${r.nature} -> ${r.action}`,
    r.outcome === 'transport_error' && r.action === 'retry',
  )
}

// --- 3b. the same outage against URGENT work -------------------------------
// The acceptance sentence's second half. Same failure, different job, and the
// difference must be visible in the outcome rather than in a comment.
{
  const r = await runCase(deadFetch, ctx(urgent, 5))
  add(
    '3b',
    'the same outage on URGENT work raises a blocker',
    `${r.outcome}/${r.nature} -> ${r.action}`,
    r.action === 'blocker',
  )
}

// --- 4. malformed response -------------------------------------------------
{
  const r = await runCase(
    scriptedFetch({ status: 200, body: '<html>gateway</html>' }),
    ctx(normal, 100),
  )
  add(
    '4',
    'malformed (non-JSON) response',
    `${r.outcome}/${r.nature} -> ${r.action}`,
    r.outcome === 'malformed_response' && r.action === 'retry',
  )
}

// --- 5 & 6. provider disabled / all free providers exhausted ---------------
// These are the same state reached two ways: the allow-list is empty. Disabling
// the provider is how it is reached on purpose; every free endpoint refusing us
// is how it is reached by accident. §8 requires the kill-switch to empty the
// allow-list without touching a model row, so that is checked too.
{
  const usableBefore = Number(
    (await db.execute('select count(*)::int as n from public.usable_models')).rows[0]?.n,
  )
  const modelRowsBefore = Number(
    (await db.execute('select count(*)::int as n from public.provider_models')).rows[0]?.n,
  )
  await db.execute(`
    update public.providers set enabled = false, disabled_reason = 'gate 5 case 5'
    where provider = 'openrouter'
  `)
  const usableDisabled = Number(
    (await db.execute('select count(*)::int as n from public.usable_models')).rows[0]?.n,
  )
  const modelRowsDisabled = Number(
    (await db.execute('select count(*)::int as n from public.provider_models')).rows[0]?.n,
  )

  const r = await runCase(deadFetch, ctx(normal, 100))

  await db.execute(`
    update public.providers set enabled = true, disabled_reason = null
    where provider = 'openrouter'
  `)
  const usableAfter = Number(
    (await db.execute('select count(*)::int as n from public.usable_models')).rows[0]?.n,
  )

  add(
    '5',
    'provider disabled empties the allow-list without deleting a model',
    `usable ${usableBefore}->${usableDisabled}->${usableAfter}, model rows ${modelRowsBefore}->${modelRowsDisabled}`,
    usableDisabled === 0 && usableAfter === usableBefore && modelRowsDisabled === modelRowsBefore,
  )
  add(
    '6',
    'all free providers exhausted is systemic, so it pages rather than spinning',
    `${r.outcome}/${r.nature} -> ${r.action}`,
    r.outcome === 'unavailable' && r.nature === 'systemic' && r.action === 'blocker',
  )
}

// --- 7. a paid model accidentally returned by model discovery --------------
// The case the spec singles out. Discovery is *made* to be wrong: a genuinely
// paid model is inserted as `usable` with a recorded probe, which is the
// strongest form of the mistake — the registry itself vouches for it.
//
// The first run of this check found something the assertion had not expected.
// `public.usable_models` requires zero pricing IN ADDITION to `status =
// 'usable'` whenever the provider is `free_only`, so a paid model marked usable
// never reaches the allow-list at all. The mistake is contained one layer
// earlier than the test assumed. That is a better result, but only if it is
// recorded as what actually happened rather than folded into a pass, so this
// case now asserts both containments separately: the view excludes it, AND the
// pricing check refuses it even when handed an allow-list that does contain it.
{
  await db.execute(`
    insert into public.provider_models
      (provider, model_id, status, pricing_prompt, pricing_completion, last_success_at)
    values
      ('openrouter', 'gate5/fake-paid-model', 'usable', '0.000003', '0.000015', app.now_utc())
    on conflict (provider, model_id) do update
      set status = 'usable', pricing_prompt = '0.000003',
          pricing_completion = '0.000015', last_success_at = app.now_utc()
  `)
  const marked = Number(
    (
      await db.execute(
        `select count(*)::int as n from public.provider_models
         where model_id = 'gate5/fake-paid-model' and status = 'usable'`,
      )
    ).rows[0]?.n,
  )
  const listed = Number(
    (
      await db.execute(
        `select count(*)::int as n from public.usable_models where model_id = 'gate5/fake-paid-model'`,
      )
    ).rows[0]?.n,
  )

  const router = new ProviderRouter(db, orKey, deadFetch)
  let routerRefused = false
  let detail = ''
  try {
    await router.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gate5/fake-paid-model',
      maxTokens: 1,
    })
    detail = 'EXECUTED — the request was built'
  } catch (error) {
    routerRefused = error instanceof PaidCallPreventedError
    detail = routerRefused ? (error as Error).name : `wrong error: ${(error as Error).name}`
  }

  await db.execute(`delete from public.provider_models where model_id = 'gate5/fake-paid-model'`)

  add(
    '7a',
    'a paid model marked usable by discovery never reaches the allow-list',
    `status=usable in registry: ${marked === 1 ? 'yes' : 'no'}; on the allow-list: ${listed === 0 ? 'no' : 'YES'}; router: ${detail}`,
    marked === 1 && listed === 0 && routerRefused,
  )

  // And the layer behind it, in case the view's pricing clause is ever relaxed:
  // hand the guard an allow-list that DOES contain the paid model and confirm
  // the pricing check still refuses. Without this, case 7 would be resting
  // entirely on one SQL predicate.
  let guardRefused = false
  let guardReason = ''
  try {
    assertModelAllowed(
      'gate5/fake-paid-model',
      [
        {
          model_id: 'gate5/fake-paid-model',
          pricing_prompt: '0.000003',
          pricing_completion: '0.000015',
        },
      ],
      true,
    )
    guardReason = 'ALLOWED — the pricing check did not fire'
  } catch (error) {
    guardRefused = error instanceof PaidCallPreventedError
    guardReason = (error as Error).message.slice(0, 80)
  }
  add(
    '7b',
    'and the pricing check refuses it even when the allow-list does contain it',
    guardReason,
    guardRefused,
  )
}

// --- 8. router receives a model without verified free status ---------------
{
  const router = new ProviderRouter(db, orKey, deadFetch)
  const results: string[] = []
  let allRefused = true
  for (const model of ['openai/gpt-4o-mini', 'openrouter/auto', 'nobody/never-probed']) {
    try {
      await router.complete({ messages: [{ role: 'user', content: 'hi' }], model, maxTokens: 1 })
      results.push(`${model}=EXECUTED`)
      allRefused = false
    } catch (error) {
      const ok = error instanceof PaidCallPreventedError || error instanceof NoUsableModelError
      results.push(`${model}=${error instanceof Error ? error.name : 'unknown'}`)
      if (!ok) allRefused = false
    }
  }
  add('8', 'an unverified model is refused, by name or by absence', results.join(' '), allRefused)
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------
const after = await spend()
add('A1', 'no money was spent by any of the above', `usage ${before} -> ${after}`, after === before)

const usageAfter = await db.execute(`
  select outcome, provenance::text as provenance, count(*)::int as n
  from public.inference_usage
  where correlation_id in (${[normal.correlation_id, urgent.correlation_id]
    .map((c) => `'${String(c)}'`)
    .join(', ')})
  group by outcome, provenance order by outcome
`)
const totalUsage = usageAfter.rows.reduce((s, r) => s + Number(r.n), 0)
// Six, and derived rather than guessed: cases 1, 2, 3, 3b, 4 and 6 each make a
// call and record it. Cases 5, 7 and 8 are refused before a request exists, so
// there is nothing to account for — an inference that never happened is not
// usage. The first run of this check asserted seven and failed on that
// arithmetic, which is exactly the kind of error a `>=` would have hidden.
const EXPECTED_USAGE_ROWS = 6
add(
  'A2',
  'every attempt that reached the provider was recorded, successes and failures alike',
  `${usageAfter.rows
    .map((r) => `${String(r.outcome)}:${String(r.provenance)}=${String(r.n)}`)
    .join(' ')} (total ${totalUsage}, expected ${EXPECTED_USAGE_ROWS})`,
  totalUsage === EXPECTED_USAGE_ROWS,
)

const charged = await db.execute(`
  select count(*)::int as n from public.inference_usage where cost_usd > 0
`)
add(
  'A3',
  'not one usage row records a charge',
  `${String(charged.rows[0]?.n)} rows with cost_usd > 0`,
  Number(charged.rows[0]?.n) === 0,
)

const misclassified = await db.execute(`
  select count(*)::int as n from public.inference_usage
  where provenance = 'authoritative' and provider_reported_cost is null
`)
add(
  'A4',
  'no figure claims to be authoritative without the provider having reported it (§11)',
  `${String(misclassified.rows[0]?.n)} such rows (a CHECK constraint makes this impossible)`,
  Number(misclassified.rows[0]?.n) === 0,
)

const raised = await db.execute(`
  select count(*)::int as n, bool_and(length(consequences_of_delay) > 3) as complete
  from public.blockers where job_id in ('${String(normal.job_id)}', '${String(urgent.job_id)}')
`)
add(
  'A5',
  'blocked work raised structured blockers, each with its consequences and options',
  `${String(raised.rows[0]?.n)} blockers, all fields populated: ${String(raised.rows[0]?.complete)}`,
  Number(raised.rows[0]?.n) === 2 && raised.rows[0]?.complete === true,
)

const nonUrgentBlockers = await db.execute(`
  select count(*)::int as n from public.blockers
  where job_id = '${String(normal.job_id)}' and work_can_continue = false
`)
add(
  'A6',
  'the non-urgent job raised exactly one blocker, and only for the systemic failure',
  `${String(nonUrgentBlockers.rows[0]?.n)} (its 429, outage and malformed cases queued silently)`,
  Number(nonUrgentBlockers.rows[0]?.n) === 1,
)

// The usage ledger is append-only for the same reason the event ledger is.
let usageImmutable = false
try {
  await db.execute(
    `update public.inference_usage set cost_usd = 99 where correlation_id = '${String(normal.correlation_id)}'`,
  )
} catch (error) {
  usageImmutable = /append-only|immutable|cannot be/i.test((error as Error).message)
}
add(
  'A7',
  'a usage figure cannot be quietly rewritten',
  usageImmutable ? 'the trigger refused the UPDATE' : 'THE UPDATE SUCCEEDED',
  usageImmutable,
)

// --- clean up -------------------------------------------------------------
// The jobs and their blockers stay: they are the evidence. The probe jobs are
// drained to a terminal state so the recovery sweep does not pick them up.
await db.execute(`
  update public.blockers set state = 'withdrawn', resolved_at = app.now_utc(),
    resolution = 'gate 5 evidence run'
  where job_id in ('${String(normal.job_id)}', '${String(urgent.job_id)}')
`)
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'gate 5 evidence run complete'
  where job_id in ('${String(normal.job_id)}', '${String(urgent.job_id)}')
`)

console.log('\n| # | check | outcome | |')
console.log('|---|---|---|---|')
for (const r of rows)
  console.log(`| ${r.n} | ${r.what} | ${r.outcome} | ${r.passed ? '✅' : '❌'} |`)
const failed = rows.filter((r) => !r.passed)
console.log(
  `\n${rows.length - failed.length}/${rows.length} checks passed` +
    ` · usage rows added: ${usageAfter.rows.length > 0 ? totalUsage : 0}` +
    ` · open blockers before: ${blockersBefore} · usage rows before: ${usageBefore}`,
)
if (failed.length > 0) process.exit(1)
