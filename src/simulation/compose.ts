/**
 * The compositional generator — §7.
 *
 * *"Do not store 500 near-duplicate prompts."* A scenario is composed at run
 * time from
 *
 *   goal family x persona x channel shape x messiness x structure x seed
 *
 * and every one of those is recorded, so any scenario can be regenerated
 * exactly from the numbers in its own record. A failure nobody can reproduce
 * is an anecdote, and CLAUDE.md records a routing flake that was invisible
 * for three days precisely because nothing could regenerate it.
 *
 * ## Structural mutation lives here, not in the roughener
 *
 * `roughen` may not change meaning, so the mutations that DO change what is
 * being asked are applied here, where the hidden intent can be updated in the
 * same breath. Each operator below edits the sentence AND the intent
 * together, and never one without the other. That pairing is the whole
 * reason this file exists rather than the operators sitting beside the
 * typos.
 *
 * CLAUDE.md, about the cost of getting this wrong: *"a harness expectation is
 * a claim about the product and is wrong about half the time at first"*, with
 * four worked examples. An operator that appended "actually forget that"
 * while leaving the intent expecting the task would report the office failing
 * for doing exactly the right thing — and it would do it silently, on a
 * fraction of seeds, which is the hardest kind of harness defect to see.
 */

import type { Draft, GoalFamily } from './goals.ts'
import { GOAL_FAMILIES } from './goals.ts'
import type { Persona } from './persona.ts'
import { PERSONAS } from './persona.ts'
import { derive, Seeded } from './random.ts'
import { roughen } from './roughen.ts'
import type { ChannelShape, Scenario, ScenarioTurn } from './scenario.ts'
import { projectByLabel, type World } from './world.ts'

/** What was done to a draft, recorded so a failure names its own shape. */
export interface Composition {
  readonly structural: readonly string[]
  readonly surface: readonly string[]
}

interface Composed {
  readonly turn: ScenarioTurn
  readonly composition: Composition
}

// ---------------------------------------------------------------------------
// Structural operators. Each returns a draft AND the intent that now matches
// it, or returns the draft unchanged.
// ---------------------------------------------------------------------------

/**
 * A second, unrelated request bolted on.
 *
 * The intent keeps the FIRST request's effect class, and the second request's
 * want is folded into the sentence describing what the person was after. A
 * merged effect class would be a lie — a person asking a question and
 * creating a task wants both, and there is no single class for that — so the
 * evaluator is told about both in `want` and scores completeness against it.
 */
const withSecondRequest = (d: Draft, other: Draft): Draft => ({
  say: `${d.say} and ${other.say}`,
  intent: {
    ...d.intent,
    want: `two things, both of which must happen: (1) ${d.intent.want}; (2) ${other.intent.want}`,
    // A negative constraint on either half binds the whole message.
    forbids: [...(d.intent.forbids ?? []), ...(other.intent.forbids ?? [])],
    withdrawn: [...(d.intent.withdrawn ?? []), ...(other.intent.withdrawn ?? [])],
  },
  why: `${d.why}; carried alongside a second unrelated request`,
})

/** An afterthought, appended the way a person adds one. */
const withAfterthought = (d: Draft, other: Draft, rng: Seeded): Draft => {
  const lead =
    rng.pick(['oh and', 'actually also', 'oh, and while you are there', 'also']) ?? 'oh and'
  return {
    say: `${d.say}. ${lead} ${other.say}`,
    intent: {
      ...d.intent,
      want: `${d.intent.want}; and, as an afterthought, ${other.intent.want}`,
      forbids: [...(d.intent.forbids ?? []), ...(other.intent.forbids ?? [])],
      withdrawn: [...(d.intent.withdrawn ?? []), ...(other.intent.withdrawn ?? [])],
    },
    why: `${d.why}; with an afterthought appended`,
  }
}

/**
 * The person changes their mind inside the message.
 *
 * The ORIGINAL request becomes withdrawn and the replacement stands. This is
 * the operator that most obviously must edit both halves at once: the
 * sentence now contains two requests and only the second one counts.
 */
const withSelfCorrection = (d: Draft, other: Draft, rng: Seeded): Draft => {
  const turn =
    rng.pick(['no, forget that,', 'actually no,', 'hang on, ignore that —', 'no scrap that,']) ??
    'no, forget that,'
  return {
    say: `${d.say} — ${turn} ${other.say}`,
    intent: {
      ...other.intent,
      want: `${other.intent.want}. The first request was withdrawn before it was sent and must not be acted on.`,
      withdrawn: [...(other.intent.withdrawn ?? []), d.say],
      /*
        The limit survives the withdrawal of the request it arrived with.

        "Do what makes sense on the bid but do not contact anyone - no scrap
        that, what is on my list" withdraws the bid work. Whether it also
        withdraws the limit is genuinely ambiguous, and the two readings are
        not symmetric: if the limit persists and the person did not mean it
        to, the office is slightly over-cautious; if it lapses and they did
        mean it, somebody gets contacted who should not have been, which §10
        calls a hard failure.

        So the limit persists. The asymmetry decides it, the same way 0304's
        does - a witness that can only ever restrain cannot cause the harm
        the other reading can.

        Found by strengthening a test that could not fail: its first version
        asserted only that some family somewhere carried a forbid, and passed
        over a generator that dropped them.
      */
      forbids: [...(d.intent.forbids ?? []), ...(other.intent.forbids ?? [])],
    },
    why: `${other.why}; reached by withdrawing an earlier request mid-message`,
  }
}

/**
 * A project named properly becomes "that one".
 *
 * This genuinely removes information, so the intent gains a legitimate thing
 * to ask about. Without that, the evaluator would score a correct
 * clarification as an unnecessary question — which CLAUDE.md warns is the
 * expensive direction, because a check that fires on correct behaviour is one
 * somebody switches off.
 */
const withVagueReference = (d: Draft, world: World, rng: Seeded): Draft => {
  if (d.intent.project === undefined) return d
  const p = projectByLabel(world, d.intent.project)
  if (p === undefined) return d
  const vague = rng.pick(['that one', 'the other one', 'that thing', 'it']) ?? 'that one'
  let said = d.say
  for (const name of [p.name, ...p.nicknames]) {
    if (said.toLowerCase().includes(name.toLowerCase())) {
      said = said.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), vague)
      return {
        ...d,
        say: said,
        intent: {
          ...d.intent,
          mayAskAbout: [...(d.intent.mayAskAbout ?? []), 'which project is meant'],
        },
        why: `${d.why}; with the project referred to only as "${vague}"`,
      }
    }
  }
  return d
}

/**
 * Cut down to a fragment.
 *
 * Only the leading function words go — an opening auxiliary, a politeness —
 * so the request survives as something a person would actually send. Cutting
 * content would change the request, which is the line this whole file exists
 * to hold.
 */
const asFragment = (d: Draft): Draft => {
  const trimmed = d.say
    .replace(/^(can you|could you|would you|please|i need you to|i want you to|can we)\s+/i, '')
    .replace(/\?$/, '')
  return trimmed === d.say ? d : { ...d, say: trimmed, why: `${d.why}; sent as a fragment` }
}

// ---------------------------------------------------------------------------

const drawOther = (world: World, rng: Seeded, notFamily: string): Draft => {
  const pool = GOAL_FAMILIES.filter((f) => f.id !== notFamily)
  const pick = pool[rng.int(pool.length)] ?? GOAL_FAMILIES[0]
  return (pick as GoalFamily).draft(world, rng)
}

/**
 * Compose one turn: draw the sentence, restructure it, then roughen it.
 *
 * Order matters and is not arbitrary. Structure first, because an operator
 * needs to recognise the project name it is about to replace, and a typo in
 * that name would defeat it silently. Surface last, because that is the order
 * a person does it in — they decide what to say, and then say it badly.
 */
export const composeTurn = (
  family: GoalFamily,
  persona: Persona,
  world: World,
  seed: number,
): Composed => {
  const rng = new Seeded(seed)
  let draft = family.draft(world, rng)
  const structural: string[] = []

  if (rng.chance(persona.selfCorrection)) {
    draft = withSelfCorrection(draft, drawOther(world, rng, family.id), rng)
    structural.push('self-correction')
  } else if (rng.chance(persona.multiRequest)) {
    draft = withSecondRequest(draft, drawOther(world, rng, family.id))
    structural.push('second-request')
  } else if (rng.chance(persona.afterthought)) {
    draft = withAfterthought(draft, drawOther(world, rng, family.id), rng)
    structural.push('afterthought')
  }

  if (rng.chance(persona.vagueReference)) {
    const before = draft.say
    draft = withVagueReference(draft, world, rng)
    if (draft.say !== before) structural.push('vague-reference')
  }

  if (rng.chance(persona.fragments)) {
    const before = draft.say
    draft = asFragment(draft)
    if (draft.say !== before) structural.push('fragment')
  }

  const { text, applied } = roughen(draft.say, persona, derive(seed, 'surface'))

  const turn: ScenarioTurn = {
    say: text,
    intent: draft.intent,
    ...(draft.ifAsked === undefined ? {} : { ifAsked: draft.ifAsked }),
    why: draft.why,
  }
  return { turn, composition: { structural, surface: applied } }
}

/** Which channel this persona is most likely to be on. */
const channelFor = (persona: Persona, rng: Seeded): ChannelShape =>
  persona.slug === 'dictates'
    ? 'voice'
    : (rng.pick<ChannelShape>(['teamhq', 'telegram', 'slack', 'voice']) ?? 'teamhq')

export interface GeneratedScenario extends Scenario {
  readonly compositions: readonly Composition[]
}

/**
 * One scenario for one family.
 *
 * Single-turn by default. Multi-turn arcs are composed by
 * `src/simulation/arcs.ts`, because a conversation is a different object from
 * a message and conflating them produced a corpus in which "the other
 * project" had no previous project to be other than.
 */
export const generate = (
  family: GoalFamily,
  persona: Persona,
  world: World,
  runSeed: number,
  nth: number,
): GeneratedScenario => {
  const seed = derive(runSeed, family.id, persona.slug, nth)
  const rng = new Seeded(derive(seed, 'channel'))
  const { turn, composition } = composeTurn(family, persona, world, seed)
  const channel = channelFor(persona, rng)
  const projects = world.projects.map((p) => p.label)
  return {
    id: `${family.id}/${persona.slug}/${nth}`,
    family: family.id,
    persona: persona.slug,
    channel,
    seed,
    projects,
    standing: world.standing,
    turns: [turn],
    compositions: [composition],
  }
}

/**
 * A whole corpus: every family, spread across personas.
 *
 * Spread rather than cross-producted. The full cross of 66 families and 4
 * personas at 3 variants each is 792 conversations, which at live rates is
 * hours of model time for coverage that is mostly repetition. §19 asks for
 * budgets to be configurable and for reliability figures never to be quoted
 * from inadequate samples; the honest way to satisfy both is a smaller
 * corpus whose composition is recorded than a large one nobody can afford to
 * run twice.
 */
export const generateCorpus = (
  world: World,
  runSeed: number,
  perFamily = 2,
  personas: readonly Persona[] = PERSONAS,
): readonly GeneratedScenario[] => {
  const out: GeneratedScenario[] = []
  for (const family of GOAL_FAMILIES) {
    for (let n = 0; n < perFamily; n++) {
      const rng = new Seeded(derive(runSeed, family.id, 'persona', n))
      const persona = personas[rng.int(personas.length)] ?? PERSONAS[0]
      out.push(generate(family, persona as Persona, world, runSeed, n))
    }
  }
  return out
}
