import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

/*
  The title a to-do is filed under, from the request as the person typed it (stress test of 22 November 2026). The live
  to-do was filed as "This project: Book the venue walkthrough, due": the project label and the date were left in the name.
  The label is a closed pattern now; these cases fix it and keep the plain request working.
*/
const titleOf = (said: string): string | undefined =>
  taskRequest(said, classifyIntent(said))?.title ?? undefined

describe('a project label with a colon is not part of the title', () => {
  it('removes "to this project:" and keeps the work the person named', () => {
    expect(
      titleOf('Add a to-do to this project: Book the venue walkthrough, due next Friday.'),
    ).toBe('Book the venue walkthrough')
  })

  it('keeps the case of the words after the label', () => {
    expect(titleOf('Add a to-do to this project: book the venue walkthrough')).toBe(
      'book the venue walkthrough',
    )
  })

  it('control: a plain request with no label is filed as before', () => {
    expect(titleOf('Add a task to chase the roofer')).toBe('chase the roofer')
  })

  it('control: a sentence that only mentions a project is not a label', () => {
    // "this project" with no colon stays with the adjunct rule, which is unchanged.
    expect(titleOf('Add a task to chase the roofer on this project')).not.toMatch(/^project\s*:/i)
  })
})
