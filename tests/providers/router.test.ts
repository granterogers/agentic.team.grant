import { describe, expect, it, vi } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { PaidCallPreventedError } from '../../src/providers/guards.ts'
import {
  EmptyCompletionError,
  NoUsableModelError,
  ProviderRouter,
  ProviderUnavailableError,
} from '../../src/providers/router.ts'

/** Answers only the queries the router issues; records everything. */
class FakeDb implements SqlExecutor {
  readonly kind = 'fake'
  readonly statements: string[] = []

  constructor(
    private readonly models: Record<string, unknown>[],
    private readonly available = true,
  ) {}

  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)
    if (sql.includes('from public.usable_models')) return { rows: this.models }
    if (sql.includes('provider_available')) return { rows: [{ ok: this.available }] }
    return { rows: [] }
  }

  calls(fragment: string): string[] {
    return this.statements.filter((s) => s.includes(fragment))
  }
}

const model = (id: string, prompt = '0', completion = '0'): Record<string, unknown> => ({
  provider: 'openrouter',
  model_id: id,
  pricing_prompt: prompt,
  pricing_completion: completion,
  base_url: 'https://openrouter.ai/api/v1',
  free_only: true,
  secret_ref: null,
})

const ok = (cost: number | null = 0, content = 'hello'): typeof fetch =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: 'minimax/minimax-m3:free',
          choices: [{ message: { content } }],
          usage: { cost, prompt_tokens: 3, completion_tokens: 2 },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch

const MESSAGES = [{ role: 'user', content: 'hi' }] as const

describe('the happy path', () => {
  it('completes and reports zero cost', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    const router = new ProviderRouter(db, 'key', ok())
    const result = await router.complete({ messages: MESSAGES })

    expect(result.content).toBe('hello')
    expect(result.cost).toBe(0)
    expect(result.promptTokens).toBe(3)
  })

  it('picks the highest-priority usable model when none is named', async () => {
    // No "default model" constant exists: §4 requires model identifiers to be
    // configuration, and here they are measurement.
    const db = new FakeDb([model('first/one:free'), model('second/two:free')])
    const fetchImpl = ok()
    await new ProviderRouter(db, 'key', fetchImpl).complete({ messages: MESSAGES })

    const body = JSON.parse((vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body ?? '{}') as string)
    expect(body.model).toBe('first/one:free')
  })

  it('sends the forced guards on every request', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    const fetchImpl = ok()
    await new ProviderRouter(db, 'key', fetchImpl).complete({ messages: MESSAGES })

    const body = JSON.parse((vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body ?? '{}') as string)
    expect(body.provider).toEqual({
      allow_fallbacks: false,
      data_collection: 'deny',
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    })
  })

  it('records provider success', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    await new ProviderRouter(db, 'key', ok()).complete({ messages: MESSAGES })
    expect(db.calls('record_provider_success')).toHaveLength(1)
  })
})

describe('layer 3 — an unmeasured model cannot be reached', () => {
  it('refuses a model absent from usable_models', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    const fetchImpl = ok()
    const router = new ProviderRouter(db, 'key', fetchImpl)

    await expect(router.complete({ messages: MESSAGES, model: 'openai/gpt-4o' })).rejects.toThrow(
      PaidCallPreventedError,
    )
    // The point: no request was made at all.
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled()
  })

  it('refuses openrouter/auto even if the view somehow returned it', async () => {
    const db = new FakeDb([model('openrouter/auto')])
    const fetchImpl = ok()
    await expect(
      new ProviderRouter(db, 'key', fetchImpl).complete({
        messages: MESSAGES,
        model: 'openrouter/auto',
      }),
    ).rejects.toThrow(/dynamically priced/)
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled()
  })

  it('raises a distinct, actionable error when nothing is usable', async () => {
    // §11: when free resources are insufficient, queue non-urgent work — which
    // needs a distinguishable error, not a generic failure.
    const db = new FakeDb([])
    await expect(
      new ProviderRouter(db, 'key', ok()).complete({ messages: MESSAGES }),
    ).rejects.toThrow(NoUsableModelError)
  })
})

describe('layer 4 — a charged response is a defect, not an expense', () => {
  it('throws when the response reports a cost', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    await expect(
      new ProviderRouter(db, 'key', ok(0.0001)).complete({ messages: MESSAGES }),
    ).rejects.toThrow(/an earlier layer was bypassed/)
  })

  it('trips the breaker when that happens', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    await new ProviderRouter(db, 'key', ok(0.0001)).complete({ messages: MESSAGES }).catch(() => {})
    expect(db.calls('record_provider_failure')).toHaveLength(1)
    expect(db.calls('record_provider_success')).toHaveLength(0)
  })

  it('throws when the provider reports no cost at all', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    await expect(
      new ProviderRouter(db, 'key', ok(null)).complete({ messages: MESSAGES }),
    ).rejects.toThrow(/cannot be verified as free/)
  })
})

describe('circuit breaker', () => {
  it('refuses before calling when the breaker is open', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')], false)
    const fetchImpl = ok()
    await expect(
      new ProviderRouter(db, 'key', fetchImpl).complete({ messages: MESSAGES }),
    ).rejects.toThrow(ProviderUnavailableError)
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled()
  })

  it('records a failure when the provider returns an error', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    const failing = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 429, message: 'rate limited' } }), {
          status: 429,
        }),
    ) as unknown as typeof fetch

    await expect(
      new ProviderRouter(db, 'key', failing).complete({ messages: MESSAGES }),
    ).rejects.toThrow(/refused/)
    expect(db.calls('record_provider_failure')).toHaveLength(1)
  })

  it('records a failure when the transport throws', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    const throwing = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    await expect(
      new ProviderRouter(db, 'key', throwing).complete({ messages: MESSAGES }),
    ).rejects.toThrow('ECONNRESET')
    expect(db.calls('record_provider_failure')).toHaveLength(1)
  })
})

describe('§15 — secrets never reach stored error text', () => {
  // Fabricated token SHAPES, which is the whole point: redaction must be
  // tested against something that looks real. None is a credential. The
  // per-line markers are needed because the exemption covers only the line it
  // is on and the one after — deliberately narrow, so a marker cannot silently
  // blanket a whole file.
  it.each([
    // secret-scan:allow-shape
    ['xoxb-1234567890-abcdefghij', 'a Slack token'],
    // secret-scan:allow-shape
    ['sk-proj-abcdefghijklmnop', 'an OpenAI key'],
    // secret-scan:allow-shape
    ['sbp_0123456789abcdef0123', 'a Supabase token'],
    // secret-scan:allow-shape
    ['Bearer someverylongsecretvalue', 'an Authorization header'],
  ])('redacts %s from a provider error (%s)', async (secret) => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    const leaking = vi.fn(async () => {
      throw new Error(`connect failed for https://x/y?auth=${secret}`)
    }) as unknown as typeof fetch

    await new ProviderRouter(db, 'key', leaking).complete({ messages: MESSAGES }).catch(() => {})

    const recorded = db.calls('record_provider_failure').join('\n')
    /*
      `[redacted:` rather than `[REDACTED]`: the four patterns that used to live
      inline in `recordFailure` are now the shared list in
      `src/text/secrets.ts`, which names the family it caught so a redacted log
      line still says what KIND of credential was there.

      The second assertion is the one that matters and is unchanged.
    */
    expect(recorded).toContain('[redacted:')
    expect(recorded).not.toContain(secret)
  })
})

describe('an empty completion is an explicit failure, not an empty string', () => {
  // Every free model on this tier is a reasoning model, and reasoning tokens
  // come out of the same completion budget. Measured: max_tokens 8 spent all
  // eight on reasoning and returned content: null.
  const reasoningOnly = (): typeof fetch =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'cohere/north-mini-code:free',
            choices: [
              { finish_reason: 'length', message: { content: null, reasoning: 'thinking…' } },
            ],
            usage: {
              cost: 0,
              prompt_tokens: 7,
              completion_tokens: 8,
              completion_tokens_details: { reasoning_tokens: 8 },
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch

  it('throws rather than returning empty content', async () => {
    const db = new FakeDb([model('cohere/north-mini-code:free')])
    await expect(
      new ProviderRouter(db, 'key', reasoningOnly()).complete({ messages: MESSAGES, maxTokens: 8 }),
    ).rejects.toThrow(EmptyCompletionError)
  })

  it('names the reasoning budget as the cause, so the fix is obvious', async () => {
    const db = new FakeDb([model('cohere/north-mini-code:free')])
    await expect(
      new ProviderRouter(db, 'key', reasoningOnly()).complete({ messages: MESSAGES, maxTokens: 8 }),
    ).rejects.toThrow(/8 tokens spent on reasoning — raise maxTokens/)
  })

  it('does NOT trip the breaker — the provider did its job', async () => {
    const db = new FakeDb([model('cohere/north-mini-code:free')])
    await new ProviderRouter(db, 'key', reasoningOnly())
      .complete({ messages: MESSAGES, maxTokens: 8 })
      .catch(() => {})
    expect(db.calls('record_provider_failure')).toHaveLength(0)
    expect(db.calls('record_provider_success')).toHaveLength(1)
  })

  it('treats whitespace-only content as empty', async () => {
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    await expect(
      new ProviderRouter(db, 'key', ok(0, '   \n  ')).complete({ messages: MESSAGES }),
    ).rejects.toThrow(EmptyCompletionError)
  })

  it('never carries chain-of-thought into the result (§6)', async () => {
    // The response type has no `reasoning` field at all, so there is nothing to
    // forward by accident. This asserts the contract holds end to end.
    const db = new FakeDb([model('minimax/minimax-m3:free')])
    const withReasoning = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'minimax/minimax-m3:free',
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'ready', reasoning: 'SECRET CHAIN OF THOUGHT' },
              },
            ],
            usage: { cost: 0, prompt_tokens: 3, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch

    const result = await new ProviderRouter(db, 'key', withReasoning).complete({
      messages: MESSAGES,
    })
    expect(JSON.stringify(result)).not.toContain('SECRET CHAIN OF THOUGHT')
    expect(Object.keys(result)).not.toContain('reasoning')
  })
})

describe('failover — a rate-limited free model is normal, not fatal', () => {
  /** A fetch that answers each call from a queue of scripted responses. */
  const scripted = (
    responses: readonly (() => Response)[],
  ): { impl: typeof fetch; bodies: () => Record<string, unknown>[] } => {
    const seen: Record<string, unknown>[] = []
    let i = 0
    const impl = vi.fn(async (_url: string, init: { body: string }) => {
      seen.push(JSON.parse(init.body) as Record<string, unknown>)
      const make = responses[Math.min(i, responses.length - 1)]
      i += 1
      return (make as () => Response)()
    }) as unknown as typeof fetch
    return { impl, bodies: () => seen }
  }

  const rateLimited = (): Response =>
    new Response(JSON.stringify({ error: { code: 429, message: 'rate-limited upstream' } }), {
      status: 200,
    })
  const answered = (model: string): Response =>
    new Response(
      JSON.stringify({
        model,
        choices: [{ message: { content: 'the answer' } }],
        usage: { cost: 0, prompt_tokens: 3, completion_tokens: 2 },
      }),
      { status: 200 },
    )
  const emptyReply = (model: string): Response =>
    new Response(
      JSON.stringify({
        model,
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        usage: { cost: 0, prompt_tokens: 3, completion_tokens: 0 },
      }),
      { status: 200 },
    )

  it('moves to the next model when the first is rate-limited', async () => {
    const db = new FakeDb([model('first/one:free'), model('second/two:free')])
    const { impl, bodies } = scripted([rateLimited, () => answered('second/two:free')])
    const result = await new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES })

    expect(result.content).toBe('the answer')
    expect(result.model).toBe('second/two:free')
    // The models tried, in the priority order measurement produced — and each
    // tried exactly once. A rate limit means wait, so re-asking the same model
    // is how a temporary limit becomes a longer one.
    expect(bodies().map((b) => b.model)).toEqual(['first/one:free', 'second/two:free'])
  })

  it('fails over on an empty completion too', async () => {
    const db = new FakeDb([model('first/one:free'), model('second/two:free')])
    const { impl } = scripted([
      () => emptyReply('first/one:free'),
      () => answered('second/two:free'),
    ])
    const result = await new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES })
    expect(result.model).toBe('second/two:free')
  })

  it('records every attempt, failures included (§11)', async () => {
    const db = new FakeDb([model('first/one:free'), model('second/two:free')])
    const { impl } = scripted([rateLimited, () => answered('second/two:free')])
    await new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES })
    // Two usage rows: one rate_limited, one ok. A failover that only recorded
    // the success would make the free tier look healthier than it is, and §11
    // exists so spend and behaviour are both measured rather than assumed.
    const usage = db.calls('record_inference_usage').concat(db.calls('inference_usage'))
    expect(usage.length).toBeGreaterThanOrEqual(2)
  })

  it('attributes the usage row to the job, not just to the thread', async () => {
    // The defect this pins: `account()` took a correlation id and nothing
    // else, so every row the worker ever wrote had a null `job_id`. 49 rows
    // out of 172 in production had one, and all 49 came from two avatar
    // scripts filling it in by hand.
    //
    // A correlation id cannot stand in for it. One correlation id covers a
    // parent job and every child it spawns, so "the job with that correlation
    // id" is not a job — which is why cost per outcome needs this column and
    // could not be computed from what was there.
    const db = new FakeDb([model('first/one:free')])
    const { impl } = scripted([() => answered('first/one:free')])
    const jobId = '11111111-2222-3333-4444-555555555555'
    const correlationId = '99999999-8888-7777-6666-555555555555'
    await new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES, jobId, correlationId })

    const usage = db.calls('inference_usage')
    expect(usage.length).toBeGreaterThanOrEqual(1)
    const insert = usage.join('\n')
    expect(insert).toContain(jobId)
    expect(insert).toContain(correlationId)
  })

  it('leaves job_id null rather than inventing one when the caller has no job', async () => {
    // A generated uuid here would be worse than a null: it would look like an
    // attribution and join to nothing, and the coverage figure on the cost
    // page — which is the thing that tells Grant how much to trust the
    // number — would read 100% while being entirely wrong.
    const db = new FakeDb([model('first/one:free')])
    const { impl } = scripted([() => answered('first/one:free')])
    await new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES })
    const insert = db.calls('inference_usage').join('\n')
    expect(insert).toContain('null::uuid')
  })

  it('stops after the attempt budget rather than walking the whole registry', async () => {
    const db = new FakeDb([
      model('a/one:free'),
      model('b/two:free'),
      model('c/three:free'),
      model('d/four:free'),
      model('e/five:free'),
    ])
    const { impl, bodies } = scripted([rateLimited])
    await expect(
      new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES }),
    ).rejects.toThrow(/all 3 candidate model\(s\) failed/)
    expect(bodies()).toHaveLength(3)
  })

  it('names every model it tried, because "inference failed" is not actionable', async () => {
    const db = new FakeDb([model('a/one:free'), model('b/two:free')])
    const { impl } = scripted([rateLimited])
    const error: Error = await new ProviderRouter(db, 'k', impl)
      .complete({ messages: MESSAGES })
      .then(() => new Error('it resolved, which it must not'))
      .catch((e: unknown) => e as Error)
    expect(error.message).toContain('a/one:free')
    expect(error.message).toContain('b/two:free')
    expect(error.message).toContain('429')
  })

  it('does not wrap a lone failure — one candidate is not a failover', async () => {
    // Wrapping here would cost every caller the ability to tell an empty
    // completion from a rate limit, in exchange for no information at all.
    const db = new FakeDb([model('only/one:free')])
    const { impl } = scripted([() => emptyReply('only/one:free')])
    await expect(
      new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES }),
    ).rejects.toBeInstanceOf(EmptyCompletionError)
  })

  it('honours a caller-named model exactly, and never substitutes another', async () => {
    // Silently answering with a different model would make the recorded
    // provenance a lie, and provenance is the thing §10 will not compromise.
    const db = new FakeDb([model('first/one:free'), model('second/two:free')])
    const { impl, bodies } = scripted([rateLimited])
    await expect(
      new ProviderRouter(db, 'k', impl).complete({
        messages: MESSAGES,
        model: 'second/two:free',
      }),
    ).rejects.toThrow(/refused/)
    expect(bodies().map((b) => b.model)).toEqual(['second/two:free'])
  })

  it('does NOT fail over when a response was charged for', async () => {
    // §11's whole point. A model that charged us is a defect in the
    // allow-list; moving to the next model would hide it behind a success.
    const db = new FakeDb([model('first/one:free'), model('second/two:free')])
    const { impl, bodies } = scripted([
      () =>
        new Response(
          JSON.stringify({
            model: 'first/one:free',
            choices: [{ message: { content: 'hi' } }],
            usage: { cost: 0.02, prompt_tokens: 3, completion_tokens: 2 },
          }),
          { status: 200 },
        ),
    ])
    await expect(
      new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES }),
    ).rejects.toBeInstanceOf(PaidCallPreventedError)
    expect(bodies()).toHaveLength(1)
  })

  it('does NOT fail over when the breaker is open — that is about the provider', async () => {
    const db = new FakeDb([model('first/one:free'), model('second/two:free')], false)
    const { impl, bodies } = scripted([() => answered('first/one:free')])
    await expect(
      new ProviderRouter(db, 'k', impl).complete({ messages: MESSAGES }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError)
    expect(bodies()).toHaveLength(0)
  })
})
