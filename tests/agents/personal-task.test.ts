/**
 * Whose work is it? (#259)
 *
 * The routing #259's definition of success turns on: *"Remind me tomorrow to
 * review the new dashboard"* has to become a Personal Task, and *"Research
 * WhatsApp integration"* has to stay agent work.
 *
 * ## The negatives outnumber the positives, on purpose
 *
 * The two errors are not comparable. A miss costs a to-do item he has to add
 * himself, and the office still answers. A FALSE POSITIVE costs him the work:
 * he asked for something, it went on his own list, and nothing happened. So
 * the corpus is weighted towards the sentences that must NOT be caught, and
 * the hardest of those is *"I need you to…"* — first person, and the office's
 * job, which `classifyIntent` already calls `i-need-you-to`.
 *
 * CLAUDE.md: a suite made only of refusals passes against a system that
 * refuses everything, and a suite made only of positives passes against one
 * that claims everything. Both halves are here.
 */
import { describe, expect, it } from 'vitest'
import { personalTaskRequest, whenFor } from '../../src/agents/mine.ts'

// A Wednesday, so "Friday" is two days away and "Monday" is five.
const WED = new Date('2026-09-16T09:00:00Z')

describe('what Grant has to do himself', () => {
  it('the Issue’s own example', () => {
    const got = personalTaskRequest('Remind me tomorrow to review the new dashboard', WED)
    expect(got?.title).toBe('Review the new dashboard')
    expect(got?.due).toBe('2026-09-17')
    expect(got?.because).toBe('reminder')
  })

  it('and its other one', () => {
    const got = personalTaskRequest('I need to send those documents tomorrow', WED)
    expect(got?.title).toBe('Send those documents')
    expect(got?.due).toBe('2026-09-17')
    expect(got?.because).toBe('commitment')
  })

  it('a weekday means the next one', () => {
    expect(personalTaskRequest('Remind me Friday to review the dashboard', WED)?.due).toBe(
      '2026-09-18',
    )
  })

  it('and a weekday that is today means the one coming, not the one nearly over', () => {
    // Said on a Wednesday about Wednesday. A reminder for six hours' time is
    // not what anybody means by "remind me on Wednesday".
    expect(whenFor('remind me on Wednesday', WED)).toBe('2026-09-23')
  })

  it('"don’t let me forget" is a reminder however it is phrased', () => {
    const got = personalTaskRequest('Don’t let me forget the invoice for the venue', WED)
    expect(got?.because).toBe('reminder')
    expect(got?.title).toContain('invoice')
  })

  it('the framing comes out of the title, so the list is scannable', () => {
    // A list where every row begins "remind me on Friday to" is a list nobody
    // can read down.
    const got = personalTaskRequest('remind me on Friday to ring the venue', WED)
    expect(got?.title).toBe('Ring the venue')
  })

  it('no date is not a failure — it lands in the Inbox', () => {
    const got = personalTaskRequest('I need to chase the accountant', WED)
    expect(got?.title).toBe('Chase the accountant')
    expect(got?.due).toBeNull()
  })
})

describe('what the office has to do — the expensive direction', () => {
  it('a bare imperative is agent work', () => {
    expect(personalTaskRequest('Research WhatsApp integration', WED)).toBeNull()
  })

  /*
    The one that matters most. First person, polite, and entirely the office's
    job — `classifyIntent` routes it as a direct command. Catching it here
    would put every delegation Grant phrases this way on his own list, and the
    work he asked for would simply not happen.
  */
  it('"I need you to…" is a delegation, not a to-do', () => {
    expect(
      personalTaskRequest('I need you to find the hold-up in how we deliver this', WED),
    ).toBeNull()
  })

  it('and so is "I need Emma to…"', () => {
    expect(personalTaskRequest('I need Emma to look at the pricing', WED)).toBeNull()
  })

  /*
    The PROPERTY that excludes both, named so that widening the pattern breaks
    a test rather than quietly reopening the hole.

    `need` must be followed IMMEDIATELY by `to`. A first draft added a separate
    "is he asking somebody?" guard instead; deliberately removing that guard
    changed nothing across this entire corpus — a control that cannot fail is
    not a control — and it also refused the reminder below, which is a real
    case. It caught nothing and cost something.
  */
  it('the exclusion is the adjacency, and every phrasing of it behaves', () => {
    for (const said of [
      'I need you to draft the announcement',
      'I want you to look at the margins',
      'I need the team to pick this up',
      'I need Ruby to check the channel numbers',
    ]) {
      expect(personalTaskRequest(said, WED), said).toBeNull()
    }
  })

  /*
    And the case the discarded guard broke. Asking the office to remind him is
    still a reminder — that is what the office is for — so it belongs on his
    list, with the ask stripped out of the title.
  */
  it('"I need you to remind me…" is a reminder, not a delegation', () => {
    const got = personalTaskRequest('I need you to remind me about the invoice on Friday', WED)
    expect(got?.because).toBe('reminder')
    expect(got?.title).toBe('The invoice')
    expect(got?.due).toBe('2026-09-18')
  })

  it('and "I need the figures" — one word from a commitment and the opposite request', () => {
    // "I need to send the figures" is his. "I need the figures" is an ask.
    expect(personalTaskRequest('I need the figures for the board pack', WED)).toBeNull()
  })

  it('reminding somebody ELSE is not his task', () => {
    expect(personalTaskRequest('Remind Marcus about the handover', WED)).toBeNull()
  })

  it('a question is never a task', () => {
    expect(personalTaskRequest('What did we decide about the pricing?', WED)).toBeNull()
  })

  it('and neither is a request for a document', () => {
    expect(personalTaskRequest('Write me a PDF report on the rollout', WED)).toBeNull()
  })

  it('"remind me" with nothing after it is not a task with an empty title', () => {
    // A row with no work in it is the card with nothing in it, filed.
    expect(personalTaskRequest('remind me', WED)).toBeNull()
  })
})

describe('when', () => {
  it('today and tonight', () => {
    expect(whenFor('do it today', WED)).toBe('2026-09-16')
    expect(whenFor('tonight', WED)).toBe('2026-09-16')
  })

  it('next week is seven days on, not "some time next week"', () => {
    expect(whenFor('next week', WED)).toBe('2026-09-23')
  })

  it('a day of the month that has passed means next month', () => {
    expect(whenFor('on the 3rd', WED)).toBe('2026-10-03')
  })

  it('and one still to come means this month', () => {
    expect(whenFor('on the 24th', WED)).toBe('2026-09-24')
  })

  /*
    The case where saying nothing beats guessing. September has no 31st, and a
    parser that rolls it into October files the task five days after he meant
    it — silently, which is the only kind of date error that matters.
  */
  it('a day the month does not have is left undated rather than rolled', () => {
    expect(whenFor('on the 31st', WED)).toBeNull()
  })

  it('and anything it does not recognise leaves the date alone', () => {
    expect(whenFor('some time before the launch', WED)).toBeNull()
  })
})
