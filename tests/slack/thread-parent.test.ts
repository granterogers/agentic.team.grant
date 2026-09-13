/**
 * Reply UNDER the message that asked, not beside it.
 *
 * Grant, 13 September, having sent three screenshots of his workspace:
 * *"you'd really need to work on it looking a lot better, making it obvious
 * what things are related to that kind of thing."*
 *
 * Nothing was related to anything. Thirty-one real questions sat in
 * `#ai_team_hq_test` with not one reply attached to any of them: Slack reports
 * `thread_ts` as null for a top-level message, the notifier read that as "no
 * thread", and every answer went out as a fresh post that looked unprompted.
 *
 * Slack has no separate act of creating a thread — posting with `thread_ts`
 * set to another message's `ts` makes that message the parent — so the fix is
 * to know the asking message's own `ts`. `inbound_commands.origin_ref` has
 * held it as `channel:ts` since the adapter was written.
 */
import { describe, expect, it } from 'vitest'
import { threadParent } from '../../src/slack/notifier.ts'

const CHANNEL = 'C0BVD21Q9S5'

describe('threadParent', () => {
  it('finds the asking message inside the origin ref', () => {
    expect(threadParent(CHANNEL, `${CHANNEL}:1789252035.147200`)).toBe('1789252035.147200')
  })

  /*
    The guard that matters. A ref naming another channel would thread the
    answer into a room Grant is not looking at — worse than not threading,
    because a reply in the wrong thread is a reply nobody finds.
  */
  it('refuses a ref that names a different channel', () => {
    expect(threadParent(CHANNEL, `C0OTHER:1789252035.147200`)).toBeNull()
  })

  /*
    The adapter writes `unknown` when an event arrives without a ts, and
    `chat.postMessage` with `thread_ts: 'unknown'` is an error rather than a
    thread. A delivery must not fail because a thread could not be found: the
    answer goes to the channel unthreaded, which is what happened for every
    message before this existed.
  */
  it.each([
    ['no ts at all', `${CHANNEL}:unknown`],
    ['no colon', CHANNEL],
    ['nothing', ''],
    ['null', null],
    ['a leading colon', `:1789252035.147200`],
  ])('answers null rather than a bad thread for %s', (_what, ref) => {
    expect(threadParent(CHANNEL, ref)).toBeNull()
  })

  /*
    Split from the RIGHT. Read left-to-right this breaks the day anything is
    prefixed onto the ref, and the channel id is the half that can be compared
    to know whether the split was right.
  */
  it('reads the ts from the last colon, not the first', () => {
    expect(threadParent(`a:b`, `a:b:1789252035.147200`)).toBe('1789252035.147200')
  })
})
