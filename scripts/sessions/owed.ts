/**
 * What happens after the Chief has answered (#312).
 *
 * Canonical ground truth this was written against:
 *
 *     real parent/child pairs               56
 *     child finished AFTER the parent       53   (95%)
 *     real turns convening 2+ specialists    0
 *
 * So the parent finishing first is not an edge case, it is what always
 * happens — and the fan-in that would have owned the result was gated at two
 * specialists, one above the only shape that occurs. A single convened
 * specialist's answer finished after the Chief had spoken, `only_chief_speaks`
 * kept it off Grant's phone, and nothing delivered it.
 *
 * None of these sentences appears in any earlier corpus. They are written to
 * make the office convene somebody and then to ask, at three different
 * moments, what became of it.
 */

import type { Session } from './run.ts'

export const OWED: readonly Session[] = [
  {
    name: 'owed-one-specialist',
    covers: ['delegation', 'narration'],
    about: 'the Chief answers, one specialist keeps working, and the answer must arrive',
    projects: ['alpha'],
    turns: [
      {
        say: 'I want the numbers on whether the second venue is cheaper once staffing is in, and somebody who knows the contracts should look at the cancellation terms',
        inProject: 'alpha',
        why: 'two distinct kinds of expertise in one sentence, so somebody is convened',
        covers: ['delegation'],
      },
      {
        say: 'what is the state of that?',
        why: 'asked while it is still running — the obligation is not fulfilled and must not read as done',
        covers: ['narration'],
      },
      {
        say: 'what did they come back with?',
        why: 'the specialist answer must be reachable rather than lost behind the Chief',
        covers: ['narration'],
      },
    ],
  },

  {
    name: 'owed-then-called-off',
    covers: ['delegation', 'reversal'],
    about: 'a late result arriving after the work was called off',
    projects: ['alpha'],
    turns: [
      {
        say: 'get somebody who knows the supplier contracts to work out what switching would actually cost us',
        inProject: 'alpha',
        why: 'work handed on',
        covers: ['delegation'],
      },
      {
        say: 'stop that, I do not need it any more',
        why: '#315 must still stop it, and the obligation must read cancelled',
        covers: ['reversal'],
      },
      {
        say: 'did anything come back on the suppliers?',
        why: 'a result that landed anyway must NOT be reported as the work having succeeded',
        covers: ['reversal'],
      },
    ],
  },
]
