/**
 * The sentence a reminder actually arrives as (#259, 0512).
 *
 * `remind_at` was stored, filtered on, rendered — and never sent. This file
 * holds the half of the fix that is the product: what Grant reads on his phone
 * when a reminder falls due.
 *
 * The wording is tested rather than asserted by eye because the alternative is
 * the shape CLAUDE.md records six times — a literal-string assertion somewhere
 * else that locks the wording, or no assertion at all and a run-together
 * paragraph reaching him. #209 is the precedent that matters here: three items
 * on one line read as five at 390px, and the fix was the element the language
 * already has.
 */
import { describe, expect, it } from 'vitest'
import { remindersBody } from '../../src/handlers/reminders.ts'

const one = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Ring the venue about the deposit',
  remind_at: '2026-09-20T09:00:00Z',
  due_on: '2026-09-21',
  project: 'Legacy Coaching Course',
  overdue: false,
}
const two = {
  ...one,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Send the landlord note',
  project: null,
}
const late = {
  ...one,
  id: '33333333-3333-4333-8333-333333333333',
  title: 'File the return',
  overdue: true,
}

describe('what a reminder says', () => {
  it('says nothing is due when nothing is', () => {
    // The duty runs every fifteen minutes. This body exists so a pass that
    // found nothing still has an honest output; `announce` is false for it,
    // which is what stops ninety-six messages a day.
    expect(remindersBody([])).toBe('Nothing to remind you about.')
  })

  it('a single reminder is a sentence, not a list of one', () => {
    const said = remindersBody([one])
    expect(said).toBe('Reminder: Ring the venue about the deposit — Legacy Coaching Course.')
    expect(said).not.toContain('\n')
  })

  it('and names the project, because a title alone can be ambiguous', () => {
    expect(remindersBody([one])).toContain('Legacy Coaching Course')
  })

  it('a task with no project says only the task', () => {
    expect(remindersBody([two])).toBe('Reminder: Send the landlord note.')
  })

  it('several are a real list, one per line', () => {
    /*
      #209: line breaks are not a list and a run-together paragraph reads as
      the wrong number of items on a phone. This is Telegram and Slack rather
      than HTML, so a hyphen bullet per line IS the list element available —
      what is asserted is that each item is on its own line and each line
      carries exactly one task.
    */
    const said = remindersBody([one, two, late])
    const lines = said.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(3)
    expect(said).toContain('3 reminders')
    for (const l of lines) expect(l.split(' — ').length).toBeLessThanOrEqual(2)
  })

  it('and says which of them is already overdue', () => {
    expect(remindersBody([late])).toContain('(overdue)')
  })

  it('CONTROL: one that is not overdue is not labelled overdue', () => {
    // The expensive direction: a reminder that cries wolf about a date that
    // has not passed is one he stops reading.
    expect(remindersBody([one])).not.toContain('overdue')
    expect(remindersBody([one, two])).not.toContain('overdue')
  })

  it('CONTROL: the count agrees with the list, however long', () => {
    const many = Array.from({ length: 7 }, (_, n) => ({
      ...two,
      id: `id-${String(n)}`,
      title: `Task ${String(n)}`,
    }))
    const said = remindersBody(many)
    expect(said).toContain('7 reminders')
    expect(said.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(7)
  })
})
