/**
 * What "it" refers to, and what the resolver must refuse to do.
 *
 * Issue #63. The positive case is easy and mostly the model's job. The tests
 * that earn their place are the refusals: a resolver that quietly drops a
 * clause produces a plausible instruction that is NOT the one Grant gave, and
 * nothing downstream can tell the difference. That is the failure mode this
 * whole file is guarding.
 */

import { describe, expect, it } from 'vitest'
import { accept, needsResolving } from '../../src/agents/thread.ts'

describe('deciding whether to spend a model call at all', () => {
  it('leaves a self-contained instruction alone', () => {
    // The common message, and the budget is ~£0/month. Most of these must
    // never reach a model.
    expect(needsResolving('Create a notebook called Coaching for Success')).toBe(false)
    expect(needsResolving('Add the interview transcripts to the Legacy course')).toBe(false)
  })

  it('spots a sentence that depends on something outside itself', () => {
    expect(needsResolving('Make the audio one long')).toBe(true)
    expect(needsResolving('Do that again')).toBe(true)
    expect(needsResolving('Add them to the project')).toBe(true)
    expect(needsResolving('Use the same one instead')).toBe(true)
  })

  it('does not treat a long instruction that names its subject as elliptical', () => {
    /*
      "it" appears here and its antecedent is inside the sentence. Sending this
      to be resolved would be a wasted call on the most common shape of real
      instruction — a long one that says what it is about and then refers back
      within itself.
    */
    expect(
      needsResolving(
        'Create a new Google Notebook called "Coaching for Success" and research how to ' +
          'make money coaching wellness, then produce a presentation from it',
      ),
    ).toBe(false)
  })
})

describe('taking the rewrite, or keeping the original', () => {
  const original = 'Make the audio one long'

  it('accepts a rewrite that substitutes the subject in', () => {
    const r = accept(original, 'Make the audio overview for Coaching for Success long')
    expect(r.changed).toBe(true)
    expect(r.instruction).toContain('Coaching for Success')
    // The original is kept so the say-back can show what was assumed.
    expect(r.from).toBe(original)
  })

  it('strips the quotes a model wraps its answer in', () => {
    const r = accept(original, '"Make the audio overview for Coaching for Success long"')
    expect(r.instruction.startsWith('"')).toBe(false)
  })

  it('keeps the original when the model repeats it back', () => {
    expect(accept(original, original).changed).toBe(false)
  })

  it('keeps the original when the model says nothing', () => {
    expect(accept(original, '   ').changed).toBe(false)
  })

  it('refuses a rewrite that is much shorter, because that is a summary', () => {
    // A summary loses a clause, and a lost clause is invisible downstream.
    expect(
      accept('Make the audio overview long and send me the link here', 'Make audio').changed,
    ).toBe(false)
  })

  it('refuses a rewrite that has grown into a plan', () => {
    const r = accept(
      original,
      'Make the audio overview long, and also create the notebook, add the sources, ' +
        'produce a presentation, send the links, and check the allowance first before ' +
        'doing any of it, then report back with what was produced and how long it took',
    )
    expect(r.changed).toBe(false)
  })

  it('refuses a rewrite that started explaining itself', () => {
    expect(accept(original, 'Sure — here is the rewritten sentence: make it long').changed).toBe(
      false,
    )
    expect(accept(original, 'The rewritten sentence is: make the audio long').changed).toBe(false)
  })

  it('refuses a list, because a list is a plan and there is already a planner', () => {
    expect(accept(original, '1. Make the audio\n2. Make it long').changed).toBe(false)
  })
})
