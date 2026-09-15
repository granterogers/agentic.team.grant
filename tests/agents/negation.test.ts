import { describe, expect, it } from 'vitest'
import { asksWhatWasSaid, excludesASubject, withoutNegated } from '../../src/agents/negation.ts'

/*
  #237. A voice note routed to exactly the specialist it excluded:

    "sorry ignore that last bit i meant the onboarding not the pricing"

  `app.who_knows_about` is a trigram match, saw "pricing", and sent the work to
  the finance director. Worse than a miss — a miss lands on the Chief of Staff,
  and this lands on somebody confidently answering the withdrawn question.
*/
describe('#237: what the request is NOT about is removed before the lookup', () => {
  it.each([
    ['sorry ignore that last bit i meant the onboarding not the pricing', 'pricing'],
    ['I meant the onboarding, not the pricing.', 'pricing'],
    ['Look at growth rather than the pricing', 'pricing'],
    ['Use marketing instead of the sales angle', 'sales'],
    ['Forget the email. Add a task to chase it.', 'email'],
  ])('drops the excluded subject in %s', (text, gone) => {
    expect(withoutNegated(text).toLowerCase()).not.toContain(gone)
    expect(excludesASubject(text)).toBe(true)
  })

  it('keeps the subject it is still about', () => {
    expect(withoutNegated('I meant the onboarding, not the pricing.').toLowerCase()).toContain(
      'onboarding',
    )
  })
})

describe('#237: a negated VERB is not a negated subject', () => {
  /*
    The one way this could make routing worse: stripping after "not" when what
    follows is how Grant feels rather than what he is asking about. "I do not
    think the pricing matters" is a pricing question.
  */
  it.each([
    'I do not think the pricing matters',
    'I am not sure the onboarding is the problem',
    'I am not convinced the margin is the issue',
    'We are not going to change the pricing yet',
  ])('leaves %s untouched', (text) => {
    expect(withoutNegated(text)).toBe(text)
    expect(excludesASubject(text)).toBe(false)
  })
})

describe('#237: doing nothing is the common case', () => {
  it.each([
    'What is our pricing?',
    'Where are things getting stuck when somebody joins?',
    'Draft the announcement email for the pricing change.',
    '',
  ])('returns %s unchanged', (text) => {
    expect(withoutNegated(text)).toBe(text)
  })

  it('never returns empty, even when the negation was the whole sentence', () => {
    // A lookup against nothing is worse than a lookup against something
    // misleading — it would send every such turn to the Chief of Staff with no
    // reason recorded.
    expect(withoutNegated('not the pricing')).toBe('not the pricing')
  })
})

describe('#231: a question about what was said earlier', () => {
  /*
    Asked in a chat with no earlier turn, the office invented a figure and
    attributed it to Grant. The provenance guards catch the claims one phrasing
    at a time; what can be decided WITHOUT a model is the shape of the question.
  */
  it.each([
    'What price did I tell you the middle tier was?',
    'And who did I say owns the onboarding rewrite?',
    'What did I ask you about right at the very start of this conversation?',
    'What did we decide about the launch date?',
    'How much did I say the tier was?',
    'What did you say the margin was?',
  ])('recognises %s', (text) => {
    expect(asksWhatWasSaid(text)).toBe(true)
  })

  it.each([
    'What is our gross margin on the middle tier?',
    'Tell me what the competitors charge.',
    'Draft the announcement email.',
    'Who owns the onboarding rewrite?',
    'What should we do about the pricing?',
  ])('leaves the ordinary question %s alone', (text) => {
    // A question about the WORLD is not a question about the conversation, and
    // answering it with "I have nothing from earlier" would be a non-sequitur.
    expect(asksWhatWasSaid(text)).toBe(false)
  })
})
