/**
 * Selective delegation on Telegram (`src/agents/delegation-scope.ts`): routine is Claire's, an explicit request for the
 * team or genuinely complex work convenes. Each class has its negative neighbour, because a rule that always says
 * "routine" passes every routine case and a rule that always says "team" passes every team case.
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

describe('delegationScope', () => {
  it('routine requests stay with the chief', () => {
    for (const said of [
      'What is on my list for this week?',
      'Remind me on Friday to call Mum',
      'What did we decide about the venue?',
      'Add a task to chase the roofer',
      'Thanks, that is all',
      'Draft a short note to the venue confirming the date',
      'What is the budget for the March event?',
    ]) {
      expect(scope(said), said).toBe('routine')
    }
  })

  it('an explicit request for the team convenes it', () => {
    for (const said of [
      'Ask the team to review the launch plan',
      'Get the specialists to look at the refund policy',
      'Have the directors weigh in on the pricing change',
      'Loop in the team on this',
      'Bring in everyone on the venue problem',
      'I want the team to look at this',
      'Can we get the team on the budget?',
      'Run this by the team',
    ]) {
      expect(scope(said), said).toBe('team')
    }
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
    ]) {
      expect(namesColleagueInFrame(said, names), said).toBe(true)
    }
    for (const said of [
      'Emma sent me the booking history',
      'What did Daniel say about the deposit?',
      'Remind me to thank Emma',
    ]) {
      expect(namesColleagueInFrame(said, names), said).toBe(false)
    }
    expect(namesColleagueInFrame('Ask Emma', [])).toBe(false)
  })

  it('mentioning a team as a subject is not asking for the team', () => {
    for (const said of [
      "What is on the team's calendar this week?",
      'Remind me about the team meeting on Friday',
      'Who is on the team for the Hartley project?',
    ]) {
      expect(scope(said), said).toBe('routine')
    }
  })

  it('genuinely complex work, several separate asks or a long brief, may convene', () => {
    expect(
      scope(
        'Review the budget impact of the venue change and then draft a note to the sponsors and also work out what it does to the timeline',
      ),
    ).toBe('complex')
    const long = `Please look into the whole launch preparation. ${'We need to understand where we stand on suppliers, sponsors, the programme and the budget, and what is still unfinished before the date. '.repeat(3)}`
    expect(long.length).toBeGreaterThan(240)
    expect(scope(long)).toBe('complex')
  })

  it('a long question is still routine: length alone is not complexity', () => {
    const q = `What is happening ${'with the thing that we talked about yesterday afternoon in the long call '.repeat(5)}?`
    expect(q.length).toBeGreaterThan(240)
    expect(scope(q)).toBe('routine')
  })
})
