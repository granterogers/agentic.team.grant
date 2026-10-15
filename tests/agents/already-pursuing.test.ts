import { describe, expect, it } from 'vitest'
import { alreadyPursuing } from '../../src/agents/already.ts'
import type { ProviderRouter } from '../../src/providers/router.ts'

/*
  Correction 1 (chief-of-staff-forensics-code.md): duplicate detection matches a new request to running work by a MODEL
  judgement over the conversation's candidates, not by text. These tests drive the real function with a stub router, so
  they check what it does with each answer the model can give, and what it is shown.
*/

type Live = { job: string; about: string; who: string }

const stub = (reply: string | Error) =>
  ({
    complete: async (req: { messages: { content: string }[] }) => {
      stub.lastUser = req.messages[1]?.content ?? ''
      if (reply instanceof Error) throw reply
      return { content: reply }
    },
  }) as unknown as ProviderRouter & { complete: unknown }
stub.lastUser = ''

const live: Live[] = [
  { job: 'job-a', about: 'Draft the summary of the venue replies', who: 'Research Director' },
  { job: 'job-b', about: 'Price the coworking options in the Canaries', who: 'Finance Director' },
]

describe('the model answer decides a match, and only a bare answer counts', () => {
  it('a bare number selects that running job', async () => {
    expect(await alreadyPursuing('Summarise the venue replies', live, stub('2'))).toEqual(live[1])
  })

  it('NONE is no match, so the new request starts', async () => {
    expect(await alreadyPursuing('Book a flight', live, stub('NONE'))).toBeNull()
  })

  it('a sentence is not read for a digit: "item 2 of your 3 points" matches nothing', async () => {
    expect(
      await alreadyPursuing('Summarise it', live, stub('This matches item 2 of your 3 points.')),
    ).toBeNull()
  })

  it('a number outside the candidates matches nothing', async () => {
    expect(await alreadyPursuing('x', live, stub('9'))).toBeNull()
  })

  it('a model error fails open: the request is not suppressed', async () => {
    expect(await alreadyPursuing('x', live, stub(new Error('provider down')))).toBeNull()
  })

  it('with no router there is no judgement, so nothing is suppressed', async () => {
    expect(await alreadyPursuing('x', live, null)).toBeNull()
  })
})

describe('what the model is shown', () => {
  it('each running request is cut to 240 characters before the judgement', async () => {
    const long = `${'x'.repeat(300)} TAIL-MARKER`
    await alreadyPursuing('something', [{ job: 'j', about: long, who: 'someone' }], stub('NONE'))
    expect(stub.lastUser).not.toContain('TAIL-MARKER')
    expect(stub.lastUser).toContain('x'.repeat(240))
  })

  it('a candidate with no stored request is not offered to the model at all', async () => {
    stub.lastUser = ''
    const result = await alreadyPursuing(
      'x',
      [{ job: 'j', about: '   ', who: 'someone' }],
      stub('1'),
    )
    expect(result).toBeNull()
    expect(stub.lastUser).toBe('')
  })
})
