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

  it('does not promote a short conditional into a procedure', () => {
    // "When you finish, tell me" is a preference, not a method, and filing it
    // as a skill buries one sentence in a library.
    const t = readTeaching('Whenever you finish something, always tell me straight away.')
    expect(t?.kind).toBe('lesson')
  })
})
