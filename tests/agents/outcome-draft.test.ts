/**
 * Version 1 acceptance, journey E: which requests have their writing as the whole job.
 *
 * `answersByWriting` lets a draft that IS the answer count as the work landed (so the office does not open it with "I have
 * not done this yet" and does not refuse "I've drafted the email for you:" as a claim of completion). It must stay narrow:
 * a request that also asks for the send, or that merely mentions a draft, keeps the truth the office owes.
 */

import { describe, expect, it } from 'vitest'
import { bodyHoldsDraft } from '../../src/agents/consequence.ts'
import { answersByWriting } from '../../src/agents/outcome.ts'

describe('answersByWriting: an imperative to write, and only to write', () => {
  const yes = [
    "Draft an email to Kevin explaining that the quote is delayed, but don't send it.",
    'Draft an email to Kevin.',
    'Please write a note to the team about Friday.',
    'Can you draft a reply to the landlord?',
    'Could you please compose a short announcement',
    "I need you to prepare a summary of the call, don't share it",
    'write up the plan',
  ]
  for (const t of yes) it(`writes: ${t}`, () => expect(answersByWriting(t)).toBe(true))

  const no = [
    'Draft an email to Kevin and send it.',
    'Write the note and then post it to Slack.',
    'Draft it and email it to the team',
    'Send the draft to Kevin.',
    'Send this to Kevin.',
    'Email Kevin the report and cc my accountant',
    'What did the draft say?',
    'Is the written report ready?',
    'Remind me to write the report on Friday',
    '',
  ]
  for (const t of no)
    it(`not writing-only: ${JSON.stringify(t)}`, () => expect(answersByWriting(t)).toBe(false))
})

describe('the draft test the handler pairs it with', () => {
  it('holds a draft: a subject line, a salutation, or a real multi-line body', () => {
    expect(bodyHoldsDraft('Subject: Hello\n\nHi Kevin,\n\nThe quote is late.\n\nBest', '')).toBe(
      true,
    )
  })
  it('does not: a one-line answer or a question back', () => {
    expect(bodyHoldsDraft('{}', '')).toBe(false)
    expect(bodyHoldsDraft('What would you like it to say?', '')).toBe(false)
  })
})
