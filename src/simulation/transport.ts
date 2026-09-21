/**
 * How a simulated message reaches the office.
 *
 * One interface, two doors. The scenarios, personas, oracles and evaluator
 * do not know which one they are talking to, which is the point: the same
 * corpus that runs offline today runs against the live office the moment a
 * credential exists, and a finding from either is expressed in the same
 * vocabulary.
 *
 * ## Why a seam at all
 *
 * This Cloud session holds no `SUPABASE_ACCESS_TOKEN`, no
 * `OPENROUTER_API_KEY` and no `HQ_API_TOKEN`. §25's failure policy is
 * explicit: *"Missing credential: block only the affected integration proof;
 * use safe local/canonical coverage where possible; continue."* A harness
 * welded to the live door would be unbuildable today and unbuilt tomorrow.
 *
 * It is also the safer arrangement on its own merits. §2 forbids polluting
 * Grant's real projects and sending synthetic traffic to real people, and
 * CLAUDE.md records this repository doing exactly that at least six times.
 * A transport that cannot reach production cannot do it a seventh.
 *
 * ## What the offline door actually measures
 *
 * Not a mock. It drives the product's REAL comprehension layer — the pure
 * modules in `src/agents/` that decide what a sentence is asking for. That
 * layer is where the mission's central question lives: *could Grant use this
 * office naturally without learning how the software wants to be spoken to?*
 * Whether a request is recognised at all, whether a withdrawal is seen,
 * whether a stated preference is registered — all of it is decided there,
 * before any model is called, and all of it is answerable with no
 * credentials.
 *
 * What it cannot answer is equally clear and is reported as UNREACHED rather
 * than as a pass: whether the right specialist was convened, whether a row
 * actually appeared in Postgres, whether the answer read well. Those need
 * the live door. A harness that quietly scored them from the offline door
 * would be the "verification that looks somewhere other than where the user
 * looks" CLAUDE.md records passing for the wrong reason three times in one
 * day.
 */

import { clauses } from '../agents/clauses.ts'
import { readCorrection } from '../agents/correction.ts'
import { extractionRequest } from '../agents/extract.ts'
import {
  type Classification,
  classifyIntent,
  needsClarification,
  onlyAnAcknowledgement,
} from '../agents/intent.ts'
import { personalTaskRequest } from '../agents/mine.ts'
import { excludesASubject, rejectsWithoutSaying } from '../agents/negation.ts'
import { readRetraction } from '../agents/retraction.ts'
import { readTeaching } from '../agents/teaching.ts'
import type { CanonicalEffects } from './effects.ts'
import type { Layer, Utterance } from './scenario.ts'

/**
 * What came back, in terms the evaluator can score.
 *
 * Deliberately NOT the office's internal objects. A transport that returned
 * a `Classification` would make every evaluator assertion a statement about
 * this repository's current type names, and CLAUDE.md records asserting the
 * mechanism rather than the property going red on a correct change four
 * separate times.
 */
export interface Observation {
  /** Which door produced this. Printed against every finding. */
  readonly door: 'comprehension' | 'canonical'
  /** What the office said back, where there is a reply. */
  readonly reply: string
  /** The office asked the person something. */
  readonly asked: boolean
  /**
   * The office understood the message to be a request of some kind at all.
   *
   * The single most important field offline. `false` means the message fell
   * through to the unrecognised default — which is the shape of *"Make me a
   * note to call Kevin"* not working while *"Remind me"* does.
   */
  readonly recognised: boolean
  /** How the office read the mood of the message. */
  readonly reading: string
  /** The office is confident enough in that reading to act widely on it. */
  readonly confident: boolean
  /** The separate requests the office could see in the message. */
  readonly clauses: readonly string[]
  /** A standing instruction was recognised in this message. */
  readonly learned: boolean
  /** A correction of previous work was recognised. */
  readonly corrected: boolean
  /** A request to pull tasks out of prose was recognised. */
  readonly extraction: boolean
  /**
   * The office would actually FILE something from this message.
   *
   * The most consequential field offline, and the one that connects a
   * comprehension reading to a real-world outcome. `personalTaskRequest` is
   * the grammatical matcher that decides whether a task appears on Grant's
   * own list, and it is deliberately narrow: its own comment argues that a
   * miss costs a to-do he adds himself while a false positive costs him the
   * WORK. That trade is right and is not what this measures.
   *
   * What this measures is the DISAGREEMENT between this matcher and the
   * intent classifier. When the office is confident a message is a direct
   * command and nothing will be filed from it, the turn ends with the office
   * having understood an instruction it has no path to carry out - which is
   * the condition #289 documents, where it then said it would.
   */
  readonly wouldFile: boolean
  /** The message was read as nothing but an acknowledgement. */
  readonly acknowledgementOnly: boolean
  /** The message was read as a contentless rejection of the last answer. */
  readonly bareRejection: boolean
  /** A subject the person excluded was removed before matching. */
  readonly exclusionSeen: boolean
  /**
   * Dimensions this door structurally cannot speak to.
   *
   * Named rather than silently absent. A blank where a verdict should be is
   * indistinguishable from a pass, and CLAUDE.md records a check that had
   * only ever reported zero being indistinguishable from a check that could
   * not report anything.
   */
  /**
   * The layers of the product this door actually drives.
   *
   * A scenario declares the layer it turns on; a door declares the layers it
   * reaches. Only their INTERSECTION is scoreable, and the evaluator must
   * gate on that rather than on the door's name.
   *
   * Before this existed, `agency` short-circuited on the scenario's layer
   * alone and reported "which this door does not reach" on the CANONICAL
   * door, which reaches all four — so the one door that can judge whether
   * the office should have asked declared itself unable to, on about
   * two-thirds of the corpus.
   */
  /**
   * Whether `clauses` is an OBSERVATION or a placeholder.
   *
   * The comprehension door calls the product's own splitter, so it knows.
   * The canonical door does not: the split happens inside the handler and
   * is not written anywhere canonical, so this door used to report
   * `[utterance.text]` - one clause, always - and every check that read
   * `clauses.length` was reading the door's own constant.
   *
   * That made `context` fail and `cancelled_executed` fire for EVERY
   * scenario carrying a withdrawal, on the live door, whatever the product
   * did. A verdict that cannot vary with the subject is not a measurement.
   */
  readonly clausesObserved: boolean
  /**
   * The office saw that something was taken back.
   *
   * The DIRECT question. `context` used to ask whether two or more clauses
   * were seen, as a proxy for "the withdrawal cannot have been noticed" -
   * and once #291 made the handler REMOVE the withdrawn half, the kept
   * half legitimately has fewer clauses, so the proxy got worse as the
   * product got better: 19 hard failures became 24 on an unchanged corpus.
   *
   * Assert the property, not the artefact that used to imply it. This
   * repository lists that correction five times.
   *
   * Undefined where a door cannot see it.
   */
  readonly withdrawalSeen?: boolean
  /**
   * Whether `learned` is an OBSERVATION or a placeholder.
   *
   * Same reason as `clausesObserved`: the canonical door cannot see the
   * handler's decision, and a constant read as a measurement made
   * `context` fail for every preference scenario live.
   */
  readonly learnedObserved?: boolean
  readonly reaches: readonly Layer[]
  /**
   * What canonically HAPPENED, where a door can see it.
   *
   * Counted from tables, never read off the reply. `reality` and
   * `completion` exist to catch the case where the prose and the rows
   * disagree, so a field derived from the prose would make both dimensions
   * unable to fail for the only reason they were written.
   *
   * Absent on the comprehension door, which executes nothing.
   */
  readonly effects?: CanonicalEffects
  readonly unreached: readonly string[]
  /** Wall-clock, for §19. */
  readonly ms: number
  /** Model calls attributable to this turn, for §19. */
  readonly modelCalls: number
}

/** Everything the office is allowed to know besides the message itself. */
export interface TurnContext {
  /**
   * WHICH CONVERSATION this turn belongs to.
   *
   * The canonical door does not pass `history` to the office - it cannot,
   * and should not: the office reconstructs a thread itself from
   * `app.conversation_before`, which keys on channel + chat + speaker
   * within a window. Handing it a history would test a path nobody uses.
   *
   * What the door DOES have to get right is the chat, and it was getting
   * it wrong. Every turn shared `origin_ref` of `teamhq:...`, so
   * `split_part(origin_ref, ':', 1)` was `teamhq` for all of them and one
   * run's scenarios threaded into each other: a turn from
   * `task.explicit` appeared in the history of the turn after it. Measured
   * at 2 prior turns on a multi-scenario run.
   *
   * That is invisible in a single-scenario run, which is how it survived,
   * and it is fatal to any multi-turn measurement - every continuity
   * scenario would be reading somebody else's conversation.
   */
  readonly conversation: string
  /** Earlier turns in this conversation, as they were actually exchanged. */
  readonly history: readonly { readonly who: 'person' | 'office'; readonly text: string }[]
  /** Standing instructions in force. */
  readonly standing: readonly string[]
  /** Whether the office has already produced an answer this person could be correcting. */
  readonly hadAnswer: boolean
}

export interface Transport {
  readonly door: Observation['door']
  /** True when this door can actually be reached in this environment. */
  readonly reachable: boolean
  /** Why it cannot be reached, where it cannot. */
  readonly blockedBecause?: string
  ask(utterance: Utterance, context: TurnContext): Promise<Observation>
}

/**
 * Dimensions the comprehension door cannot answer, named once.
 *
 * One list, so the evaluator's idea of what was unreached and the
 * transport's cannot drift. CLAUDE.md: two lists in two functions compared
 * by eye is how they came to differ.
 */
export const COMPREHENSION_CANNOT_REACH: readonly string[] = [
  'reality', // no canonical row is written, so no effect can be verified
  'conversation-quality', // no prose is generated, so there is nothing to read
  'goal-completion', // nothing is executed, so nothing completes
]

/**
 * The offline door: the product's own comprehension layer, driven directly.
 *
 * No network, no database, no model. Every function called here is one the
 * live office calls on the same sentence before it does anything else.
 */
export const comprehensionDoor = (): Transport => ({
  door: 'comprehension',
  reachable: true,
  async ask(utterance: Utterance, context: TurnContext): Promise<Observation> {
    const started = Date.now()
    const said = utterance.text
    const withdrawal = readRetraction(said)

    const classification: Classification = classifyIntent(said)
    const correction = readCorrection(said, context.hadAnswer)
    const teaching = readTeaching(said)
    const extraction = extractionRequest(said)
    const filing = personalTaskRequest(said)

    return {
      door: 'comprehension',
      // The comprehension layer produces no prose. Saying so explicitly
      // beats an empty string, which an evaluator would score as a terse
      // answer rather than as no answer at all.
      reply: '',
      asked: needsClarification(classification),
      recognised: classification.recognised,
      reading: classification.intent,
      confident: classification.confident,
      /*
        What the HANDLER sees, which since #291 is the message with a
        retraction already taken out of it.

        The offline door exists to drive the product's real comprehension
        layer, and after #291 that layer begins with `readRetraction`. A
        door that split the raw message would report a withdrawal as
        invisible on every scenario the handler now handles correctly -
        the same disagreement-between-two-halves defect this repository
        keeps paying for, with the halves being the two doors.
      */
      clauses: clauses(withdrawal === null ? said : withdrawal.kept),
      learned: teaching !== null,
      corrected: correction !== null,
      extraction: extraction !== null,
      wouldFile: filing !== null,
      acknowledgementOnly: onlyAnAcknowledgement(said),
      bareRejection: rejectsWithoutSaying(said),
      exclusionSeen: excludesASubject(said),
      clausesObserved: true,
      learnedObserved: true,
      withdrawalSeen: withdrawal !== null,
      reaches: ['comprehension'],
      unreached: COMPREHENSION_CANNOT_REACH,
      ms: Date.now() - started,
      modelCalls: 0,
    }
  },
})

/**
 * The live door.
 *
 * Implemented in `./canonical.ts` and re-exported here so callers have one
 * place to ask for a door. It is a separate module because it is the only
 * part of this harness that writes to shared infrastructure, and a file
 * that can create rows in Grant's Supabase should be a file somebody has to
 * open on purpose.
 *
 * **It has never been run.** It refuses without
 * `--i-have-checked-the-first-run`, and `firstRunChecklist()` says what to
 * check. See Issue #294 for why it cannot simply import the session
 * runner's proved version of the same SQL.
 */
export { canonicalDoor, firstRunChecklist } from './canonical.ts'
