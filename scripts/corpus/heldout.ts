/**
 * The HELD-OUT corpus — novel formulations, written after the routing was fixed.
 *
 * Issue #232 / #235 §17. The development corpus in `routing.ts` was used to
 * find three routing defects and is frozen; every one of those fixes could in
 * principle have been a fix to THAT LIST rather than to the office's
 * understanding, and nothing in a development score can tell the difference.
 *
 * So these thirty cases were written against the same eight specialists and
 * the same ten linguistic forms, and **none of them appears in the development
 * corpus**. If development accuracy is high and this is much lower, the
 * routing learned the corpus rather than the concepts, and the report says so
 * rather than quoting the flattering number.
 *
 * Deliberately harder in one respect: the subjects are drawn from a small
 * business's actual week — a supplier, a refund policy, a hiring decision, a
 * late invoice — rather than from the vocabulary of the expertise lists. That
 * is the population Grant draws from, and it is the one a literal matcher
 * cannot memorise.
 */

import type { Case } from './routing.ts'

export const HELD_OUT: readonly Case[] = [
  // ------------------------------------------------------------------ finance
  {
    wants: 'finance-director',
    form: 'explicit',
    ask: 'What is our cash position at the end of the quarter?',
  },
  {
    wants: 'finance-director',
    form: 'indirect',
    ask: 'If we hire two more people, when do we run out?',
  },
  {
    wants: 'finance-director',
    form: 'colloquial',
    ask: 'Can we actually afford this or am I dreaming?',
  },
  {
    wants: 'finance-director',
    form: 'speech',
    ask: 'so the invoice thing, the one that is late, does that actually change anything for us this month or not',
  },
  { wants: 'finance-director', form: 'typo', ask: 'whats our burn rate lookin like nxt quater' },

  // ----------------------------------------------------------------- research
  {
    wants: 'research-director',
    form: 'explicit',
    ask: 'What are the three main alternatives customers consider instead of us?',
  },
  {
    wants: 'research-director',
    form: 'indirect',
    ask: 'Before we commit, go and see whether anyone has solved this already.',
  },
  {
    wants: 'research-director',
    form: 'vague',
    ask: 'I want a much better picture of the landscape here.',
  },
  {
    wants: 'research-director',
    form: 'command',
    ask: 'Dig up whatever exists on how the bigger firms handle this.',
  },

  // ------------------------------------------------------------------ growth
  {
    wants: 'growth-director',
    form: 'explicit',
    ask: 'Which marketing channel brought us the most signups last month?',
  },
  {
    wants: 'growth-director',
    form: 'indirect',
    ask: 'People find us and then never come back. Why?',
  },
  {
    wants: 'growth-director',
    form: 'colloquial',
    ask: 'How do we get in front of more of the right people?',
  },
  {
    wants: 'growth-director',
    form: 'speech',
    ask: 'right so the the funnel thing, people are dropping off somewhere and i want to know where',
  },

  // -------------------------------------------------------------- operations
  {
    wants: 'operations-director',
    form: 'explicit',
    ask: 'How long does it take us to fulfil an order end to end?',
  },
  {
    wants: 'operations-director',
    form: 'indirect',
    ask: 'Why does everything take three weeks when it should take three days?',
  },
  { wants: 'operations-director', form: 'vague', ask: 'The way we run the handover feels wrong.' },
  { wants: 'operations-director', form: 'typo', ask: 'wher is the delya in our delivery proces' },

  // ----------------------------------------------------------- quality & risk
  {
    wants: 'quality-director',
    form: 'explicit',
    ask: 'What is our exposure if the supplier misses the deadline?',
  },
  {
    wants: 'quality-director',
    form: 'indirect',
    ask: 'Tell me everything that could embarrass us about this.',
  },
  {
    wants: 'quality-director',
    form: 'colloquial',
    ask: 'Sanity check this before I commit to it.',
  },
  {
    wants: 'quality-director',
    form: 'command',
    ask: 'Pressure test the refund policy before we publish it.',
  },

  // --------------------------------------------------------- communications
  {
    wants: 'communications-director',
    form: 'explicit',
    ask: 'Write the note telling customers the delivery date has moved.',
  },
  {
    wants: 'communications-director',
    form: 'indirect',
    ask: 'How do we tell people this without making it worse?',
  },
  {
    wants: 'communications-director',
    form: 'vague',
    ask: 'This needs to land better than the last one did.',
  },
  {
    wants: 'communications-director',
    form: 'typo',
    ask: 'draft somthing i can send to the custmers tomorow',
  },

  // ---------------------------------------------------------------- strategy
  {
    wants: 'strategy-director',
    form: 'explicit',
    ask: 'Should we build this ourselves or partner with someone?',
  },
  {
    wants: 'strategy-director',
    form: 'indirect',
    ask: 'Where does this business need to be in two years?',
  },
  {
    wants: 'strategy-director',
    form: 'colloquial',
    ask: 'What is the one bet worth making this year?',
  },

  // ------------------------------------------- negative controls: Claire only
  { wants: 'nobody', form: 'explicit', ask: 'What is on the calendar for Thursday?' },
  { wants: 'nobody', form: 'colloquial', ask: 'All good, thanks for that.' },
]
