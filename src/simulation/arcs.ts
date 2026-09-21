/**
 * Multi-turn conversations — §8.
 *
 * *"The simulator reacts to the office."* A corpus of single messages cannot
 * test the things that actually break in use: a preference established in
 * turn one and expected in turn four, a bare "yes" whose referent is the
 * previous question, "no, the other project" with a previous project to be
 * other than, or the office asking something it was already told.
 *
 * ## An arc is a different object from a message
 *
 * Kept apart from `compose.ts` deliberately. A conversation has state — what
 * has been said, what the office asked, what is still outstanding — and
 * folding that into the single-message generator produced a corpus in which
 * `project.the-other-one` had no previous project to be other than, and
 * `preference.applied-later` had no earlier preference to apply. Both scored,
 * and both were meaningless.
 *
 * ## The simulator answers; it does not co-operate
 *
 * §8 lists what a person actually does: sometimes approve, sometimes decline,
 * sometimes modify; correct, abandon, refer back, ask what already happened,
 * change a date, answer ambiguously once. A simulator that always answers the
 * office's question helpfully is a simulator that tests nothing, because a
 * real person half the time answers a different question.
 *
 * And critically — §8 again — when the office asks something it should
 * already know, the simulator **records that** rather than forgiving it. The
 * easy mistake is to write a co-operative simulator and score only the final
 * answer, which makes an office that interrogates its way to correctness look
 * identical to one that understood.
 */

import { composeTurn } from './compose.ts'
import type { GoalFamily } from './goals.ts'
import { familyById } from './goals.ts'
import type { Persona } from './persona.ts'
import { derive, Seeded } from './random.ts'
import type { ChannelShape, Scenario, ScenarioTurn } from './scenario.ts'
import type { World } from './world.ts'

/** How the person responds when the office asks them something. */
export type Reaction = 'answers' | 'approves' | 'declines' | 'modifies' | 'vague' | 'impatient'

export interface ArcTurn extends ScenarioTurn {
  /**
   * How this turn behaves if the office asked a question on the previous one.
   *
   * On the turn rather than the arc, because a person is not consistently
   * patient: they answer the first question and get short by the third.
   */
  readonly reactsBy?: Reaction
}

export interface Arc extends Scenario {
  readonly turns: readonly ArcTurn[]
  /** What the whole conversation is for, in one line, for the report. */
  readonly about: string
  /** The turn after which this becomes a second, separate conversation. */
  readonly breaksAfter?: number
}

/**
 * The sentence a person uses for each reaction.
 *
 * Short, because they are short. CLAUDE.md quotes Grant's own: *"yes"*,
 * *"that one"*, *"Wednesday instead"*.
 */
const REACTION_WORDS: Readonly<Record<Reaction, readonly string[]>> = {
  answers: ['the pricing one', 'the bid', 'the coaching thing'],
  approves: ['yes', 'yeah go on', 'fine, do it'],
  declines: ['no, leave it', 'do not do that', 'no, hold off'],
  modifies: ['yes but take the last paragraph out', 'ok, but make it shorter first'],
  vague: ['that one', 'the other one', 'you know the one'],
  impatient: ['I already told you', 'as I said, the pricing one'],
}

export const reactionFor = (persona: Persona, rng: Seeded): Reaction => {
  const roll = rng.next()
  if (roll < persona.approves * 0.6) return 'approves'
  if (roll < persona.approves * 0.6 + 0.15) return 'declines'
  if (roll < persona.approves * 0.6 + 0.25) return 'modifies'
  if (roll < persona.approves * 0.6 + 0.25 + persona.vagueReference * 0.3) return 'vague'
  return 'answers'
}

export const reactionText = (reaction: Reaction, rng: Seeded): string =>
  rng.pick(REACTION_WORDS[reaction]) ?? 'yes'

const turnOf = (
  familyId: string,
  persona: Persona,
  world: World,
  seed: number,
  reactsBy?: Reaction,
): ArcTurn => {
  const family = familyById(familyId)
  if (family === undefined) throw new Error(`no goal family called ${familyId}`)
  const { turn } = composeTurn(family as GoalFamily, persona, world, seed)
  return reactsBy === undefined ? turn : { ...turn, reactsBy }
}

/**
 * The arcs, by what they are for.
 *
 * Each is a real working conversation rather than a list of probes: the turns
 * belong together, and the later ones only make sense because of the earlier
 * ones. That is the property that makes an arc worth running — if the turns
 * could be shuffled without changing what a correct answer is, it is a corpus
 * of messages wearing a conversation.
 */
export const ARC_RECIPES: readonly {
  readonly id: string
  readonly about: string
  readonly families: readonly string[]
  /** Which turns react to a question from the office. */
  readonly reactive?: Readonly<Record<number, Reaction>>
  /**
   * The turn after which the person goes away and comes back in a NEW
   * conversation.
   *
   * The single most-requested thing this harness could not express. Every
   * arc was one unbroken thread, so "does the office still know my
   * preference tomorrow" and "does it still resolve `that one` tomorrow"
   * were the same question - and they have OPPOSITE right answers.
   *
   * A preference is a LESSON. It is stored, it is durable, and it must
   * still apply in a conversation that has never heard it said. A bare
   * referent is a THREAD fact: `app.conversation_before` windows at thirty
   * minutes and twelve turns, so after a break there is nothing to resolve
   * `that one` against and the office should ASK rather than guess.
   *
   * An office that forgets the preference is one Grant has to repeat
   * himself to. An office that confidently resolves the referent is one
   * that acts on the wrong project. Only a break can tell them apart.
   */
  readonly breaksAfter?: number
}[] = [
  {
    id: 'arc.preference-continuity',
    about:
      'States a presentation preference, works for three turns, and expects it to still hold. §9 end to end.',
    families: [
      'preference.establish',
      'project.lookup',
      'task.explicit',
      'preference.applied-later',
      'preference.one-off-override',
      'preference.applied-later',
    ],
  },
  {
    id: 'arc.preference-reversal',
    about:
      'Establishes a preference, uses it, changes their mind, and expects the change to stick.',
    families: ['draft.style', 'draft.from-material', 'preference.reversal', 'draft.from-material'],
  },
  {
    id: 'arc.wrong-project-recovery',
    about: 'Asks vaguely, gets the wrong project, corrects it, and expects the correction to hold.',
    families: ['project.ambiguous', 'project.the-other-one', 'task.explicit', 'project.lookup'],
    reactive: { 1: 'answers' },
  },
  {
    id: 'arc.approval-declined',
    about:
      'Asks for something that needs approval, then declines it, then checks nothing happened.',
    families: [
      'draft.from-material',
      'approval.write-under-review',
      'approval.declined',
      'conversation.what-did-you-do',
    ],
    reactive: { 2: 'declines' },
  },
  {
    id: 'arc.approval-modified',
    about: 'Approves with a change, and the amended version must be what proceeds.',
    families: ['draft.from-material', 'approval.write-under-review', 'approval.modified'],
    reactive: { 2: 'modifies' },
  },
  {
    id: 'arc.changed-mind-mid-work',
    about: 'Sets work going, changes the constraint underneath it, and expects the plan re-cut.',
    families: [
      'multi.negative-constraint',
      'approval.changed-mind-after-plan',
      'conversation.what-did-you-do',
    ],
  },
  {
    id: 'arc.cancellation',
    about: 'Asks, withdraws, asks something else, and checks the withdrawn thing did not happen.',
    families: [
      'task.explicit',
      'noaction.cancelled-outright',
      'task.query',
      'conversation.what-did-you-do',
    ],
  },
  {
    id: 'arc.capability-wall',
    about: 'Hits something the office cannot do, and then something it can.',
    families: ['capability.not-built', 'capability.needs-approval', 'capability.supported'],
    reactive: { 1: 'approves' },
  },
  {
    id: 'arc.rejection-recovery',
    about: 'Says the office got it wrong without saying what was right, then says.',
    families: ['knowledge.grounded', 'conversation.rejection', 'knowledge.conflicting'],
    reactive: { 1: 'answers' },
  },
  {
    id: 'arc.thinking-aloud',
    about: 'Muses, is asked whether to act, says no, and nothing must exist afterwards.',
    families: ['noaction.thinking-aloud', 'noaction.acknowledgement', 'task.query'],
    reactive: { 0: 'declines' },
  },

  /*
    The twelve below were added because 40 of the 66 goal families had never
    once appeared in a conversation.

    That is the honest state of this instrument as of today: the arcs
    covered 26 families, and every multi-turn claim this workstream has made
    was about those 26. Specialist hand-offs, conflicting preferences, a
    deliberate project switch, a mixed question-and-instruction, an honest
    absence, a duplicate request, a revision chain and every capability wall
    but one had been measured as ISOLATED SENTENCES only - which is exactly
    the thing §8 says a corpus of single messages cannot test.

    None of them is a new probe. Each is an existing family put where a
    person would actually say it, with turns that only make sense because of
    the turns before them.
  */

  {
    id: 'arc.conflicting-preferences',
    about:
      'States a preference, states a second that contradicts it, and expects the office to notice rather than silently obey the last one.',
    families: [
      'preference.establish',
      'draft.from-material',
      'preference.conflict',
      'draft.from-material',
      'conversation.what-did-you-do',
    ],
  },
  {
    id: 'arc.project-switch',
    about:
      'Works on one project, switches to another mid-conversation, and the switch must hold for everything after it.',
    families: [
      'project.lookup',
      'task.explicit',
      'project.switch-mid-turn',
      'task.explicit',
      'conversation.what-did-you-do',
    ],
  },
  {
    id: 'arc.question-plus-action',
    about: 'Sends messages that ask AND instruct in one breath, then checks both halves happened.',
    families: [
      'multi.question-plus-action',
      'multi.partial-cancel',
      'task.query',
      'conversation.what-did-you-do',
    ],
  },
  {
    id: 'arc.specialist-chain',
    about: 'Needs two specialists, and the second must build on what the first found.',
    families: ['specialist.appropriate', 'specialist.synthesis', 'conversation.what-did-you-do'],
  },
  {
    id: 'arc.specialist-failure',
    about:
      'A specialist cannot finish, and what the office says afterwards must match what actually happened.',
    families: ['specialist.failure', 'conversation.what-did-you-do', 'specialist.appropriate'],
  },
  {
    id: 'arc.partial-then-changed',
    about:
      'Starts something with several parts, changes one part while it is in flight, and abandons another.',
    families: [
      'multi.dependent',
      'task.modify',
      'multi.abandoned-clause',
      'conversation.what-did-you-do',
    ],
  },
  {
    id: 'arc.late-correction',
    about:
      'Asks for something, talks about three other things, and only then takes the first one back.',
    families: [
      'task.explicit',
      'knowledge.grounded',
      'draft.from-material',
      'task.cancel',
      'conversation.what-did-you-do',
    ],
  },
  {
    id: 'arc.referent-chain',
    about:
      'Never names a project after the first turn, and every later reference must land on the same one.',
    families: ['project.by-nickname', 'task.implied', 'task.indirect', 'project.the-other-one'],
  },
  {
    id: 'arc.standing-approval',
    about: 'Grants a standing permission, uses it, and expects not to be asked again.',
    families: ['approval.standing', 'approval.read-allowed', 'approval.paused-resume'],
    reactive: { 1: 'approves' },
  },
  {
    id: 'arc.honest-absence',
    about:
      'Asks about things the office has no material for, and every answer must be an honest absence rather than a plausible one.',
    families: ['knowledge.unindexed', 'knowledge.no-result', 'knowledge.buried'],
  },
  {
    id: 'arc.duplicate-guard',
    about: 'Asks for the same thing twice, and must not end up with it twice.',
    families: ['task.explicit', 'task.duplicate-request', 'task.query'],
  },
  {
    id: 'arc.draft-revision',
    about: 'Drafts, corrects, revises, and the last version must be the one that stands.',
    families: [
      'draft.from-material',
      'draft.correction',
      'draft.revise',
      'conversation.what-did-you-do',
    ],
  },

  /*
    And the two that only exist because of `breaksAfter`.

    Grant does not have one conversation a day. He says something on
    Telegram in the morning and opens the dashboard in the afternoon, and
    the office's memory of those two is governed by completely different
    mechanisms - a lesson is a row, a thread is a thirty-minute window.
    Until now the harness could not tell the two apart, because every arc
    was one unbroken conversation.
  */

  {
    id: 'arc.across-conversations',
    about:
      'Establishes a preference, goes away, comes back in a new conversation, and it must still hold.',
    families: [
      'preference.establish',
      'draft.from-material',
      'preference.applied-later',
      'draft.from-material',
    ],
    breaksAfter: 1,
  },
  {
    id: 'arc.stale-referent',
    about:
      'Refers to something from a conversation that has ended, where the office should ask rather than guess.',
    families: ['project.lookup', 'task.explicit', 'project.the-other-one', 'task.implied'],
    breaksAfter: 1,
  },

  /* The last five pick up what the twelve above left. */

  {
    id: 'arc.walls',
    about:
      'Walks into three different kinds of wall in a row - forbidden, unavailable, impossible - and each must be refused for its own reason.',
    families: [
      'capability.forbidden',
      'capability.unavailable',
      'capability.impossible',
      'capability.supported',
    ],
  },
  {
    id: 'arc.nominal-delegation',
    about:
      'Asks for something a specialist should do, where the tempting answer is to say a specialist did it. §9, and `npm run measure` says this is the one that has actually been happening.',
    families: [
      'specialist.wrong-temptation',
      'specialist.nominal',
      'conversation.what-did-you-do',
      'specialist.appropriate',
    ],
  },
  {
    id: 'arc.project-that-is-not-there',
    about: 'Refers to a project that is archived, and then to one that never existed.',
    families: ['project.stale', 'project.missing', 'project.lookup'],
  },
  {
    id: 'arc.clarification-economy',
    about:
      'Answers one question with a bare yes, and the office must not then ask something it was already told.',
    families: [
      'conversation.necessary-question',
      'conversation.bare-yes',
      'conversation.unnecessary-question',
      'noaction.pure-question',
    ],
    reactive: { 1: 'approves' },
  },
  {
    id: 'arc.material-then-work',
    about:
      'Hands over material, has things pulled out of it, and uses what came back - including a document that tries to give the office instructions.',
    families: [
      'task.extract',
      'knowledge.dependent-use',
      'knowledge.injection',
      'multi.independent',
      'preference.about-behaviour',
      'preference.presentation-only',
    ],
  },
]

export const buildArc = (
  recipe: (typeof ARC_RECIPES)[number],
  persona: Persona,
  world: World,
  runSeed: number,
): Arc => {
  const seed = derive(runSeed, recipe.id, persona.slug)
  const rng = new Seeded(derive(seed, 'channel'))
  const turns = recipe.families.map((familyId, i) =>
    turnOf(familyId, persona, world, derive(seed, familyId, i), recipe.reactive?.[i]),
  )
  const channel: ChannelShape =
    persona.slug === 'dictates'
      ? 'voice'
      : (rng.pick<ChannelShape>(['teamhq', 'telegram', 'slack']) ?? 'teamhq')
  return {
    id: `${recipe.id}/${persona.slug}`,
    about: recipe.about,
    family: recipe.id,
    persona: persona.slug,
    channel,
    seed,
    projects: world.projects.map((p) => p.label),
    standing: world.standing,
    turns,
    ...(recipe.breaksAfter === undefined ? {} : { breaksAfter: recipe.breaksAfter }),
  }
}

export const buildArcs = (
  personas: readonly Persona[],
  world: World,
  runSeed: number,
): readonly Arc[] => ARC_RECIPES.flatMap((r) => personas.map((p) => buildArc(r, p, world, runSeed)))

/**
 * Which conversation a turn belongs to.
 *
 * Extracted from the runner and exported so it is testable. It lived as
 * three lines inside `scripts/shadow/grant.ts`, where nothing could reach
 * it - and the whole point of `breaksAfter` is a distinction the
 * comprehension door cannot exercise at all, so the offline sweep running
 * green over it says nothing. A mechanism with no check behind it is the
 * thing this repository records paying for most often.
 *
 * Turns up to and including `breaksAfter` are the first conversation.
 * Everything after it is a second one, which the canonical door turns into
 * a different chat, which is what makes `app.conversation_before` return
 * nothing for it.
 */
export const conversationFor = (arc: Arc, turn: number): string =>
  arc.breaksAfter === undefined || turn <= arc.breaksAfter ? arc.id : `${arc.id}-again`

/** True on the first turn of the second conversation, where the thread is dropped. */
export const isFirstAfterTheBreak = (arc: Arc, turn: number): boolean =>
  arc.breaksAfter !== undefined && turn === arc.breaksAfter + 1
