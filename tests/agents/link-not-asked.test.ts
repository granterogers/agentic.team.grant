import { describe, expect, it } from 'vitest'
import { linkRequest } from '../../src/agents/links.ts'

/*
  A link the person mentions and says not to open is not a link request (stress test of 23 November 2026: the team opened
  example.com and filed it as a document). The controls keep an explicit request working.
*/
describe('a link the person says not to open is not acted on', () => {
  it('does not file or read a link the person is not asking about', () => {
    expect(
      linkRequest(
        "Our supplier's page is https://example.com, but I am not asking about it. Do not open it. What should I do about the venue booking this week?",
      ),
    ).toBeNull()
  })

  it('does not read a link after "do not open" alone', () => {
    expect(
      linkRequest('Do not open https://example.com/report, just tell me the deadline.'),
    ).toBeNull()
  })

  it('control: an explicit request to add a link is still a request', () => {
    const got = linkRequest('Add https://example.com/report as a source for this project.')
    expect(got).not.toBeNull()
    expect(got?.intent).toBe('add_source')
  })

  it('control: an explicit request to read a link is still a request to read it', () => {
    const got = linkRequest('Read https://example.com/ and tell me what it says.')
    expect(got).not.toBeNull()
    expect(got?.intent).toBe('discuss')
  })
})
