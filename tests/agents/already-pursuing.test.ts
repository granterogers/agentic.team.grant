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

describe('only work for the same project can be a repeat (priority 3, DEC-016)', () => {
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  const otherProject = [
    { job: 'job-b', about: 'Draft the venue summary', who: 'Research', project: B },
  ]

  it('work for another project is never offered, so a different request is not suppressed', async () => {
    stub.lastUser = ''
    const result = await alreadyPursuing('Draft the venue summary', otherProject, stub('1'), {
      projectId: A,
    })
    expect(result).toBeNull()
    expect(stub.lastUser).toBe('')
  })

  it('work for the same project is offered and can match', async () => {
    const same = [{ job: 'job-a', about: 'Draft the venue summary', who: 'Research', project: A }]
    expect(
      await alreadyPursuing('Draft the venue summary', same, stub('1'), { projectId: A }),
    ).toEqual(same[0])
  })

  it('work whose project is unknown is not offered to a request that has a project', async () => {
    stub.lastUser = ''
    const unknown = [
      { job: 'job-n', about: 'Draft the venue summary', who: 'Research', project: null },
    ]
    expect(
      await alreadyPursuing('Draft the venue summary', unknown, stub('1'), { projectId: A }),
    ).toBeNull()
    expect(stub.lastUser).toBe('')
  })

  it('with no project given the candidates are offered as before (no behaviour change for old callers)', async () => {
    expect(await alreadyPursuing('Draft the venue summary', otherProject, stub('1'))).toEqual(
      otherProject[0],
    )
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
