/**
 * "Wire this up" — including the sentence that got a paragraph instead.
 */
import { describe, expect, it } from 'vitest'
import { connectRequest, namedSpace, populateRequest } from '../../src/agents/connect.ts'

describe('the sentences Grant actually sent', () => {
  it('reads an explicit "work with the notion you have"', () => {
    const asked = connectRequest('just work with the notion teamspace you have for now')
    expect(asked?.what).toBe('notion')
  })

  it('reads "there is only one teamspace you have access to, use it"', () => {
    const asked = connectRequest(
      'there is only one current notion teamspace you have access to already, so use it',
    )
    expect(asked?.what).toBe('notion')
  })

  it('does NOT catch the two he actually sent, and that is recorded not hidden', () => {
    // "just work with what you have for now" names nothing — it only means
    // Notion because of the message before it. And the other is an answer to a
    // question the agent asked, with no verb in it. Stretching the patterns
    // until these matched would match an enormous amount besides.
    //
    // Asserted so the gap stays visible: if a later change makes these pass,
    // it has almost certainly made something worse pass too.
    expect(connectRequest('just work with what you have for now')).toBeNull()
    expect(
      connectRequest(
        'there is only one current notion teamspace you ahve access to already, ' +
          "so i don't hink you need the iD.. and it has no active projects ATM .. otherwise, good to go",
      ),
    ).toBeNull()
  })

  it('picks up a teamspace named plainly', () => {
    expect(connectRequest('attach the Legacy Coaching Course teamspace in notion')?.named).toBe(
      'Legacy Coaching Course',
    )
  })

  it('picks up a quoted one, which is unambiguous', () => {
    expect(namedSpace('use the "Money Mastery" teamspace')).toBe('Money Mastery')
  })

  it('does not mistake an article for a name', () => {
    expect(namedSpace('connect the teamspace to this project')).toBeNull()
    expect(namedSpace('use our teamspace')).toBeNull()
  })
})

describe('what must not trigger a configuration change', () => {
  it('ignores a question about connections', () => {
    // Answering "can you write to Notion?" by rewiring a project would be a
    // remarkable way to answer a question.
    for (const said of [
      'can you connect to notion?',
      'is notion connected to this project?',
      'why can we not use notion here?',
    ]) {
      expect(connectRequest(said), said).toBeNull()
    }
  })

  it('ignores a brief that merely mentions Notion', () => {
    // The same failure as the audio overview: a long instruction containing a
    // trigger word is not a request for the trigger word.
    const brief = [
      'Take the notebook and populate the corresponding Notion teamspace.',
      '- Read all twelve sources.',
      '- Break the curriculum into Projects.',
      '- Create the tasks that follow.',
      '- Write the documents up properly.',
      'Check what exists before creating anything.',
    ].join('\n')
    expect(connectRequest(brief)).toBeNull()
  })

  it('ignores a message that says nothing about Notion', () => {
    expect(connectRequest('connect the github repo to this project')).toBeNull()
  })

  it('ignores talking about Notion without a verb', () => {
    expect(connectRequest('notion is looking a bit empty')).toBeNull()
  })
})

/**
 * The brief that came back as prose while the teamspace stayed empty.
 *
 * *"notion is still empty.. you need to check against the results of what im
 * asking."* These are the sentences that must reach `office.notion_import`.
 */
describe('asking for Notion to be filled', () => {
  const brief =
    "use your connection to the notebook 'Legacy Coaching Course' as a means to fully " +
    'populate the corresponding teamspace in Notion: so create tasks, fully populate docs ' +
    'on Notion format to be easily viewable based on what is present in the notebook, ' +
    "break down the teamspace into 'notion projects' based on the coaching curriculum"

  it('reads the brief he actually sent', () => {
    expect(populateRequest(brief)).toBe(true)
  })

  it('overlaps with connectRequest, which is why order matters', () => {
    // The brief says "use ... Notion", so the wire-up table reads it too — it
    // is one long line rather than the multi-sentence shape `looksLikeABrief`
    // recognises. Both readings are defensible and neither is wrong: he is
    // asking for a workspace to be connected AND filled.
    //
    // So this is not a conflict to be settled by tightening a regex, it is a
    // sequence: attach first, then write. `instruction.ts` enqueues both in
    // that order, and this test exists so a change to either table shows up as
    // a decision rather than as an empty teamspace.
    expect(connectRequest(brief)).not.toBeNull()
    expect(populateRequest(brief)).toBe(true)
  })

  it('reads the short forms too', () => {
    expect(populateRequest('populate Notion from what we have')).toBe(true)
    expect(populateRequest('import the course into Notion')).toBe(true)
    expect(populateRequest('build out the Notion pages')).toBe(true)
  })

  it('leaves questions about Notion alone', () => {
    expect(populateRequest('can you populate Notion with this?')).toBe(false)
    expect(populateRequest('what would you put into Notion?')).toBe(false)
  })

  it('does not fire on a sentence with no Notion in it', () => {
    expect(populateRequest('populate the spreadsheet from the notebook')).toBe(false)
  })
})
