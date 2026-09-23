/**
 * "What I asked for was a proper illustrated PDF" is a request (#320).
 *
 * ## The turn this is written against
 *
 *   Grant : Write me a PDF report on where the Legacy Coaching Course is
 *   office: (makes one — `artifact.report` children, PDFs on the project)
 *   Grant : Okay, that's pretty good. But what I asked for was a proper
 *           beautifully illustrated PDF with details on that, not just a
 *           couple of small paragraphs.
 *   office: I can't create a PDF directly in Telegram, but I'll build a
 *           Notion page you can export as a PDF.
 *
 * Two independent defects met in that last line and both are fixed. The
 * capability half is in the registry — no row named `artifact.report`, so no
 * agent's brief mentioned it. This is the other half: every verb in `MAKE_IT`
 * is a present-tense imperative, which is how a FRESH request is worded, and a
 * follow-up restating an unmet one has no imperative in it at all. Nothing
 * recognised the sentence, so the turn fell through to prose and the model
 * filled the gap.
 *
 * ## The negatives are the point
 *
 * A recogniser that says yes to everything would "fix" this and make a second
 * report every time Grant mentioned the first. The exclusion that already
 * protected "the report you wrote yesterday" has to keep working, and asking
 * ABOUT a document must still not make one.
 */

import { describe, expect, it } from 'vitest'
import { artifactRequest } from '../../src/agents/actions.ts'

describe('a follow-up that restates an unmet request asks for the thing again', () => {
  it('the sentence Grant actually sent', () => {
    expect(
      artifactRequest(
        "Okay, that's pretty good. But what I asked for was a proper beautifully " +
          'illustrated PDF with details on that, not just a couple of small paragraphs.',
      ),
    ).not.toBeNull()
  })

  it('phrasings nobody wrote it against', () => {
    for (const said of [
      'I wanted a proper illustrated PDF, not a few paragraphs.',
      "That's not what I asked for, I asked for a written report I can print.",
      'All I wanted was a one-pager on the pricing change.',
      'I was after a proper dossier, with the numbers in it.',
    ]) {
      expect(artifactRequest(said), said).not.toBeNull()
    }
  })

  it('and the fresh imperative still works', () => {
    expect(artifactRequest('Write me a PDF report on where the course has got to')).not.toBeNull()
  })
})

describe('and does not make a second one by mistake', () => {
  it('asking for a document that exists is a delivery request', () => {
    for (const said of [
      'Send me the report you wrote yesterday.',
      'I wanted the report you already sent — can you resend it?',
      'What I asked for was the report you made last week.',
    ]) {
      expect(artifactRequest(said), said).toBeNull()
    }
  })

  it('a remark about a document is not a request for one', () => {
    for (const said of [
      'Did you see the report from the accountants?',
      'The PDF looked fine to me.',
      'I asked for a coffee, not a meeting.',
      // The #259 sentence, kept here as a standing negative: "Call it X" is
      // the ANSWER to "what should I call it?", and a recogniser that claimed
      // it would turn a task into a report.
      'Call it Review the onboarding copy.',
      'Add a task',
    ]) {
      expect(artifactRequest(said), said).toBeNull()
    }
  })

  /*
    The control that proves the restatement clause is doing the work rather
    than an imperative hidden in the sentence.

    CLAUDE.md records three vacuous controls in one session: a test asserting
    that a name appears in a file stays green when the expression is replaced
    by null. So this asserts the DISCRIMINATION — a restatement with no making
    verb in it at all is recognised, and the same sentence about nothing
    makeable is not.
  */
  it('the restatement alone carries it, and only for something makeable', () => {
    expect(artifactRequest('What I asked for was a proper illustrated PDF.')).not.toBeNull()
    expect(artifactRequest('What I asked for was a quieter office.')).toBeNull()
  })
})
