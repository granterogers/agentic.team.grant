/**
 * The ten ways Grant actually asks for a task (#259).
 *
 * Every string here is from his own brief for this run — *"exercise realistic
 * phrasing including 'Fine, remind me tomorrow…', 'Right, set aside a task…',
 * 'Also, I need to…', 'So, make sure I…', 'Morning — remind me…'"* — and the
 * corpus was run against the interpreter before anything was changed. Two
 * defects, both real:
 *
 * **Six of the ten kept the opener in the TITLE.** "Fine, remind me tomorrow to
 * chase the printers" became a task called *"Fine, to chase the printers"* —
 * the framing word kept and the rest left as a fragment, on the list
 * `stripFraming` exists to make scannable. Also *"Morning — to send the
 * invoice"*, *"Thanks. to ring the venue"* and *"Actually, about the
 * handover"*.
 *
 * **Three of the ten were not recognised at all.** "Right, set aside a task
 * to…", "So, make sure I…" and "Anyway, put a task on my list to…" fell
 * through to the office's own work, so the task was never created and the
 * sentence was answered instead.
 *
 * ## What is asserted
 *
 * The TITLE, not merely that something was made. A task called "Fine, to chase
 * the printers" exists and is useless, and a test that only asked whether a
 * row appeared would have been green through both defects.
 *
 * The controls are the load-bearing half. This interpreter decides whether
 * work lands on Grant's list or on the team's, and the expensive direction is
 * unambiguous: a missed reminder costs him retyping a sentence, while a
 * delegation captured as a personal task means the work simply never happens
 * AND he is told it is his to do.
 */
import { describe, expect, it } from 'vitest'
import { personalTaskRequest } from '../../src/agents/mine.ts'

/** A Wednesday, so "Friday" and "Monday" land on different sides of it. */
const WED = new Date('2026-09-16T10:00:00Z')

describe('the way he actually says it', () => {
  it.each([
    ['Fine, remind me tomorrow to chase the printers', 'Chase the printers', '2026-09-17'],
    ['Right, set aside a task to renew the insurance', 'Renew the insurance', null],
    ['Also, I need to book the venue for October', 'Book the venue for October', null],
    ['So, make sure I call the accountant on Friday', 'Call the accountant', '2026-09-18'],
    ['Morning — remind me to send the invoice today', 'Send the invoice', '2026-09-16'],
    ['Thanks. Remind me tomorrow to ring the venue.', 'Ring the venue', '2026-09-17'],
    [
      'ok but remind me next week to check the refund policy',
      'Check the refund policy',
      '2026-09-23',
    ],
    ['Sorry, one more — I need to email the landlord tomorrow', 'Email the landlord', '2026-09-17'],
    ['Anyway, put a task on my list to review the pricing', 'Review the pricing', null],
    ['Actually, remind me on Monday about the handover', 'The handover', '2026-09-21'],
  ])('%s', (said, title, due) => {
    const got = personalTaskRequest(said, WED)
    expect(got, `"${said}" made no task at all`).not.toBeNull()
    expect(got?.title).toBe(title)
    expect(got?.due).toBe(due)
  })

  it('CONTROL: none of the titles keeps a conversational opener', () => {
    /*
      Asserted as a PROPERTY over the whole corpus rather than case by case,
      because the failure was six cases at once and a per-case expectation is
      six chances to write the defect into the test.
    */
    const openers =
      /^(?:fine|right|also|so|morning|thanks|ok|sorry|anyway|actually|well|but|and|then|one more)\b/i
    for (const said of [
      'Fine, remind me tomorrow to chase the printers',
      'Morning — remind me to send the invoice today',
      'Thanks. Remind me tomorrow to ring the venue.',
      'Actually, remind me on Monday about the handover',
      'ok but remind me next week to check the refund policy',
      'Sorry, one more — I need to email the landlord tomorrow',
    ]) {
      const title = personalTaskRequest(said, WED)?.title ?? ''
      expect(openers.test(title), `"${said}" produced "${title}"`).toBe(false)
    }
  })

  it('CONTROL: and none of them is left as a fragment starting "to"', () => {
    for (const said of [
      'Fine, remind me tomorrow to chase the printers',
      'Right, set aside a task to renew the insurance',
      'Anyway, put a task on my list to review the pricing',
    ]) {
      expect(personalTaskRequest(said, WED)?.title ?? '').not.toMatch(/^to\b/i)
    }
  })
})

describe('and the work that is NOT his', () => {
  it.each([
    ['Research WhatsApp integration', 'the Issue names this one as agent work'],
    ['I need you to draft the announcement email', 'first person, second-person object'],
    ['Can you find out what they charge?', 'a question for the team'],
    ['What is on my list today?', 'asking about the list is not adding to it'],
    ['Add a task for Emma to research the pricing', 'says task, and says who for'],
    ['Put a reminder for the team about the deadline', 'likewise, and not his'],
    ['Remind Emma to send the figures', 'reminding somebody else'],
    ['Remind me why we dropped the Tuesday cohort', 'a question wearing a reminder'],
  ])('%s — %s', (said) => {
    expect(personalTaskRequest(said, WED)).toBeNull()
  })

  it('CONTROL: the guard is about WHO, not about the word task', () => {
    /*
      "Add a task for me to…" says "for" and is still his. Without this the
      somebody-else guard would be a rule about the preposition rather than
      about the person, and would refuse the plainest phrasing there is.
    */
    const mine = personalTaskRequest('Add a task for me to renew the parking permit', WED)
    expect(mine).not.toBeNull()
    expect(mine?.title.toLowerCase()).toContain('parking permit')
  })
})
