import { describe, expect, it, vi } from 'vitest'
import { artifactRequest } from '../../src/agents/actions.ts'
import { entitled, noneEntitled } from '../../src/agents/entitled.ts'
import { asksForWriting } from '../../src/agents/goal.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { namedColleague } from '../../src/agents/named.ts'
import { claimsToHaveSent } from '../../src/agents/quality.ts'
import { taskRequest } from '../../src/agents/tasks.ts'
import { asHumanWords } from '../../src/agents/turn.ts'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { AllCandidatesFailedError, ProviderRouter } from '../../src/providers/router.ts'

/*
  Agent E2's local end-to-end layer: deterministic properties of "does the office understand, stay inside the
  human-contact boundary, and survive its provider failing". Everything here is pure or driven with stubs; nothing
  touches a database or a network. The replica-backed halves are scripts/isolated/e2e-*.ts.

  `it.fails` marks a DEFECT: the assertion states the intended behaviour, it currently fails, and the test is green
  because of that. The day the product is fixed these go red, which is the signal to delete the marker.
*/

describe('realistic outward-contact sentences: nothing deterministic performs them', () => {
  const OUTWARD = [
    'Send this to Kevin.',
    'Email Kevin the report and cc my accountant',
    "Draft an email to Kevin but don't send it.",
    'Please send this to everyone',
  ]
  it.each(OUTWARD)('%s -> no plan, no file, no task, no rule, no call-off', (said) => {
    const w = asHumanWords(said)
    expect(entitled.plan(w)).toBeNull()
    expect(entitled.link(w)).toBeNull()
    expect(entitled.page(w)).toBeNull()
    expect(entitled.research(w)).toBeNull()
    expect(entitled.teaching(w)).toBeNull()
    expect(entitled.callsItOff(w)).toBeNull()
    expect(artifactRequest(said)).toBeNull()
    expect(personalTaskRequest(said)).toBeNull()
    expect(taskRequest(said, classifyIntent(said))).toBeNull()
  })

  it('a draft is a draft: "draft an email but do not send it" asks for writing and for nothing outward', () => {
    expect(asksForWriting("Draft an email to Kevin but don't send it.")).toBe(true)
  })

  it('a FORWARDED message is silent in every consequence-bearing reader', () => {
    const w = asHumanWords('Please send this to everyone and add a task to wire the deposit')
    for (const [name, reader] of Object.entries(noneEntitled)) {
      const out = (reader as (x: typeof w, y?: never) => unknown)(w)
      expect(out === null || out === false, `${name} read a forwarded message`).toBe(true)
    }
  })

  it('control: the same readers DO act on his typed words (the silence is not "read nothing")', () => {
    expect(personalTaskRequest('Remind me tomorrow to call Kevin.')?.title).toBe('Call Kevin')
    expect(
      entitled.plan(
        asHumanWords(
          'I want you to push this video into a new notebook project called AI Learning, then find me the transcription and report back to me here. https://youtu.be/9_SZFIW7tus',
        ),
      ),
    ).not.toBeNull()
    // and the same words, forwarded, plan nothing
    expect(
      noneEntitled.plan(
        asHumanWords(
          'I want you to push this video into a new notebook project called AI Learning, then find me the transcription and report back to me here. https://youtu.be/9_SZFIW7tus',
        ),
      ),
    ).toBeNull()
  })

  it('"Stop sending me updates." is deliberately NOT stored as a standing rule (#364 pin)', () => {
    const w = asHumanWords('Stop sending me updates.')
    expect(entitled.teaching(w)).toBeNull()
    expect(entitled.callsItOff(w)).toBeNull()
  })

  it('a ROLE word names the one asked (Ask the finance director ...)', () => {
    const staff = [
      { slug: 'finance-director', name: 'Daniel' },
      { slug: 'research-director', name: 'Emma' },
    ]
    expect(
      namedColleague(
        'Ask the finance director to review the outstanding work and tell me what needs attention',
        staff,
      ),
    ).toBe('finance-director')
  })
})

describe('a false "I contacted somebody" is stopped (claimsToHaveSent)', () => {
  const CAUGHT = [
    "I've emailed Kevin the report and copied your accountant.",
    'I messaged the team on Slack.',
    'Done - I sent the report to Kevin.',
  ]
  it.each(CAUGHT)('control: caught - %s', (text) => {
    expect(claimsToHaveSent(text)).not.toBeNull()
  })

  // The office has no outbound path while it answers, so every one of these is false by construction. They were
  // measured on 7 October 2026 as MISSED (the real worker delivered them verbatim, scripts/isolated/e2e-failure.ts F3)
  // and are caught since the claim detector and the evidence requirement (src/agents/consequence.ts) replaced the list.
  const FORMERLY_MISSED = [
    "Email sent to Kevin, cc'd your accountant.",
    'Email sent to Kevin.',
    'The report was sent to Kevin and your accountant.',
    'Kevin has been sent the report.',
    "I've cc'd your accountant.",
    "I've shared the report with Kevin.",
    "I've let Kevin know.",
    'Emailed Kevin the report.',
    'The report has been delivered to Kevin.',
  ]
  for (const text of FORMERLY_MISSED) {
    it(`caught (was a live defect) - ${text}`, () => {
      expect(claimsToHaveSent(text)).not.toBeNull()
    })
  }
})

/* ---- the model chain, with the real model names, over a stub transport ---- */

class FakeDb implements SqlExecutor {
  readonly kind = 'fake'
  constructor(private readonly models: Record<string, unknown>[]) {}
  async execute(sql: string): Promise<SqlResult> {
    if (sql.includes('app.model_order(')) return { rows: this.models }
    if (sql.includes('provider_available')) return { rows: [{ ok: true }] }
    return { rows: [] }
  }
}
const row = (id: string): Record<string, unknown> => ({
  provider: 'openrouter',
  model_id: id,
  pricing_prompt: '0',
  pricing_completion: '0',
  base_url: 'https://openrouter.ai/api/v1',
  free_only: true,
  secret_ref: null,
  standing: 'unproven',
  why: 'e2e',
})
const CHAIN = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.7-flash',
  'mistralai/mistral-small-3.2-24b-instruct',
  'some/free-tier:free',
]
const MESSAGES = [{ role: 'user', content: 'hi' }] as const
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
const good = (model: string): Response =>
  json({
    model,
    choices: [{ message: { content: 'the answer' } }],
    usage: { cost: 0, prompt_tokens: 3, completion_tokens: 2 },
  })
const modelOf = (init: { body: string }): string =>
  String((JSON.parse(init.body) as { model: string }).model)

describe('model fallback chain', () => {
  it('walks gpt-oss -> qwen -> mistral past a 429, a malformed body and answers from the third', async () => {
    const asked: string[] = []
    const impl = vi.fn(async (_u: string, init: { body: string }) => {
      const m = modelOf(init)
      asked.push(m)
      if (asked.length === 1)
        return json({ error: { code: 429, message: 'rate-limited upstream' } })
      if (asked.length === 2) return new Response('<html>502 bad gateway</html>', { status: 200 })
      return good(m)
    }) as unknown as typeof fetch
    const result = await new ProviderRouter(new FakeDb(CHAIN.map(row)), 'k', impl).complete({
      messages: MESSAGES,
    })
    expect(asked).toEqual(CHAIN.slice(0, 3))
    expect(result.model).toBe(CHAIN[2])
  })

  it('a network error on the first model falls to the second', async () => {
    let n = 0
    const impl = vi.fn(async (_u: string, init: { body: string }) => {
      n += 1
      if (n === 1) throw new TypeError('fetch failed')
      return good(modelOf(init))
    }) as unknown as typeof fetch
    const result = await new ProviderRouter(new FakeDb(CHAIN.map(row)), 'k', impl).complete({
      messages: MESSAGES,
    })
    expect(result.model).toBe(CHAIN[1])
  })

  it('every model failing is one error that names each model tried', async () => {
    const impl = vi.fn(async () =>
      json({ error: { code: 429, message: 'rate-limited' } }),
    ) as unknown as typeof fetch
    await expect(
      new ProviderRouter(new FakeDb(CHAIN.map(row)), 'k', impl).complete({ messages: MESSAGES }),
    ).rejects.toBeInstanceOf(AllCandidatesFailedError)
  })

  // M1 (was a documented FINDING: three models per call). The documented chain is four deep and the free tier is the
  // last rung, so it has to be reachable inside one call.
  it('one call walks the whole documented chain, so the fourth (free tier) IS reached', async () => {
    const asked: string[] = []
    const impl = vi.fn(async (_u: string, init: { body: string }) => {
      asked.push(modelOf(init))
      return json({ error: { code: 429, message: 'rate-limited' } })
    }) as unknown as typeof fetch
    await new ProviderRouter(new FakeDb(CHAIN.map(row)), 'k', impl)
      .complete({ messages: MESSAGES })
      .catch(() => undefined)
    expect(asked).toEqual(CHAIN)
  })

  // M1 (was an `it.fails` DEFECT): a provider that accepts the connection and never answers is abandoned at the
  // per-request deadline and the next model answers. Real timers with a tiny deadline; the race against a safety
  // timer means a regression reads "still waiting" instead of hanging the suite.
  it('a model that HANGS is failed over from within a bounded time', async () => {
    let n = 0
    const impl = vi.fn(async (_u: string, init: { body: string }) => {
      n += 1
      if (n === 1) return new Promise<Response>(() => undefined)
      return good(modelOf(init))
    }) as unknown as typeof fetch
    const settled = await Promise.race([
      new ProviderRouter(new FakeDb(CHAIN.map(row)), 'k', impl, 4, { requestTimeoutMs: 40 })
        .complete({ messages: MESSAGES })
        .then((r) => `answered by ${r.model}`)
        .catch(() => 'failed'),
      new Promise<string>((ok) => setTimeout(() => ok('still waiting'), 800)),
    ])
    expect(settled).toBe(`answered by ${CHAIN[1]}`)
  })
})
