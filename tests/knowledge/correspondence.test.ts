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

  it('forbids the sentence the whole cache makes tempting', () => {
    // A subject line plus a snippet reads like a thread and is not one. This
    // is the one instruction in the block that cannot be dropped.
    const block = mailBlock([hit()])
    expect(block).toContain('NOT the ')
    expect(block).toMatch(/not read one/i)
    expect(block).toMatch(/may NOT say what/i)
  })

  it('CONTROL: and it does not claim the office holds the message body', () => {
    expect(mailBlock([hit()])).toContain('never fetches')
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
