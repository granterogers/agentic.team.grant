/**
 * Asking for the same thing again — the nine ways it can happen (#316).
 *
 * `collaboration.ts` found that one question asked twice fans out twice. This
 * is the lifecycle around that, written after the fix and against it, so it
 * can fail: none of these sentences appears in any earlier corpus, and each
 * one separates two behaviours that look identical from the reply alone.
 *
 * The cases that must NOT duplicate and the cases that MUST are deliberately
 * interleaved, because a fix that simply never fans out twice would pass a
 * corpus of the first kind perfectly — the judge-that-marks-everything-poor
 * shape CLAUDE.md records.
 */

import type { Session } from './run.ts'

export const REPEATING: readonly Session[] = [
  {
    name: 'again-accidental',
    covers: ['delegation', 'duplicate-action'],
    about: 'the identical request twice, then a question about who is on it',
    projects: ['alpha'],
    turns: [
      {
        say: 'work out what the renewal terms cost us over three years and what we could renegotiate',
        inProject: 'alpha',
        why: 'big enough to hand on',
        covers: ['delegation'],
      },
      {
        say: 'work out what the renewal terms cost us over three years and what we could renegotiate',
        why: 'word for word — the structural key must refuse a second attempt',
        covers: ['duplicate-action'],
      },
      {
        say: 'how many people are on that?',
        why: 'canonical state knows; this must not be answered from retrieval',
        covers: ['duplicate-action'],
      },
    ],
  },

  {
    name: 'again-reworded',
    covers: ['delegation', 'duplicate-action'],
    about: 'the same work asked for differently, which no key can catch',
    projects: ['alpha'],
    turns: [
      {
        say: 'get someone to pull together what the three big competitors charge',
        inProject: 'alpha',
        why: 'the first fan-out',
        covers: ['delegation'],
      },
      {
        say: 'can you find out what the three big competitors are charging',
        why: 'the same obligation, different words — grounded intent, not a key',
        covers: ['duplicate-action'],
      },
    ],
  },

  {
    name: 'again-on-purpose',
    covers: ['delegation', 'reversal'],
    about: 'a deliberate second, independent attempt',
    projects: ['alpha'],
    turns: [
      {
        say: 'have someone work out whether the venue deposit is refundable',
        inProject: 'alpha',
        why: 'the first attempt',
        covers: ['delegation'],
      },
      {
        say: 'get another person to look at that as well',
        why: 'he ASKED for a second one — refusing this is the fix overshooting',
        covers: ['delegation'],
      },
    ],
  },

  {
    name: 'again-different-work',
    covers: ['delegation', 'duplicate-action'],
    about: 'the same subject, materially different work',
    projects: ['alpha'],
    turns: [
      {
        say: 'draft the pricing announcement email for the customers',
        inProject: 'alpha',
        why: 'the first piece of work',
        covers: ['delegation'],
      },
      {
        say: 'draft the pricing announcement slides for the board',
        why: 'same subject, different deliverable — suppressing this is the silent direction',
        covers: ['duplicate-action'],
      },
    ],
  },

  {
    name: 'again-after-stopping',
    covers: ['delegation', 'reversal'],
    about: 'called off, then asked for again — #315 must survive the fix',
    projects: ['alpha'],
    turns: [
      {
        say: 'have someone pull together what we know about the two suppliers',
        inProject: 'alpha',
        why: 'work in flight',
        covers: ['delegation'],
      },
      {
        say: 'stop that, I do not need it any more',
        why: '#315: it must actually stop, and say what it stopped',
        covers: ['reversal'],
      },
      {
        say: 'have someone pull together what we know about the two suppliers',
        why: 'a cancelled obligation frees its key — an explicit restart must work',
        covers: ['reversal'],
      },
    ],
  },
]
