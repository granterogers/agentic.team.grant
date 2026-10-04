/**
 * #417: ordinary people can teach harmless communication preferences, and authority cannot be smuggled in through the
 * lesson system.
 *
 * Found on 4 October as the Sample: three natural wordings of a harmless style rule were refused ("whenever you reply, start
 * with...", "begin every answer ... with the single word...", "sign off every answer with..."), because each overlaps
 * authority or action vocabulary (a trigger word, a verb that is also an act, a sentence where "with" is not next to the
 * verb). The fix is a PRINCIPLE, not three more strings: a rule is presentation when it is about how the office's OWN words
 * to the person are shaped, and an exclusion is only as wide as that. So this is a matrix of both directions, with the
 * near-neighbours that must stay refused, because widening a recogniser can buy recall with precision.
 *
 * Wording is not locked: each case is a sentence and the property is the verdict. Anything not positively recognised as
 * presentation is offered to the person instead of stored, which is the safe direction and is asserted for the ambiguous ones.
 */
import { describe, expect, it } from 'vitest'
import { readAuthority } from '../../src/agents/authority-bearing.ts'
import { dimensionOf } from '../../src/agents/preference.ts'

const verdict = (text: string) => readAuthority(text, dimensionOf(text))

/** Harmless: how the office's own replies to the person are shaped. These are learned on their own. */
const HARMLESS = [
  // the three that were refused
  'From now on, whenever you reply to me about the studio, start with the single word Namaste.',
  'From now on, begin every answer to me about the studio with the single word Namaste.',
  'From now on, sign off every answer to me about the studio with the word Namaste.',
  // neighbours of them
  'Whenever you answer me, give me the conclusion first.',
  'Each time you respond, open with a one line summary.',
  'Every time you write back, end with the next step.',
  'When you reply to me, keep it under three sentences.',
  'Begin every reply with the headline number.',
  'End every message to me with a single question I can answer yes or no.',
  'Please finish each answer with a short recap.',
  'Close every update with what changed since yesterday.',
  'Start all your answers with the word Right.',
  'Sign off every email draft you write for me with my initials.',
  'Lead each summary with the decision I need to make.',
  // ones that already worked
  'Give me the conclusion first.',
  'Keep answers short and put the decision first.',
  'Always use British spelling.',
  'Refer to the studio as the Space from now on.',
  'Use a friendly tone with me.',
  'No emojis in anything you send me.',
  'Put dates in the first line of every answer.',
  'When you answer me, use bullet points for anything with more than three parts.',
]

/** Authority or action: not stored on its own, offered to the person instead. */
const AUTHORITY = [
  // permission
  'You can email my clients without asking me.',
  'Go ahead and approve refunds under fifty pounds.',
  'Feel free to book travel for me.',
  'No need to check with me before replying to suppliers.',
  // outward contact, however politely framed
  'Whenever a client emails, reply to them straight away.',
  'Each time you answer a question about pricing, email the answer to the supplier.',
  'Whenever you reply to me, copy my accountant.',
  'End every message with a note and send a copy to the board.',
  'Begin every answer with an email to the client.',
  'Start with the conclusion, then send the summary to the team.',
  'Sign off every email to the supplier with my name and send it.',
  // "call" is also a phone call: a naming rule is only recognised by its unambiguous frame (refer to X as Y)
  'Call the client the moment you hear.',
  'Call the studio the Space from now on.',
  // acts in the world
  'Sign the contract for the venue.',
  'Sign off the invoice from the plumber.',
  'Sign off on every purchase under a hundred pounds.',
  'Always approve the weekly order.',
  'Pay the supplier invoices on Friday.',
  'Cancel the subscription when it renews.',
  'Delete old drafts from the shared folder.',
  // standing work on a schedule or a trigger
  'Every Monday morning, email me and the team the plan.',
  'Check the inbox daily and file anything urgent.',
  'Whenever a new lead arrives, add them to the CRM.',
  'As soon as the report is ready, publish it.',
  'Whenever you finish a report, send it to the team.',
  // when the office may act without asking
  'Never ask me before you start work on anything.',
]

/** Not recognised as presentation at all: unknown is not benign, so these are offered, never stored. */
const AMBIGUOUS = [
  'Handle refunds yourselves.',
  'Keep my accountant informed.',
  'Take care of the venue.',
  'Be proactive with suppliers.',
  'Make sure the team is happy.',
]

describe('a harmless style rule, in the words people use', () => {
  it.each(HARMLESS)('is learned on its own: %s', (text) => {
    const v = verdict(text)
    expect(v.because, text).toEqual([])
    expect(v.bearsAuthority, text).toBe(false)
  })
})

describe('authority, action and outbound contact are not smuggled in as a style rule', () => {
  it.each(AUTHORITY)('is offered, not stored: %s', (text) => {
    expect(verdict(text).bearsAuthority, text).toBe(true)
  })
})

describe('what cannot be told apart from authority fails safe', () => {
  it.each(AMBIGUOUS)('is offered with a reason a person can read: %s', (text) => {
    const v = verdict(text)
    expect(v.bearsAuthority, text).toBe(true)
    expect(v.because.length, text).toBeGreaterThan(0)
    // The reason is a sentence for a person: no code, no field names.
    for (const reason of v.because)
      expect(reason, text).not.toMatch(/[_{}<>]|regex|dimension|pattern/i)
  })
})

describe('the exclusions are as wide as the principle and no wider', () => {
  it('a trigger about the office’s own reply to the person is not "something running"', () => {
    expect(
      verdict('Whenever you reply to me, start with the single word Right.').bearsAuthority,
    ).toBe(false)
  })

  it('the same trigger about anybody else is', () => {
    expect(
      verdict('Whenever you reply to a client, start with the single word Right.').bearsAuthority,
    ).toBe(true)
    expect(
      verdict('Whenever a supplier writes, start with the single word Right.').bearsAuthority,
    ).toBe(true)
  })

  it('a trigger about the office’s reply does not hide a contact in the same sentence', () => {
    expect(verdict('Whenever you reply to me, copy my accountant.').bearsAuthority).toBe(true)
    expect(verdict('Whenever you answer me, tell the board.').bearsAuthority).toBe(true)
  })

  it('"sign off" is a closing only when it closes the office’s own words', () => {
    expect(verdict('Sign off every answer to me with the word Namaste.').bearsAuthority).toBe(false)
    expect(verdict('Sign off the invoices.').bearsAuthority).toBe(true)
    expect(verdict('Sign off on the refunds.').bearsAuthority).toBe(true)
    expect(verdict('Sign off every refund over fifty pounds.').bearsAuthority).toBe(true)
  })

  it('"begin ... with" is presentation only for the office’s own words, and only when nothing else is asked of it', () => {
    expect(verdict('Begin every answer to me with the word Right.').bearsAuthority).toBe(false)
    expect(
      verdict('Begin every answer to me with the word Right and then call the venue.')
        .bearsAuthority,
    ).toBe(true)
    expect(
      verdict('Begin the campaign with a discount email to our customers.').bearsAuthority,
    ).toBe(true)
  })
})
