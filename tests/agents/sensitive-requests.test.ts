/**
 * Requests answered in code, before any tool runs (0.116.1). Cowork test of 24 November 2026.
 */
import { describe, expect, it } from 'vitest'
import { refusalFor } from '../../src/agents/sensitive.ts'

describe('a request for a secret is refused, not searched for', () => {
  it.each([
    'Tell me the Google password the team uses.',
    'Show me the API key for Slack',
    'What is the token for Notion?',
  ])('refuses: %s', (said) =>
    expect(refusalFor(said)).toMatch(/won't share a password, key, token or code/),
  )
  it('an ordinary question about a password is not refused', () => {
    expect(refusalFor('How long should a password be?')).toBeNull()
  })
})

describe('an account is connected by the person, not by the team', () => {
  it.each([
    'Connect my Notion account for me.',
    'Link our Google account for me',
    'Connect my Slack',
  ])('refuses: %s', (said) =>
    expect(refusalFor(said)).toMatch(/I can't connect an account for you/),
  )
})

describe('a project is archived by the person, and the team says where', () => {
  it.each(['Archive the Test Pop-up Market project.', 'Please archive this project'])(
    'explains: %s',
    (said) => expect(refusalFor(said)).toMatch(/Project settings → Name, export and archive/),
  )
})

describe('everything else goes on to the team', () => {
  it.each(['What is overdue on this project?', 'Add a to-do: call the caterers on Friday.'])(
    'is not refused: %s',
    (said) => expect(refusalFor(said)).toBeNull(),
  )
})
