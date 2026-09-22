/**
 * #302 durability, the untouched set — written after v685.
 *
 * The first durability corpus found a classification defect: a job in state
 * `complete` on attempt 4 told Grant *"I could not get this done after 4
 * attempts"* and then answered his question. That corpus has now influenced
 * the implementation, so it is regression material and cannot discover a
 * second defect in the thing it caused to be built.
 *
 * This one is written against the fixed code, and none of its scenarios is a
 * neighbour of anything above. Same properties, different working day.
 *
 * ## Where it aims
 *
 * The first set reached `completed` eighteen times out of twenty-two, because
 * most of its turns were read as `thought` or `question`. That is honest and
 * it is also thin coverage of the classes that matter. So these sessions are
 * built to REACH the awkward states rather than to sound natural first:
 *
 *   - a request that lands, then a second that cannot, in one conversation —
 *     so `completed` and `blocked` sit side by side and the narration has to
 *     hold both
 *   - work handed to a specialist and then asked about twice, which is the
 *     false-positive direction: pending work MUST be allowed to say what is
 *     coming
 *   - a change of mind after something real exists, which is the only way to
 *     reach a genuine partial state rather than an empty one
 *   - three separate asks about the same thing, to see whether the answer
 *     drifts as the conversation lengthens
 *
 * ## The follow-ups are the point
 *
 * *"did you do it?"*, *"what happened?"*, *"try again"*, *"do that"* and
 * *"actually leave it"* carry no content of their own, so the answer to each
 * is entirely a function of state and memory. They are where an office that
 * narrates from the model rather than from the rows gives itself away.
 */

import type { Session } from './run.ts'

export const DURABILITY_FRESH: readonly Session[] = [
  {
    name: 'dfresh-one-lands-one-does-not',
    covers: ['multi-clause', 'ambiguous-requests'],
    about: 'a request that can be carried out beside one that cannot, then both asked about',
    projects: ['alpha'],
    turns: [
      {
        say: 'put a task on the bid to confirm the printer quote by Tuesday',
        inProject: 'alpha',
        why: 'grounded and fileable — this one should land',
      },
      {
        say: 'and someone should probably square things with the landlord at some point',
        why: 'the same conversation, a request that cannot land — the answer must not blur them',
        covers: ['ambiguous-requests'],
      },
      {
        say: 'which of those is real and which is not?',
        why: 'completed and blocked side by side: the distinction has to survive being asked about',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  {
    name: 'dfresh-pending-described',
    covers: ['delegation', 'memory-dependent-work'],
    about: 'the false-positive direction — real pending work must be describable, twice',
    projects: ['alpha'],
    turns: [
      {
        say: 'work out what it would cost us to move the whole thing to annual billing and what that does to cash',
        inProject: 'alpha',
        why: 'big enough to plan — if children exist the office MAY say what is coming',
        covers: ['delegation'],
      },
      {
        say: 'where has that got to?',
        why: 'asked once: pending work described',
        covers: ['memory-dependent-work'],
      },
      {
        say: 'anything back yet?',
        why: 'asked twice, differently — the answer must not drift from the rows',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  {
    name: 'dfresh-change-after-real-work',
    covers: ['corrections', 'multi-clause'],
    about: 'something real exists, and then the instruction changes underneath it',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'add two things on the coaching one: book the venue, and write the welcome pack',
        inProject: 'beta',
        why: 'two asks, so a genuine partial state is reachable rather than an empty one',
        covers: ['multi-clause'],
      },
      {
        say: 'actually the welcome pack should go on the bid instead, not coaching',
        why: 'a change of project after something exists — the reassignment is the test',
        covers: ['corrections', 'cross-project'],
      },
      {
        say: 'so what is where now?',
        why: 'what happened / what moved / what is still pending, asked plainly',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  {
    name: 'dfresh-drift',
    covers: ['memory-dependent-work', 'voice-notes'],
    about: 'the same unfinished thing asked about three times, to see whether the story drifts',
    projects: ['alpha'],
    turns: [
      {
        say: 'we need to get the insurance sorted before the renewal date',
        why: 'an obligation with no imperative — the shape that lands as other',
      },
      {
        say: 'did you do it?',
        why: 'first ask',
        covers: ['memory-dependent-work'],
      },
      {
        say: 'so um is that sorted or not, I cannot remember what we said',
        why: 'second ask, dictated, with a false memory hook in it',
        covers: ['voice-notes'],
      },
      {
        say: 'try again',
        why: 'a bare retry against a turn that never had anything to retry',
      },
    ],
  },
]
