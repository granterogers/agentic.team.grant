/**
 * #412: a model's working must never be what a person is handed as the answer.
 *
 * Cause, established from the stored outputs: the provider router already refuses to read a provider's `reasoning` fields (the
 * type has nowhere to put them). The leak is the model writing its working INTO `content` - gpt-oss-120b, five stored outputs
 * from 15 September ("We need to call task.create. Attempt task.create.") and one live on 3 October ("We need to access office
 * records: db.read but we cannot actually run. In this simulation we must assume..."). The coherence gate that catches that
 * shape (#246) recognised "call/use/query/read/run" as the verb and "can/could/must" as the modal, so "we need to ACCESS" and
 * "we CANNOT actually run" slipped past. Nothing here is a list of banned words: the signal is still a plan about answering AND
 * the office's own machinery named in the SAME sentence, and every case has an honest neighbour that must survive.
 */
import { describe, expect, it } from 'vitest'
import { deliberationLeak, metadataProblems } from '../../src/agents/quality.ts'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { EmptyCompletionError, ProviderRouter } from '../../src/providers/router.ts'

const TOOLS = ['db.read', 'task.create', 'notebook.read', 'web.search']

describe('working that was written into the answer is refused', () => {
  it.each([
    'We need to access office records: db.read but we cannot actually run. In this simulation we must assume we have no record unless we can infer.',
    'We need to call task.create.\nAttempt task.create.\nWe need parameters: project? Not given.',
    'We need to query db.read for pricing.',
    "We need to perform notebook.read query.Attempt to read relevant notebook.We can't actually run commands.",
    'We cannot actually run db.read here, so I will assume nothing is stored.',
  ])('%s', (body) => {
    expect(deliberationLeak(body, TOOLS)).not.toBeNull()
  })
})

describe('and an honest answer in the same voice survives', () => {
  it.each([
    'We need to raise $6,300 to meet the 15 % match, so the total funding will be $48,300.',
    'I need to know which project you want me to attach it to before I can schedule it.',
    'We need to access the venue before Friday, so the key has to be collected from the building manager.',
    'I cannot actually confirm the deposit date from what I have; the venue agreement does not give one.',
    'We need to check the figures with the accountant, then the budget is ready to send.',
    'The December closing balance is 21,700. That figure is read straight from the cashflow forecast.',
    'db.read is switched off at the moment, so I have not looked in the database.',
    'In this simulation of cashflow, the closing balance in March is 19,090.',
    'Reasoning about the lock-in period, the break-even point is month nine.',
    // ordinary English that shares words with the leak, including beside the generic machinery nouns
    'We cannot access Google until you reconnect it.',
    'You need to fetch the document from the source.',
    'This simulation shows the projected result.',
    'We need to check the policy with the accountant before Friday.',
    'We need to open the instructions with the venue manager first.',
    'I cannot access the description field until you share the file.',
    'We will read the schema together on Monday and then agree the fields.',
  ])('%s', (body) => {
    expect(deliberationLeak(body, TOOLS)).toBeNull()
  })

  it('does not depend on the list: without registry names, plain planning is still left alone', () => {
    expect(deliberationLeak('We need to access the records and then report back.', [])).toBeNull()
  })
})

describe('the refusal reaches the retry loop, and a good answer produces none', () => {
  const meta = (body: string) =>
    metadataProblems({
      confidence: 'medium',
      evidence: 'inferred',
      sources: [],
      contradictions: null,
      body,
      toolNames: TOOLS,
    } as never)

  it('a leaked working is a body problem naming what to do instead (the next attempt reads it)', () => {
    const p = meta('We need to access office records: db.read but we cannot actually run.')
    const mine = p.find((x) => x.field === 'body' && /plans out loud/.test(x.problem))
    expect(mine).toBeDefined()
    expect(mine?.problem).toMatch(/answer, not the working/)
  })

  it('and an ordinary long answer, or one that only talks about cannot / simulation, produces no problem', () => {
    const long = `${'The December closing balance is 21,700. '.repeat(40)}We cannot access Google until you reconnect it. This simulation shows the projected result.`
    expect(meta(long).filter((x) => /plans out loud|questions itself/.test(x.problem))).toEqual([])
  })

  it('an empty or malformed body is not a leak (other gates own it)', () => {
    expect(deliberationLeak('', TOOLS)).toBeNull()
    expect(deliberationLeak('{', TOOLS)).toBeNull()
    expect(deliberationLeak('}{ ,', TOOLS)).toBeNull()
  })
})

/** The router's own boundary: whatever a provider sends besides the answer is never the answer. */
class Db implements SqlExecutor {
  readonly kind = 'fake'
  async execute(sql: string): Promise<SqlResult> {
    if (sql.includes('app.model_order(')) {
      return {
        rows: [
          {
            provider: 'openrouter',
            model_id: 'openai/gpt-oss-120b',
            pricing_prompt: '0',
            pricing_completion: '0',
            base_url: 'https://openrouter.ai/api/v1',
            free_only: true,
            secret_ref: null,
            standing: 'unproven',
            why: 'x',
          },
        ],
      }
    }
    if (sql.includes('provider_available')) return { rows: [{ ok: true }] }
    return { rows: [] }
  }
}
const reply = (message: Record<string, unknown>): typeof fetch =>
  (async () =>
    new Response(
      JSON.stringify({
        model: 'openai/gpt-oss-120b',
        choices: [{ message, finish_reason: 'stop' }],
        usage: { cost: 0, prompt_tokens: 3, completion_tokens: 2 },
      }),
      { status: 200 },
    )) as unknown as typeof fetch
const ask = (message: Record<string, unknown>) =>
  new ProviderRouter(new Db(), 'key', reply(message)).complete({
    messages: [{ role: 'user', content: 'hi' }],
  })

describe('provider response shapes', () => {
  it('returns the final answer and not a reasoning field beside it', async () => {
    const r = await ask({
      content: 'The closing balance is 21,700.',
      reasoning: 'We need to read the row for December...',
      reasoning_content: 'We need to read the row for December...',
      reasoning_details: [{ type: 'reasoning.text', text: 'We need to read the row' }],
    })
    expect(r.content).toBe('The closing balance is 21,700.')
    expect(JSON.stringify(r)).not.toContain('We need to read')
  })

  it('treats an answer that is only reasoning as no answer, never as the answer', async () => {
    await expect(
      ask({ content: null, reasoning: 'We need to access office records: db.read' }),
    ).rejects.toBeInstanceOf(EmptyCompletionError)
    await expect(ask({ content: '', reasoning_content: 'Let us think' })).rejects.toBeInstanceOf(
      EmptyCompletionError,
    )
  })

  it('leaves a legitimate answer that merely contains the word reasoning intact', async () => {
    const text =
      'The reasoning behind the 12-month lock-in is the 4.6% rate, which is the highest on the list.'
    expect((await ask({ content: text })).content).toBe(text)
  })
})
