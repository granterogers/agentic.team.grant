/**
 * READ SOMETHING, THEN MAKE TASKS FROM IT (#282, anchor B).
 *
 * Production, verbatim after the self-correction is removed:
 *
 *   > "Scan the entirety of the Legacy Coaching Project and create appropriate
 *   > tasks for me to review."
 *
 * None of the four original shapes reached it: the source is named with a
 * reading verb rather than with `out of`, and the plural is qualified where
 * they allow only a bare `the`. The sentence fell through to `taskRequest` and
 * became ONE personal task titled "appropriate tasks for me to review" — the
 * delegation performed as its own title.
 *
 * The controls are the point of the file. A widened matcher that also claims
 * "read the brief and let me know if it is any good" would turn a question
 * into a task-extraction job, which is the expensive direction.
 */
import { describe, expect, it } from 'vitest'
import { extractionRequest } from '../../src/agents/extract.ts'

describe('extractionRequest — read a source, then make tasks', () => {
  it('names the source from the production sentence', () => {
    const got = extractionRequest(
      'Scan the entirety of the Legacy Coaching Project and create appropriate tasks for me to review.',
    )
    expect(got?.from).toBe('Legacy Coaching Project')
  })

  it('takes a qualifier between the verb and the plural', () => {
    expect(extractionRequest('Read the workshop notes and make a few tasks from them')?.from).toBe(
      'workshop notes',
    )
  })

  it('reads other reading verbs the same way', () => {
    expect(extractionRequest('Go through the pricing brief and write the next steps')?.from).toBe(
      'pricing brief',
    )
  })

  it('CONTROL: reading without making tasks is not an extraction', () => {
    expect(extractionRequest('Read the brief and let me know if it is any good')).toBeNull()
    expect(extractionRequest('Scan this and tell me what you think')).toBeNull()
  })

  it('CONTROL: a prohibition still stops it', () => {
    /*
      `tasks.ts` learned this as #249: reading a refusal as an instruction does
      the thing he just said not to do, which is the worst false positive
      available.
    */
    expect(extractionRequest('Do not scan the project and create tasks')).toBeNull()
  })

  it('CONTROL: a single personal to-do is untouched', () => {
    expect(extractionRequest('Remind me on Friday to ring the venue')).toBeNull()
    expect(extractionRequest('Review the onboarding copy')).toBeNull()
  })
})
