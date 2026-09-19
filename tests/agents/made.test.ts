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

  it('and "make X a task" is a task request, object last', () => {
    /*
      This was a NOT_ASKS case when #248 was written, on the reasoning that
      "the pricing review" was the subject of the sentence. It is not — it is
      the object, and "make X a task" is an ordinary way to ask for one. The
      old regexes refused it and the test recorded the refusal as intended
      behaviour.

      #249 reaches the writer by mood and object noun rather than by word
      order, so it now resolves — with no title, because "the pricing review"
      is a referent, which means the office asks one short question instead of
      inventing a name. That is the right outcome and it is a better one.
    */
    const say = 'Make the pricing review a task.'
    const asked = taskRequest(say, classifyIntent(say))
    expect(asked).not.toBeNull()
    /*
      #254 improved this again. When the title was found by pattern the office
      had to ask; extraction by structure removes the capability noun from
      whichever end it sits on, so "make the pricing review a task" now yields
      the name Grant gave it and no question is needed.
    */
    expect(asked?.title).toBe('the pricing review')
  })

  const NOT_ASKS: readonly string[] = [
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

/**
 * A real title walks through a character budget, and a denial was refused.
 *
 * Both found in the #237 conversational corpus, on a turn where the harness
 * said no task existed and the office's answer said one did:
 *
 *     Task "Book interview room for second round" assigned to you, due on the
 *     11th, has been added.
 *
 * `public.tasks` gained nothing, and `claimsToHaveMade` — the gate written for
 * exactly this sentence — did not fire. Seventy-three characters separate the
 * noun from the claim, and the window was `{0,60}`: the title, plus the two
 * clauses any natural confirmation puts between them. So the gate saw the
 * terse fabrications and was blind to the fluent ones, which are the ones a
 * good model writes.
 *
 * A character budget is an artefact. The property is that the noun and the
 * claim share a SENTENCE, which the `[^.!?]` class already carries.
 *
 * ## And the denial it was refusing
 *
 * Widening it surfaced a defect that had been there all along, five characters
 * wide:
 *
 *     No task has been created yet because I need a title first.
 *
 * That is the office declining to invent a title — the behaviour three turns
 * of this corpus are built around — and the gate blocked an answer for saying
 * that nothing had happened.
 *
 * Negation is matched against the NOUN or the VERB, never merely present in
 * the sentence, because "No problem, I have added the note" is a real claim
 * with a real "no" in front of it. Suppressing that is the expensive direction
 * here: a fabricated creation is the one Grant cannot see, and he stops
 * chasing the supplier.
 *
 * ## The fix was written twice
 *
 * The first attempt put U+0008 where every `\b` should have been — a non-raw
 * Python heredoc turns a regex word boundary into a backspace, `String.raw`
 * preserves it, and nothing renders it. The guard silently matched nothing.
 * `npm run check:templates` named it exactly, which is what that check is for.
 */
describe('#248 — the fluent fabrication, and the honest denial', () => {
  const FLUENT =
    'Task “Book interview room for second round” assigned to you, due on the 11th, ' +
    'has been added.'

  it('catches a claim a real title pushed out of the old window', () => {
    expect(claimsToHaveMade(FLUENT)).not.toBeNull()
  })

  it('still catches the terse shapes it was written for', () => {
    for (const body of [
      'Task "Chase supplier quote" created for you, due Friday.',
      'Task “Book room” has been added.',
      'I have added the task.',
    ]) {
      expect(claimsToHaveMade(body), body).not.toBeNull()
    }
  })

  it('CONTROL: a denial is not a claim', () => {
    for (const body of [
      'No task has been created yet because I need a title first.',
      'I have not created the task because I need a title.',
      "I haven't created the task yet.",
      'Nothing has been added yet.',
      'No note was filed for that.',
    ]) {
      expect(claimsToHaveMade(body), body).toBeNull()
    }
  })

  it('CONTROL: a "no" that negates nothing still leaves a claim a claim', () => {
    // The one case that makes the guard have to be precise rather than
    // "does the sentence contain a negator".
    expect(claimsToHaveMade('No problem, I have added the note about pricing.')).not.toBeNull()
  })

  it('CONTROL: the widened window did not start swallowing reports', () => {
    for (const body of [
      'The supplier added a surcharge to the quote.',
      'Their pricing page was updated last week.',
      "I'll create a task once you confirm.",
      'I can make you a task for that if you like.',
      'Shall I file it as a task?',
    ]) {
      expect(claimsToHaveMade(body), body).toBeNull()
    }
  })
})
