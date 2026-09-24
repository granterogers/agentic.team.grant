/*
  What a failed live call SAYS, as properties.

  call.js hands this experience whatever it has, including a raw exception
  message: a network failure used to reach the screen as "Failed to fetch".
  The properties: no raw exception text ever reaches the screen, every
  problem tells the person what to press, the control is named as the
  microphone (this experience has no phone), and a sentence call.js composed
  for a person is not rewritten into something vaguer.
*/
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../web/studio/call.js', () => ({
  callActivity: () => 'idle',
  callMuted: () => false,
  callPhase: () => 'idle',
}))
const { plainly } = await import('../../web/studio/bc/livevoice.js')

const RAW = [
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
  'the call would not connect (502)',
  'the call would not connect (401)',
  'TypeError: x is undefined',
  'ERR_TUNNEL_CONNECTION_FAILED',
]

describe('plainly', () => {
  it('never shows a raw exception', () => {
    for (const raw of RAW) {
      const { words, tone } = plainly(raw)
      expect(tone).toBe('problem')
      expect(words).not.toContain(raw)
      expect(words).not.toMatch(/fetch|TypeError|ERR_|\(\d{3}\)|undefined/)
    }
  })
  it('tells the person what to press, and calls it the microphone', () => {
    for (const raw of [...RAW, 'The call dropped. Press the phone to try again.']) {
      const { words } = plainly(raw)
      expect(words.toLowerCase()).toContain('press the microphone')
      expect(words.toLowerCase()).not.toMatch(/\bphone\b/)
    }
  })
  it('keeps a sentence call.js composed for a person (negative control)', () => {
    const refused =
      'The microphone was refused. Allow it for this site, then press the phone again.'
    expect(plainly(refused).words).toBe(
      'The microphone was refused. Allow it for this site, then press the microphone again.',
    )
  })
  it('a hang-up is not a problem, and nothing is nothing', () => {
    expect(plainly('Call ended. Press the phone to call again.')).toEqual({
      words: 'Call ended.',
      tone: 'ended',
    })
    expect(plainly('')).toEqual({ words: '', tone: '' })
  })
})
