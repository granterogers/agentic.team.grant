/**
 * #310 through the deployed office — the lifecycle as a conversation.
 *
 * `verify:preferences` drives `remember()` directly, which proves the
 * mechanism. This proves the thing Grant experiences: that saying it, changing
 * his mind, and taking it back over several turns leaves the office holding
 * exactly what he last said.
 *
 * Written after the fix and deliberately not in its wording — the unit cases
 * are the reproductions, so none of these sentences appears in them.
 */

import type { Session } from './run.ts'

export const PREFERENCES: readonly Session[] = [
  {
    name: 'pref-override',
    covers: ['preferences', 'corrections'],
    about: 'a rule, then the opposite rule, then asked what it believes',
    projects: ['alpha'],
    turns: [
      {
        say: 'from now on keep everything you send me really brief',
        inProject: 'alpha',
        why: 'the first rule — it must be stored and said back',
        covers: ['preferences'],
      },
      {
        say: 'actually no, I would rather have thorough answers from now on',
        why: 'the reversal: the office must replace, not hold both',
        covers: ['corrections'],
      },
      {
        say: 'what are you doing about the length of your answers?',
        why: 'it must describe ONE rule, and the later one',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  {
    name: 'pref-withdrawn',
    covers: ['preferences', 'corrections'],
    about: 'a rule given and then taken back with nothing in its place',
    projects: ['alpha'],
    turns: [
      {
        say: 'always put the screenshots in the reply from now on',
        inProject: 'alpha',
        why: 'a rule about links and images',
        covers: ['preferences'],
      },
      {
        say: 'do not put screenshots in anymore',
        why: 'a withdrawal, not a replacement — nothing may be left standing',
        covers: ['corrections'],
      },
      {
        say: 'so what have I told you about screenshots?',
        why: 'the honest answer is that there is no longer a rule',
        covers: ['memory-dependent-work'],
      },
    ],
  },

  {
    name: 'pref-said-twice',
    covers: ['preferences', 'memory-dependent-work'],
    about: 'the same rule twice, the second time as a complaint',
    projects: ['alpha'],
    turns: [
      {
        say: 'always give me your answers as clear bullet points',
        inProject: 'alpha',
        why: 'the rule',
        covers: ['preferences'],
      },
      {
        say: "I've told you already to always give me your answers as clear bullet points",
        why: 'the same rule, complained about — it must not become a second one',
        covers: ['preferences'],
      },
      {
        say: 'how many standing rules have I given you about formatting?',
        why: 'the count must be one',
        covers: ['memory-dependent-work'],
      },
    ],
  },
]
