/**
 * The four inference enforcement layers of master spec §11.
 *
 * All of them are injected HERE, by the wrapper. §11 is explicit that they are
 * *"never by callers"*, and the reason is structural rather than stylistic: a
 * guard a caller can forget is a guard that will be forgotten, and the failure
 * mode is a silent charge rather than an error.
 *
 * Layer  What it does                                         Verified
 * -----  ---------------------------------------------------  --------------
 *   1    provider.max_price at the provider's budget,         404, prevents
 *        allow_fallbacks false
 *   2    a dedicated key with a hard spend cap                limit: 5
 *   3    allow-list from measured probes, not pricing         ADR-0009
 *   4    post-response breaker on usage.cost above budget     here
 *
 * ## The budget is data, not zero
 *
 * Until 2026-09-15 every one of these layers was hardcoded to ZERO, because
 * the office ran only on free models. Moving to a low-cost paid model does not
 * remove a single layer — it gives each one a number to compare against, held
 * on the `providers` row where Grant can change it. A budget of zero is still
 * expressible and is still the DEFAULT, so a provider nobody has funded behaves
 * exactly as it did before this change.
 *
 * Evidence for 1 and 3: docs/test-evidence/phase-2-inference-guards.md.
 */

/** Zero budget in every dimension OpenRouter prices. */
export const ZERO_MAX_PRICE = {
  prompt: 0,
  completion: 0,
  request: 0,
  image: 0,
} as const

/**
 * Provider options forced onto every request.
 *
 * Each field answers one of §11's three "silent hazards":
 *
 * - `allow_fallbacks: false` — it defaults to **true**, and a fallback is
 *   precisely how a refused free model becomes a paid one.
 * - `data_collection: 'deny'` — it defaults to **"allow"**. Measured cost of
 *   denying: 8 of 21 free models become unavailable (ADR-0009). That is the
 *   privacy posture working, and D2 Option B bought it deliberately.
 * - `max_price` all zero — documented to *prevent execution*, not derank, and
 *   confirmed: a paid model returns `404 No endpoints found that satisfy the
 *   max price for this request`.
 */
export const FORCED_PROVIDER_OPTIONS = {
  allow_fallbacks: false,
  data_collection: 'deny',
  max_price: ZERO_MAX_PRICE,
} as const

/**
 * What a provider is permitted to charge.
 *
 * `maxPricePrompt` and `maxPriceCompletion` are US dollars per MILLION tokens,
 * which is the unit OpenRouter's `max_price` speaks; `maxCostPerCallUsd` is
 * dollars for one response, which is the unit `usage.cost` speaks. They are
 * different units on purpose — layer 1 refuses an endpoint before it runs and
 * layer 4 refuses a response after it has — and conflating them is how a
 * per-million ceiling gets compared against a per-call charge and passes a
 * thousand-fold overspend.
 */
export interface Budget {
  readonly maxPricePrompt: number
  readonly maxPriceCompletion: number
  readonly maxCostPerCallUsd: number
}

/** The budget every provider has until somebody funds it. */
export const NO_BUDGET: Budget = {
  maxPricePrompt: 0,
  maxPriceCompletion: 0,
  maxCostPerCallUsd: 0,
} as const

/**
 * Layer 1, at the budget the provider actually has.
 *
 * `data_collection: 'deny'` is NOT part of the budget and never becomes
 * configurable here: it is the privacy posture D2 Option B bought, and it
 * applies to every candidate endpoint whatever the price ceiling says.
 *
 * ## Why `allow_fallbacks` follows the budget
 *
 * It is pinned false at zero budget, exactly as it always was, and true once a
 * ceiling exists. That reads like a safeguard being relaxed and is the
 * opposite, because of what the flag actually controls.
 *
 * `provider.allow_fallbacks` chooses among the UPSTREAM HOSTS serving the one
 * model in the request. It has never been able to change WHICH MODEL answers
 * — that is the top-level `models` array, which this office does not send and
 * `buildRequestBody` has no field for. So the hazard the flag was written for
 * was never "a different model": it was "a free model is refused and the
 * request lands on a host that charges", and with `max_price` all zero there
 * was nothing else to prevent that. The flag WAS the price bound.
 *
 * Now the price bound is the price bound. Every candidate host has to satisfy
 * the ceiling below, so the worst a fallback can do is cost the same as the
 * endpoint it replaced.
 *
 * Measured, 2026-09-15, which is why this is not a theoretical tidy-up: pinned
 * to one host, `openai/gpt-oss-120b` returned `429 queue_timeout` from AkashML
 * with `limit_source: upstream_provider_shared_pool`. The identical request
 * with fallbacks allowed and the same ceiling was served by Groq, http 200. A
 * paid model pinned to the single cheapest host is a paid model with a free
 * model's availability, which is most of what Grant is paying to leave behind.
 */
export function forcedProviderOptions(budget: Budget = NO_BUDGET): Record<string, unknown> {
  const funded = budget.maxPricePrompt > 0 || budget.maxPriceCompletion > 0
  return {
    allow_fallbacks: funded,
    data_collection: 'deny',
    max_price: {
      prompt: budget.maxPricePrompt,
      completion: budget.maxPriceCompletion,
      request: 0,
      image: 0,
    },
  }
}

/**
 * Model identifiers that must never be sent, whatever a registry says.
 *
 * `openrouter/auto` and its `:free` variant price at `-1` — dynamically priced.
 * §11 warns that `:free` on a router is a no-op; measurement confirms both
 * report `-1` while only `openrouter/free` reports `0`. A `-1` must never be
 * numerically compared against a budget, because it reads as cheaper than free.
 *
 * This is a denylist on top of an allow-list, which is normally redundant. It
 * is kept because these three are the specific identifiers a person or a model
 * is most likely to reach for by name.
 */
export const NEVER_CALL = new Set([
  'openrouter/auto',
  'openrouter/auto:free',
  'openrouter/auto-beta',
])

export class PaidCallPreventedError extends Error {
  constructor(
    readonly model: string,
    readonly reason: string,
  ) {
    super(`refusing to call ${model}: ${reason}`)
    this.name = 'PaidCallPreventedError'
  }
}

/**
 * Layer 4. A response that cost more than the provider's budget means the
 * earlier layers were bypassed, which is a defect rather than an expense to
 * absorb.
 *
 * `usage.cost` absent is treated as suspicious, not as zero: a provider that
 * stops reporting cost is a provider we can no longer verify, and §11's
 * "'free' means measured, not assumed" applies to the response as much as to
 * the registry. That half does not relax when a budget exists — it gets
 * STRICTER, because an unreported cost against a funded key is a charge nobody
 * can see.
 *
 * `ceilingUsd` defaults to zero, so a caller that has not thought about a
 * budget gets the behaviour this function had when it was called
 * `assertResponseWasFree`: any charge at all is a defect.
 *
 * The ceiling is per RESPONSE, not per day. It is not a spend limit — layer 2's
 * key cap is — it is a tripwire on the single call, sized so that a routine
 * answer never approaches it and a mis-routed request to something expensive
 * cannot complete quietly. Measured 2026-09-15 on gpt-oss-120b: a real office
 * turn costs about $0.0001, so a $0.01 ceiling is a hundredfold headroom.
 */
export function assertResponseWithinBudget(
  model: string,
  usage: { cost?: number | null } | undefined,
  ceilingUsd = 0,
): void {
  if (usage === undefined || usage.cost === undefined || usage.cost === null) {
    throw new PaidCallPreventedError(
      model,
      'the provider reported no usage.cost, so this call cannot be verified as within budget',
    )
  }
  if (usage.cost > ceilingUsd) {
    throw new PaidCallPreventedError(
      model,
      `the response reported cost ${usage.cost}, above this provider's ` +
        `per-call ceiling of ${ceilingUsd}, so an earlier layer was bypassed`,
    )
  }
}

/** Is this pricing string genuinely free? */
export function isZeroPriced(prompt: string | null, completion: string | null): boolean {
  // Deliberately a string comparison. Parsing "-1" to a number and comparing
  // against a budget would treat a dynamically-priced router as cheaper than
  // free, which is the exact hazard §11 names.
  return prompt === '0' && completion === '0'
}

export interface AllowedModel {
  readonly model_id: string
  readonly pricing_prompt: string | null
  readonly pricing_completion: string | null
}

/**
 * Layer 3 at the call site: may this model be sent?
 *
 * Takes the allow-list as data rather than reading the database, so it is pure
 * and every branch has a test.
 */
export function assertModelAllowed(
  model: string,
  allowList: readonly AllowedModel[],
  freeOnly: boolean,
): void {
  if (NEVER_CALL.has(model)) {
    throw new PaidCallPreventedError(
      model,
      'this identifier is dynamically priced (-1), never free',
    )
  }

  const entry = allowList.find((m) => m.model_id === model)
  if (entry === undefined) {
    throw new PaidCallPreventedError(
      model,
      'not in the measured allow-list — a model is callable only after a probe ' +
        'executed it within budget (ADR-0009)',
    )
  }

  if (freeOnly && !isZeroPriced(entry.pricing_prompt, entry.pricing_completion)) {
    throw new PaidCallPreventedError(
      model,
      `free_only is set and pricing is prompt=${String(entry.pricing_prompt)} ` +
        `completion=${String(entry.pricing_completion)}`,
    )
  }
}

/**
 * Build the request body, with the guards applied last.
 *
 * Applying them last is the point: a caller cannot override them by passing
 * their own `provider` block, because theirs is merged underneath.
 */
export function buildRequestBody(
  model: string,
  body: Record<string, unknown>,
  budget: Budget = NO_BUDGET,
): Record<string, unknown> {
  const callerProvider =
    typeof body.provider === 'object' && body.provider !== null
      ? (body.provider as Record<string, unknown>)
      : {}

  return {
    ...body,
    model,
    // Caller options first, forced options second. Order is the enforcement.
    provider: { ...callerProvider, ...forcedProviderOptions(budget) },
  }
}
