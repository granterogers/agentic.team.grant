/**
 * Asking the office to read a page (#135, #16).
 *
 * The whole browser tier had no door: `browser.gather` is a registered handler
 * with an adapter, a ledger, a tab, sessions and a budget, and NOTHING ever
 * enqueued one. These are the sentences that now open it, and — more
 * importantly — the ones that must not.
 *
 * The expensive direction here is the false positive. A gather spends
 * browser-minutes, files a document into the project's knowledge, and puts a
 * page in front of future retrieval. Reading a link Grant merely mentioned is
 * therefore worse than missing one he meant, and the negative controls below
 * outnumber the positives on purpose.
 */
import { describe, expect, it } from 'vitest'
import { artifactRequest, pageRequest } from '../../src/agents/actions.ts'

describe('a request to read a page', () => {
  const asks = [
    ['an explicit read', 'Read https://example.com/pricing and tell me what changed'],
    ['a look', 'Have a look at https://example.com/pricing for me'],
    ['a question about it', 'What does https://example.com/pricing say about the tiers?'],
    ['a summary', 'Summarise https://example.com/pricing'],
    ['a bare link', 'https://example.com/pricing'],
    ['a link with a word of framing', 'this: https://example.com/pricing'],
    ['http as well as https', 'Open http://example.com/pricing'],
  ] as const

  it.each(asks)('%s', (_name, said) => {
    const got = pageRequest(said)
    expect(got).not.toBeNull()
    expect(got?.url).toBe(
      said.includes('http://') ? 'http://example.com/pricing' : 'https://example.com/pricing',
    )
    // The ledger and the Browser tab show WHY, in his words.
    expect(got?.because).toBe(said)
  })

  const declines = [
    [
      'a link mentioned in passing',
      'We should probably move off https://example.com/pricing eventually',
    ],
    [
      'a link as the subject of a plan',
      'I am thinking about whether https://example.com/pricing is still the right model for us next year',
    ],
    ['a reading verb about our own documents', 'Read the Q3 report and tell me what it says'],
    ['a reading verb with no address at all', 'Have a look at what Elena sent over'],
    ['nothing at all', ''],
    ['a bare noun', 'pricing'],
  ] as const

  it.each(declines)('declines: %s', (_name, said) => {
    expect(pageRequest(said)).toBeNull()
  })

  it('takes the first address when there are two, rather than guessing', () => {
    const got = pageRequest('Read https://example.com/a and https://example.com/b')
    expect(got?.url).toBe('https://example.com/a')
  })

  it('does not swallow the sentence punctuation into the address', () => {
    expect(pageRequest('Read https://example.com/pricing.')?.url).toBe(
      'https://example.com/pricing',
    )
    expect(pageRequest('Did you read https://example.com/pricing?')?.url).toBe(
      'https://example.com/pricing',
    )
  })

  it('leaves a non-web scheme alone rather than queueing a job that exists to fail', () => {
    expect(pageRequest('Read file:///etc/passwd')).toBeNull()
    expect(pageRequest('Open ftp://example.com/x')).toBeNull()
  })

  /*
    The precedence, MEASURED rather than assumed.

    "Write me a PDF report on https://example.com/pricing" is a request for a
    FILE that happens to name a page, and the first draft of this test asserted
    that both matchers claim it and the handler's ordering decides. They do
    not: `pageRequest` declines it, because the sentence carries no reading
    verb and is far too long to be a bare link. That is the better outcome and
    it needed checking rather than assuming — #258's own lesson was written
    after a listing matcher swallowed a request to make something.

    So there is no ambiguity to resolve here at all, and this test says so, in
    both directions.
  */
  it('leaves a request for a FILE about a page to the file path', () => {
    const said = 'Write me a PDF report on https://example.com/pricing'
    expect(artifactRequest(said)).not.toBeNull()
    expect(pageRequest(said)).toBeNull()
  })

  it('but still reads a page when the sentence asks for a read and no file', () => {
    const said = 'Read https://example.com/pricing and tell me what changed'
    expect(artifactRequest(said)).toBeNull()
    expect(pageRequest(said)).not.toBeNull()
  })
})
