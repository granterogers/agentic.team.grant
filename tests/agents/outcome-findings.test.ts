/**
 * #440: an answer that IS the findings is not opened with "I have not done this yet" (`answersByFindings`, `findingsOnly`).
 *
 * The state sentences are composed from canonical counts, never from wording, so every case here pairs the narrow rule with
 * the neighbour that must keep the truth the office owes: a request that also asks for a change, a send or a creation; a
 * blocked action; a failure; pending work that really is waiting on him.
 */
import { describe, expect, it } from 'vitest'
import {
  answersByFindings,
  type CanonicalOutcome,
  classifyOutcome,
  contractFor,
  sayWhatHappened,
} from '../../src/agents/outcome.ts'

const base: CanonicalOutcome = {
  wanted: 1,
  landed: 0,
  pendingActions: 0,
  awaitingApproval: false,
  missing: [],
  capabilityRefused: false,
  attempt: 1,
  maxAttempts: 4,
  settled: false,
  asked: true,
}

describe('answersByFindings: a request for findings, and only for findings', () => {
  it.each([
    'Look at the venue contract risk and give me a recommendation.',
    'Ask the team to look at the venue contract risk and the budget impact and give me a recommendation',
    'Research the alternatives to Mailchimp',
    'Can you compare the two quotes?',
    'Please review the launch plan for anything unfinished',
    'Get Daniel and Emma to compare the deposit and the pricing',
    'Summarise the call',
    'Tell me which supplier is the riskiest',
    'Investigate why the deposit was refused',
  ])('findings: %s', (t) => expect(answersByFindings(t)).toBe(true))

  it.each([
    'Research the alternatives and email the summary to Kevin',
    'Review the plan and then post it to Slack',
    'Compare the quotes and add a task to call the cheaper one',
    'Look at the contract, and book the venue',
    'Review the invoice and pay it',
    'Add a task to review the contract',
    'Remind me to research the alternatives',
    'Send the report to Kevin',
    'Create a PDF of the budget',
    'What did the research say?',
    '',
  ])('not findings-only: %s', (t) => expect(answersByFindings(t)).toBe(false))
})

describe('what the contract owes, by class (the safety disclosures are untouched)', () => {
  it('a blocked turn with nothing landed still says so', () => {
    expect(classifyOutcome(base)).toBe('blocked_needs_user')
    expect(sayWhatHappened(base)).toBe('I have not done this yet, and nothing has been changed.')
  })

  it('findings that exist count as landed: the turn is complete and no state sentence is owed', () => {
    const found = { ...base, landed: 1 }
    expect(classifyOutcome(found)).toBe('completed')
    expect(sayWhatHappened(found)).toBeNull()
  })

  it('a mixed outcome (findings done, a requested change not) says it is partly done and names what is missing', () => {
    const mixed: CanonicalOutcome = { ...base, wanted: 2, landed: 1, missing: ['which project'] }
    expect(classifyOutcome(mixed)).toBe('partially_completed')
    expect(sayWhatHappened(mixed)).toMatch(/partly done.*1 of 2.*which project/)
  })

  it('an action that is waiting on his word still says so, findings or not', () => {
    const waiting = { ...base, landed: 1, awaitingApproval: true, pendingActions: 1 }
    expect(sayWhatHappened({ ...waiting, findingsOnly: true })).toBe(
      'Nothing has changed yet. It is waiting on your word.',
    )
  })

  it('a refused capability and an exhausted retry still say so', () => {
    expect(sayWhatHappened({ ...base, capabilityRefused: true })).toMatch(/not something I can do/)
    expect(sayWhatHappened({ ...base, settled: true, attempt: 4 })).toMatch(
      /could not get this done after 4 attempts/,
    )
  })

  it('findings handed to colleagues are progress, not a disclaimer', () => {
    const handedOn = { ...base, pendingActions: 2, findingsOnly: true }
    expect(sayWhatHappened(handedOn)).toBe(
      'I have asked 2 colleagues to look into this and will come back with what they find.',
    )
    expect(sayWhatHappened({ ...handedOn, pendingActions: 1 })).toMatch(/asked a colleague/)
    // CONTROL: the same pending work for a request that was NOT findings-only keeps the old sentence.
    expect(sayWhatHappened({ ...base, pendingActions: 2 })).toMatch(
      /^Nothing has changed yet — I have handed this on in 2 pieces/,
    )
  })

  it('findings do NOT license a promise or a completion claim the rows do not support', () => {
    const found = { ...base, landed: 1 }
    expect(contractFor(found).mayCommitToFuture).toBe(false)
    expect(contractFor({ ...base, findingsOnly: true }).mayClaimCompletion).toBe(false)
  })
})
