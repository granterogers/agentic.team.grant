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
  }
}

export const buildArcs = (
  personas: readonly Persona[],
  world: World,
  runSeed: number,
): readonly Arc[] => ARC_RECIPES.flatMap((r) => personas.map((p) => buildArc(r, p, world, runSeed)))
