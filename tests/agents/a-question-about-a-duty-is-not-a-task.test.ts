/**
 * A question about what he must do is not a commitment to do it (`ASKING_WHETHER_I_MUST` in `src/agents/mine.ts`).
 *
 * Found by the first controlled real-model run: "When do I have to pay the venue deposit, and how much is it?" was filed as
 * a task titled "When do pay the venue deposit, and how much is it?". It was one of five ways of asking the same thing;
 * the other four were answered. The class is every question built on an inverted "do/should/must I need to".
 */
import { describe, expect, it } from 'vitest'
import { personalTaskRequest } from '../../src/agents/mine.ts'

const NOW = new Date('2026-10-08T10:00:00Z')
const TZ = 'Europe/Athens'
const filed = (said: string) => personalTaskRequest(said, NOW, TZ)

describe('a question about an obligation files nothing', () => {
  it.each([
    'When do I have to pay the venue deposit, and how much is it?',
    'What do I need to bring on Friday?',
    'Do I need to call the accountant?',
    'Do I have to pay the deposit before the 1st?',
    'Why do I have to renew the licence?',
    'How much do I need to pay the venue',
    'Should I remember to pay the deposit?',
    'Must I sign it today?',
    'Do we need to book the room?',
  ])('%s', (said) => {
    expect(filed(said)).toBeNull()
  })
})

describe('NEGATIVE CONTROLS: a statement of need still files, with its own title', () => {
  it.each([
    ['I need to call the accountant on Friday', 'Call the accountant'],
    ['I have to pay the deposit by 1 November', 'Pay the deposit'],
    ['I need to ring Kevin tomorrow', 'Ring Kevin'],
    ['I have to chase the printers', 'Chase the printers'],
  ])('%s', (said, title) => {
    expect(filed(said)?.title).toBe(title)
  })

  it('a question and a real commitment in one message: only the commitment files', () => {
    expect(
      filed('When do I need to be at the venue? Also I need to call Kevin tomorrow.')?.title,
    ).toBe('Call Kevin')
  })

  it('a polite request that is shaped like a question still files (it is a request, not a question about a duty)', () => {
    expect(filed('Can you add a task to review the Q4 numbers')?.title).toBe(
      'Review the Q4 numbers',
    )
  })
})
