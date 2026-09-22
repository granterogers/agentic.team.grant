/**
 * Does this answer promise that the OFFICE will do something — #302.
 *
 * The second half of the outcome contract, and deliberately the smaller half.
 * `outcome.ts` decides from canonical rows whether a commitment is PERMITTED;
 * this decides whether the answer contains one. Authority stays with the
 * rows: nothing here is ever consulted unless `mayCommitToFuture` is already
 * false, so a promise backed by a real child job is never even shown to it.
 *
 * ## Why this is not the blacklist the contract exists to avoid
 *
 * A list of ways to say "I'll do it" is missing the next one, always. So the
 * shape is inverted twice over:
 *
 *   - The SUBJECT and the TENSE are closed classes. First person plus a
 *     future marker is how English commits, and neither list grows: there is
 *     no eighth English future modal waiting to be discovered.
 *   - The exemption is the enumeration, not the detection. Everything after
 *     "I'll" is an execution unless it is one of a handful of verbs that
 *     cannot be one — "I'll be brief", "I'll need the project name". A
 *     closed exemption over an open detection is the correction this
 *     repository records six times, in the direction that cannot go stale:
 *     a new way to promise is caught by construction, and the cost of a new
 *     non-action verb is one false positive, visible immediately.
 *
 * ## The five things it must NOT fire on
 *
 * False positives matter as much as misses here, and more in one respect: a
 * gate that refuses good answers is one somebody switches off, which this
 * repository records twice. The cases that must pass:
 *
 *   1. **A legitimate conditional.** *"Tell me which project and I'll add
 *      it."* This is the next action the invariant ASKS for — it depends on
 *      him, so it is not a promise about what the office will do unbidden.
 *      Forbidding it would turn an ask into a dead end.
 *   2. **A request for grounding.** *"Which project should I add it to?"*
 *      No commitment at all.
 *   3. **A capability explanation.** *"I can create tasks, but not send
 *      email."* `can` is not a future marker.
 *   4. **A description of pending work.** Never reaches here, because the
 *      contract permits it — but a sentence about what a CHILD is doing is
 *      not first person about this turn anyway.
 *   5. **Ordinary future talk.** *"The renewal will lapse in March."* Not
 *      first person. *"I'll be brief."* Not an execution.
 */

import { straighten } from './quality.ts'
import { readClause } from './request.ts'

/**
 * How English says "I am going to do this".
 *
 * A closed class, and closed in the strong sense: the set of future markers
 * in English is fixed. `can`, `could`, `may` and `might` are deliberately
 * absent — they express capability or possibility, and a capability
 * explanation is one of the things this must not fire on.
 */
const COMMITS =
  /\b(?:i|we)(?:\s*(?:'|\u2019)\s*ll\b|\s+will\b|\s+shall\b|\s*(?:'|\u2019)?\s*(?:m|am|re|are)\s+(?:going|about)\s+to\b)/i

/**
 * Verbs that cannot be an execution, however they are tensed.
 *
 * The enumeration is HERE rather than on the detection side, so a new way of
 * promising is caught by construction and the only cost of an omission is a
 * false positive somebody sees at once.
 *
 * `have to` and `need` are requests for grounding wearing a future tense —
 * *"I'll need the project name"* is the office asking, which is the behaviour
 * the invariant wants. Bare `have` is NOT here: *"I'll have it ready by
 * Friday"* is a promise.
 */
const NOT_AN_EXECUTION =
  /^\s*(?:be|been|being|need|have\s+to|has\s+to|want|know|think|see|assume|expect|remain|stay|keep\s+that\s+in\s+mind)\b/i

/**
 * What makes a commitment depend on HIM rather than on the office.
 *
 * The whole point of `blocked_needs_user` is to ask, and an ask is only
 * useful if the office may say what happens once he answers. So a commitment
 * inside the scope of a condition he controls is licensed.
 *
 * Both orders, because both are natural: *"if you tell me, I'll add it"* and
 * *"I'll add it once you tell me"*.
 */
const DEPENDS_ON_HIM =
  /\b(?:if|once|when|whenever|as\s+soon\s+as|after|provided|assuming)\b|\b(?:tell|let|give|send|confirm|name|point|say|pick|choose)\s+me\b|\byour\s+(?:word|go[\s-]?ahead|confirmation|answer|steer)\b|\bsay\s+the\s+word\b|\byou\s+(?:tell|let|confirm|name|say|decide|choose|pick)\b/i

/**
 * A subordinator that can license a commitment placed BEFORE it.
 *
 * "I'll add it once you tell me" is the same offer as "once you tell me,
 * I'll add it", so the condition has to be readable in both directions - but
 * only when it is genuinely subordinate. A semicolon is not a subordinator,
 * which is what the third live reproduction turned on: *"I'll create a task
 * titled X; let me know who should own it"* is a promise followed by an
 * unrelated request, and reading the request as the promise's condition
 * licensed the exact sentence this exists to catch.
 */
const SUBORDINATES_AFTER = /^[^.;!?]*\b(?:once|when|if|as\s+soon\s+as|after|provided|assuming)\b/i

/** A promise the canonical state cannot keep. */
export interface UnsupportedCommitment {
  /** The sentence it was found in, for the correction and for the report. */
  readonly clause: string
  /** The marker that made it a commitment, so a finding names its evidence. */
  readonly marker: string
}

/**
 * Split into sentences, keeping it crude on purpose.
 *
 * A commitment lives in one sentence and its licensing condition almost
 * always lives in the same one. Splitting finer would separate *"tell me
 * which project"* from *"and I'll add it"* and turn the clearest legitimate
 * case into a violation.
 */
const sentences = (text: string): readonly string[] =>
  text
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')

/**
 * The first unsupported commitment, or null.
 *
 * Called ONLY where the canonical outcome says a commitment is not
 * permitted. That gate is what makes a short closed-class rule sufficient:
 * it never has to distinguish a real plan from an invented one, because a
 * real plan is never shown to it.
 */
export const unsupportedCommitment = (body: string): UnsupportedCommitment | null => {
  const text = straighten(String(body ?? ''))
  if (text.trim() === '') return null

  for (const sentence of sentences(text)) {
    const m = COMMITS.exec(sentence)
    if (m === null) continue
    const before = sentence.slice(0, m.index)
    const after = sentence.slice(m.index + m[0].length)

    if (NOT_AN_EXECUTION.test(after)) continue

    /*
      A condition he controls, and POSITION decides whether it governs.

      The first version tested the whole sentence, and the third live
      reproduction walked straight through it: *"I'll create a task titled
      X; let me know who should own it"* is a promise followed by an
      unrelated request, and an unpositioned test read the request as the
      promise's condition.

      So a condition licenses only when it is an ANTECEDENT - before the
      commitment - or when it subordinates the commitment from the right
      with a real subordinator. A semicolon is not one.
    */
    if (DEPENDS_ON_HIM.test(before)) continue
    if (SUBORDINATES_AFTER.test(after)) continue

    /*
      And the "do X and I'll do Y" shape, which is the commonest way to
      offer to continue - including in the sentence the office is REQUIRED
      to say: *"say it again in a sentence and I will"*.

      Detected by asking the office's own imperative reader whether the left
      side is an instruction to HIM, rather than by listing the verbs he
      might be asked to perform. A detector that fired on the office's own
      mandated sentence would make the contract unsatisfiable, which is how
      this case was found.
    */
    const joined = /\b(?:and|then)\s*,?\s*$/i.test(before)
    /*
      The LAST clause before the "and", not everything before it.

      The office's own mandated sentence is "I understood what you want and
      could not carry it out - say it again in a sentence and I will", and
      handing the whole left side to the imperative reader gets a mood of
      "not an imperative" because it begins with "I". The clause that
      actually governs is the one next to the conjunction.
    */
    const lastClause = before
      .replace(/\b(?:and|then)\s*,?\s*$/i, '')
      .split(/[\u2014\u2013,;:]|\s-\s/)
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .pop()
    if (joined && lastClause !== undefined && readClause(lastClause).mood === 'ask') continue

    return { clause: sentence.slice(0, 200), marker: m[0].trim() }
  }
  return null
}

/**
 * What to tell the writer when its draft promised something nothing will do.
 *
 * Carries the canonical sentence rather than a scolding, so the rewrite has
 * the truth to build on — and names no issue number, because a message a
 * model reads becomes a message Grant reads.
 */
export const rewriteBecauseNothingIsQueued = (
  truth: string,
  offending: UnsupportedCommitment,
): string =>
  'Your draft says the office is going to do something, and nothing is ' +
  `queued to do it: "${offending.clause}". No work was started, handed on ` +
  'or scheduled by this turn.\n\n' +
  `Rewrite the answer. It must begin with exactly this: "${truth}"\n\n` +
  'Then say what you would need in order to do it, and ask for it. You may ' +
  'say what happens once HE does something — "tell me which project and I ' +
  'will add it" is fine, because it depends on him. You may not say the ' +
  'office is going to do anything on its own, because nothing will.'

/**
 * Hold the answer to what is actually queued, with a bounded rewrite.
 *
 * The loop the invariant needs, and the termination rule is the important
 * part: **regeneration may never turn a failed action into a different
 * unsupported promise.** A model asked to stop promising will cheerfully
 * promise something else, so the loop ends at a sentence composed from the
 * rows rather than at another attempt.
 *
 *   draft -> contains a commitment? -> rewrite once -> still? -> the TRUTH
 *
 * One rewrite, not several. A second costs another model call for a smaller
 * chance of a clean answer, and the deterministic fallback is already
 * correct - so more attempts buy prose, not honesty, and this repository
 * records what an unbounded retry loop costs when the thing it retries
 * cannot get better on its own.
 *
 * `rewrite` is injected so the whole loop is testable without a model, and
 * so the termination property can be proved against a rewriter that is
 * adversarial by construction.
 */
/**
 * Whichever half of the contract this answer breaks, or null.
 *
 * One entry point, so the handler cannot enforce the future tense and forget
 * the past — which is exactly what happened: `mayClaimCompletion` had been on
 * the contract since it was written with nothing reading it, and the sweep
 * found the office claiming two operations that never happened.
 *
 * A permission that nothing enforces is the defaulted-parameter defect in
 * another costume, and this repository records four of those.
 */
export const misrepresents = (
  draft: string,
  may: { readonly mayCommitToFuture: boolean; readonly mayClaimCompletion: boolean },
): UnsupportedCommitment | null =>
  (may.mayCommitToFuture ? null : unsupportedCommitment(draft)) ??
  (may.mayClaimCompletion ? null : claimsCompletion(draft))

export const heldToWhatIsQueued = async (
  draft: string,
  /** The sentence composed from canonical state, or null where none is owed. */
  truth: string | null,
  rewrite: (instruction: string) => Promise<string>,
  /** What the rows permit. Both halves, so neither can be forgotten. */
  may: { readonly mayCommitToFuture: boolean; readonly mayClaimCompletion: boolean },
): Promise<{ readonly answer: string; readonly outcome: 'clean' | 'rewritten' | 'fell_back' }> => {
  const first = misrepresents(draft, may)
  if (first === null) return { answer: draft, outcome: 'clean' }

  const second = await rewrite(rewriteBecauseNothingIsQueued(truth ?? '', first)).catch(() => '')
  if (second.trim() !== '' && misrepresents(second, may) === null) {
    return { answer: second.trim(), outcome: 'rewritten' }
  }

  /*
    The terminal state is the TRUTH, never a third attempt.

    Where a sentence is owed, it is the whole answer: composed from the
    rows, so it cannot promise anything.

    Where none is owed - a COMPLETED turn whose answer trailed a promise
    about extra work - there is nothing to fall back to, and going silent
    would lose the true report of work that really was done. So the
    offending sentences are REMOVED rather than rewritten. That is
    deletion, not paraphrase: the detector already names the exact
    sentence, nothing is invented in its place, and the invariant holds
    unconditionally - if the rows say nothing is coming, the answer does
    not say something is.
  */
  if (truth !== null) return { answer: truth, outcome: 'fell_back' }
  return { answer: withoutCommitments(draft, may), outcome: 'fell_back' }
}

/**
 * The draft with every unsupported commitment taken out of it.
 *
 * Sentence-wise and iterative, because removing one can reveal another, and
 * bounded by the sentence count so it always terminates. Falls back to the
 * draft only if removal would leave nothing at all — an empty answer is the
 * #302 symptom this whole change exists to end.
 */
const withoutCommitments = (draft: string, may: Parameters<typeof misrepresents>[1]): string => {
  const kept = sentences(straighten(draft)).filter((s) => misrepresents(s, may) === null)
  const joined = kept.join(' ').trim()
  return joined === '' ? draft : joined
}

/**
 * Does this answer report that the office ALREADY did something — #302, the
 * past-tense half.
 *
 * `mayClaimCompletion` has been on the contract since it was written and
 * nothing enforced it. The durability sweep found what that costs:
 *
 *     turn 1: "Added 'book venue' to the coaching project and moved
 *              'write welcome pack' to the Match Funding Bid project."
 *     turn 2: "I haven't created any tasks yet, so there's nothing to list."
 *
 * Zero tasks and zero child jobs on both. The office told him two opposite
 * things one turn apart, and at most one of them could be true.
 *
 * ## Why `claimsToHaveMade` could not see it
 *
 * It requires a creation VERB **and** an artifact NOUN — task, note,
 * document, reminder. The sentence above names the thing by its TITLE
 * instead, so the noun never appears and the detector is blind by
 * construction. That is the enumeration failure this repository records six
 * times, in the direction that cannot be patched: the set of things a person
 * might ask to be created is open, and a list of nouns will always be one
 * short.
 *
 * So the noun requirement is dropped. What is left is the closed part: a
 * verb that means brought-into-existence or put-somewhere, in the past, with
 * the office as the agent. The set of such verbs is small and stable in a
 * way that the set of THINGS is not — and where it is wrong, it is wrong by
 * one false positive that somebody sees immediately.
 *
 * Consulted only where `mayClaimCompletion` is false, so an office that
 * really did the work is never shown it.
 */
const DID_IT =
  /(?:^|[.!?]\s+|\b(?:i|we)\s+(?:have\s+|'ve\s+|just\s+)?)(?:created|added|filed|logged|made|drafted|scheduled|booked|saved|moved|put|set\s+up|opened|started|sent|posted|assigned|updated|renamed|deleted|removed)\b/i

/**
 * What takes the claim back out of the past.
 *
 * Negation first, because the composed sentence and the honest answer are
 * both negated — *"I have not done this"*, *"I haven't created any tasks
 * yet"* — and a detector that fired on those would refuse the office for
 * telling the truth.
 */
const NOT_A_CLAIM =
  /\b(?:not|never|n't|nothing|no)\b|\bcould\s+not\b|\bcannot\b|\bwithout\b|\?\s*$|\b(?:if|once|when|would|could|should|shall\s+i|want\s+me\s+to|like\s+me\s+to)\b/i

/**
 * The first sentence that reports work the rows do not show.
 *
 * Sentence by sentence, so an answer that truthfully says what it did NOT do
 * and then claims something else is caught on the second sentence rather
 * than excused by the first. That ordering is the actual live case: the
 * composed truth led, and the claim followed it.
 */
export const claimsCompletion = (body: string): UnsupportedCommitment | null => {
  const text = straighten(String(body ?? ''))
  if (text.trim() === '') return null
  for (const sentence of sentences(text)) {
    const m = DID_IT.exec(sentence)
    if (m === null) continue
    if (NOT_A_CLAIM.test(sentence)) continue
    return { clause: sentence.slice(0, 200), marker: m[0].trim() }
  }
  return null
}
