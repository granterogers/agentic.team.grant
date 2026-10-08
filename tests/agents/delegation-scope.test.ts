/**
 * Selective delegation (`src/agents/delegation-scope.ts`), the same decision for every interface: routine is Claire's, an
 * explicit request for the team or work that genuinely needs specialists convenes. The decision turns on WHAT IS ASKED, never
 * on how long the message is. Each class has its negative neighbour, because a rule that always says "routine" passes every
 * routine case and a rule that always says "complex" passes every complex one.
 */
import { describe, expect, it } from 'vitest'
import { split } from '../../src/agents/clauses.ts'
import { delegationScope, namesColleagueInFrame } from '../../src/agents/delegation-scope.ts'
import { classifyIntent } from '../../src/agents/intent.ts'

const scope = (instruction: string, namesAColleague = false) =>
  delegationScope({
    instruction,
    classification: classifyIntent(instruction),
    asks: split(instruction).length,
    namesAColleague,
  })

describe('routine: Claire answers, nobody is convened', () => {
  it.each([
    "What's happening with my tasks?",
    'Remind me tomorrow to call Mum.',
    'Mark the roofer task done.',
    "What's the status of the venue contract?",
    'How much is the deposit and when is it due?',
    'Add a task to chase the roofer',
    'Thanks, that is all',
    'Draft a short note to the venue confirming the date',
    'Summarise this document for me',
    'Compare these two numbers',
    'What did the research say about the alternatives?',
    'Do I need to research anything before Friday?',
    'fyi I looked into the alternatives',
  ])('%s', (said) => {
    expect(scope(said)).toBe('routine')
  })

  it('a reminder or task ABOUT investigating is a reminder, not an investigation', () => {
    for (const said of [
      'Remind me to research the alternatives on Monday',
      'Add a task to audit the books next week',
    ])
      expect(scope(said), said).toBe('routine')
  })

  it('a negation is not a request', () => {
    expect(scope("Don't investigate that yet")).toBe('routine')
  })
})

describe('LENGTH IS NOT INTENT', () => {
  it('a long pasted update asking for nothing investigative stays with Claire', () => {
    const long = `Here is a long update from the venue about the building works and the catering. ${'The kitchen will be closed on Tuesday and the car park resurfaced over the weekend. '.repeat(20)}Summarise it for me.`
    expect(long.length).toBeGreaterThan(1200)
    expect(scope(long)).toBe('routine')
  })

  it('a long question stays with Claire', () => {
    const q = `What is happening ${'with the thing that we talked about yesterday afternoon in the long call '.repeat(5)}?`
    expect(scope(q)).toBe('routine')
  })

  it('a pasted email that says "investigate" is not him asking', () => {
    const pasted = `Please tell me what this means: "Dear Grant, thank you for your patience while we confirm the booking details for the day. We will investigate the missing certificate and research alternatives for the catering."`
    expect(scope(pasted)).toBe('routine')
  })

  it('a SHORT request can still need a real investigation', () => {
    for (const said of [
      'Investigate why the Hartley deposit was refused',
      'Research the alternatives and give me a recommendation.',
      'Investigate.',
    ])
      expect(scope(said), said).toBe('complex')
  })
})

describe('complex: investigative, weighing towards a recommendation, or several independent workstreams', () => {
  it.each([
    'Research the alternatives and give me a recommendation.',
    'Can you research the alternatives to Mailchimp?',
    'Compare the two quotes and recommend one',
    'Look at which channel is bringing people in and draft the note we send them',
    'Review the venue contract risk, analyse the budget impact and prepare a summary for the board',
  ])('%s', (said) => {
    expect(scope(said)).toBe('complex')
  })
})

describe('team: he named the team or a colleague as the doer', () => {
  it.each([
    'Ask the team to investigate this.',
    'Ask the team to review the launch plan',
    'Get the specialists to look at the refund policy',
    'Have the directors weigh in on the pricing change',
    'Loop in the team on this',
    'Bring in everyone on the venue problem',
    'I want the team to look at this',
    'Can we get the team on the budget?',
    'Run this by the team',
  ])('%s', (said) => {
    expect(scope(said)).toBe('team')
  })

  it('naming a colleague as the doer is an explicit request for them', () => {
    expect(scope('Ask Emma to pull together the booking history', true)).toBe('team')
  })

  it('a list of colleagues in an asking frame is detected over the whole sentence, and a bare mention is not', () => {
    const names = ['Claire', 'Tom', 'Emma', 'Daniel', 'Marcus']
    for (const said of [
      'Ask Daniel and Emma to compare the deposit and the pricing',
      'Get Emma to pull the booking history',
      'have Tom, Emma and Daniel look at it',
    ])
      expect(namesColleagueInFrame(said, names), said).toBe(true)
    for (const said of [
      'Emma sent me the booking history',
      'What did Daniel say about the deposit?',
      'Remind me to thank Emma',
    ])
      expect(namesColleagueInFrame(said, names), said).toBe(false)
    expect(namesColleagueInFrame('Ask Emma', [])).toBe(false)
  })

  it('mentioning a team as a subject is not asking for the team', () => {
    for (const said of [
      "What is on the team's calendar this week?",
      'Remind me about the team meeting on Friday',
      'Who is on the team for the Hartley project?',
    ])
      expect(scope(said), said).toBe('routine')
  })
})
