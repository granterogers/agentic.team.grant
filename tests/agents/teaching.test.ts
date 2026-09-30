/**
 * Reading a message as a teaching — or, more often, correctly not.
 *
 * The failure mode that matters is eagerness. A recogniser that turns every
 * instruction into a stored rule fills the office with rules Grant never meant
 * to give, and each one then shapes every later answer.
 */

import { describe, expect, it } from 'vitest'
import { readTeaching } from '../../src/agents/teaching.ts'

describe('readTeaching — ordinary work is not a teaching', () => {
  const work = [
    'Send me the weekly report.',
    'Can you look at the Wellness project and tell me where it got to?',
    'Create a new notebook called Market Landscape and upload the PDFs.',
    'What did we decide about the pricing page?',
    'Thanks, that is exactly right.',
    'no',
  ]
  for (const w of work) {
    it(`leaves alone: ${w.slice(0, 40)}`, () => {
      expect(readTeaching(w)).toBeNull()
    })
  }
})

describe('readTeaching — a standing preference is a lesson', () => {
  it('reads "from now on"', () => {
    const t = readTeaching('From now on, always paste the image URLs into the reply as well.')
    expect(t?.kind).toBe('lesson')
    expect(t?.kind === 'lesson' && t.body).toContain('paste the image URLs')
  })

  it('reads a prohibition', () => {
    const t = readTeaching('Never send me two messages for one voice note.')
    expect(t?.kind).toBe('lesson')
  })

  it('reads an explicit request to keep it', () => {
    const t = readTeaching('Remember this: I only want messages from the chief of staff.')
    expect(t?.kind).toBe('lesson')
  })

  it('keeps a lesson to one sentence, because the cap is the boundary', () => {
    // ADR-0015: a lesson long enough to hold a procedure is long enough to hold
    // an endpoint and a payload.
    const t = readTeaching(
      'From now on, always give me the URL. That matters because I cannot see ' +
        'anything otherwise and I will not go looking for it on the build page.',
    )
    expect(t?.kind).toBe('lesson')
    expect(t?.kind === 'lesson' && t.body.length).toBeLessThanOrEqual(280)
    expect(t?.kind === 'lesson' && t.body).not.toContain('build page')
  })
})

describe('readTeaching — a procedure is a skill', () => {
  const brief =
    'When you write a project brief, read the spec section first, then list ' +
    'the files it touches and why each one has to change, then say what you ' +
    'did not do and why you did not do it.'

  it('reads a conditional with a sequence', () => {
    const t = readTeaching(brief)
    expect(t?.kind).toBe('skill')
  })

  it('names it from the condition', () => {
    const t = readTeaching(brief)
    expect(t?.kind === 'skill' && t.name).toBe('Writing a project brief')
  })

  it('keeps the whole message as the procedure, not the half after the comma', () => {
    // Cutting at the comma dropped the first step whenever the condition came
    // second: "read the spec first, whenever you write a brief" is the same
    // instruction with its parts swapped.
    const t = readTeaching(brief)
    expect(t?.kind === 'skill' && t.procedure).toContain('read the spec section first')
    expect(t?.kind === 'skill' && t.procedure).toContain('what you did not do')
  })

  it('reads a message that announces itself as a method', () => {
    const t = readTeaching(
      "Here's how to handle a research request: check what we already hold, " +
        'then search, then write it up with the sources cited inline.',
    )
    expect(t?.kind).toBe('skill')
  })

  it('reads a numbered list as a procedure', () => {
    const t = readTeaching(
      'Our review process:\n1. Read the diff top to bottom\n2. Run the fast ' +
        'checks\n3. Write down what you could not verify',
    )
    expect(t?.kind).toBe('skill')
  })

  it('names a procedure with no stated condition from the procedure itself', () => {
    /*
      The bug this exists for reached the live office.

      The gerund rule was applied to the fallback phrase "Whenever it applies to
      the work in hand" and produced a skill called "Ting applies to the work in
      hand". Sixteen tests passed, because every one of them supplied a
      condition. The rule only makes sense on a verb phrase.
    */
    const t = readTeaching(
      "Here's how to handle a request you cannot finish: do every part that is " +
        'not blocked, then say plainly which part you could not do and why.',
    )
    expect(t?.kind).toBe('skill')
    expect(t?.kind === 'skill' && t.name).not.toMatch(/^Ting/)
    expect(t?.kind === 'skill' && t.name).toMatch(/^[A-Z]/)
    expect(t?.kind === 'skill' && t.name).toContain('how to handle a request')
  })

  it('does not gerund a pronoun', () => {
    const t = readTeaching(
      'When it comes to a research request, check what we already hold first, ' +
        'then search, then write it up with the sources cited inline in the text.',
    )
    expect(t?.kind === 'skill' && t.name).not.toMatch(/^Iting|^Ting/)
  })

  it('does not promote a short conditional into a procedure', () => {
    // "When you finish, tell me" is a preference, not a method, and filing it
    // as a skill buries one sentence in a library.
    const t = readTeaching('Whenever you finish something, always tell me straight away.')
    expect(t?.kind).toBe('lesson')
  })
})

describe('#237: eight things asked for is not a procedure taught', () => {
  /*
    This exact instruction was filed as a global skill called "Shoulding
    decide". None of its eight clauses was answered, and the nonsense went into
    the office's memory to be "put in front of the relevant work from now on".

    Two things let it through: `when we should decide,` matched the condition
    pattern mid-clause, and nothing distinguished a request for WORK from a
    teaching once the text was long enough.
  */
  const eightClauses =
    'I need you to look at what we charge, compare it to two competitors, ' +
    'work out the margin at the current price, say what happens if we drop ' +
    'it ten percent, flag anything risky about doing that, suggest when we ' +
    'should decide, tell me who should own it, and keep the whole thing ' +
    'under a page.'

  it('is not read as a teaching at all', () => {
    expect(readTeaching(eightClauses)).toBeNull()
  })

  it.each([
    'Can you compare the two options and tell me when we should decide, please.',
    'I want you to draft the note and say when we should send it, then stop.',
    'Could you look at the pricing and flag when we should review it again?',
  ])('leaves the work request %s alone', (text) => {
    expect(readTeaching(text)).toBeNull()
  })
})

describe('#237: a real teaching still lands', () => {
  /*
    Long enough to reach the CONDITIONAL path, which is the one #237 narrowed.

    Shorter teachings were, and still are, read as a lesson rather than a
    procedure — that is the 140-character floor doing its job and has nothing
    to do with this change. Testing the short ones here would have asserted
    against a threshold instead of against the anchor.
  */
  it.each([
    'Whenever you write a client brief, read the spec first, check it against the last three we sent, and flag anything that contradicts what we told them before it goes out.',
    'Read the spec first, check it against the last three we sent and flag anything that contradicts what we told them, whenever you write a client brief for somebody new.',
  ])('still reads %s as a procedure', (text) => {
    expect(text.length).toBeGreaterThanOrEqual(140)
    expect(readTeaching(text)?.kind).toBe('skill')
  })

  it('an explicit teach signal beats the work-request guard', () => {
    // "I need you to remember that ..." is both a request and a teaching, and
    // the teaching is the part that matters.
    const text =
      'I need you to remember this: whenever you draft an announcement, run it ' +
      'past Grace before it goes anywhere near a customer.'
    expect(readTeaching(text)).not.toBeNull()
  })
})

describe('the rule is the sentence that carries the marker (final audit, invariant 4)', () => {
  const lesson = (text: string) => {
    const t = readTeaching(text)
    return t?.kind === 'lesson' ? t.body : null
  }

  it('a reminder first and the rule second stores the RULE, never the reminder', () => {
    expect(
      lesson('Remind me tomorrow to call Kevin. From now on give me the conclusion first.'),
    ).toBe('From now on give me the conclusion first.')
  })

  it('a rule followed by a question is stored; the question mark is not a question about the rule', () => {
    expect(
      lesson('From now on give me the conclusion first. And what is the status of the venue?'),
    ).toBe('From now on give me the conclusion first.')
  })

  it('the rule sits between two other sentences', () => {
    expect(
      lesson(
        'Please research sponsors then write the outreach note. Always keep it brief. What is on my plate today?',
      ),
    ).toBe('Always keep it brief.')
  })

  it('CONTROL: a question ABOUT a rule is still not stored as one', () => {
    expect(
      lesson('Should you always use bullet points? Also remind me tomorrow to call Kevin.'),
    ).toBeNull()
  })

  it("CONTROL: a third party's habit in a later sentence is still not a rule for the office", () => {
    expect(lesson('Thanks for that. My accountant always sends invoices late.')).toBeNull()
    expect(lesson('Fine. Emma never replies before ten, by the way.')).toBeNull()
  })

  it('CONTROL: a single-sentence rule is unchanged', () => {
    expect(lesson('From now on give me the conclusion first.')).toBe(
      'From now on give me the conclusion first.',
    )
  })

  it.each([
    ['Do not use bullet points. I never read them.', 'Do not use bullet points.'],
    ['Keep it short. I always read on my phone.', 'Keep it short.'],
    ['Please use British spelling. I always forget to say.', 'Please use British spelling.'],
    ['Keep replies short. From now on use bullet points.', 'Keep replies short.'],
  ])(
    'an incidental "never"/"always" later does not displace the rule before it (review R2-2): %s',
    (said, rule) => {
      expect(lesson(said)).toBe(rule)
    },
  )

  it.each([
    ['Write me a summary of the venue. Never mind, I will do it.'],
    ['Remind me to call Kevin tomorrow. I never remember.'],
    ['Thanks for that. My accountant always sends invoices late.'],
  ])(
    "a marker that is a retraction, a statement about himself or somebody else's habit stores NOTHING: %s",
    (said) => {
      expect(lesson(said)).toBeNull()
    },
  )

  it('CONTROL: a first-person preference is still a rule', () => {
    expect(lesson('I always want the conclusion first. Research the venue.')).toBe(
      'I always want the conclusion first.',
    )
  })
})
