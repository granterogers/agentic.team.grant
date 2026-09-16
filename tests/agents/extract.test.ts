/**
 * Reading a request to extract tasks, and refusing where there is none (#130).
 *
 * Half of these are about the FALSE POSITIVE, because `hq_task_add` is a real
 * write into a list Grant looks at and a dozen invented tasks is a worse
 * outcome than not recognising the request at all.
 */
import { describe, expect, it } from 'vitest'
import { extractionRequest } from '../../src/agents/extract.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

describe('what is an extraction', () => {
  it('reads the headline case', () => {
    const r = extractionRequest('pull the tasks out of the pricing brief')
    expect(r?.from).toBe('pricing brief')
  })

  it('reads the ways a person actually says it', () => {
    expect(extractionRequest('extract the action items from WS02 Pricing.pdf')?.from).toBe(
      'WS02 Pricing.pdf',
    )
    expect(extractionRequest('what are the next steps in the onboarding doc')?.from).toBe(
      'onboarding doc',
    )
    expect(extractionRequest('turn the workshop notes into tasks')?.from).toBe('workshop notes')
    expect(extractionRequest('make tasks from the retro')?.from).toBe('retro')
    expect(extractionRequest('list the to-dos in the launch plan')?.from).toBe('launch plan')
  })

  /*
    A trailing clause is not part of the name. Getting this wrong would send
    the handler looking for a document called "the brief then tell me which
    are urgent", find nothing, and report that the brief does not exist.
  */
  it('takes the source and not the sentence after it', () => {
    expect(
      extractionRequest('pull the tasks out of the pricing brief, then tell me which are urgent')
        ?.from,
    ).toBe('pricing brief')
  })

  it('asks the whole project when no source is named', () => {
    expect(extractionRequest('what needs doing')).toEqual({
      from: null,
      matched: 'what needs doing',
    })
    expect(extractionRequest('pull out all the actions')?.from).toBeNull()
  })
})

describe('what is not', () => {
  /*
    #249's lesson, in the place it would do the most damage: reading a refusal
    as an instruction does the thing he just said not to do.
  */
  it('is not an extraction when he says not to', () => {
    expect(extractionRequest('do not pull the tasks out of that yet, just summarise it')).toBeNull()
    expect(
      extractionRequest('summarise the brief rather than pulling the tasks out of it'),
    ).toBeNull()
  })

  it('is not an extraction when he is telling us he did it', () => {
    expect(extractionRequest('I pulled the tasks out of the brief already')).toBeNull()
    expect(extractionRequest('here are the actions from the call')).toBeNull()
  })

  it('does not fire on ordinary sentences that mention tasks', () => {
    expect(extractionRequest('how many tasks are open?')).toBeNull()
    expect(extractionRequest('send me the report')).toBeNull()
    expect(extractionRequest('mark the roofing task done')).toBeNull()
  })

  /*
    The discriminator that matters most, asserted against the OTHER reader
    rather than described.

    A single stated task is `taskRequest`'s and must not become an extraction,
    or one task Grant dictated is replaced by a model's opinion of several.
  */
  it('leaves a single stated task to taskRequest', () => {
    const said = 'make a task to chase the roofing quote'
    expect(extractionRequest(said)).toBeNull()
    expect(taskRequest(said, classifyIntent(said))).not.toBeNull()
  })

  /*
    And the reverse, which is the reason extraction is checked FIRST: this
    satisfies both readings, and only one of them is what he meant.
  */
  it('claims a plural-with-a-source that taskRequest would also take', () => {
    const said = 'make tasks from the workshop notes'
    expect(extractionRequest(said)?.from).toBe('workshop notes')
  })
})
