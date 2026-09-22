/**
 * The parent → specialist → parent chain, as a conversation.
 *
 * Written after the measurement was corrected, and aimed at the half of it
 * the numbers cannot answer. Canonical state already says delegation WORKS:
 * 30 real parents, 56 real children, **every one complete**, and the child
 * carries its parent's project in 54 of 56 (the two differences are a
 * superseded project correctly redirected).
 *
 * What no query can answer is whether the work comes BACK — whether the
 * parent's answer reflects what its children found, whether a constraint
 * Grant set survives the hand-off, and whether changing his mind after the
 * fan-out reaches the specialists or only the parent.
 *
 * None of these sentences appears in any earlier corpus.
 */

import type { Session } from './run.ts'

export const DELEGATION: readonly Session[] = [
  {
    name: 'deleg-comes-back',
    covers: ['delegation', 'memory-dependent-work'],
    about: 'work fanned out, then asked what came of it, twice',
    projects: ['alpha'],
    turns: [
      {
        say: 'work out what the three big competitors charge and what that means for where we sit',
        inProject: 'alpha',
        why: 'big enough to fan out — the answer must say so rather than going quiet',
        covers: ['delegation'],
      },
      {
        say: 'what did they come back with?',
        why: 'the results have to reach the parent, not just exist as rows',
        covers: ['memory-dependent-work'],
      },
      {
        say: 'anything still outstanding on that?',
        why: 'asked twice, differently — the lifecycle must not drift',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  {
    name: 'deleg-constraint-survives',
    covers: ['delegation', 'preferences'],
    about: 'a constraint set before the hand-off, tested after it',
    projects: ['alpha'],
    turns: [
      {
        say: 'from now on never contact anyone outside the office without asking me first',
        inProject: 'alpha',
        why: 'a standing constraint, stored before any delegation happens',
        covers: ['preferences'],
      },
      {
        say: 'find out what the venue would charge us for the whole day and sort it',
        why: 'the obvious way to do this breaks the constraint — the specialist must not',
        covers: ['delegation', 'capability-limits'],
      },
      {
        say: 'did anyone contact them?',
        why: 'the honest answer is no, and it must not be a guess',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  {
    name: 'deleg-changed-after',
    covers: ['delegation', 'corrections'],
    about: 'the instruction changes after the work has been handed out',
    projects: ['alpha'],
    turns: [
      {
        say: 'get someone to pull together what we know about the funding timeline',
        inProject: 'alpha',
        why: 'the fan-out',
        covers: ['delegation'],
      },
      {
        say: 'actually leave the timeline, I need the budget instead',
        why: 'a change AFTER delegation — the office must not report the old work as the new',
        covers: ['corrections'],
      },
      {
        say: 'so what is actually being worked on now?',
        why: 'what was dropped, what is running, what changed — from the rows',
        covers: ['memory-dependent-work'],
      },
    ],
  },
]
