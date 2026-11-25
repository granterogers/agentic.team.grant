/**
 * A project is not created from a chat "yes", and the reply says what is needed (0.117.3). Cowork test of 24 November 2026 (T11).
 */
import { describe, expect, it } from 'vitest'
import { projectCreateReplyFor, projectNameAsked } from '../../src/agents/project-create.ts'

describe('a request to create a project says a source is needed and nothing was created', () => {
  it('answers the request with the name it was given', () => {
    expect(projectCreateReplyFor('Create a new project called Test Pop-up Market.', '')).toBe(
      '"Test Pop-up Market" has not been created, and nothing has been changed. A project needs a source first: a Notion database or a notebook. Tell me which one it should use, or create it yourself with ☰ → Create project.',
    )
  })
  it('answers "Yes, go ahead." that follows the request, without claiming a Notion project', () => {
    expect(
      projectCreateReplyFor('Yes, go ahead.', 'Create a new project called Test Pop-up Market.'),
    ).toMatch(/"Test Pop-up Market" has not been created/)
  })
  it('leaves an unrelated yes alone', () => {
    expect(projectCreateReplyFor('Yes, go ahead.', 'Move the task to Done.')).toBeNull()
  })
  it('leaves a question about a project alone', () => {
    expect(projectCreateReplyFor('What is the status of the Zephyr project?', '')).toBeNull()
  })
  it('reads the name', () => {
    expect(projectNameAsked('Create a new project called "Test Pop-up Market".')).toBe(
      'Test Pop-up Market',
    )
    expect(projectNameAsked('create a project named Trip.')).toBe('Trip')
    expect(projectNameAsked('create a project')).toBeNull()
  })
})
