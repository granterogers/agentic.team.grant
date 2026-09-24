/**
 * What actually happened, as a CLASS, and what the answer is then allowed to
 * say about it — #302.
 *
 * ## The defect
 *
 * Understanding improved faster than acting. The office now reads messages it
 * used to discard, the acting path did not widen with it, and when it
 * understands an instruction it cannot carry out it does one of two things,
 * neither of which is asking:
 *
 *     "stick something down so I do not forget to ring Kevin about the quote"
 *       -> read as an assignment, extractor returned nothing, nothing filed,
 *          model wrote "Task added", the gate refused it four times, and
 *          Grant received an EMPTY REPLY.
 *
 *     "on simgrant Match Funding Bid do what you think is best and let me know"
 *       -> refused once for claiming, and the retry came back with
 *          "I'll draft a high-level outline... create a task... add a Notion
 *          note..." - three things, none of which exists, which PASSED.
 *
 * The second is reached FROM the first. The refusal is written into
 * `pinned_config` so the retry can see it, the retry reads *"do not report it
 * as done"*, and switches from the past tense to the future. **The closed loop
 * teaches the model to promise instead of claim.**
 *
 * ## Why this is not another detector
 *
 * Every existing gate keys on a CLAIM: `claimsToHaveRead` needs "I checked",
 * `claimsToHaveSent` needs "I posted", `claimsToHaveMade` needs a past-tense
 * creation. Each is a list of ways of saying a thing, and a list is always
 * missing the next one — this repository records that correction six times,
 * and the future tense is simply the shape no list had.
 *
 * Adding "I'll", "I will", "I am going to" would be the seventh instance of
 * the same mistake, and it would be worse than the previous six because the
 * future tense is also how a LEGITIMATE plan is expressed. A gate that cannot
 * tell "I'll draft it" backed by a child job from "I'll draft it" backed by
 * nothing has to refuse both or allow both.
 *
 * So the question is inverted. Not *"does this sentence claim something?"* but
 * *"what is the canonical outcome, and what is an answer for that outcome
 * permitted to say?"* The permission is computed from rows. The wording is
 * never consulted.
 *
 * ## The invariant
 *
 * IF THE REQUEST IS UNDERSTOOD BUT CANNOT BE COMPLETED, THE FINAL RESPONSE
 * MUST ACCURATELY REPRESENT THE CANONICAL OUTCOME AND, WHERE USEFUL, ASK FOR
 * THE MINIMUM INFORMATION OR APPROVAL NEEDED TO CONTINUE.
 *
 * The one rule everything else falls out of: **a commitment to the future is
 * permitted only where a canonical pending action exists.** A child job, a job
 * paused for approval, a blocker carrying what answering it performs — those
 * are things that will actually happen. Without one, "I'll add the task" is
 * the same lie as "Task added" in a tense the old gate could not see.
 *
 * ## Deliberately pure
 *
 * No database, no clock, no model. Everything here is a function of counts the
 * caller has already established, so the classes can be driven exhaustively in
 * a unit test and so `verify:outcome` can prove each one against real rows
 * without this file being able to cheat.
 */

/**
 * The six outcomes a turn can end in.
 *
 * A closed set, and closed on purpose: `REQUIRES` below is typed against it,
 * so a seventh class cannot be added without the compiler demanding its
 * contract. CLAUDE.md records what an unforced enumeration costs — a
 * `REQUIRES` map typed this way is what caught `delivery` missing from the
 * effect classes.
 */
export type OutcomeClass =
  /** Everything that was wanted exists. A question answered is also this. */
  | 'completed'
  /** Some of it exists and some does not, and the answer must say which. */
  | 'partially_completed'
  /** Understood, not done, and there is something specific to ask him for. */
  | 'blocked_needs_user'
  /** Understood, not done, and nothing he could say would change that. */
  | 'blocked_capability'
  /** Not done YET, and a canonical pending action is waiting on his word. */
  | 'pending_approval'
  /** Attempts are spent and nothing landed. */
  | 'failed_after_retries'

/**
 * What the caller has established from canonical state.
 *
 * Every field is a count or a list of rows, never a reading of the answer.
 * That is the whole design: a field derived from the prose would make this
 * unable to fail for the only reason it exists.
 */
export interface CanonicalOutcome {
  /**
   * How many distinct things this turn set out to do.
   *
   * Zero for a question, an acknowledgement or a preference — and zero is not
   * a failure, it is the commonest correct answer in the corpus.
   */
  readonly wanted: number
  /**
   * How many of them CANONICALLY EXIST.
   *
   * Counted from rows the turn produced, never from what the handler decided
   * to attempt. `acted` in `OutputMetadata` counts the latter, which is why it
   * cannot see a `my_task_add` that was called and refused.
   */
  readonly landed: number
  /**
   * Work that is really going to happen: child jobs enqueued, and a job paused
   * with something waiting on it.
   *
   * This is the ONLY thing that licenses a commitment to the future, and it is
   * the whole reason the field exists.
   */
  readonly pendingActions: number
  /** A blocker was raised that is waiting on Grant to answer it. */
  readonly awaitingApproval: boolean
  /**
   * What the turn could not resolve, named in words he could act on — "which
   * project", "a title for it".
   *
   * Non-empty is what separates `blocked_needs_user` from
   * `blocked_capability`: the first has a question worth asking and the second
   * does not. Forcing the caller to NAME the gap is the point — "I could not
   * do it" is not an answer he can do anything with.
   */
  readonly missing: readonly string[]
  /** The office declined because the capability does not exist or is refused. */
  readonly capabilityRefused: boolean
  /** Which attempt this is, and how many it gets. */
  readonly attempt: number
  readonly maxAttempts: number
  /**
   * Has the turn FINISHED, or is it still being answered?
   *
   * `failed_after_retries` is a fact about a settled job, and the handler is
   * by definition still running when it asks. Without this the class fires on
   * the LAST attempt - which is exactly when the office is most likely to
   * produce a good answer, because it has the previous refusals in front of
   * it.
   *
   * Found live on 22 September: a job in state `complete` on attempt 4 told
   * Grant *"I could not get this done after 4 attempts, and nothing was
   * created"* and then answered his question in the next sentence. The
   * attempt count was right and the conclusion drawn from it was not.
   *
   * So the handler passes `false` and never reaches the class; a reader of
   * settled state passes what the job's own state says.
   */
  readonly settled: boolean
  /**
   * Did he ASK for work, in a form the office's own grammar recognises?
   *
   * Separate from `wanted` because the two numbers answer different
   * questions, and the first wiring used one for both.
   *
   * `wanted` is deliberately permissive: it counts every clause the handler
   * would act on, and it includes the `other` reading, because a narrower
   * count reopened #302 within the hour - *"get someone onto the insurance
   * renewal before it slips"* is a request the strict list did not cover and
   * the office promised to file a task for it.
   *
   * But `other` is ALSO what every non-model path returns for the whole
   * utterance: no provider, a short single clause, a fan-out branch. So
   * *"did you do it?"* arrives as one reading of kind `other`, counts as
   * wanting work, lands nothing, classifies as `blocked_needs_user`, and the
   * office answers a question about its own state by opening *"I have not
   * done this. I understood what you want and could not carry it out - say it
   * again in a sentence and I will."* Measured over 34 live turns: **22 of
   * them, 65%, opened with that clause, 8 of those on questions.**
   *
   * CLAUDE.md records the shape exactly - a fallback class and a real class
   * sharing one name makes both unreachable, and nothing downstream can tell
   * *"we decided this"* from *"we did not know"*. The remedy there was
   * `Classification.recognised`; this is the same remedy one layer out.
   *
   * It is deliberately used for ONE thing: whether the office VOLUNTEERS a
   * state sentence. It never widens what an answer may claim, so a turn that
   * asked for nothing still may not say it did something.
   */
  readonly asked: boolean
}

/**
 * Classify, from rows alone.
 *
 * Order matters and is argued rather than incidental:
 *
 *   1. **Spent attempts first.** A job out of attempts with nothing to show is
 *      `failed_after_retries` whatever else is true of it, because that is the
 *      state Grant is actually in — waiting, with nothing coming.
 *   2. **Approval before blocked.** A job paused for approval is not blocked
 *      on information; it is blocked on a decision, and those need different
 *      sentences and different next actions.
 *   3. **Capability before information.** If the office cannot do a thing at
 *      all, asking him which project is a waste of his time.
 *   4. Then the arithmetic.
 */
export const classifyOutcome = (c: CanonicalOutcome): OutcomeClass => {
  /*
    Settled FIRST, because an unfinished turn cannot have failed.

    The handler asks this while it is composing an answer, so its attempt
    count can equal the maximum while the job is about to succeed - and it
    did, live, producing "I could not get this done after 4 attempts"
    immediately before answering the question.
  */
  const outOfAttempts = c.settled && c.attempt >= c.maxAttempts
  if (outOfAttempts && c.landed === 0 && c.wanted > 0 && c.pendingActions === 0) {
    return 'failed_after_retries'
  }
  /*
    WORK THAT IS REALLY GOING TO HAPPEN IS NEVER SILENT.

    `c.wanted > 0` used to be required here, and a live turn on v717 showed
    what that costs. A dictated message carrying four intentions fanned out to
    **four child jobs**, and because its readings did not count as `wanted`
    the class came out `completed`, no sentence was owed, and the answer Grant
    received was:

        "I have nothing from earlier in this conversation — this is the first
         thing you have said to me here…"

    Four specialists were working and he was told nothing was happening. The
    #302 contract governs over-claiming in every direction and had no rule for
    UNDER-claiming: an office that starts work and does not say so is one he
    cannot plan around, and it is the same defect as a false promise with the
    sign reversed.

    Pending work is a fact about rows, so it decides the class on its own.
  */
  if (c.awaitingApproval || (c.pendingActions > 0 && c.landed === 0)) {
    return 'pending_approval'
  }
  if (c.capabilityRefused) return 'blocked_capability'
  /*
    Nothing was wanted, so nothing missing can make this incomplete.

    A question, an acknowledgement and a stated preference all arrive here,
    and all three are COMPLETE with zero effects. Reading them as blocked was
    the first draft's mistake and it would have put "I could not do that" on
    the end of every "thanks".
  */
  if (c.wanted === 0) return 'completed'
  /*
    Nothing landed, and we have NOT established that it cannot be done.

    The first draft fell back to `blocked_capability` here, which asserts an
    incapability nobody proved: "it is not something I can do" would have
    been a fresh fabrication in the sentence written to stop fabrications.
    Only an explicit `capabilityRefused` — checked above — licenses that
    claim.

    So an unexplained miss is `blocked_needs_user` with a generic ask. The
    honest position is that the office understood, did nothing, and does not
    know why; the useful next action is to have him say it again plainly.
  */
  if (c.landed === 0) return 'blocked_needs_user'
  if (c.landed < c.wanted) return 'partially_completed'
  return 'completed'
}

/**
 * What an answer for this outcome may and may not do.
 *
 * Permissions, not wording. Nothing here inspects a sentence, and nothing here
 * can be satisfied by phrasing something differently — which is the property
 * that makes this survive the next way somebody finds to say "I did it".
 */
export interface NarrationContract {
  /** The answer may report the work as done. */
  readonly mayClaimCompletion: boolean
  /**
   * The answer may commit to doing something after this turn.
   *
   * **The rule #302 turns on.** True only where a canonical pending action
   * exists, so "I'll draft the outline" is permitted exactly when something is
   * really going to draft it.
   */
  readonly mayCommitToFuture: boolean
  /** The answer must distinguish what happened from what did not. */
  readonly mustNameWhatDidNotHappen: boolean
  /** The answer must ask for something — information, or a decision. */
  readonly mustAsk: boolean
}

/**
 * The contract for each class.
 *
 * A `Record` over the closed union, so the compiler refuses a new class
 * without one. `mayCommitToFuture` is computed from the outcome rather than
 * fixed per class, because the same class can arrive with or without a pending
 * action and the permission belongs to the STATE, not to the label.
 */
const BASE: Record<OutcomeClass, Omit<NarrationContract, 'mayCommitToFuture'>> = {
  completed: { mayClaimCompletion: true, mustNameWhatDidNotHappen: false, mustAsk: false },
  partially_completed: {
    mayClaimCompletion: false,
    mustNameWhatDidNotHappen: true,
    mustAsk: false,
  },
  blocked_needs_user: { mayClaimCompletion: false, mustNameWhatDidNotHappen: true, mustAsk: true },
  blocked_capability: { mayClaimCompletion: false, mustNameWhatDidNotHappen: true, mustAsk: false },
  pending_approval: { mayClaimCompletion: false, mustNameWhatDidNotHappen: false, mustAsk: true },
  failed_after_retries: {
    mayClaimCompletion: false,
    mustNameWhatDidNotHappen: true,
    mustAsk: false,
  },
}

export const contractFor = (c: CanonicalOutcome): NarrationContract => ({
  ...BASE[classifyOutcome(c)],
  mayCommitToFuture: c.pendingActions > 0 || c.awaitingApproval,
})

/**
 * The sentence the office is REQUIRED to say, composed from the rows.
 *
 * Composed rather than policed, which is the difference between this and every
 * gate that came before it. `act()` already proves the shape works — *"Happy
 * to, but this one is not attached to a project, so I have nowhere to put it.
 * Tell me which project and it is done."* is code-composed, always true, and
 * has never needed a detector.
 *
 * Null where the class needs no clause: a completed turn says what it did in
 * the ordinary way, and bolting a state sentence onto it would give Grant a
 * status report on every "thanks".
 *
 * The wording names the gap rather than the mechanism. "I have not added
 * anything" is a fact about his world; "the extractor returned null" is a fact
 * about ours, and #242's lesson is that an internal reference in a sentence a
 * person reads is a defect.
 */
export const sayWhatHappened = (c: CanonicalOutcome): string | null => {
  const cls = classifyOutcome(c)
  const list = (xs: readonly string[]): string =>
    xs.length <= 1
      ? (xs[0] ?? '')
      : `${xs.slice(0, -1).join(', ')} and ${String(xs[xs.length - 1] ?? '')}`

  switch (cls) {
    case 'completed':
      return null
    case 'partially_completed':
      return `That is partly done — ${String(c.landed)} of ${String(c.wanted)}. ${
        c.missing.length > 0
          ? `For the rest I need ${list(c.missing)}.`
          : 'The rest did not go through.'
      }`
    case 'blocked_needs_user':
      /*
        The generic ask is not a worse sentence than a named one — it is the
        true one when nothing is named. Claiming to know what is missing when
        we do not is the same defect as claiming to have done the work.
      */
      if (c.missing.length > 0) return `I have not done this yet — I need ${list(c.missing)}.`
      /*
        Nothing specific to ask for, and he did not ask for work in a form
        the grammar recognises. Then the office owes him nothing extra: the
        clause below is an answer to a request, and this turn was a question
        or a remark that the `other` reading could not tell apart from one.

        Silence here does NOT loosen the contract. The class is unchanged, so
        `mayClaimCompletion` is still false and the backstop still runs - the
        office may say nothing about having done it, it simply does not open
        by announcing that it has not.
      */
      if (!c.asked) return null
      /*
        No promise in it (behavioural remediation, 24 September 2026). The
        earlier sentence ended "say it again in a sentence and I will", which
        is false whenever the reason was a missing capability or a remark
        misread as a request - 290 harness turns carried it in front of
        answers that went on to say, correctly, "I can't send WhatsApp
        messages" or "no further action needed". Repeating a sentence does
        not make a capability exist. What is always true here is that nothing
        was done and nothing changed; the answer after it says why.
      */
      return 'I have not done this yet, and nothing has been changed.'
    case 'blocked_capability':
      return 'I have not done this, and it is not something I can do — so there is nothing to wait for.'
    case 'pending_approval':
      /*
        WAITING ON HIM AND WAITING ON A COLLEAGUE ARE DIFFERENT SENTENCES.

        `awaitingApproval` is a blocker with his name on it; `pendingActions`
        is work already handed to somebody. Telling him that four specialists
        are "waiting on your word" would be false in the expensive direction —
        he would wait for a decision nobody needs, while the office waits for
        him.
      */
      return c.awaitingApproval
        ? 'Nothing has changed yet. It is waiting on your word.'
        : `Nothing has changed yet — I have handed this on${
            c.pendingActions > 1 ? ` in ${String(c.pendingActions)} pieces` : ''
          } and will come back with what comes of it.`
    case 'failed_after_retries':
      return `I could not get this done after ${String(c.attempt)} attempts, and nothing was created. ${
        c.missing.length > 0
          ? `It may go through if I have ${list(c.missing)}.`
          : 'Ask me again and I will retry it.'
      }`
  }
}

/**
 * The classes in which a turn owes Grant a sentence it cannot get from the
 * model.
 *
 * Exported so the handler and the tests read the same list rather than two
 * copies of it — CLAUDE.md records a row list built twice as a list that will
 * disagree.
 */
export const OWES_A_SENTENCE: readonly OutcomeClass[] = [
  'partially_completed',
  'blocked_needs_user',
  'blocked_capability',
  'pending_approval',
  'failed_after_retries',
]
