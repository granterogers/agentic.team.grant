/**
 * Prove the office cannot be moved onto a different model without saying so.
 *
 *   npm run verify:fallback
 *
 * ## Why this exists separately from verify:router
 *
 * `verify:router` asks whether the router works. This asks the question Grant
 * put after the paid switch, which is narrower and sharper: the primary model
 * passing acceptance is not sufficient if automatic failover can silently move
 * production onto a materially different one.
 *
 * Six properties, each of which would be a real hazard if it failed:
 *
 *   1. failover happens only under intended conditions
 *   2. the budget and the privacy posture hold on every candidate, not the first
 *   3. which model actually answered is observable, in the result and the ledger
 *   4. an exhausted failover fails truthfully, naming what it tried
 *   5. failover cannot bypass provenance, action or safety enforcement
 *   6. there is no uncontrolled paid-spend path
 *
 * ## How it is instrumented
 *
 * The allow-list, the budget and the breaker come from the REAL database, so
 * this measures the registry Grant actually runs. Only `fetch` is faked, and
 * it is faked because the alternative is waiting for a model to be genuinely
 * rate-limited at the moment the suite runs -- which is a suite that passes or
 * fails on the weather. The final section makes one real call.
 *
 * It spends a few hundredths of a penny and asserts that it did, because a
 * spend check that can only ever read zero is not measuring anything.
 */
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { buildRequestBody, PaidCallPreventedError } from '../../src/providers/guards.ts'
import {
  AllCandidatesFailedError,
  DEFAULT_MAX_ATTEMPTS,
  ProviderRouter,
} from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: { what: string; outcome: string; passed: boolean }[] = []
const add = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
}

// --- the registry, as production sees it -----------------------------------

const provider = (
  await db.execute(`
    select free_only, max_price_prompt, max_price_completion, max_cost_per_call_usd
      from public.providers where provider = 'openrouter'
  `)
).rows[0] as {
  free_only: boolean
  max_price_prompt: string
  max_price_completion: string
  max_cost_per_call_usd: string
}
const ceilingPrompt = Number(provider.max_price_prompt)
const ceilingCompletion = Number(provider.max_price_completion)
const perCall = Number(provider.max_cost_per_call_usd)
const budget = {
  maxPricePrompt: ceilingPrompt,
  maxPriceCompletion: ceilingCompletion,
  maxCostPerCallUsd: perCall,
}

// The router's own ordering, restated once here and nowhere else in this file.
const usable = (
  await db.execute(`
    select model_id, pricing_prompt, pricing_completion, model_priority
      from public.usable_models
     order by priority, model_priority, model_id
  `)
).rows as {
  model_id: string
  pricing_prompt: string
  pricing_completion: string
  model_priority: number
}[]

const order = usable.map((m) => m.model_id)
const candidates = order.slice(0, DEFAULT_MAX_ATTEMPTS)

console.log(
  `provider budget: prompt <= $${ceilingPrompt}/M, completion <= $${ceilingCompletion}/M, one response <= $${perCall}`,
)
console.log(`candidate order: ${candidates.join(' -> ')}`)
console.log(`${String(order.length)} usable model(s) in total\n`)

// --- a fake provider, so failover is driven rather than waited for ---------

interface Sent {
  model: string
  provider: Record<string, unknown>
}

/**
 * A fetch that plays a script of outcomes and records every body it was given.
 *
 * `outcomes` is consumed one per request: 'ok' answers, 'rate_limited' returns
 * the shape OpenRouter returns for a 429, and a number answers with that
 * usage.cost so layer 4 can be driven.
 */
const scripted = (
  outcomes: readonly ('ok' | 'rate_limited' | number)[],
): { fetchImpl: typeof fetch; sent: Sent[] } => {
  const sent: Sent[] = []
  let i = 0
  const fetchImpl = (async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Sent
    sent.push(body)
    const outcome = outcomes[i] ?? 'rate_limited'
    i += 1
    if (outcome === 'rate_limited') {
      return new Response(
        JSON.stringify({ error: { code: 429, message: 'injected rate limit' } }),
        { status: 200 },
      )
    }
    const cost = outcome === 'ok' ? 0.00002 : outcome
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ finish_reason: 'stop', message: { content: 'ready' } }],
        usage: { cost, prompt_tokens: 10, completion_tokens: 2 },
      }),
      { status: 200 },
    )
  }) as unknown as typeof fetch
  return { fetchImpl, sent }
}

const ask = {
  messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
  maxTokens: 512,
}

/**
 * Undo the failures this suite invented.
 *
 * The injected 429s are not provider failures -- they never left this process
 * -- but the router cannot tell, so it records them and the breaker opens on
 * the REAL provider. Left alone that is a suite which takes the office offline
 * for an hour in order to prove the office stays online, and the first run did
 * exactly that: nine fabricated failures, breaker open, every real job refused.
 *
 * So each block that injects failures repairs the health row afterwards. It
 * restores the SNAPSHOT rather than recording a success, because claiming a
 * success that did not happen is the same class of lie this office is being
 * tested for.
 *
 * verify:router injects one of these too, and has been spending one of the
 * breaker's allowed failures on every run since it was written.
 */
const HEALTH =
  'provider, state, consecutive_failures, opened_at, next_probe_at, ' +
  'cooldown_seconds, last_success_at, last_failure_at, last_error'
const snapshot = (
  await db.execute(`select ${HEALTH} from public.provider_health where provider = 'openrouter'`)
).rows[0] as Record<string, unknown> | undefined

const lit = (v: unknown): string =>
  v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`

const restoreHealth = async (): Promise<void> => {
  if (snapshot === undefined) return
  await db.execute(`
    update public.provider_health
       set state = ${lit(snapshot.state)}::public.breaker_state,
           consecutive_failures = ${String(Number(snapshot.consecutive_failures ?? 0))},
           opened_at = ${lit(snapshot.opened_at)}::timestamptz,
           next_probe_at = ${lit(snapshot.next_probe_at)}::timestamptz,
           last_failure_at = ${lit(snapshot.last_failure_at)}::timestamptz,
           last_error = ${lit(snapshot.last_error)}
     where provider = 'openrouter'
  `)
}

// ===========================================================================
// 1. Failover happens only under intended conditions
// ===========================================================================

{
  const { fetchImpl, sent } = scripted(['ok'])
  const r = await new ProviderRouter(db, '', fetchImpl).complete(ask)
  add(
    'a healthy primary is never bypassed',
    `answered by ${r.model} after ${String(sent.length)} request(s)`,
    r.model === candidates[0] && sent.length === 1,
  )
  await restoreHealth()
}

{
  const { fetchImpl, sent } = scripted(['rate_limited', 'ok'])
  const r = await new ProviderRouter(db, '', fetchImpl).complete(ask)
  add(
    'a rate-limited primary moves to the next candidate, and stops there',
    `${sent.map((s) => s.model).join(' -> ')}, answered by ${r.model}`,
    sent.length === 2 && sent[0]?.model === candidates[0] && r.model === candidates[1],
  )
  await restoreHealth()
}

{
  // A named model is a decision somebody made. Answering on a different one
  // would make the recorded provenance a lie.
  const { fetchImpl, sent } = scripted(['rate_limited', 'ok'])
  let threw = ''
  try {
    await new ProviderRouter(db, '', fetchImpl).complete({ ...ask, model: candidates[0] as string })
  } catch (error) {
    threw = (error as Error).name
  }
  add(
    'a caller-named model never fails over to a different one',
    `${threw === '' ? 'did NOT throw' : threw} after ${String(sent.length)} request(s)`,
    threw !== '' && sent.length === 1,
  )
  await restoreHealth()
}

{
  // Layer 4 firing is a defect report, not a reason to shop elsewhere: moving
  // on would hide a bypassed guard behind a success.
  const over = perCall + 1
  const { fetchImpl, sent } = scripted([over, 'ok'])
  let threw = ''
  try {
    await new ProviderRouter(db, '', fetchImpl).complete(ask)
  } catch (error) {
    threw =
      error instanceof PaidCallPreventedError ? 'PaidCallPreventedError' : (error as Error).name
  }
  add(
    'a charge above the ceiling stops the call, it does not fail over',
    `${threw} after ${String(sent.length)} request(s) (injected cost $${String(over)} vs ceiling $${String(perCall)})`,
    threw === 'PaidCallPreventedError' && sent.length === 1,
  )
  await restoreHealth()
}

{
  const { fetchImpl, sent } = scripted(new Array(10).fill('rate_limited'))
  try {
    await new ProviderRouter(db, '', fetchImpl).complete(ask)
  } catch {
    // asserted below
  }
  add(
    'the walk is bounded — a bad afternoon does not become ten requests',
    `${String(sent.length)} request(s) for a maximum of ${String(DEFAULT_MAX_ATTEMPTS)}`,
    sent.length === DEFAULT_MAX_ATTEMPTS,
  )
  await restoreHealth()
}

// ===========================================================================
// 2. The budget and the privacy posture hold on EVERY candidate
// ===========================================================================

{
  const { fetchImpl, sent } = scripted(['rate_limited', 'rate_limited', 'ok'])
  await new ProviderRouter(db, '', fetchImpl).complete(ask)
  const bad = sent.filter(
    (s) =>
      s.provider.data_collection !== 'deny' ||
      JSON.stringify(s.provider.max_price) !==
        JSON.stringify({
          prompt: ceilingPrompt,
          completion: ceilingCompletion,
          request: 0,
          image: 0,
        }),
  )
  add(
    'every candidate in a full failover carried deny and the same ceiling',
    `${String(sent.length)} request(s) inspected, ${String(bad.length)} without the posture`,
    sent.length === DEFAULT_MAX_ATTEMPTS && bad.length === 0,
  )
  await restoreHealth()
}

{
  // Not only the three the router would reach today. A model promoted into the
  // top three tomorrow must not arrive with a different posture.
  const wrong = order.filter((model) => {
    const sentProvider = buildRequestBody(model, { messages: [] }, budget).provider as Record<
      string,
      unknown
    >
    return sentProvider.data_collection !== 'deny'
  })
  add(
    'data_collection deny is carried for every usable model, not just the candidates',
    `${String(order.length)} model(s) checked, ${String(wrong.length)} without deny`,
    order.length > 0 && wrong.length === 0,
  )
  await restoreHealth()
}

// ===========================================================================
// 3. Which model answered is observable
// ===========================================================================

{
  const { fetchImpl } = scripted(['rate_limited', 'ok'])
  const r = await new ProviderRouter(db, '', fetchImpl).complete(ask)
  add(
    'the result names the model that actually served it, not the one asked for',
    `requested order began ${String(candidates[0])}, result says ${r.model}`,
    r.model === candidates[1] && r.model !== candidates[0],
  )
  await restoreHealth()
}

{
  const correlationId = crypto.randomUUID()
  const { fetchImpl } = scripted(['rate_limited', 'ok'])
  await new ProviderRouter(db, '', fetchImpl).complete({ ...ask, correlationId })
  const rows = (
    await db.execute(`
      select model_id, outcome from public.inference_usage
       where correlation_id = '${correlationId}' order by occurred_at
    `)
  ).rows as { model_id: string; outcome: string }[]
  const models = rows.map((r) => `${r.model_id}=${r.outcome}`)
  add(
    'the ledger records the attempt that failed AND the one that answered',
    models.join(', ') || 'no rows',
    rows.length === 2 &&
      rows[0]?.outcome === 'rate_limited' &&
      rows[1]?.outcome === 'ok' &&
      rows[0]?.model_id !== rows[1]?.model_id,
  )
  await restoreHealth()
}

// ===========================================================================
// 4. An exhausted failover fails truthfully
// ===========================================================================

{
  const { fetchImpl } = scripted(['rate_limited', 'rate_limited', 'rate_limited'])
  let message = ''
  let named = false
  try {
    await new ProviderRouter(db, '', fetchImpl).complete(ask)
  } catch (error) {
    message = (error as Error).message
    named =
      error instanceof AllCandidatesFailedError &&
      candidates.every((c) => (error as AllCandidatesFailedError).candidates.includes(c))
  }
  add(
    'all candidates failing names every model tried, rather than "inference failed"',
    message.slice(0, 110),
    named,
  )
  await restoreHealth()
}

// ===========================================================================
// 5. Failover cannot bypass provenance, action or safety enforcement
// ===========================================================================
//
// The strongest form of this is structural rather than behavioural. The
// coherence gate takes an output and its metadata; there is no model field on
// OutputMetadata and no branch in the gate that could read one. A gate that
// CANNOT know which model produced an answer cannot be relaxed by changing it.

{
  const quality = await readFile('src/agents/quality.ts', 'utf8')
  const mentions = order.filter((model) => quality.includes(model))
  const hasModelField = /readonly\s+model\s*[?]?:/.test(quality)
  add(
    'the quality gate cannot see which model produced an answer',
    `${String(mentions.length)} model id(s) named in the gate, model field on OutputMetadata: ${String(hasModelField)}`,
    mentions.length === 0 && !hasModelField,
  )
  await restoreHealth()
}

{
  // And the same for the provenance layer, which is the other enforcement the
  // office relies on to stay honest.
  const prov = await readFile('src/agents/provenance.ts', 'utf8')
  const mentions = order.filter((model) => prov.includes(model))
  add(
    'the provenance layer cannot see which model produced an answer either',
    `${String(mentions.length)} model id(s) named in src/agents/provenance.ts`,
    mentions.length === 0,
  )
  await restoreHealth()
}

// ===========================================================================
// 6. No uncontrolled paid-spend path
// ===========================================================================

{
  const funded = (
    await db.execute(`
      select provider, max_price_prompt, max_price_completion from public.providers
       where enabled and (max_price_prompt > 0 or max_price_completion > 0)
    `)
  ).rows as { provider: string }[]
  add(
    'exactly one provider is funded, and it is the one Grant funded',
    funded.map((f) => f.provider).join(', ') || 'none',
    funded.length === 1 && funded[0]?.provider === 'openrouter',
  )
  await restoreHealth()
}

{
  // A model whose LISTED price is above the ceiling would be refused by layer 1
  // at request time, but it should never have reached the allow-list either.
  const tooDear = usable.filter(
    (m) =>
      Number(m.pricing_prompt) * 1e6 > ceilingPrompt ||
      Number(m.pricing_completion) * 1e6 > ceilingCompletion,
  )
  add(
    'every model in the allow-list is priced inside the ceiling',
    tooDear.length === 0
      ? `${String(usable.length)} model(s), dearest ${String(
          Math.max(...usable.map((m) => Number(m.pricing_completion) * 1e6)),
        )}/M completion`
      : tooDear.map((m) => m.model_id).join(', '),
    tooDear.length === 0,
  )
  await restoreHealth()
}

{
  const { fetchImpl, sent } = scripted(['ok'])
  let threw = ''
  try {
    await new ProviderRouter(db, '', fetchImpl).complete({
      ...ask,
      model: 'anthropic/claude-opus-4.1',
    })
  } catch (error) {
    threw =
      error instanceof PaidCallPreventedError ? 'PaidCallPreventedError' : (error as Error).name
  }
  add(
    'an expensive model outside the allow-list cannot be reached by naming it',
    `${threw}, ${String(sent.length)} request(s) made`,
    threw === 'PaidCallPreventedError' && sent.length === 0,
  )
  await restoreHealth()
}

// ===========================================================================
// 7. One real failover, against the real provider
// ===========================================================================
//
// Everything above fakes the transport. That is the right instrument for a
// property that must hold for ANY provider behaviour, and it would be a poor
// place to stop: a fake cannot tell us the second model is actually reachable
// today, which is the whole point of having one.

{
  let first = true
  const flaky = (async (url: string, init: RequestInit): Promise<Response> => {
    if (first) {
      first = false
      return new Response(
        JSON.stringify({ error: { code: 429, message: 'injected rate limit' } }),
        {
          status: 200,
        },
      )
    }
    return fetch(url, init)
  }) as unknown as typeof fetch

  const correlationId = crypto.randomUUID()
  try {
    const r = await new ProviderRouter(db, '', flaky).complete({ ...ask, correlationId })
    // The property, not the artefact: SOME model other than the primary
    // answered, for real, inside the ceiling. Naming candidates[1] here went
    // red on its first run because qwen was also refusing at that moment and
    // the office correctly walked on to the third -- which is the mechanism
    // working, reported as a failure.
    add(
      'a real model other than the primary answers, for real, within the ceiling',
      `${r.model} answered ${JSON.stringify(r.content.slice(0, 24))} at $${r.cost.toFixed(8)}`,
      r.content.length > 0 &&
        r.model !== candidates[0] &&
        order.includes(r.model) &&
        r.cost > 0 &&
        r.cost <= perCall,
    )
  } catch (error) {
    add(
      'a real model other than the primary answers, for real, within the ceiling',
      `FAILED: ${(error as Error).message.slice(0, 110)}`,
      false,
    )
  }
}

// ---------------------------------------------------------------------------

console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const passed = checks.filter((c) => c.passed).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
