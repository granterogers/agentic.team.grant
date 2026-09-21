/**
 * What a simulated human is trying to do, and what the office is allowed to see.
 *
 * The mission's §5 separates three roles and the separation is the whole
 * instrument:
 *
 *   A. the USER SIMULATOR knows the hidden intent and the hidden state;
 *   B. the OFFICE UNDER TEST receives only what a real person on a real
 *      channel would have sent;
 *   C. the EVALUATOR may see everything.
 *
 * If B can see any part of A, every score afterwards is a measurement of the
 * harness telling the office the answer. That is not a risk to be careful
 * about; it is a property to be enforced by construction, which is what the
 * two types below do. `Scenario` holds the truth. `Utterance` is the only
 * thing that may cross to the office, and `src/simulation/isolation.ts`
 * refuses to let anything else.
 *
 * CLAUDE.md's most-repeated lesson applies to this file more than to any
 * other in the harness: **a comment claiming a property is worth nothing
 * without a check behind it.** The check is
 * `tests/simulation/isolation.test.ts`, and it is proved by sabotage — the
 * leak is put back and the detector must go red.
 */

/**
 * The channel shape a message arrives in.
 *
 * Not decoration. §16 notes the canonical door is one translation step short
 * of Telegram and Slack, and a voice transcript is a genuinely different
 * object from typed text: no punctuation, spoken numbers, self-correction
 * left in. The shape decides how the mutator roughens a sentence and which
 * adapter the scenario can honestly claim to have exercised.
 */
export type ChannelShape = 'teamhq' | 'telegram' | 'voice' | 'slack'

/**
 * What the office is expected to have DONE, as a class rather than a row.
 *
 * A class, because the mission forbids the harness from asserting the
 * office's internal route (§10C: a sensible AVAILABLE route, not the one the
 * test author imagined). "A task exists" is a property of the world. "The
 * task handler ran" is a guess about plumbing, and CLAUDE.md records four
 * separate occasions where asserting the mechanism went red on a correct
 * change.
 */
export type EffectClass =
  | 'none' // a question, an acknowledgement, a preference — nothing may change
  | 'task' // something to do now exists
  | 'task_changed' // one that existed is different, or gone
  | 'document' // something was written
  | 'delivery' // a message left the building, to a permitted destination
  | 'preference' // a standing instruction was recorded
  | 'blocked' // the office correctly stopped and asked
  | 'declined' // the office correctly said it cannot

/**
 * Everything the simulator knows and the office must not.
 *
 * `want` is the sentence a person would use to describe what they were
 * actually after, written from outside the software. It exists so the
 * evaluator can ask "did this happen" rather than "did the office use the
 * words we hoped for", and it is the single most dangerous string in the
 * harness: leaked into the office's context it converts every scenario into a
 * comprehension test the office cannot fail.
 */
export interface HiddenIntent {
  /** What the person actually wanted, in their own terms. Never shown to the office. */
  readonly want: string
  /** What must be true of the world afterwards. */
  readonly effect: EffectClass
  /**
   * Which project the person had in mind, by label.
   *
   * Their MIND, not their words — a scenario whose whole point is that they
   * said "the other one" has a definite answer here and a hopeless one in the
   * message.
   */
  readonly project?: string
  /**
   * Clauses the person withdrew before sending.
   *
   * "Actually forget that" is the commonest thing in Grant's own messages and
   * the most expensive to get wrong: a cancelled clause that gets executed is
   * a HARD FAILURE (§10), not a scoring deduction.
   */
  readonly withdrawn?: readonly string[]
  /**
   * Constraints the person stated negatively — "but don't contact anyone".
   *
   * Tracked apart from `want` because losing one is its own hard failure and
   * because a negative constraint is invisible to any check that only asks
   * whether the positive half happened.
   */
  readonly forbids?: readonly string[]
  /**
   * Which layer of the office this scenario actually turns on.
   *
   * The single most important field for honest scoring, and it was missing
   * from the first version of this harness. Without it the evaluator judged
   * every scenario against whichever door happened to be running, and three
   * of the first baseline's six failure classes were that mistake rather
   * than the product.
   *
   * `classifyIntent` is confident that *"can you pull the numbers on the
   * review"* is a question. It has no opinion whatever on WHICH review, and
   * it was never asked for one - project resolution decides that, in the
   * database. Reading "it does not intend to ask" off the intent classifier
   * and calling that a failure to clarify is asserting at the wrong layer,
   * which CLAUDE.md lists among its own traps twice.
   *
   *   - `comprehension` - turns on reading this message. Judgeable offline.
   *   - `referent` - turns on knowing which project or thing is meant.
   *     Decided in project resolution, which needs the database.
   *   - `history` - turns on what was said earlier. Decided in the thread
   *     resolver, which needs a conversation.
   *   - `execution` - turns on something actually happening. Needs the
   *     canonical door.
   *
   * Anything other than `comprehension` makes the dependent dimensions
   * UNREACHED on the offline door rather than failed. Unreached is the
   * honest verdict; a low score is not.
   */
  readonly turnsOn?: 'comprehension' | 'referent' | 'history' | 'execution'
  /**
   * Limits the person actually SAID, in words, in this message.
   *
   * Distinct from `forbids`, which holds every limit binding the office
   * whatever its source - including ones implied by the request type, such
   * as "draft it" implying "do not send it". Only a spoken limit can be
   * looked for in the text, and the first version of the safety check
   * conflated the two: it searched the message for the evaluator's own
   * phrase "emailing the participants", which no person ever said, and
   * reported a limit as lost every single time it ran.
   */
  readonly saidNo?: readonly string[]
  /** The office would be right to ask about this before acting. */
  readonly mayAskAbout?: readonly string[]
  /**
   * The office already has everything it needs for these.
   *
   * The other half of clarification scoring, and the half that is usually
   * missing. §8: an unnecessary question is recorded as a defect rather than
   * forgiven, and nothing can call a question unnecessary without knowing
   * what was already on the table.
   */
  readonly alreadyKnows?: readonly string[]
}

/**
 * One thing a person says. This — and only this — may reach the office.
 *
 * Deliberately not a subset of `Scenario` by convention. It is a separate
 * object built by `utteranceOf`, because a convention is a thing somebody
 * forgets at 3am and a type is a thing the compiler remembers.
 */
export interface Utterance {
  /** The words, after mutation. Exactly what a person typed or said. */
  readonly text: string
  /** The surface it arrived on. */
  readonly channel: ChannelShape
  /**
   * The project the SURFACE says is open, if any.
   *
   * A real fact about the world — the dashboard has a project selected — and
   * so legitimately available to the office. Distinct from
   * `HiddenIntent.project`, which is what the person meant and may differ;
   * that difference is the entire content of the "no, the other project"
   * family.
   */
  readonly inProject?: string
}

/** A reply from the office, as the simulator sees it. */
export interface OfficeReply {
  readonly text: string
  /** Did the office ask the person something? */
  readonly asked: boolean
  /** Opaque handle the oracle uses to find canonical evidence. */
  readonly ref?: string
}

export interface ScenarioTurn {
  /**
   * The clean sentence, before messiness is applied.
   *
   * Stored clean and roughened at generation time so a failure is
   * reproducible from a seed (§7) and so the same goal can be re-run at a
   * different messiness without rewriting the case.
   */
  readonly say: string
  readonly intent: HiddenIntent
  /**
   * How the simulator should answer if the office asks something here.
   *
   * §8: the simulator reacts. Without this a multi-turn scenario is a
   * monologue, and the office's clarifying question — the thing most worth
   * testing — has nowhere to go.
   */
  readonly ifAsked?: string
  /** What this turn is testing, printed beside the result. */
  readonly why: string
}

export interface Scenario {
  readonly id: string
  /** The goal family this came from, so failures cluster (§20). */
  readonly family: string
  readonly persona: string
  readonly channel: ChannelShape
  /** The seed that produced it. A scenario that cannot be regenerated is an anecdote. */
  readonly seed: number
  /** Dashboard projects that must exist for this to make sense, by label. */
  readonly projects?: readonly string[]
  /**
   * Standing preferences already in force when the scenario opens.
   *
   * §9 needs a preference established in one session to be honoured in a
   * later one, and a harness that can only ever establish a preference
   * in-conversation cannot test persistence at all.
   */
  readonly standing?: readonly string[]
  readonly turns: readonly ScenarioTurn[]
}

/**
 * The one sanctioned way to turn a scenario turn into something the office
 * may see.
 *
 * It constructs a NEW object naming each permitted field rather than
 * spreading and deleting. Spreading is how a field added to `ScenarioTurn`
 * next month arrives in the office's context without anybody deciding it
 * should — and "it was added by a spread" is exactly the kind of accident
 * §14 asks to be proved impossible rather than merely unlikely.
 */
export const utteranceOf = (channel: ChannelShape, text: string, inProject?: string): Utterance =>
  inProject === undefined ? { text, channel } : { text, channel, inProject }
