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
import { excludesASubject, rejectsWithoutSaying } from '../agents/negation.ts'
import { readTeaching } from '../agents/teaching.ts'
import type { Utterance } from './scenario.ts'

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
  readonly unreached: readonly string[]
  /** Wall-clock, for §19. */
  readonly ms: number
  /** Model calls attributable to this turn, for §19. */
  readonly modelCalls: number
}

/** Everything the office is allowed to know besides the message itself. */
export interface TurnContext {
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

    const classification: Classification = classifyIntent(said)
    const correction = readCorrection(said, context.hadAnswer)
    const teaching = readTeaching(said)
    const extraction = extractionRequest(said)

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
      clauses: clauses(said),
      learned: teaching !== null,
      corrected: correction !== null,
      extraction: extraction !== null,
      acknowledgementOnly: onlyAnAcknowledgement(said),
      bareRejection: rejectsWithoutSaying(said),
      exclusionSeen: excludesASubject(said),
      unreached: COMPREHENSION_CANNOT_REACH,
      ms: Date.now() - started,
      modelCalls: 0,
    }
  },
})

/**
 * The live door, when a credential exists.
 *
 * Not wired to `scripts/sessions/run.ts` by import, deliberately: that file
 * calls `process.exit(2)` at module scope when `SUPABASE_ACCESS_TOKEN` is
 * unset, so importing it would kill any run in an environment without one —
 * including every run in this session. Exactly the shape CLAUDE.md warns
 * about, where a pre-condition shared by two suites becomes a coupling that
 * only fails when somebody runs both.
 *
 * It reports itself unreachable rather than throwing, so a corpus run in an
 * environment without credentials produces an honest UNREACHED report rather
 * than a crash — §25 again: block the affected proof, continue everything
 * else.
 */
export const canonicalDoor = (): Transport => {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const has = token !== undefined && token !== ''
  return {
    door: 'canonical',
    reachable: has,
    ...(has ? {} : { blockedBecause: 'SUPABASE_ACCESS_TOKEN is not set in this environment' }),
    async ask(): Promise<Observation> {
      throw new Error(
        'the canonical door is not wired in this build: run the harness where SUPABASE_ACCESS_TOKEN is set, and see docs/shadow-grant/README.md',
      )
    },
  }
}
