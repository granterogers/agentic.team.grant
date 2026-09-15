import { describe, expect, it } from 'vitest'
import type { AllowedModel } from '../../src/providers/guards.ts'
import {
  assertModelAllowed,
  assertResponseWithinBudget,
  buildRequestBody,
  FORCED_PROVIDER_OPTIONS,
  isZeroPriced,
  NEVER_CALL,
  PaidCallPreventedError,
  ZERO_MAX_PRICE,
} from '../../src/providers/guards.ts'

const free = (id: string): AllowedModel => ({
  model_id: id,
  pricing_prompt: '0',
  pricing_completion: '0',
})
const ALLOW: AllowedModel[] = [free('minimax/minimax-m3:free'), free('openrouter/free')]

describe('layer 1 — forced provider options', () => {
  it('sets a zero budget in every priced dimension', () => {
    expect(ZERO_MAX_PRICE).toEqual({ prompt: 0, completion: 0, request: 0, image: 0 })
  })

  it('disables fallbacks, because they default to true', () => {
    // A fallback is precisely how a refused free model becomes a paid one.
    expect(FORCED_PROVIDER_OPTIONS.allow_fallbacks).toBe(false)
  })

  it('denies data collection, because it defaults to allow', () => {
    expect(FORCED_PROVIDER_OPTIONS.data_collection).toBe('deny')
  })
})

describe('the guards cannot be overridden by a caller', () => {
  it('applies forced options over a caller-supplied provider block', () => {
    const body = buildRequestBody('minimax/minimax-m3:free', {
      messages: [],
      provider: { allow_fallbacks: true, data_collection: 'allow', max_price: { prompt: 99 } },
    })
    expect(body.provider).toEqual(FORCED_PROVIDER_OPTIONS)
  })

  it('keeps caller options that are not guards', () => {
    const body = buildRequestBody('minimax/minimax-m3:free', {
      messages: [],
      provider: { order: ['minimax'], allow_fallbacks: true },
    })
    expect((body.provider as Record<string, unknown>).order).toEqual(['minimax'])
    expect((body.provider as Record<string, unknown>).allow_fallbacks).toBe(false)
  })

  it('overrides a caller-supplied model with the vetted one', () => {
    const body = buildRequestBody('minimax/minimax-m3:free', {
      model: 'openai/gpt-4o',
      messages: [],
    })
    expect(body.model).toBe('minimax/minimax-m3:free')
  })

  it('tolerates a caller passing no provider block at all', () => {
    const body = buildRequestBody('openrouter/free', { messages: [] })
    expect(body.provider).toEqual(FORCED_PROVIDER_OPTIONS)
  })

  it('tolerates a caller passing provider: null', () => {
    const body = buildRequestBody('openrouter/free', { messages: [], provider: null })
    expect(body.provider).toEqual(FORCED_PROVIDER_OPTIONS)
  })
})

describe('isZeroPriced', () => {
  it('accepts "0"/"0"', () => {
    expect(isZeroPriced('0', '0')).toBe(true)
  })

  it('rejects "-1", the dynamically-priced router value', () => {
    // The hazard: parsed as a number, -1 < 0 reads as cheaper than free.
    expect(isZeroPriced('-1', '-1')).toBe(false)
    expect(Number('-1') < Number('0')).toBe(true)
  })

  it.each([
    ['0', '0.0000006'],
    ['0.0000006', '0'],
    ['0.000001', '0.000001'],
    [null, '0'],
    ['0', null],
    [null, null],
  ])('rejects prompt=%s completion=%s', (p, c) => {
    expect(isZeroPriced(p, c)).toBe(false)
  })
})

describe('layer 3 — the measured allow-list', () => {
  it('allows a probed, zero-priced model', () => {
    expect(() => assertModelAllowed('minimax/minimax-m3:free', ALLOW, true)).not.toThrow()
  })

  it('refuses a model absent from the allow-list', () => {
    expect(() => assertModelAllowed('openai/gpt-4o-mini', ALLOW, true)).toThrow(
      PaidCallPreventedError,
    )
  })

  it('explains that absence means unprobed rather than unknown', () => {
    expect(() => assertModelAllowed('openai/gpt-4o-mini', ALLOW, true)).toThrow(
      /measured allow-list/,
    )
  })

  it.each([...NEVER_CALL])('refuses %s even if something put it on the allow-list', (model) => {
    // The denylist sits ON TOP of the allow-list, because these are the
    // identifiers a person or a model is most likely to reach for by name.
    const poisoned = [...ALLOW, free(model)]
    expect(() => assertModelAllowed(model, poisoned, true)).toThrow(/dynamically priced/)
  })

  it('refuses a non-zero-priced model under free_only, even if allow-listed', () => {
    const list: AllowedModel[] = [
      { model_id: 'x/y', pricing_prompt: '0.000001', pricing_completion: '0' },
    ]
    expect(() => assertModelAllowed('x/y', list, true)).toThrow(/free_only is set/)
  })

  it('permits a priced model when free_only is off — voice needs this', () => {
    // Gate 1's Realtime models have no free tier, which is why D3 is an
    // explicitly funded decision rather than a default.
    const list: AllowedModel[] = [
      {
        model_id: 'gpt-realtime-2.1-mini',
        pricing_prompt: '0.00001',
        pricing_completion: '0.00002',
      },
    ]
    expect(() => assertModelAllowed('gpt-realtime-2.1-mini', list, false)).not.toThrow()
  })

  it('still refuses a denylisted identifier when free_only is off', () => {
    const list = [free('openrouter/auto')]
    expect(() => assertModelAllowed('openrouter/auto', list, false)).toThrow(/dynamically priced/)
  })
})

describe('layer 4 — post-response breaker', () => {
  it('accepts a zero-cost response', () => {
    expect(() => assertResponseWithinBudget('m', { cost: 0 })).not.toThrow()
  })

  it('throws when the response reports any cost', () => {
    expect(() => assertResponseWithinBudget('m', { cost: 0.000001 })).toThrow(
      /an earlier layer was bypassed/,
    )
  })

  it('treats a missing usage block as unverifiable, not free', () => {
    // A provider that stops reporting cost is one we can no longer verify.
    expect(() => assertResponseWithinBudget('m', undefined)).toThrow(
      /cannot be verified as within budget/,
    )
  })

  it('treats an absent cost key as unverifiable', () => {
    // The two shapes a parsed JSON response can actually take. The compiler
    // rejected an explicit `{ cost: undefined }` under
    // exactOptionalPropertyTypes, which was right: JSON cannot produce it, so
    // a test asserting on it would be testing an unreachable state.
    expect(() => assertResponseWithinBudget('m', {})).toThrow(/cannot be verified as within budget/)
  })

  it('treats cost: null as unverifiable', () => {
    expect(() => assertResponseWithinBudget('m', { cost: null })).toThrow(
      /cannot be verified as within budget/,
    )
  })

  it('names the model in the error, so a log line is actionable', () => {
    expect(() => assertResponseWithinBudget('minimax/minimax-m3:free', { cost: 1 })).toThrow(
      /minimax\/minimax-m3:free/,
    )
  })

  // ## The budget, once there is one (0373)
  //
  // Every assertion above passes a ceiling of zero, implicitly, via the
  // default — which is the point of the default: the office spent months with
  // no money and that behaviour has to survive unchanged for any provider
  // Grant has not funded.

  it('accepts a charge at or under the provider ceiling', () => {
    // A measured turn on gpt-oss-120b, 2026-09-15: $0.0000348.
    expect(() => assertResponseWithinBudget('m', { cost: 0.0000348 }, 0.01)).not.toThrow()
  })

  it('accepts a charge exactly on the ceiling', () => {
    // Inclusive deliberately. A tripwire that fires ON the permitted value
    // refuses the thing it was configured to allow.
    expect(() => assertResponseWithinBudget('m', { cost: 0.01 }, 0.01)).not.toThrow()
  })

  it('refuses a charge above the ceiling', () => {
    expect(() => assertResponseWithinBudget('m', { cost: 0.011 }, 0.01)).toThrow(
      /an earlier layer was bypassed/,
    )
  })

  it('says what the ceiling was, so the error names both numbers', () => {
    // A refusal that reports only the charge leaves the reader to guess what
    // it was measured against, and this repository already records what a
    // report line stating one half of a comparison costs.
    expect(() => assertResponseWithinBudget('m', { cost: 5 }, 0.01)).toThrow(/0\.01/)
  })

  it('does NOT relax the unverifiable case when a budget exists', () => {
    // The dangerous direction. An unreported cost against a funded key is a
    // charge nobody can see, so a budget makes this stricter, never looser.
    expect(() => assertResponseWithinBudget('m', { cost: null }, 0.01)).toThrow(
      /cannot be verified as within budget/,
    )
    expect(() => assertResponseWithinBudget('m', undefined, 0.01)).toThrow(
      /cannot be verified as within budget/,
    )
  })
})

describe('layer 1 — the budget reaches the request body', () => {
  it('sends an all-zero max_price by default', () => {
    // The default IS the old behaviour. A caller that has not thought about a
    // budget must not acquire one by calling a function whose name did not
    // change.
    const body = buildRequestBody('openrouter/free', { messages: [] })
    expect(body.provider).toEqual(FORCED_PROVIDER_OPTIONS)
  })

  it('sends the provider ceiling when there is one', () => {
    const body = buildRequestBody(
      'openai/gpt-oss-120b',
      { messages: [] },
      { maxPricePrompt: 0.2, maxPriceCompletion: 1, maxCostPerCallUsd: 0.01 },
    )
    expect(body.provider).toEqual({
      allow_fallbacks: true,
      data_collection: 'deny',
      max_price: { prompt: 0.2, completion: 1, request: 0, image: 0 },
    })
  })

  it('never lets a caller turn data collection back on, funded or not', () => {
    // The one provider option that is not a price and never becomes one.
    for (const budget of [
      { maxPricePrompt: 0, maxPriceCompletion: 0, maxCostPerCallUsd: 0 },
      { maxPricePrompt: 0.2, maxPriceCompletion: 1, maxCostPerCallUsd: 0.01 },
    ]) {
      const body = buildRequestBody(
        'openai/gpt-oss-120b',
        { messages: [], provider: { data_collection: 'allow' } },
        budget,
      )
      expect((body.provider as Record<string, unknown>).data_collection).toBe('deny')
    }
  })

  it('pins to one upstream host while the budget is zero', () => {
    // With no price ceiling, the flag IS the price ceiling: a free model that
    // gets refused must not be allowed to land on a host that charges.
    const body = buildRequestBody('openrouter/free', { messages: [] })
    expect((body.provider as Record<string, unknown>).allow_fallbacks).toBe(false)
  })

  it('allows another upstream host once a ceiling bounds them all', () => {
    // Measured 2026-09-15: pinned, gpt-oss-120b returned 429 queue_timeout
    // from the cheapest host; with fallbacks and the same ceiling it was
    // served by another at http 200. The flag only ever chose among hosts for
    // ONE model — the model itself comes from `model`, and there is no
    // `models` array in anything this office sends.
    const body = buildRequestBody(
      'openai/gpt-oss-120b',
      { messages: [] },
      { maxPricePrompt: 0.2, maxPriceCompletion: 1, maxCostPerCallUsd: 0.01 },
    )
    expect((body.provider as Record<string, unknown>).allow_fallbacks).toBe(true)
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(body.models).toBeUndefined()
  })

  it('a caller cannot raise the ceiling by passing its own max_price', () => {
    const body = buildRequestBody(
      'openai/gpt-oss-120b',
      { messages: [], provider: { max_price: { prompt: 99, completion: 99 } } },
      { maxPricePrompt: 0.2, maxPriceCompletion: 1, maxCostPerCallUsd: 0.01 },
    )
    const sent = body.provider as { max_price: Record<string, number> }
    expect(sent.max_price.prompt).toBe(0.2)
    expect(sent.max_price.completion).toBe(1)
  })
})
