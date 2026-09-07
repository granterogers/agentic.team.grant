/**
 * Two messages that are one instruction, as cases.
 *
 * The pair below is real: Grant sent a voice note to Emma describing what to do
 * with a video, and the link as a separate message. Both halves were read
 * correctly and separately, so the video went into the wrong notebook and the
 * plan was never formed.
 */
import { describe, expect, it } from 'vitest'
import { join, PAIRING_WINDOW_MINUTES, readFragment } from '../../src/agents/pairing.ts'

const NOTE =
  'I want you to push this video into a new notebook project called AI Learning, then find ' +
  'me the transcription and then report back all the repositories that are mentioned.'
const LINK = 'https://youtu.be/9_SZFIW7tus?is=rfmlfQUmiGGPY1Dw'

describe('the real pair', () => {
  it('reads the voice note as needing a link', () => {
    const f = readFragment(NOTE)
    expect(f.needsALink).toBe(true)
    expect(f.isBareLink).toBe(false)
  })

  it('reads the shared link as a bare link', () => {
    const f = readFragment(LINK)
    expect(f.isBareLink).toBe(true)
    expect(f.needsALink).toBe(false)
  })

  it('joins them instruction-first', () => {
    // Every reader downstream is written for "do this with that URL". Producing
    // the shape the rest of the system already handles is the point of joining
    // them here rather than teaching four modules a second shape.
    const joined = join(NOTE, LINK)
    expect(joined.startsWith('I want you to push')).toBe(true)
    expect(joined.endsWith(LINK)).toBe(true)
  })
})

describe('what is not half of anything', () => {
  it('a complete instruction is neither half', () => {
    const f = readFragment(`Add ${LINK} to the coaching project`)
    expect(f.isBareLink).toBe(false)
    expect(f.needsALink).toBe(false)
  })

  it('a bare demonstrative is not pointing at a link', () => {
    // "this is fine" appears in ordinary prose constantly. Treating it as a
    // fragment would pair unrelated messages, which is silent and permanent.
    expect(readFragment('this is fine, thanks').needsALink).toBe(false)
    expect(readFragment('that works').needsALink).toBe(false)
  })

  it('tolerates the words people put around a shared link', () => {
    expect(readFragment(`this: ${LINK}`).isBareLink).toBe(true)
    expect(readFragment(`${LINK} 👍`).isBareLink).toBe(true)
  })

  it('but not an instruction wrapped around one', () => {
    expect(
      readFragment(`Make an audio overview of ${LINK} for the coaching project`).isBareLink,
    ).toBe(false)
  })

  it('recognises the phrasings that point at a previous message', () => {
    for (const text of [
      'do that with the video I just sent',
      'summarise the link',
      'push the one I sent into the notebook',
    ]) {
      expect(readFragment(text).needsALink, text).toBe(true)
    }
  })
})

describe('the window', () => {
  it('is short on purpose', () => {
    // Joining too eagerly applies an instruction to the wrong link, which is
    // silent and permanent. Joining too rarely is the behaviour we already
    // had, which is visible.
    expect(PAIRING_WINDOW_MINUTES).toBeGreaterThan(0)
    expect(PAIRING_WINDOW_MINUTES).toBeLessThanOrEqual(10)
  })
})
