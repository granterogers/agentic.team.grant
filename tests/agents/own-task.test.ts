/**
 * A request addressed TO the specialist who is answering is a request for the work (#408).
 *
 * Driven through the real worker, "Ask the finance specialist to summarise the assumptions in the budget documents" reached the
 * finance director unchanged and she answered "let me know which finance specialist you want to handle this". Only a leading
 * "ask|have|get <her> to" is removed, only when she is the one named, so every case here has its negative beside it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ownTask, type Speaking } from '../../src/agents/own-task.ts'

const daniel: Speaking = {
  slug: 'finance-director',
  name: 'Daniel',
  title: 'Finance & Data Director',
}
const emma: Speaking = { slug: 'research-director', name: 'Emma', title: 'Research Director' }
const claire: Speaking = { slug: 'chief-of-staff', name: 'Claire', title: 'Chief of Staff' }

describe('a request addressed to the person answering', () => {
  it.each([
    [
      'Ask the finance specialist to summarise the assumptions in the budget documents in this project.',
      'Summarise the assumptions in the budget documents in this project.',
    ],
    [
      'Ask Daniel to check the cashflow for the second payment on account.',
      'Check the cashflow for the second payment on account.',
    ],
    [
      'Please ask the finance director to compare the savings accounts.',
      'Compare the savings accounts.',
    ],
    ['Have the finance team draft the tax summary for me.', 'Draft the tax summary for me.'],
    ['Can you ask Daniel to total the fit-out budget?', 'Total the fit-out budget?'],
  ])('is reduced to the work: %s', (said, expected) => {
    expect(ownTask(said, daniel)).toBe(expected)
  })

  it('gives a question its verb back, so it reads as a request', () => {
    expect(
      ownTask(
        'Please ask the finance director which savings account pays the highest rate',
        daniel,
      ),
    ).toBe('Tell me which savings account pays the highest rate')
  })
})

describe('and is left whole when it is not that', () => {
  it.each([
    // Somebody else is named: that is a request to convene them.
    ['Ask Emma to find out what the competitors charge.', daniel],
    ['Ask the research director to compare the two venues.', daniel],
    // The speaker is named alongside somebody else.
    ['Ask Daniel and Emma to compare the two quotes together.', daniel],
    ['Ask Daniel, then Emma, to compare the two quotes.', daniel],
    // Nothing follows: that is a request to talk to her.
    ['Ask the finance director', daniel],
    ['Ask Daniel about it', daniel],
    // Not addressed to anybody.
    ['What is the closing balance in December?', daniel],
    ['Summarise the assumptions in the budget documents.', daniel],
    // The chief of staff convenes; she is not the finance specialist.
    ['Ask the finance specialist to summarise the assumptions in the budget documents.', claire],
    // A word that merely begins like a name.
    ['Ask financial advisers to look at the pension options please.', daniel],
  ])('%s', (said, who) => {
    expect(ownTask(said, who)).toBe(said)
  })

  it('still strips for the one it names when somebody else would have been left alone', () => {
    expect(ownTask('Ask Emma to find out what the competitors charge.', emma)).toBe(
      'Find out what the competitors charge.',
    )
  })
})

describe('the handler uses it where only the model reads the result', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
  it('applies it to the routing text after the speaker is known', () => {
    expect(src).toMatch(/instruction = ownTask\(instruction, who\)/)
  })
  it('does not apply it to the words every consequence-bearing reader uses', () => {
    expect(src).not.toMatch(/turn\.kept\s*=\s*ownTask/)
    expect(src).not.toMatch(/ownTask\(turn\.kept/)
  })
})

describe('a frame that names a kind of person is addressed to whoever was chosen (#408 closure)', () => {
  const quality: Speaking = {
    slug: 'quality-director',
    name: 'Grace',
    title: 'Quality & Risk Director',
  }
  it.each([
    [
      'Ask the appropriate person on the team to review our launch preparation and identify anything important that is still unfinished.',
      'Review our launch preparation and identify anything important that is still unfinished.',
    ],
    [
      'Have the right person look at the venue contract for anything risky.',
      'Look at the venue contract for anything risky.',
    ],
    [
      'Please get the best colleague to check which tasks are blocked.',
      'Check which tasks are blocked.',
    ],
  ])('%s', (said, expected) => {
    expect(ownTask(said, quality)).toBe(expected)
  })

  it.each([
    // the chief of staff is the one who convenes: for her this is the request itself
    [
      'Ask the appropriate person on the team to review our launch preparation and flag anything unfinished.',
      claire,
    ],
    // nothing follows, or somebody else is named as well
    ['Ask the appropriate person.', quality],
    ['Ask the right person and Emma to review it.', quality],
    // a statement, not a delegation frame
    ['The appropriate person on the team is Grace, so review the launch plan.', quality],
  ])('left whole: %s', (said, who) => {
    expect(ownTask(said as string, who as Speaking)).toBe(said)
  })
})

describe('a frame that addresses the team collectively is addressed to each member who answers (real-model run)', () => {
  const quality: Speaking = {
    slug: 'quality-director',
    name: 'Grace',
    title: 'Quality & Risk Director',
  }
  it.each([
    [
      'Ask the team to look at the venue contract risk and the budget impact and give me a recommendation.',
      'Look at the venue contract risk and the budget impact and give me a recommendation.',
    ],
    [
      'Please get the specialists to check which tasks are blocked.',
      'Check which tasks are blocked.',
    ],
    [
      'Have the whole team review the launch plan for anything unfinished.',
      'Review the launch plan for anything unfinished.',
    ],
    ['Ask the team which supplier is the riskiest.', 'Tell me which supplier is the riskiest.'],
  ])('%s', (said, expected) => {
    expect(ownTask(said, quality)).toBe(expected)
  })

  it.each([
    // the chief of staff convenes the team: for her this is the request itself
    ['Ask the team to look at the venue contract risk and give me a recommendation.', claire],
    // nothing follows, or somebody else is named as well
    ['Ask the team.', quality],
    ['Ask the team and Emma to review it.', quality],
    // a statement, not a delegation frame
    ['The team asked to review the launch plan, so go ahead.', quality],
    ["What is on the team's calendar this week?", quality],
  ])('left whole: %s', (said, who) => {
    expect(ownTask(said as string, who as Speaking)).toBe(said)
  })
})
