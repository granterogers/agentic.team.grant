/**
 * "Remind me why we decided X" is a question, not a reminder (#259, §16).
 *
 * Found by attacking the office with a false premise. Asked *"Remind me why we
 * decided to drop the Tuesday cohort"* — a decision that never happened — it
 * created a personal task on Grant's REAL list called "Why we decided to drop
 * the cohort", due in four days, and answered:
 *
 *     That is on your list for 2026-09-22.
 *     [evidence: verified · confidence: high]
 *
 * Verified and high confidence, because by then the task genuinely existed:
 * the office had just made it. A fabrication laundered through a row the
 * office created itself, and the question never answered.
 *
 * The positives below outnumber the negatives on purpose. The usual rule in
 * this repository is that a false positive on a matcher is the cheap
 * direction; here it is the expensive one, because it writes to the list he is
 * supposed to trust.
 */
import { describe, expect, it } from 'vitest'
import { personalTaskRequest } from '../../src/agents/mine.ts'

describe('a question wearing "remind me"', () => {
  const questions = [
    'Remind me why we decided to drop the Tuesday cohort.',
    'Remind me what the retainer number was.',
    'remind me who is running the September cohort',
    'Remind me whether we ever signed that contract.',
    'Remind me again why the beta slipped.',
  ]

  it.each(questions)('makes no task: %s', (said) => {
    expect(personalTaskRequest(said)).toBeNull()
  })

  /*
    THE CONTROL, and the half that decides whether this is a fix or a
    regression. A rule that refused every "remind me" would pass every test
    above and destroy the feature.
  */
  const reminders = [
    'Remind me tomorrow to review the dashboard',
    'Remind me to send Priya the figures on Friday',
    'Remind me about the invoice next week',
    // "to" beats an interrogative: a reminder that happens to contain a
    // question word is still a reminder.
    'Remind me to ask what the price is',
    'Remind me to find out who owns the renewal',
  ]

  it.each(reminders)('still makes a task: %s', (said) => {
    expect(personalTaskRequest(said)).not.toBeNull()
  })

  it('leaves "when" and "where" alone, because they cut both ways', () => {
    // "remind me when the deadline approaches" is a real reminder and
    // "remind me when the deadline is" is a question. Guessing between them
    // would trade a defect for a coin flip, so today's behaviour stands.
    expect(personalTaskRequest('Remind me when the deadline approaches')).not.toBeNull()
  })
})
