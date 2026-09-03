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
 *   1    provider.max_price all-zero, allow_fallbacks false   404, prevents
 *   2    a dedicated key with a hard spend cap                limit: 5
 *   3    allow-list from measured probes, not pricing         ADR-0009
 *   4    post-response breaker on usage.cost > 0              here
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
 * Layer 4. A response that reports a non-zero cost means the earlier layers
 * were bypassed, which is a defect rather than an expense to absorb.
 *
 * `usage.cost` absent is treated as suspicious, not as zero: a provider that
 * stops reporting cost is a provider we can no longer verify, and §11's
 * "'free' means measured, not assumed" applies to the response as much as to
 * the registry.
 */
export function assertResponseWasFree(
  model: string,
  usage: { cost?: number | null } | undefined,
): void {
  if (usage === undefined || usage.cost === undefined || usage.cost === null) {
    throw new PaidCallPreventedError(
      model,
      'the provider reported no usage.cost, so this call cannot be verified as free',
    )
  }
  if (usage.cost > 0) {
    throw new PaidCallPreventedError(
      model,
      `the response reported cost ${usage.cost}, so an earlier layer was bypassed`,
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
        'executed it at zero cost (ADR-0009)',
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
): Record<string, unknown> {
  const callerProvider =
    typeof body.provider === 'object' && body.provider !== null
      ? (body.provider as Record<string, unknown>)
      : {}

  return {
    ...body,
    model,
    // Caller options first, forced options second. Order is the enforcement.
    provider: { ...callerProvider, ...FORCED_PROVIDER_OPTIONS },
  }
}
