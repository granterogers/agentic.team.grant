/**
 * What the office may say about an email it has not read (#172, ADR-0037).
 *
 * `mailBlock` is the only place a model is told what the cached mail IS, and
 * the distinction it has to carry is unusual: the office holds a subject line,
 * a sender, a date and roughly a hundred characters of Gmail's own snippet,
 * and never the body — `src/google/mail.ts` fetches `format=metadata` so the
 * body is not transferred at all.
 *
 * So the failure this guards is not fabrication in general. It is the specific,
 * very plausible sentence *"the email says they agreed to the March date"*,
 * produced from a subject line. Every assertion here is about the block saying
 * so, and about the tiers not being flattened.
 */

import { describe, expect, it } from 'vitest'
import {
  type Coverage,
  coverageNote,
  type MailHit,
  mailBlock,
  mailRefs,
} from '../../src/knowledge/retrieval.ts'

const hit = (over: Partial<MailHit> = {}): MailHit => ({
  // The metadata-only shape, which is still what most cached rows are: a
  // message whose body nothing has looked at yet (#172, ADR-0038).
  body: null,
  bodyTruncated: false,
  withheld: null,
  excerpt: 'Can we move it to the Thursday',
  from: 'Priya Raman',
  matched: 'Priya Raman',
  messageId: 'abc123',
  sentAt: '2026-09-14T09:12:00+00:00',
  subject: 'Thursday',
  why: 'contact',
  ...over,
})

describe('the correspondence, as the model sees it', () => {
  it('says nothing when there is nothing', () => {
    expect(mailBlock([])).toBe('')
  })

  it('names the sender, the date and the subject', () => {
    const block = mailBlock([hit()])
    expect(block).toContain('Thursday')
    expect(block).toContain('Priya Raman')
    expect(block).toContain('2026-09-14')
  })

  it('states WHY each message is here, differently for each tier', () => {
    const both = mailBlock([
      hit({ matched: 'Priya Raman', why: 'contact' }),
      hit({ matched: 'Harbour Lighting Rebuild', messageId: 'def', why: 'named' }),
    ])
    expect(both).toContain('is a contact on this project')
    expect(both).toContain('the subject names "Harbour Lighting Rebuild"')
  })

  it('forbids the sentence a preview makes tempting', () => {
    /*
      A subject line plus a snippet reads like a thread and is not one. This is
      the one instruction in the block that cannot be dropped — and #172 made
      it CONDITIONAL rather than universal, which is why it is now asserted
      against a message whose body the office does not hold rather than against
      any message at all.

      Asserted as a property and not as a wording. The three literal strings
      that used to stand here (`NOT the `, `not read one`, `never fetches`)
      were a lock on a sentence, and ADR-0038 changing the posture turned all
      three red over correct behaviour — the sixth instance CLAUDE.md records.
    */
    const block = mailBlock([hit()])
    expect(block).toMatch(/may NOT say what/i)
    expect(block).toMatch(/preview/i)
    /*
      It must not claim a read it did not do — the thing the caveat is for.

      Asserted against the READ grant's own words rather than against "quote",
      because `THE_RULE` legitimately says the office may quote untrusted data:
      a negative on that word would have gone red over the injection fence,
      which is a different sentence doing a different job. The first draft did
      exactly that.
    */
    expect(block).not.toMatch(/what was agreed in it/i)
  })

  it('CONTROL: a message whose body IS held is allowed to be used', () => {
    /*
      The other direction, and the reason the assertion above is narrow. A
      caveat printed over a body Grant explicitly authorised the office to hold
      would forbid the feature he asked for — a rule that is right about six
      messages and applied to a seventh it is wrong about.
    */
    const block = mailBlock([
      hit({ body: 'We agreed the March date and the two-week onboarding.' }),
    ])
    expect(block).toContain('We agreed the March date')
    expect(block).toMatch(/what was agreed in it/i)
    // And with nothing in this block unread, the preview caveat is absent —
    // a rule about a case that is not present is a rule a model misapplies.
    expect(block).not.toMatch(/may NOT say what/i)
  })

  it('says both halves when the block holds both kinds', () => {
    const block = mailBlock([
      hit({ body: 'The signed contract is attached.', messageId: 'read-1' }),
      hit({ messageId: 'preview-1' }),
    ])
    expect(block).toMatch(/what was agreed in it/i)
    expect(block).toMatch(/may NOT say what/i)
  })

  it('bulk mail says it arrived and nothing else', () => {
    const block = mailBlock([hit({ excerpt: 'FIFTY PERCENT OFF EVERYTHING', withheld: 'bulk' })])
    expect(block).toMatch(/bulk mail/i)
    expect(block).toMatch(/deliberately does not read marketing/i)
    // The excerpt is not rendered either: withholding a body and printing the
    // marketing copy underneath it would withhold nothing.
    expect(block).not.toContain('FIFTY PERCENT OFF')
  })

  it('records a citable reference per message', () => {
    expect(mailRefs([hit()])).toEqual(['mail:abc123 Thursday'])
    expect(mailRefs([])).toEqual([])
  })

  it('CONTROL: a reference names the message, so two messages are two sources', () => {
    // A ref that collapsed to "mail" would make one cited email and five
    // indistinguishable in `outputs.sources`, which is where #185 reads from.
    const refs = mailRefs([hit(), hit({ messageId: 'xyz', subject: 'Other' })])
    expect(new Set(refs).size).toBe(2)
  })
})

describe('and what it may conclude from the mail being unreadable', () => {
  const covered = (over: Partial<Coverage> = {}): Coverage => ({
    blank: [],
    complete: true,
    documents: 5,
    ...over,
  })

  it('a stale cache earns its own sentence, even with nothing else missing', () => {
    const note = coverageNote(covered({ blank: ['mail'], complete: false }))
    expect(note).toMatch(/not been able to read the mail/i)
    expect(note).toContain('never that there is nothing there')
    // It must NOT borrow the connector sentence, which would say the mail is
    // attached to the project. It is not: it is a cache the office shares.
    expect(note).not.toContain('attached')
  })

  it('and sits alongside a connector gap without either swallowing the other', () => {
    const note = coverageNote(covered({ blank: ['drive', 'mail'], complete: false }))
    expect(note).toMatch(/not been able to read the mail/i)
    expect(note).toContain('Google Drive')
    expect(note).toContain('is attached')
    // "Google Drive and mail are attached" is the sentence this ordering
    // exists to prevent.
    expect(note).not.toMatch(/Drive and mail/)
  })

  it('CONTROL: a fresh cache says nothing about the mail at all', () => {
    expect(coverageNote(covered())).toBe('')
    expect(coverageNote(covered({ blank: ['drive'], complete: false }))).not.toMatch(/mail/i)
  })
})
