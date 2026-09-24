/**
 * Reading a correction, and refusing to read one where there is none (#147).
 *
 * The expensive direction of being wrong here is the FALSE POSITIVE: offering
 * to turn an ordinary instruction into a standing rule is the office being
 * obtuse in a way Grant notices every time, and half of these cases are about
 * that rather than about the happy path.
 */
import { describe, expect, it } from 'vitest'
import { readCorrection } from '../../src/agents/correction.ts'

describe('what is a correction', () => {
  it('reads the example from the issue', () => {
    const c = readCorrection('no, at the end of the message, not after every bullet', true)
    expect(c).not.toBeNull()
    expect(c?.fragment).toBe('at the end of the message, not after every bullet')
    expect(c?.rule).toBe('From now on, at the end of the message, not after every bullet.')
  })

  it('reads one that contrasts without opening with a rejection', () => {
    const c = readCorrection('put it at the end rather than after every bullet', true)
    expect(c?.rule).toContain('rather than')
  })

  it('keeps a rule that is already phrased as one, rather than framing it twice', () => {
    const c = readCorrection('no, always put the summary last', true)
    expect(c?.rule).toBe('Always put the summary last.')
  })
})

describe('what is not', () => {
  it('is not a correction when nothing was answered', () => {
    expect(readCorrection('no, at the end of the message', false)).toBeNull()
  })

  it('is not a correction when it carries no instruction', () => {
    // #237's contentless rejection, in the place it would do most damage: an
    // offer to store a standing rule that says nothing.
    expect(readCorrection('no', true)).toBeNull()
    expect(readCorrection('no, wrong', true)).toBeNull()
    expect(readCorrection('nope!', true)).toBeNull()
  })

  it('is not a correction when it is a new request', () => {
    expect(
      readCorrection(
        'Read everything on the pricing project and propose the tasks it actually needs, with owners, and tell me which of them you think can be done this week rather than next, and why the rest cannot',
        true,
      ),
    ).toBeNull()
  })

  it('does not read a long request as a correction merely because it contrasts', () => {
    /*
      The contrast branch is the weak one — "rather than" is ordinary English —
      so it is the branch that has to be short. An opening rejection is
      positional evidence and may carry more, which is the other half of the
      ceiling and is asserted here so a future change cannot collapse the two
      back into one number without a test going red.
    */
    const long =
      'tell me which of these can be done this week rather than next, and why the rest cannot, with owners against each one'
    expect(long.length).toBeGreaterThan(90)
    expect(readCorrection(long, true)).toBeNull()
    expect(readCorrection(`no, ${long}`, true)).not.toBeNull()
  })

  it('does not read an answer that merely contains the word no', () => {
    expect(readCorrection('There is no entry for that in the notebook', true)).toBeNull()
  })

  it('does not fire on an ordinary short instruction', () => {
    expect(readCorrection('send me the report', true)).toBeNull()
    expect(readCorrection('what did Emma find?', true)).toBeNull()
  })
})

describe('behavioural remediation 2026-09-24: a negating correction keeps its negation', () => {
  it.each([
    ["Don't use bullet points", "From now on, don't use bullet points."],
    ['Stop sending me updates every hour', 'From now on, stop sending me updates every hour.'],
    [
      "please don't put a summary at the top",
      "From now on, please don't put a summary at the top.",
    ],
  ])('%s', (said, rule) => {
    expect(readCorrection(said, true)?.rule).toBe(rule)
  })

  it('NEGATIVE CONTROL: the drafted rule never loses the "not" it was given', () => {
    for (const said of ["Don't use bullet points", 'Stop sending me updates every hour']) {
      expect(readCorrection(said, true)?.rule ?? '').toMatch(/\b(?:don't|stop)\b/i)
    }
  })
})

describe('behavioural remediation 2026-09-24: calling work off is not a rule', () => {
  it.each([
    "Stop that, I've sorted the coach myself.",
    "Stop that one, we've booked a minibus instead",
    'No, I did it myself already this morning',
  ])('%s', (said) => {
    expect(readCorrection(said, true)).toBeNull()
  })

  it('NEGATIVE CONTROL: restating what he asked for is still a correction', () => {
    expect(readCorrection('No, I said bullet points at the end', true)).not.toBeNull()
    expect(readCorrection('no, use the British spelling', true)?.rule).toBe(
      'From now on, use the British spelling.',
    )
  })
})
