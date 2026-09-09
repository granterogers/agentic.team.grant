/**
 * "Wire this up" — including the sentence that got a paragraph instead.
 */
import { describe, expect, it } from 'vitest'
import { connectRequest, namedSpace } from '../../src/agents/connect.ts'

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
