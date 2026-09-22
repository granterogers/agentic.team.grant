/**
 * Two harness defects that each read exactly like a product defect.
 *
 * Both were found on 22 September while verifying #302 live, and neither was
 * visible in the office's reply — only in the rows.
 *
 * ## 1. Accidental new chat
 *
 * The canonical door builds its chat as `shadow-<runToken>-<conversation>`,
 * and every probe invocation minted a FRESH run token. So `--conversation`
 * alone could not join two runs into one conversation, and a follow-up turn
 * arrived with no history.
 *
 * It looked like the office forgetting itself: asked to file something, it
 * proposed the title *"Ring Kevin about the quote"*, and when the question it
 * had asked was answered it asked for a title again. Asking again with no
 * thread is CORRECT. The rows said so — two `inbound_commands` with different
 * first segments, `shadow-ed4l7raa-s302-kevin` and `shadow-kj2aot0s-s302-kevin`.
 *
 * ## 2. Cross-turn dedupe collision
 *
 * Fixing the first introduced the second. `nth` restarts at 1 in every
 * process, so once two invocations shared a run token the key
 * `teamhq:shadow:<token>-<nth>` collided: turn 2 was silently deduplicated
 * against turn 1 and the door returned the FIRST turn's answer.
 *
 * That reads exactly like the office repeating itself, and the reply was
 * identical, so nothing in the text could tell them apart. **One
 * `inbound_commands` row where there should have been two** is what did.
 *
 * ## The property
 *
 * Dedupe identity and thread identity are different questions, and the two
 * defects are the two ways of confusing them. Two turns of one conversation
 * SHARE a chat and must NOT share a key.
 */

import { describe, expect, it } from 'vitest'
import { chatFor, dedupeKeyFor } from '../../src/simulation/canonical.ts'

describe('the chat threads a conversation and separates two of them', () => {
  it('two turns of one conversation share a chat', () => {
    expect(chatFor('tok1', 'kevin')).toBe(chatFor('tok1', 'kevin'))
  })

  /*
    The first defect, as a check. A caller that names one conversation gets
    ONE chat for it, whatever else varies within the run.
  */
  it('a named conversation is stable, so a follow-up has history', () => {
    const first = chatFor('shared', 'the-kevin-thread')
    const second = chatFor('shared', 'the-kevin-thread')
    expect(second).toBe(first)
  })

  it('two conversations in one run do NOT share a chat', () => {
    expect(chatFor('tok1', 'kevin')).not.toBe(chatFor('tok1', 'priya'))
  })

  /*
    And two RUNS do not thread into each other, which is the property the run
    token is in the chat for. Losing it is the cross-scenario contamination
    measured at 2 prior turns on a turn that had none.
  */
  it('two runs of the same conversation name do NOT share a chat', () => {
    expect(chatFor('tokA', 'kevin')).not.toBe(chatFor('tokB', 'kevin'))
  })

  it('is safe to put in an origin_ref, whatever the conversation is called', () => {
    const chat = chatFor('tok', 'arc.preference-continuity/grant-like #2')
    expect(chat).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(chat.length).toBeLessThanOrEqual(80)
  })

  /*
    The FIRST SEGMENT is what `app.conversation_before` threads on, so a
    colon in the chat would split the thread at a place nobody intended.
  */
  it('contains no colon, because the first segment is what threads', () => {
    expect(chatFor('tok', 'a:b:c')).not.toContain(':')
  })
})

describe('the dedupe key separates turns that share a thread', () => {
  /*
    The second defect, as a check. Same token, same conversation, and `nth`
    restarting at 1 in a new process is exactly the live case.
  */
  it('two processes sharing a run token do not collide on turn 1', () => {
    expect(dedupeKeyFor('shared', 1, 'aaaaaa')).not.toBe(dedupeKeyFor('shared', 1, 'bbbbbb'))
  })

  it('two turns within one process do not collide', () => {
    expect(dedupeKeyFor('shared', 1, 'aaaaaa')).not.toBe(dedupeKeyFor('shared', 2, 'aaaaaa'))
  })

  it('and the same turn of the same process is stable, so a retry deduplicates', () => {
    expect(dedupeKeyFor('shared', 1, 'aaaaaa')).toBe(dedupeKeyFor('shared', 1, 'aaaaaa'))
  })

  /*
    The CHECK constraint on `inbound_commands.dedupe_key` requires the
    channel in the first segment, and a key that violates it does not fail
    loudly — the insert is refused and the turn is lost. Nine of ten first-run
    attempts died that way before the shape was corrected.
  */
  it('keeps the channel in the first segment, which the constraint requires', () => {
    expect(dedupeKeyFor('tok', 1, 'nonce').split(':')[0]).toBe('teamhq')
  })
})

describe('the two identities are independent, which is the whole lesson', () => {
  it('one conversation, two turns: same chat, different keys', () => {
    const chat1 = chatFor('shared', 'kevin')
    const chat2 = chatFor('shared', 'kevin')
    const key1 = dedupeKeyFor('shared', 1, 'aaaaaa')
    const key2 = dedupeKeyFor('shared', 1, 'bbbbbb')
    expect(chat1).toBe(chat2)
    expect(key1).not.toBe(key2)
  })
})
