import { describe, expect, it, vi } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import {
  ENVELOPE_INSTRUCTION,
  extractAnswer,
  NoAnswerEnvelopeError,
  withEnvelope,
} from '../../src/providers/envelope.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

/*
  The answer envelope (#412). Two things have to be true for it to be worth turning on: every legitimate answer must come out
  of it EXACTLY as the model meant it (code, tables, lists, quotation, a sentence that sounds like working-out), and everything a
  model wrote outside the tags must be gone. The corpus below is the first half; the leak cases are the second.
*/
const wrap = (s: string): string => `<answer>${s}</answer>`

const GOLDEN: readonly [string, string][] = [
  ['one plain sentence', 'The deposit is due on Friday.'],
  [
    'a sentence that sounds like working-out but is ordinary prose',
    'We need to check the policy with the accountant before Friday.',
  ],
  ['a numbered list', '1. Call the venue\n2. Confirm the date\n3. Send the deposit'],
  ['a bulleted list', '- first\n- second\n- third'],
  ['a table', '| Item | Cost |\n|---|---|\n| Venue | 400 |\n| Catering | 250 |'],
  ['a fenced code block', 'Use this:\n\n```ts\nconst total = a + b\n```\n\nThen run it.'],
  ['html in the reply', 'Wrap it in a <div class="note"> and close it with </div>.'],
  [
    'a reply that talks about the format itself',
    'Put the reply between <answer> and </answer> tags, once.',
  ],
  ['a reply that quotes the closing tag', 'The tag you want is </answer> and it goes last.'],
  ['a refusal that explains itself', 'I have not done this, and it is not something I can do.'],
  ['non-ASCII text and money', 'Das kostet £63.50 – « très bien » – 数量 3。'],
  [
    'multiple paragraphs',
    'First paragraph.\n\nSecond paragraph, longer, with a colon: and a dash - here.',
  ],
  ['a single word', 'Yes.'],
]

describe('every legitimate answer comes out exactly as written', () => {
  it.each(GOLDEN)('round-trips: %s', (_, answer) => {
    const got = extractAnswer(wrap(answer))
    expect(got).toEqual({ ok: true, answer })
  })
  it('keeps the answer whole when the model adds a newline or spaces around the tags', () => {
    expect(extractAnswer('<answer>\n  Hello there.\n</answer>\n')).toEqual({
      ok: true,
      answer: 'Hello there.',
    })
  })
})

describe('everything outside the tags is dropped, never repaired', () => {
  it.each([
    [
      'a plan before the answer',
      `We need to access office records: db.read but first check.\n${wrap('Five projects are open.')}`,
    ],
    [
      'working-out after the answer',
      `${wrap('Five projects are open.')}\nLet me double check that.`,
    ],
    [
      'an imagined tool call before it',
      `call db.read({"table":"projects"})\n${wrap('Five projects are open.')}`,
    ],
    ['both', `The user asks about projects.\n${wrap('Five projects are open.')}\nDone.`],
  ])('drops %s', (_, content) => {
    const got = extractAnswer(content)
    expect(got).toEqual({ ok: true, answer: 'Five projects are open.' })
  })
})

describe('a reply with no usable envelope is not an answer', () => {
  it('has no tags at all (a bare reply, or only reasoning)', () => {
    expect(extractAnswer('We need to answer the user.')).toEqual({ ok: false, reason: 'no_tags' })
  })
  it('opens and never closes (cut short): a truncated reply must not pass for a complete one', () => {
    expect(extractAnswer('<answer>The deposit is due on Fri')).toEqual({
      ok: false,
      reason: 'unclosed',
    })
  })
  it('closes before it opens', () => {
    expect(extractAnswer('</answer> oops <answer>')).toEqual({ ok: false, reason: 'unclosed' })
  })
  it('has tags with nothing inside', () => {
    expect(extractAnswer('<answer>   </answer>')).toEqual({ ok: false, reason: 'empty' })
    expect(extractAnswer('<answer></answer>')).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('the instruction is added without disturbing what is already there', () => {
  it('appends to the system message and leaves the rest alone', () => {
    const out = withEnvelope([
      { role: 'system', content: 'You are Claire.' },
      { role: 'user', content: 'hi' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]?.content.startsWith('You are Claire.')).toBe(true)
    expect(out[0]?.content.endsWith(ENVELOPE_INSTRUCTION)).toBe(true)
    expect(out[1]).toEqual({ role: 'user', content: 'hi' })
  })
  it('adds a system message when there is none', () => {
    const out = withEnvelope([{ role: 'user', content: 'hi' }])
    expect(out[0]).toEqual({ role: 'system', content: ENVELOPE_INSTRUCTION })
    expect(out).toHaveLength(2)
  })
  it('does not mutate its input', () => {
    const input = [{ role: 'system', content: 'S' }] as const
    withEnvelope(input)
    expect(input[0].content).toBe('S')
  })
  it('says nothing that would reach a person or name an issue', () => {
    expect(ENVELOPE_INSTRUCTION).not.toMatch(/#\d|issue|§/i)
  })
})

/* ---- the router: the contract is enforced where every call passes ------------------------------------------------------- */
class FakeDb implements SqlExecutor {
  readonly kind = 'fake'
  readonly statements: string[] = []
  constructor(private readonly models: Record<string, unknown>[]) {}
  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)
    if (sql.includes('app.model_order(')) return { rows: this.models }
    if (sql.includes('provider_available')) return { rows: [{ ok: true }] }
    return { rows: [] }
  }
}
const model = (id: string): Record<string, unknown> => ({
  provider: 'openrouter',
  model_id: id,
  pricing_prompt: '0',
  pricing_completion: '0',
  base_url: 'https://openrouter.ai/api/v1',
  free_only: true,
  secret_ref: null,
  standing: 'unproven',
  why: 'no record yet',
})
const reply = (m: string, content: string): Response =>
  new Response(
    JSON.stringify({
      model: m,
      choices: [{ message: { content } }],
      usage: { cost: 0, prompt_tokens: 3, completion_tokens: 2 },
    }),
    { status: 200 },
  )
const scripted = (responses: readonly (() => Response)[]) => {
  const seen: { messages: { role: string; content: string }[] }[] = []
  let i = 0
  const impl = vi.fn(async (_u: string, init: { body: string }) => {
    seen.push(JSON.parse(init.body))
    const make = responses[Math.min(i, responses.length - 1)] as () => Response
    i += 1
    return make()
  }) as unknown as typeof fetch
  return { impl, seen: () => seen }
}
const MESSAGES = [{ role: 'user', content: 'how many projects?' }] as const

describe('the router enforces the envelope when asked, and only then', () => {
  it('returns only what is inside the tags, and says the instruction was sent', async () => {
    const { impl, seen } = scripted([
      () => reply('a/one:free', `We need to count.\n${wrap('Five.')}`),
    ])
    const r = await new ProviderRouter(new FakeDb([model('a/one:free')]), 'k', impl).complete({
      messages: MESSAGES,
      answerEnvelope: true,
    })
    expect(r.content).toBe('Five.')
    expect(JSON.stringify(seen()[0]?.messages)).toContain('<answer>')
  })

  it('a reply with no envelope is not an answer: it fails over to the next model', async () => {
    const { impl } = scripted([
      () => reply('a/one:free', 'We need to access office records: db.read but ...'),
      () => reply('b/two:free', wrap('Five.')),
    ])
    const db = new FakeDb([model('a/one:free'), model('b/two:free')])
    const r = await new ProviderRouter(db, 'k', impl).complete({
      messages: MESSAGES,
      answerEnvelope: true,
    })
    expect(r.content).toBe('Five.')
    expect(r.model).toBe('b/two:free')
    // and the unusable attempt was ACCOUNTED, as a malformed response, not hidden
    expect(db.statements.some((s) => s.includes('malformed_response'))).toBe(true)
  })

  it('when every model ignores the format the call fails, naming the cause, and returns no text', async () => {
    const { impl } = scripted([() => reply('a/one:free', 'The user asks about projects. Five.')])
    await expect(
      new ProviderRouter(new FakeDb([model('a/one:free')]), 'k', impl).complete({
        messages: MESSAGES,
        answerEnvelope: true,
      }),
    ).rejects.toBeInstanceOf(NoAnswerEnvelopeError)
  })

  it('CONTROL: without the flag nothing is sent or stripped, so every existing caller is unchanged', async () => {
    const { impl, seen } = scripted([
      () => reply('a/one:free', `We need to count.\n${wrap('Five.')}`),
    ])
    const r = await new ProviderRouter(new FakeDb([model('a/one:free')]), 'k', impl).complete({
      messages: MESSAGES,
    })
    expect(r.content).toBe(`We need to count.\n${wrap('Five.')}`)
    expect(JSON.stringify(seen()[0]?.messages)).not.toContain('<answer>')
  })
})
