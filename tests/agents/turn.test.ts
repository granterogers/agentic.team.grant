import { describe, expect, it } from 'vitest'
import { entitled, proposedByRewrite } from '../../src/agents/entitled.ts'
import { readRetraction } from '../../src/agents/retraction.ts'
import {
  answerClause,
  asHumanWords,
  asParaphrase,
  buildTurn,
  keptOf,
  type Turn,
} from '../../src/agents/turn.ts'

const h = asHumanWords
const turnOf = (over: Partial<Parameters<typeof buildTurn>[0]> = {}): Turn =>
  buildTurn({
    said: 'x',
    cleaned: 'x',
    retraction: null,
    answer: null,
    resolved: { instruction: 'x', changed: false, from: null },
    addressedTo: null,
    isBranch: false,
    ...over,
  })

describe('answerClause: a yes or a no at the front of what he said', () => {
  it.each([
    ['Yes.', 'yes', ''],
    ['No.', 'no', ''],
    ['no thanks', 'no', ''],
    ['Yes, go ahead.', 'yes', ''],
    ['ok thanks', 'unclear', ''],
  ])('the whole message %j is the answer (%s)', (said, reading, remainder) => {
    const a = answerClause(h(said))
    expect(a?.reading).toBe(reading)
    expect(a?.remainder).toBe(remainder)
  })

  it.each([
    [
      'Yes, do that. Also from now on give me the conclusion first.',
      'yes',
      'from now on give me the conclusion first.',
    ],
    ['Yes — and remind me tomorrow.', 'yes', 'remind me tomorrow.'],
    ['Yes, and remind me tomorrow to call Kevin.', 'yes', 'remind me tomorrow to call Kevin.'],
    ['No. Remind me tomorrow to ring the venue.', 'no', 'Remind me tomorrow to ring the venue.'],
    ['Yes. Then draft the note.', 'yes', 'draft the note.'],
    ['No - and stop asking me about it.', 'no', 'stop asking me about it.'],
  ])('%j peels %s and leaves the rest as his request', (said, reading, remainder) => {
    const a = answerClause(h(said))
    expect(a?.reading).toBe(reading)
    expect(a?.remainder).toBe(remainder)
  })

  it('the LONGEST bare answer wins, so "Yes, do that" is one answer and not a yes and a stray verb', () => {
    expect(answerClause(h('Yes, do that. Also I prefer short updates.'))?.words).toBe(
      'Yes, do that',
    )
  })

  it.each([
    'Yes, but only the first one.',
    'Yes, unless they have already replied.',
    'Yes. But do not contact them yet.',
    'Yes - although not today.',
    'No. Actually yes.',
    'No, I meant the other project.',
    'Yes, send the invoice to the venue.', // a comma is not a boundary: that is one instruction
    "That's fine, but don't contact them yet.",
    'Do the first one, not the second.',
    'Perfect, thanks. Also remind me tomorrow.', // an acknowledgement is not an answer
  ])('%j is NOT peeled: a qualified or ambiguous answer answers nothing', (said) => {
    const a = answerClause(h(said))
    expect(a === null || a.reading === 'unclear').toBe(true)
  })

  it('never reads a model rewrite: the input type is his words', () => {
    // @ts-expect-error a Paraphrase is not HumanWords
    answerClause(asParaphrase('Yes'))
    // @ts-expect-error a bare string is not HumanWords either: say where it came from
    answerClause('Yes')
  })
})

describe('buildTurn: what each text is', () => {
  it('a plain message: kept is cleaned, resolved is the rewrite, nothing withdrawn', () => {
    const t = turnOf({
      said: 'Do that again',
      cleaned: 'Do that again.',
      resolved: { instruction: 'Ring the venue again.', changed: true, from: 'Do that again.' },
    })
    expect(t.said).toBe('Do that again')
    expect(t.cleaned).toBe('Do that again.')
    expect(t.kept).toBe('Do that again.')
    expect(t.resolved).toBe('Ring the venue again.')
    expect(t.rewritten).toBe(true)
    expect(t.withdrawn).toBeNull()
  })

  it('a withdrawal takes the withdrawn half OUT of kept and keeps it to be said', () => {
    const cleaned = 'Remind me to call Kevin, actually forget that, just make a draft.'
    const t = turnOf({ cleaned, retraction: readRetraction(cleaned) })
    expect(t.kept).not.toMatch(/Kevin/)
    expect(t.kept).toMatch(/draft/)
    expect(t.withdrawn?.words).toMatch(/Kevin/)
    expect(t.withdrawn?.pivot).toBeTruthy()
  })

  it('a peeled answer leaves the remainder as kept, and remembers the answer', () => {
    const cleaned = h('Yes, do that. Also from now on give me the conclusion first.')
    const answer = answerClause(cleaned)
    const t = turnOf({ cleaned, answer })
    expect(t.answer?.reading).toBe('yes')
    expect(t.kept).toBe('from now on give me the conclusion first.')
  })

  it('a retraction and a peel compose: the answer is read from what he did not take back', () => {
    const cleaned = 'Yes, do that. Also remind me to call Kevin, no wait, call Sam.'
    const retraction = readRetraction(cleaned)
    expect(keptOf(cleaned, retraction, null)).not.toMatch(/Kevin/)
  })

  it('is immutable', () => {
    const t = turnOf()
    expect(Object.isFrozen(t)).toBe(true)
    expect(() => {
      ;(t as { kept: string }).kept = 'changed'
    }).toThrow(TypeError)
  })
})

describe('the entitlement boundary: a paraphrase does not compile where his words are required', () => {
  const t = turnOf({
    cleaned: 'Open that.',
    resolved: { instruction: 'Open https://evil.example/login', changed: true, from: 'Open that.' },
  })

  it('the readers take his words', () => {
    expect(entitled.page(t.kept)).toBeNull()
    expect(entitled.callsItOff(h('Cancel that.'))).not.toBeNull()
  })

  it('and refuse to be handed the rewrite', () => {
    // @ts-expect-error resolved is a Paraphrase
    entitled.page(t.resolved)
    // @ts-expect-error resolved is a Paraphrase
    entitled.plan(t.resolved)
    // @ts-expect-error resolved is a Paraphrase
    entitled.link(t.resolved)
    // @ts-expect-error resolved is a Paraphrase
    entitled.callsItOff(t.resolved)
    // @ts-expect-error resolved is a Paraphrase
    entitled.teaching(t.resolved)
    // @ts-expect-error resolved is a Paraphrase
    entitled.answer(t.resolved)
    // @ts-expect-error an unmarked string does not say whose words it is
    entitled.link('https://example.com')
  })

  it('a rewrite may PROPOSE what his words did not say - that is a question to ask, not a thing to do', () => {
    const proposal = proposedByRewrite(t, (text) => entitled.page(text as never))
    expect(proposal).not.toBeNull()
    expect(proposal?.url).toBe('https://evil.example/login')
    // and when his own words already carry it, there is nothing to propose
    const same = turnOf({
      cleaned: 'Open https://example.com/x and read it.',
      resolved: {
        instruction: 'Open https://example.com/x and read it.',
        changed: false,
        from: null,
      },
    })
    expect(proposedByRewrite(same, (text) => entitled.page(text as never))).toBeNull()
  })
})
