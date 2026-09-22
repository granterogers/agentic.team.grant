/**
 * Discovery — conversations aimed where nothing has ever looked.
 *
 * Written on 22 September against v695, after #302 and #304 closed, and
 * deliberately NOT a neighbourhood of either. Those are regression material
 * now; a corpus that found a defect cannot find the next one in the thing it
 * caused to be built.
 *
 * ## Why these shapes and not others
 *
 * `npm run breadth` reports eight of thirty-seven coverage dimensions with
 * **no cases at all**, and four of them are the working day:
 *
 *     cross-project-work · changed-intent · contradictory-instructions ·
 *     permission-gated-actions
 *
 * And `npm run measure` says what real traffic looks like: 85 of 180 real
 * routing decisions go to the Chief of Staff, the finance director has
 * **never been chosen**, and delegation depth is 1 on two decisions out of
 * everything the office has ever done. So a corpus that exercises
 * single-turn task creation is testing the part that already works.
 *
 * ## What the turns are FOR
 *
 * Each session is built to reach a state that only a SEQUENCE can reach, and
 * the measurement is `npm run shadow:coherence`, which asks four questions no
 * per-turn check can:
 *
 *   - a row created and never mentioned
 *   - the same row created twice
 *   - a row on the wrong project after a switch
 *   - an answer denying what the conversation itself put there
 *
 * Expectations are sparse for the same reason they are sparse in
 * `durability.ts`: an expectation written here is this file grading its own
 * conversation. The two oracles read canonical state themselves.
 */

import type { Session } from './run.ts'

export const DISCOVERY: readonly Session[] = [
  // ------------------------------------------------ cross-project-work
  {
    name: 'disc-switching',
    covers: ['cross-project', 'memory-dependent-work'],
    about: 'two projects alternating, with a referent that only makes sense in one of them',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'on the bid, put something down to chase the letter of support',
        inProject: 'alpha',
        why: 'a named project and a clear action — the row must land on alpha',
      },
      {
        say: 'right, coaching now — book the venue for the first session',
        inProject: 'beta',
        why: 'an explicit switch mid-conversation; the row must land on beta, not alpha',
        covers: ['cross-project'],
      },
      {
        say: 'and add the same chase there too',
        why: '"the same" refers across the switch — a legitimate duplicate, on the other project',
        covers: ['ambiguous-requests'],
      },
      {
        say: 'what is on each of them now?',
        why: 'the office must keep the two apart when asked to list them',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  // ------------------------------------------------ contradictory-instructions
  {
    name: 'disc-contradiction',
    covers: ['corrections', 'multi-clause'],
    about:
      'two instructions in one message that cannot both be obeyed, then a third that settles it',
    projects: ['alpha'],
    turns: [
      {
        say: 'put the budget rewrite on the bid and also keep the bid completely untouched until Friday',
        inProject: 'alpha',
        why: 'both halves are imperative and they contradict — asking is right, silently picking one is not',
        covers: ['ambiguous-requests'],
      },
      {
        say: 'the second one, obviously',
        why: 'a contentless resolution: only the thread says which',
        covers: ['memory-dependent-work'],
      },
      {
        say: 'so is anything sitting on the bid right now or not',
        why: 'if the first half was obeyed anyway, this is where the two answers disagree',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  // ------------------------------------------------ changed-intent
  {
    name: 'disc-changed-intent',
    covers: ['corrections', 'multi-clause'],
    about: 'a request, then the same request wanted differently, three times over',
    projects: ['alpha'],
    turns: [
      {
        say: 'get a task down for the printer quote, due Tuesday',
        inProject: 'alpha',
        why: 'the baseline row',
      },
      {
        say: 'make that Thursday instead',
        why: 'a change to the row just made — a change, not a second row',
        covers: ['corrections'],
      },
      {
        say: 'actually it is not the printer, it is the signage, same date',
        why: 'the SUBJECT changes while the row stays — the commonest way a duplicate appears',
        covers: ['corrections'],
      },
      {
        say: 'how many printer or signage things have I got now?',
        why: 'one row changed twice, or three rows: the answer must match the table',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  // ------------------------------------------------ permission-gated-actions
  {
    name: 'disc-approval-arc',
    covers: ['approval', 'corrections'],
    about: 'approval asked for, then the thing modified, then withdrawn before it happens',
    projects: ['alpha'],
    turns: [
      {
        say: 'write the funding officer a note about the delay and get it over to them',
        inProject: 'alpha',
        why: 'sending is gated — approval or an honest refusal, never a quiet send',
        covers: ['approval'],
      },
      {
        say: 'before that goes, make it about the budget change rather than the delay',
        why: 'a modification of something waiting on him — the pending thing must change, not fork',
        covers: ['corrections'],
      },
      {
        say: 'no, leave the whole thing, I will ring them',
        why: 'a withdrawal of gated work — nothing may be left waiting afterwards',
        covers: ['corrections'],
      },
      {
        say: 'is anything still pending with you on that?',
        why: 'the truthful end state, asked plainly',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  // ------------------------------------------------ dictated, several asks at once
  {
    name: 'disc-dictated-pile',
    covers: ['voice-notes', 'multi-clause', 'cross-project'],
    about: 'one dictated run of speech carrying two projects, two actions and a question',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'ok so um two things on the bid the budget page needs redoing and someone should chase that letter and also on the coaching one can you get the welcome pack started and actually what did we say the deadline was',
        inProject: 'alpha',
        why: 'four intentions, two projects, no punctuation — where a row lands on the wrong one',
        covers: ['voice-notes', 'cross-project'],
      },
      {
        say: 'which of those did you actually do',
        why: 'partial completion across two projects, asked directly',
        covers: ['memory-dependent-work'],
      },
      {
        say: 'do the rest',
        why: 'a contentless retry over a partial state — the duplicate risk is highest here',
      },
    ],
  },

  // ------------------------------------------------ preference scope
  {
    name: 'disc-preference-scope',
    covers: ['preferences', 'memory-dependent-work'],
    about: 'a preference stated for one project, then work on another',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'on the bid, never put a due date on anything unless I give you one',
        inProject: 'alpha',
        why: 'a scoped standing instruction — it must not become global',
        covers: ['preferences'],
      },
      {
        say: 'add a task on coaching to book the venue, end of next week',
        inProject: 'beta',
        why: 'a different project, with a date he gave: the preference must not suppress it',
        covers: ['cross-project'],
      },
      {
        say: 'and one on the bid to confirm the numbers',
        why: 'back to the scoped project, no date given — the preference applies here',
        covers: ['cross-project'],
      },
      {
        say: 'what did I tell you about dates?',
        why: 'the office must state the SCOPE it stored, not a widened version of it',
        covers: ['memory-dependent-work'],
      },
    ],
  },
]
