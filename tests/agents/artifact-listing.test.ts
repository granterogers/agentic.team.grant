/**
 * Asking what a notebook HAS, rather than asking for a new one (#260).
 *
 * Grant's example is the first test. The rest are the ways it could be wrong,
 * and they matter more: this sits in front of a path that spends a NotebookLM
 * quota and puts a file in his notebook, so the expensive direction is reading
 * a question as a request.
 *
 * `notebookRequest` is asserted alongside in the overlapping cases, because
 * "is this a listing" and "is this a generation" have to disagree — a phrase
 * both matched would do both.
 */

import { describe, expect, it } from 'vitest'
import { artifactListing, notebookRequest } from '../../src/agents/actions.ts'

describe('a question about what exists', () => {
  it('reads Grant’s own example', () => {
    const asked = artifactListing('Give me all the audio overviews in the Money Mastery notebook.')
    expect(asked?.kinds).toEqual(['audio'])
    expect(asked?.many).toBe(true)
  })

  it('reads a slide-deck listing', () => {
    expect(artifactListing('List all slide decks in the coaching notebook')?.kinds).toEqual([
      'slides',
    ])
  })

  it('reads two kinds in the order they were named', () => {
    const asked = artifactListing(
      'Show me the audio overviews and the mind maps in our notebook please',
    )
    expect(asked?.kinds).toEqual(['audio', 'mindmap'])
  })

  it('reads "what has it generated" as every kind', () => {
    const asked = artifactListing('What has the notebook generated so far?')
    expect(asked).not.toBeNull()
    expect(asked?.kinds).toEqual([])
    expect(asked?.many).toBe(true)
  })

  it('knows one from many, so the reply can be phrased in the right number', () => {
    expect(artifactListing('Send me the audio overview')?.many).toBe(false)
    expect(artifactListing('Send me all the audio overviews')?.many).toBe(true)
  })
})

describe('and what it must not read as one', () => {
  /*
    The expensive direction. Listing something that is not there says "there
    are none"; generating something that was only asked about spends a quota
    and puts a file in his notebook.
  */
  it('CONTROL: a request to MAKE one is not a request to see them', () => {
    expect(notebookRequest('Make an audio overview of the coaching material')).not.toBeNull()
    expect(artifactListing('Make an audio overview of the coaching material')).toBeNull()
  })

  it('CONTROL: and the two never both fire', () => {
    for (const said of [
      'Make an audio overview',
      'Give me all the audio overviews in the notebook',
      'Can you create a slide deck from the notebook',
      'List the slide decks',
    ]) {
      const both = notebookRequest(said) !== null && artifactListing(said) !== null
      expect(both, said).toBe(false)
    }
  })

  it('CONTROL: a definition question is not a listing', () => {
    expect(artifactListing('What is an audio overview?')).toBeNull()
    expect(artifactListing('What are the slide decks for, exactly?')).toBeNull()
  })

  it('CONTROL: an ordinary sentence with no artifact word is not a listing', () => {
    expect(artifactListing('Show me the pricing page')).toBeNull()
    expect(artifactListing('What did we decide about the supplier?')).toBeNull()
  })

  it('CONTROL: a brief that merely mentions one is not a listing', () => {
    const brief = [
      'Populate the Notion teamspace from the notebook.',
      '- pull the files it has generated (audio overviews and the like)',
      '- add a page per module',
      '- link each one back to the source',
      '- tell me when it is done',
      'Take your time over it.',
      'No rush at all.',
    ].join('\n')
    expect(artifactListing(brief)).toBeNull()
    // And the generation matcher agrees, which is the defect that guard was
    // written for in the first place.
    expect(notebookRequest(brief)).toBeNull()
  })

  it('CONTROL: "what has it generated" needs the notebook named', () => {
    // Otherwise every "what have you produced this week" becomes a notebook
    // enumeration, which is a different question with a different answer.
    expect(artifactListing('What have you generated so far?')).toBeNull()
  })
})
