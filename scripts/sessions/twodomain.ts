/**
 * Requests that genuinely need two domains (#318).
 *
 * The measurement said 88% of real delivered requests need nobody but the
 * Chief, 0% were delegated, and the one "warranted" case was a capability gap
 * rather than an expertise gap. That answers whether the office
 * under-delegates on Grant's ACTUAL traffic. It does not answer the other
 * half: when a request genuinely spans two domains, does collaboration fire,
 * and does the specialist's contribution change the result?
 *
 * So each of these is written to need two people and to be impossible to
 * answer well with one. The pairs are the ones #318 names — research to
 * strategy, finance to strategy, growth to communications, operations to
 * quality — plus a three-way.
 *
 * None of these sentences appears in any earlier corpus. They carry a
 * constraint and a project so the run can check that both survive the
 * hand-off, which is the other thing collaboration has to preserve.
 */

import type { Session } from './run.ts'

export const TWO_DOMAIN: readonly Session[] = [
  {
    name: 'two-research-strategy',
    covers: ['delegation', 'collaboration'],
    about: 'find out what is true, then say what we should do about it',
    projects: ['alpha'],
    turns: [
      {
        say: 'Find out how the three big competitors price their onboarding, and then tell me what that means for whether we should keep ours free. Keep it to one page.',
        inProject: 'alpha',
        why: 'research and strategy: the second half is unanswerable without the first',
        covers: ['delegation'],
      },
      {
        say: 'what did they come back with?',
        why: 'the specialist contributions must be reachable and attributed',
        covers: ['collaboration'],
      },
    ],
  },

  {
    name: 'two-finance-strategy',
    covers: ['delegation', 'collaboration'],
    about: 'the numbers, and the decision the numbers are for',
    projects: ['alpha'],
    turns: [
      {
        say: 'Work out what the venue deposit and the staffing actually cost us across the whole season, and on that basis tell me whether we move the event or keep it where it is.',
        inProject: 'alpha',
        why: 'finance then strategy — a single specialist answers half',
        covers: ['delegation'],
      },
      {
        say: 'did they agree?',
        why: 'a disagreement between two specialists must survive rather than be blended',
        covers: ['collaboration'],
      },
    ],
  },

  {
    name: 'two-growth-comms',
    covers: ['delegation', 'collaboration'],
    about: 'which channel is working, and what we say in it',
    projects: ['alpha'],
    turns: [
      {
        say: 'Look at which channel is actually bringing people in and then draft the note we send them, in plain English with no bullet points.',
        inProject: 'alpha',
        why: 'growth then communications, with a FORM constraint that must survive the hand-off',
        covers: ['delegation'],
      },
    ],
  },

  {
    name: 'two-ops-quality',
    covers: ['delegation', 'collaboration'],
    about: 'how the process runs, and where it is exposed',
    projects: ['alpha'],
    turns: [
      {
        say: 'Map how a refund actually gets processed from request to money out, and then tell me where in that chain we are exposed if someone disputes it.',
        inProject: 'alpha',
        why: 'operations then quality — the risk read depends on the map',
        covers: ['delegation'],
      },
    ],
  },

  {
    name: 'three-way',
    covers: ['delegation', 'collaboration'],
    about: 'a request that needs three different kinds of expertise',
    projects: ['alpha'],
    turns: [
      {
        say: 'I want to know what the pricing change does to our margin, how it lands with the customers we already have, and whether it creates any compliance exposure. Do not give me a list.',
        inProject: 'alpha',
        why: 'finance, growth and quality in one sentence, plus a form constraint',
        covers: ['delegation'],
      },
      {
        say: 'where exactly do they differ?',
        why: 'three contributions must remain distinguishable rather than blended into one voice',
        covers: ['collaboration'],
      },
    ],
  },
]
