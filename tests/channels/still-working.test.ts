/**
 * Five minutes of silence must be impossible (#282).
 *
 * ## Measured before it was built
 *
 * 335 real `office.instruction` jobs over fourteen days: median 21s, p90 259s,
 * **30 of them over five minutes**, worst fifteen hours. And `announceStart`
 * does not cover it — it speaks only when the roster NAMES somebody with a
 * bot, and #70 retired the staff bots, so two "on it" messages have been sent
 * in the system's history, five days apart.
 *
 * ## Every sentence has a column behind it
 *
 * No model here and there must not be one. A generated reassurance is the most
 * comfortable possible way to tell Grant work is happening when it is not, and
 * the branch that matters most — paused, going nowhere — is the one a fluent
 * paragraph would round off into progress.
 */
import { describe, expect, it } from 'vitest'
import { stillWorkingSays } from '../../src/channels/progress.ts'

const at = (minutes: number) => ({
  state: 'running',
  waiting_on: null as string | null,
  minutes,
  children_done: 0,
  children_total: 0,
})

describe('stillWorkingSays', () => {
  it('says how long it has been, from the clock rather than from a guess', () => {
    expect(stillWorkingSays(at(7))).toContain('7 minutes in')
  })

  it('a PAUSE says so, and quotes the reason a person can read', () => {
    /*
      The most useful thing he can be told, and the one a cheerful "still
      working on it" would be false about. `waiting_on` holds the sentence
      rather than the reason code — 0457 exists because it once held the code.
    */
    const said = stillWorkingSays({
      ...at(9),
      state: 'paused',
      waiting_on: 'Waiting for you to approve opening the supplier page.',
    })
    expect(said).toContain('Paused 9 minutes in')
    expect(said).toContain('approve opening the supplier page')
  })

  it('a pause with NO reason recorded admits that, rather than inventing one', () => {
    const said = stillWorkingSays({ ...at(9), state: 'paused' })
    expect(said).toContain('no reason recorded')
    expect(said).toContain('Worth a look')
  })

  it('a retry says the first attempt did not come back cleanly', () => {
    expect(stillWorkingSays({ ...at(6), state: 'retrying' })).toContain('running again')
  })

  it('a fan-out counts who is back, because the children are rows', () => {
    const said = stillWorkingSays({ ...at(5), children_done: 2, children_total: 3 })
    expect(said).toContain('2 of 3')
  })

  it('and says it is assembling once they are all back', () => {
    const said = stillWorkingSays({ ...at(5), children_done: 3, children_total: 3 })
    expect(said).toContain('putting it together')
  })

  it('with nothing to report it says exactly that, and promises only a return', () => {
    /*
      The honest floor. It must not imply a finding, a stage or a percentage —
      none of those is a column, so none of them can be said.
    */
    const said = stillWorkingSays(at(5))
    expect(said).toContain('Nothing to report yet')
    expect(said).not.toMatch(/\d+%|stage|nearly|almost/i)
  })

  it('CONTROL: no branch claims a result, a finding or a completion', () => {
    /*
      Asserted as a property over every shape rather than one sentence at a
      time, so a branch added later cannot quietly start claiming something.
    */
    const shapes = [
      at(5),
      { ...at(5), state: 'paused', waiting_on: 'Waiting on you.' },
      { ...at(5), state: 'paused' },
      { ...at(5), state: 'retrying' },
      { ...at(5), children_done: 1, children_total: 4 },
      { ...at(5), children_done: 4, children_total: 4 },
    ]
    for (const shape of shapes) {
      const said = stillWorkingSays(shape)
      expect(said, said).not.toMatch(/\bI found\b|\bI have finished\b|\bdone\b|\bthe answer\b/i)
    }
  })
})
