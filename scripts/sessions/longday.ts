/**
 * One long working day, where the state changes under the conversation (#327).
 *
 * ## The gap this fills
 *
 * Every session in the corpus is one to four turns, and each isolates a single
 * property: cancellation, or idempotency, or a preference, or a hand-off. That
 * is the right shape for finding a defect in one mechanism and it cannot find
 * the defect this is written for, which is what those mechanisms do to EACH
 * OTHER once the thread is long enough for the office to have acted several
 * times and for Grant to have changed his mind about some of it.
 *
 * Twelve turns in one chat, two dashboard projects, dictated the way he
 * actually dictates. Nothing here is a trigger phrase and none of these
 * sentences appears in any earlier corpus.
 *
 * ## What each crossing is FOR
 *
 * The interesting turns are the ones where two repaired systems meet:
 *
 *   turn 6   an antecedent from turn 1, asked from INSIDE the other project —
 *            referent resolution crossing project scope
 *   turn 7   calling off work that has already part-finished — #315 meeting a
 *            child that is already terminal
 *   turn 9   an accidental repeat of a request whose first attempt is DONE —
 *            #316's idempotency, on the completed side rather than in flight
 *   turn 10  a correction AFTER the office acted, naming the wrong thing
 *   turn 11  what is outstanding — `obligation_state` across a tree that has
 *            been cancelled, restarted and completed in different branches
 *   turn 12  what he told it earlier, which only memory can answer
 *
 * ## What it must never do
 *
 * Mutate anything in the project he is NOT talking about. The second project
 * exists so that cross-context leakage has somewhere to show up, and it holds
 * a task of its own for exactly that reason.
 */

import type { Session } from './run.ts'

export const LONG_DAY: readonly Session[] = [
  {
    name: 'long-day',
    covers: [
      'memory-dependent-work',
      'cross-project-work',
      'corrections',
      'changed-intent',
      'multi-agent-work',
      'voice-and-speech-style',
    ],
    about:
      'twelve turns, two projects, work started, part-done, called off, repeated and corrected',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'right so the thing I need this morning is somebody to work out what the venue change actually does to the budget, and separately I want a view on whether the sponsors will wear it',
        inProject: 'alpha',
        why: 'dictated, two distinct kinds of expertise, so somebody is convened and an obligation opens',
        covers: ['multi-agent-work', 'voice-and-speech-style'],
      },
      {
        say: 'who have you got on that',
        why: 'answered from child-job state, never from retrieval or inference (#317)',
        covers: ['multi-agent-work'],
      },
      {
        say: 'put together a short written summary of where the venue thing has got to, as a document I can read',
        why: 'an artifact request in the middle of live work — the office can do this (#320)',
        covers: ['creation'],
      },
      {
        say: "that's not really what I was after, I wanted the numbers in it not just prose",
        why: 'a complaint that restates an unmet artifact request rather than asking fresh (#320)',
        covers: ['corrections'],
      },
      {
        say: 'ok park that for a sec, what is happening on the membership renewals',
        inProject: 'beta',
        why: 'the surface changes project mid-thread while work is still open in the first',
        covers: ['cross-project-work'],
      },
      {
        say: 'and the sponsor question from earlier, did that ever come back',
        why: 'an antecedent five turns back, asked from INSIDE the other project — the referent is alpha and the scope is beta',
        covers: ['cross-project-work', 'memory-dependent-work'],
      },
      {
        say: 'actually drop the sponsor one, it has been overtaken',
        why: 'calling off work that may already have part-finished — #315 against a terminal child',
        covers: ['changed-intent'],
      },
      {
        say: 'from now on when you write anything up for me keep it to plain paragraphs, no bullet lists',
        why: 'a preference stated while two projects are in play — its scope must be deliberate',
        covers: ['corrections'],
      },
      {
        say: 'put together a short written summary of where the venue thing has got to, as a document I can read',
        why: 'word for word the same as turn 3, whose work has SETTLED — #316 on the completed side',
        covers: ['changed-intent'],
      },
      {
        say: 'no hang on, I meant the renewals one, not the venue',
        why: 'a correction after the office has already acted, naming a different subject',
        covers: ['corrections', 'cross-project-work'],
      },
      {
        say: 'what is still outstanding for me at this point',
        why: 'obligation_state across a tree cancelled in one branch and complete in another',
        covers: ['memory-dependent-work'],
      },
      {
        say: 'what did I tell you earlier about how I want things written',
        why: 'only memory answers this; a fabricated recollection is the worst available outcome',
        covers: ['memory-dependent-work'],
      },
    ],
  },
]
