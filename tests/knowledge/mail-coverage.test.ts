/**
 * "There is nothing in your email about that" is a claim (#172, #257).
 *
 * `mailBlock` returned an empty string when nothing matched, so the model was
 * told NOTHING about mail and any absence it stated was a claim about a search
 * whose shape it had never been given.
 *
 * This is not hypothetical. Measured on the live database while writing it:
 * **206 cached messages, 167 threads, zero contacts, and zero mail associated
 * with any of Grant's five projects.** ADR-0037 calls a contact match "the
 * strongest statement of relevance the database holds", and that tier has
 * never fired on real data. An office answering "nothing in your email" in
 * that state is confidently wrong about his own business.
 *
 * The rule the note enforces is the one #257 settled: you may say you cannot
 * connect any correspondence to this project; you may NOT say there is none.
 */
import { describe, expect, it } from 'vitest'
import { type MailCoverage, mailBlock, mailCoverageNote } from '../../src/knowledge/retrieval.ts'

const coverage = (over: Partial<MailCoverage> = {}): MailCoverage => ({
  aliases: 0,
  // Null is "no project was named", which is the shape that keeps the old
  // contacts-or-aliases proxy. A case about a PROJECT sets it.
  associated: null,
  cached: 206,
  contacts: 0,
  ...over,
})

describe('an empty inbox answer says WHICH kind of empty it is', () => {
  it('refuses the absence when mail is cached but nothing can be associated', () => {
    const note = mailCoverageNote(coverage())
    expect(note).toContain('206')
    // The two halves of the rule, both required.
    expect(note).toContain('cannot connect any of his correspondence')
    expect(note).toContain('may NOT')
  })

  it('says something different when there is no cached mail at all', () => {
    const note = mailCoverageNote(coverage({ cached: 0 }))
    // A different fact pointing at a different fix: connect or sync, rather
    // than add a contact.
    expect(note).toContain('no cached mail at all')
    expect(note).not.toContain('206')
  })

  /*
    Silence when coverage is complete. A caveat on every turn is one nobody
    reads, which is the rule `app.project_knowledge` already follows — and the
    reason this is a note rather than a permanent disclaimer.
  */
  it('says nothing when the project CAN associate mail', () => {
    expect(mailCoverageNote(coverage({ contacts: 1 }))).toBe('')
    expect(mailCoverageNote(coverage({ aliases: 3 }))).toBe('')
    expect(mailCoverageNote(null)).toBe('')
  })

  /*
    AND "CAN" MEANS IT ACTUALLY DOES.

    The line above keeps its argument — a caveat on every turn is one nobody
    reads — and it was being decided by the wrong number. `app.mail_coverage`
    has always computed how much mail a project MATCHES and the TypeScript
    interface dropped it, so a project with an alias nobody has written about
    was treated as covered. Measured live: all five of Grant's active projects
    match ZERO of 274 cached messages, and every one has at least one alias.
  */
  it('but a project that matches nothing is not covered, whatever tiers it has', () => {
    expect(mailCoverageNote(coverage({ contacts: 5, aliases: 1, associated: 0 }))).toContain(
      'may NOT',
    )
    expect(mailCoverageNote(coverage({ aliases: 3, associated: 0 }))).toContain('may NOT')
  })

  it('and one that does match is left in silence', () => {
    expect(mailCoverageNote(coverage({ contacts: 0, aliases: 1, associated: 4 }))).toBe('')
  })

  it('reaches the model through mailBlock when there are no hits', () => {
    expect(mailBlock([], coverage())).toContain('cannot connect any')
  })

  /*
    THE CONTROL, and the one that matters most. With hits, the note must NOT
    appear: telling the model it can see nothing while handing it four
    messages would be the office contradicting itself inside one prompt, which
    is the coherence defect #185 exists about.
  */
  it('CONTROL: it does not appear when there ARE hits to show', () => {
    const hit = {
      excerpt: 'The renewal is due at the end of the month.',
      from: 'ben@hartleyco.com',
      body: null,
      bodyTruncated: false,
      withheld: null,
      matched: 'ben@hartleyco.com',
      messageId: 'm1',
      sentAt: '2026-09-10T09:00:00Z',
      subject: 'Renewal',
      why: 'contact' as const,
    }
    const block = mailBlock([hit], coverage())
    expect(block).toContain('Renewal')
    expect(block).not.toContain('cannot connect any')
    // And the standing rule about bodies survives the change.
    expect(block).toContain('NOT say what')
  })
})
