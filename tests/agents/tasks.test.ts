import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { NEEDS_A_TITLE, TITLE_ASKED, taskRequest, titleReply } from '../../src/agents/tasks.ts'

const ask = (text: string) => taskRequest(text, classifyIntent(text))

/*
  #237. Every case here is a sentence a session actually put through the
  office, or the nearest variant of one. The four-way distinction is the
  property that matters most: only one of these four may write.
*/
describe('#237: only a command creates a task', () => {
  it('creates on a plain imperative with a title', () => {
    const r = ask('Create a task to chase the pricing page by Friday.')
    expect(r?.title).toBe('chase the pricing page by Friday')
  })

  it('creates on an imperative after an affirmation', () => {
    // "Yes, do it. Create the task." classified as an unconfident `thought`
    // until #237 — the class that convenes nobody and writes nothing — so the
    // one turn of four that WAS a command was the one that did nothing.
    expect(classifyIntent('Yes, do it. Create the task.').intent).toBe('direct_command')
    expect(ask('Yes, do it. Create the task.')).not.toBeNull()
  })

  it('refuses a suggestion', () => {
    expect(ask('I think we should create a task for that.')).toBeNull()
  })

  it('refuses a question', () => {
    expect(ask('Should we create a task for that?')).toBeNull()
  })

  it('refuses an explicit hold', () => {
    expect(ask('Do not create it yet — show me what it would say.')).toBeNull()
  })

  it('refuses a hedge', () => {
    expect(ask('Maybe create a task later.')).toBeNull()
  })

  it('refuses a prohibition even when the intent would allow it', () => {
    /*
      Belt and braces over the intent gate rather than instead of it. "Do not
      create it yet" reaches its correct verdict by NOT BEING UNDERSTOOD, which
      is a thin reason to rely on for the one operation that writes.
    */
    const text = 'Add the summary but do not create a task for it.'
    expect(classifyIntent(text).intent).toBe('direct_command')
    expect(ask(text)).toBeNull()
  })
})

describe('#237: a referent is not a title', () => {
  it.each([
    'Add a task for that.',
    'Create a task for it.',
    'Add a task about that.',
    'Create the task.',
  ])('asks rather than inventing a title from %s', (text) => {
    const r = ask(text)
    expect(r).not.toBeNull()
    // A task called "that" is worse than a question. The handler answers with
    // NEEDS_A_TITLE, which asks for the one field the writer actually requires
    // — the reply this replaced asked for four, one of which is not even a
    // parameter of the function it would have called.
    expect(r?.title).toBeNull()
  })

  it.each([
    ['Add a task to review the onboarding copy.', 'review the onboarding copy'],
    ['Put a task on the board to fix the pricing page.', 'fix the pricing page'],
    ['Create a task called Renew the domain', 'Renew the domain'],
    ['Log a task about the Friday deploy', 'the Friday deploy'],
  ])('takes the title out of %s', (text, title) => {
    expect(ask(text)?.title).toBe(title)
  })
})

describe('#237: it does not fire on ordinary work', () => {
  it.each([
    'What would a fifteen percent price cut do to our margin?',
    'Draft the announcement email for the pricing change.',
    'I need you to model the margin impact of the price cut.',
    'Where are things getting stuck when somebody joins?',
  ])('leaves %s alone', (text) => {
    expect(ask(text)).toBeNull()
  })

  it('does not fire on the word task in a sentence about tasks', () => {
    // The commonest false positive shape: talking ABOUT the board rather than
    // asking for something on it.
    expect(ask('Which tasks are blocked at the moment?')).toBeNull()
  })
})

describe('#237: the answer to the title question is accepted', () => {
  /*
    The office asked "what should it be called?" and then could not accept the
    answer — the reply matched no task shape, fell through to prose, and the
    task was never created. A question whose answer is dead is worse than not
    asking: Grant has typed the same intention twice and has nothing.
  */
  it.each([
    ['Call it Review the onboarding copy.', 'Review the onboarding copy'],
    ['call it Renew the domain', 'Renew the domain'],
    ["Let's call it Fix the pricing page", 'Fix the pricing page'],
    ['Title: Chase the invoice', 'Chase the invoice'],
  ])('takes an explicit naming reply with no history: %s', (text, title) => {
    expect(titleReply(text, null)).toBe(title)
  })

  it('takes a bare phrase ONLY when the question was just asked', () => {
    const bare = 'Review the onboarding copy'
    // Without the question in front of it this is an ordinary instruction and
    // turning it into a task would be a write nobody asked for.
    expect(titleReply(bare, null)).toBeNull()
    expect(titleReply(bare, 'Some unrelated answer about margins.')).toBeNull()
    expect(titleReply(bare, NEEDS_A_TITLE)).toBe(bare)
  })

  it.each(['that', 'it', 'this'])('refuses the referent %s as a title', (text) => {
    expect(titleReply(text, NEEDS_A_TITLE)).toBeNull()
  })

  it('refuses a question, however short', () => {
    expect(titleReply('What do you suggest?', NEEDS_A_TITLE)).toBeNull()
  })

  it('refuses a long reply, which is a new instruction rather than a title', () => {
    const long =
      'Actually forget the task, I want you to go and look at what the competitors ' +
      'are charging and come back with a comparison'
    expect(titleReply(long, NEEDS_A_TITLE)).toBeNull()
  })

  it('NEEDS_A_TITLE contains the marker the reply is matched against', () => {
    // Both sides come from one constant, so rewording the question cannot
    // silently break the recognition of its answer. CLAUDE.md records four
    // occasions when a literal-string assertion became a wording lock.
    expect(NEEDS_A_TITLE).toContain(TITLE_ASKED)
  })
})

describe('#237: a resolved referent is still a referent', () => {
  /*
    The thread resolver expands "that" into whatever it referred to, which is
    correct and produced a task called "the second project" — filed in the
    right place, fabricated from nothing, and a name Grant would never find
    anything by. Asking is better than naming a task after a pronoun with its
    hair combed.
  */
  it.each([
    'Add a task for the second project.',
    'Add a task for the other one.',
    'Create a task for the same thing.',
    'Add a task for the above.',
  ])('asks rather than titling a task %s', (text) => {
    const r = ask(text)
    expect(r).not.toBeNull()
    expect(r?.title).toBeNull()
  })

  it('still takes a real title that happens to start with "the"', () => {
    // The guard names the referential phrases, not every sentence beginning
    // with a determiner — "the pricing page" is a perfectly good task.
    expect(ask('Add a task for the pricing page rewrite.')?.title).toBe('the pricing page rewrite')
  })
})
