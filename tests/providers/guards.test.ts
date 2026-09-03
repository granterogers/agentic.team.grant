import { describe, expect, it } from 'vitest'
import type { AllowedModel } from '../../src/providers/guards.ts'
import {
  assertModelAllowed,
  assertResponseWasFree,
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
    expect(() => assertResponseWasFree('m', { cost: 0 })).not.toThrow()
  })

  it('throws when the response reports any cost', () => {
    expect(() => assertResponseWasFree('m', { cost: 0.000001 })).toThrow(
      /an earlier layer was bypassed/,
    )
  })

  it('treats a missing usage block as unverifiable, not free', () => {
    // A provider that stops reporting cost is one we can no longer verify.
    expect(() => assertResponseWasFree('m', undefined)).toThrow(/cannot be verified as free/)
  })

  it('treats an absent cost key as unverifiable', () => {
    // The two shapes a parsed JSON response can actually take. The compiler
    // rejected an explicit `{ cost: undefined }` under
    // exactOptionalPropertyTypes, which was right: JSON cannot produce it, so
    // a test asserting on it would be testing an unreachable state.
    expect(() => assertResponseWasFree('m', {})).toThrow(/cannot be verified as free/)
  })

  it('treats cost: null as unverifiable', () => {
    expect(() => assertResponseWasFree('m', { cost: null })).toThrow(/cannot be verified as free/)
  })

  it('names the model in the error, so a log line is actionable', () => {
    expect(() => assertResponseWasFree('minimax/minimax-m3:free', { cost: 1 })).toThrow(
      /minimax\/minimax-m3:free/,
    )
  })
})
