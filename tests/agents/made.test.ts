/**
 * #248 — the office may not report making something it did not make.
 *
 * Found immediately after #246 was fixed, which is the useful part of the
 * story: stopping the model narrating its tool deliberation did not make the
 * action happen, it made the FAILURE INVISIBLE. The deliberation was ugly and
 * legible; "Task created for you, due Friday" is neither, and Grant stops
 * chasing the supplier.
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { claimsToHaveMade } from '../../src/agents/quality.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

describe('#248 — a creation claimed in the past tense', () => {
  const CLAIMS: readonly string[] = [
    'Task “Chase supplier quote” created for you, due Friday.',
    'Task "Chase supplier quote" created for you, due Friday.',
    "I've created a task to chase the supplier.",
    'I have added the note to your notebook.',
    'I made you a reminder for Friday morning.',
    'The document has been filed under pricing.',
    'A draft is saved in the project.',
    'I logged it against the alpha project.',
    'I scheduled the review for Thursday.',
    'Done — that is on your list now.',
  ]

  for (const body of CLAIMS) {
    it(`catches: ${body.slice(0, 48)}`, () => {
      expect(claimsToHaveMade(body)).not.toBeNull()
    })
  }
})

describe('#248 — a plan, an offer or a question is not a claim', () => {
  // These are the sentences the office SHOULD keep saying. A check that
  // refuses them pushes it towards saying nothing about what it intends.
  const FINE: readonly string[] = [
    "I'll create the task once you tell me which project it belongs to.",
    'I can make you a task to chase it, if that would help.',
    'Shall I file this as a task?',
    'Would you like me to add a reminder for Friday?',
    'I could draft it and let you look before anything is saved.',
    'I am about to set it up — confirm the project first.',
    'You may want a task for this; say the word.',
    'That task was created last week by you, before I was involved.',
    'The supplier has not sent the quote.',
    '',
  ]

  for (const body of FINE) {
    it(`leaves alone: ${body.slice(0, 48) || '(empty)'}`, () => {
      expect(claimsToHaveMade(body)).toBeNull()
    })
  }
})

describe('#248 — "make me a task" is how a person asks', () => {
  // The one word between the verb and the article that sent the whole write
  // path into prose, and with it the false "Task created for you".
  const ASKS: readonly string[] = [
    'OK. Make me a task to chase the supplier quote instead.',
    'Make me a task to chase the supplier quote.',
    'Add me a task for the renewal.',
    'Create a task to chase the supplier quote.',
    'Log me a task about the onboarding copy.',
    'Raise us a task to review the contract.',
  ]

  for (const say of ASKS) {
    it(`reaches the writer: ${say.slice(0, 44)}`, () => {
      expect(taskRequest(say, classifyIntent(say))).not.toBeNull()
    })
  }

  const NOT_ASKS: readonly string[] = [
    // The subject of the sentence, not the person being done a favour.
    'Make the pricing review a task.',
    // The prohibition still wins, over the intent gate and over this.
    'Do not make me a task for this yet.',
    "Don't create a task for the renewal.",
    // A question about tasks is not an instruction to write one.
    'Do we have a task for the renewal?',
  ]

  for (const say of NOT_ASKS) {
    it(`writes nothing: ${say.slice(0, 44)}`, () => {
      expect(taskRequest(say, classifyIntent(say))).toBeNull()
    })
  }
})

describe('#248 — the subject dropped, which is how a model reports', () => {
  it('catches a calendar entry the office cannot write', () => {
    // Verbatim from the run that found it. Nothing was added: there is no
    // calendar write on this path at all, and it invented a limitation of the
    // thing it had not done ("our system can only create all-day events").
    expect(
      claimsToHaveMade(
        'Added an all-day calendar entry for this Friday titled “Revised quote reminder.” ' +
          'It will show up in your schedule as a reminder for the morning.',
      ),
    ).not.toBeNull()
  })

  const DROPPED: readonly string[] = [
    'Added it: chase the supplier for the revised quote.',
    'Created the task for Friday.',
    'Filed that under pricing.',
    'Scheduled a reminder for the morning.',
    'Logged this against alpha.',
  ]

  for (const body of DROPPED) {
    it(`catches: ${body.slice(0, 44)}`, () => {
      expect(claimsToHaveMade(body)).not.toBeNull()
    })
  }

  it('but not the same verb mid-clause about something else', () => {
    expect(
      claimsToHaveMade('I have added the renewal to the risks you listed for review.'),
    ).not.toBeNull()
    // The office describing a list, not reporting an action it took.
    expect(claimsToHaveMade('The supplier added a surcharge to the quote.')).toBeNull()
    expect(claimsToHaveMade('Their pricing page was updated last week.')).toBeNull()
  })
})
