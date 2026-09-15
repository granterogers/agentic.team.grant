/**
 * The quality gate (§10, §16).
 *
 * §16: *"no substantive output bypasses review."* The invariants note what
 * makes that sentence usable rather than decorative:
 *
 *   *"The word 'substantive' needs a hard definition, or the gate is decided
 *   ad hoc."*
 *
 * and the definition it settles on is about provenance, not importance:
 *
 *   *"the exemption must be defined by how the answer was produced -
 *   deterministic code path vs. inference - because THAT IS CHECKABLE, whereas
 *   'was it important?' is not."*
 *
 * So the question this module answers is never "does this matter?". It is
 * "where did this come from?", which has an answer the database can verify —
 * and 0023 does verify it, refusing a `deterministic` claim from any job with
 * recorded inference usage.
 *
 * ## What this module is not
 *
 * It is not the enforcement. The enforcement is the 0018 trigger on `jobs`,
 * which refuses `committed` while any non-deterministic output is unreviewed.
 * This module decides what to *send* to review and what a review must record.
 * If it were the only thing standing between an output and a commit, §10's
 * *"the gate cannot be bypassed by the caller"* would be false the moment
 * someone wrote a second caller.
 */

/** How an output was produced. The only input the exemption is allowed to read. */
export const PRODUCTION_PATHS = [
  /** A model wrote it. Always substantive. */
  'inference',
  /** Code produced it with no model call — a status read, a count, a list. */
  'deterministic_retrieval',
  /** Code reshaped material that was already reviewed. */
  'mechanical_transformation',
  /** Words lifted verbatim from output that has already passed review. */
  'quoted_from_reviewed',
] as const

export type ProductionPath = (typeof PRODUCTION_PATHS)[number]

/**
 * What the output does, which decides review only when the path is ambiguous.
 *
 * The invariants list these explicitly under "Requires review", and they are
 * kept as data rather than prose so that adding a kind is a visible change.
 */
export const SUBSTANTIVE_KINDS = [
  'research_conclusion',
  'strategy',
  'recommendation',
  'project_change_from_inference',
  'external_source_introduced',
  'notebook_write',
] as const

export type OutputKind =
  | (typeof SUBSTANTIVE_KINDS)[number]
  | 'status'
  | 'task_list'
  | 'calendar_read'
  | 'restatement'

export interface ReviewDecision {
  readonly required: boolean
  /** `false` when the output may be recorded as `deterministic` in the database. */
  readonly exempt: boolean
  readonly reason: string
}

/**
 * Does this output need review?
 *
 * Reads the production path first and the kind second, in that order and not
 * the other way round. A `status` produced by a model is still a model's
 * words: §16's whole point is that provenance decides, because provenance is
 * the part that can be checked.
 */
export const reviewRequired = (input: {
  readonly path: ProductionPath
  readonly kind: OutputKind
}): ReviewDecision => {
  if (input.path === 'inference') {
    return {
      required: true,
      exempt: false,
      reason:
        'a model produced this, so it is substantive by §16 regardless of what ' + 'it is about',
    }
  }

  // Below here no model was involved, so the exemption is available. It is
  // still withheld for the kinds that introduce material from outside or write
  // somewhere - those change what the system believes, and a mechanical path
  // into a wrong belief is still a wrong belief.
  if (
    input.kind === 'external_source_introduced' ||
    input.kind === 'notebook_write' ||
    input.kind === 'project_change_from_inference'
  ) {
    return {
      required: true,
      exempt: false,
      reason: `${input.kind} introduces or writes material, so it is reviewed even on a ${input.path} path`,
    }
  }

  return {
    required: false,
    exempt: true,
    reason: `${input.path} with no model call, and ${input.kind} neither introduces nor writes material`,
  }
}

// ---------------------------------------------------------------------------
// The metadata a review must carry
// ---------------------------------------------------------------------------

export type Confidence = 'low' | 'medium' | 'high'
export type Evidence = 'verified' | 'inferred' | 'speculative'
export type ReviewerStatus =
  | 'pending'
  | 'approved'
  | 'approved_with_reservations'
  | 'rejected'
  | 'needs_revision'

export interface OutputMetadata {
  readonly confidence: Confidence
  readonly evidence: Evidence
  readonly sources: readonly string[]
  readonly contradictions: string | null
  /**
   * What the agent actually WROTE.
   *
   * Optional so every existing caller keeps compiling, and supplied by the
   * worker — which is the only caller — so the check below is live. See
   * `claimsToHaveRead` for why the body has to be in here at all.
   */
  readonly body?: string
  /**
   * How many things this job actually DID — child jobs, tasks, consultations.
   *
   * Supplied by the worker, which is the only caller that can count them.
   * Absent means "not counted", and an absent count never accuses anybody:
   * the action check below only fires on the claims that are false by
   * CONSTRUCTION, plus the ones this number can disprove.
   */
  readonly acted?: number
}

export interface MetadataProblem {
  readonly field: string
  readonly problem: string
}

/**
 * Check the §16 metadata for the combinations that are not coherent.
 *
 * Not a schema check — the database has those. These are the pairings that
 * satisfy every column constraint individually and still describe something
 * impossible, which is how a confident-sounding guess gets published.
 */
/**
 * Does this text claim, in the first person, to have SENT something?
 *
 * #237. A voice note produced this, and Grant would have believed it:
 *
 *     "I've posted a Slack message to the team asking what's blocking
 *      onboarding. We need their input before we decide anything else.
 *      A Slack message is going out right now."
 *
 * `deliveries` for that job: **zero**. Child jobs: **zero**. Nobody was
 * contacted, and he would have sat waiting for replies from a team that was
 * never asked.
 *
 * ## Why this one can be strict where `claimsToHaveRead` must be narrow
 *
 * An agent answering an instruction has NO outbound path. The office's only
 * way out is the notifier, which runs after the output exists and is the
 * thing that turns this very answer into a message. So a first-person claim
 * to have already posted, sent, emailed or messaged somebody is false at the
 * moment it is written, every time, by construction — there is nothing to
 * check it against because there is nothing it could be true of.
 *
 * Future tense is left alone. "I'll ask the team" is a plan, and §9's hand-off
 * makes plans like that real; "I have asked the team" is a claim about the
 * past that nothing performed.
 */
export const claimsToHaveSent = (body: string): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const claims: RegExp[] = [
    /\bI(?:'ve|\s+have)?\s+(?:just\s+)?(?:posted|sent|messaged|emailed|e-mailed|pinged|notified|forwarded)\b[^.!?]{0,60}/i,
    /\b(?:a|the)\s+(?:slack\s+message|message|email|note)\s+(?:is|has)\s+(?:going|gone|been)\s+(?:out|sent)\b[^.!?]{0,60}/i,
    /\bI\s+(?:have\s+)?(?:asked|contacted|reached\s+out\s+to)\s+(?:the\s+)?(?:team|everyone|them|him|her|\w+)\s+(?:on|in|via|over)\s+(?:slack|telegram|email)\b[^.!?]{0,60}/i,
  ]
  for (const re of claims) {
    const hit = re.exec(text)
    if (hit !== null) return hit[0].trim().slice(0, 80)
  }
  return null
}

/**
 * Does this text claim, in the first person, to have gone and looked?
 *
 * Returns the phrase it found, so the failure can quote it back rather than
 * saying "something in here". Null when it makes no such claim.
 *
 * ## Deliberately narrow
 *
 * It matches a small set of verbs in the FIRST PERSON or attached to a named
 * retrieval — "I pulled", "the db read shows", "I queried". It does not match
 * "the records show", "according to the brief", or any of the hundred ways a
 * sentence can imply a source without asserting an action, because a check
 * that fires on those would fire on almost every honest summary and be turned
 * off within a week.
 *
 * The bar is: **would a person reading this believe a lookup happened?** Not:
 * does this mention data.
 *
 * False negatives are expected and acceptable. A false POSITIVE fails a job
 * that was fine, so the list stays short and grows only when a real message
 * gets past it.
 */
export const claimsToHaveRead = (body: string): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const claims: RegExp[] = [
    // First person, past tense, retrieval verb.
    /\bI\s+(?:pulled|queried|fetched|retrieved|looked\s+up|ran\s+a?\s*quer\w+|checked\s+the\s+(?:db|database|table))\b[^.!?]{0,60}/i,
    /\bI(?:'ve|\s+have)\s+(?:pulled|queried|fetched|retrieved|read)\b[^.!?]{0,60}/i,
    /*
      First person, a looking verb, and one of the office's OWN sources named.

      Added because a real message got past the list, which is the only reason
      this header permits growing it. #237's contradictions session produced:

        "I checked the notebook, our docs, GitHub and the mail folder, but I
         have nothing on it here..."

      from an output whose evidence was `inferred` — four named lookups, none
      of which happened, in a sentence whose second half is honest. "I pulled"
      was caught and "I checked the notebook" was not, which is a distinction
      no reader would make.

      Kept narrow by naming the SOURCES rather than widening the verbs: "I
      checked the maths" and "I reviewed your proposal" still match nothing,
      and "the records show" still matches nothing because it asserts no
      action. The bar is unchanged — would a person reading this believe a
      lookup happened.
    */
    /\bI\s+(?:checked|searched|reviewed|read|looked\s+(?:at|through|in)|went\s+through|had\s+a\s+look\s+(?:at|in))\s+(?:the\s+|our\s+|your\s+)?(?:notebook|notebooklm|documents?|docs?|drive|github|repo|mail|inbox|gmail|email|calendar|notion|records?|files?|corpus|sources?|attachments?)\b[^.!?]{0,60}/i,
    // The system named as the actor of a read.
    /\bthe\s+(?:db|database|table|query|record)\s+(?:read|query|results?)\s+shows?\b[^.!?]{0,60}/i,
    /\b(?:db|database)\s+read\s+shows?\b[^.!?]{0,60}/i,
    /\baccording\s+to\s+the\s+(?:db|database)\b[^.!?]{0,60}/i,
  ]
  for (const re of claims) {
    const hit = re.exec(text)
    if (hit !== null) return hit[0].trim().slice(0, 80)
  }
  return null
}

export const metadataProblems = (m: OutputMetadata): readonly MetadataProblem[] => {
  const problems: MetadataProblem[] = []

  if (m.evidence === 'verified' && m.sources.length === 0) {
    problems.push({
      field: 'sources',
      problem:
        'evidence is "verified" with no sources. Verified means someone can go ' +
        'and check; with nothing to check, the correct label is inferred.',
    })
  }

  /*
    A citation that is not an address (#185).

    "verified with no sources" was already refused above; this is the same rule
    one step in, because a model that has been told it must cite something
    writes "the project records" and satisfies a length check. Every handler in
    `src/handlers` writes `<scheme>:<ref>`, so the shape is the office's own and
    not an invention of this check. Caught here as well as on the sending path
    so a job fails while somebody can still act on it, rather than producing
    something that is refused at the last moment.
  */
  if (m.evidence === 'verified' && m.sources.length > 0) {
    const bad = unresolvableSources(m.sources)
    if (bad.length > 0) {
      problems.push({
        field: 'sources',
        problem:
          `${bad.length} of ${m.sources.length} citations are not addresses ` +
          `(${bad
            .map((b) => `"${String(b).slice(0, 40)}"`)
            .join(', ')
            .slice(0, 160)}). ` +
          'A source is where somebody goes to check, so it needs a scheme and a ' +
          'reference, not a description.',
      })
    }
  }

  if (m.evidence === 'speculative' && m.confidence === 'high') {
    problems.push({
      field: 'confidence',
      problem:
        'high confidence in a speculative finding. §12 exists to keep these ' +
        'apart, and this pairing is what it looks like when they are conflated.',
    })
  }

  /*
    A claim of having READ, from an output that read nothing (#185).

    On 13 September Claire sent Grant this, at 03:45, on his phone:

      "I pulled the project records. The db read shows five active projects:
       mtz08joe, mtyz6js5, mtyyz7zy, mtyywoxz and mty9izdi."

    None of the five existed. The office had recorded `evidence: inferred` —
    it knew perfectly well that nothing had been read — and rendered that as
    small grey text UNDER a sentence claiming a database read. The footer was
    honest and the message was not, and the message is the part a person reads.

    So this is not the "a model hallucinated" problem, which no check can
    solve. It is that the output CONTRADICTED ITS OWN METADATA and nothing
    compared the two. That is checkable, cheaply, and it is what this does.

    The same model did it twice, five days apart, and it reached Grant both
    times.
  */
  /*
    A claim of having SENT something, from a job that sent nothing (#237).

    Strict, and it can afford to be: an agent answering an instruction has no
    outbound path at all. The notifier is the office's only way out and it runs
    after this, on this very answer. So "I've posted a Slack message to the
    team" is false at the moment it is written, every time.

    Worse than a fabricated read, which is why it is here: a fabricated read
    produces a wrong answer Grant can argue with, and a fabricated send leaves
    him waiting on people who were never asked.
  */
  const sentClaim = claimsToHaveSent(m.body ?? '')
  if (sentClaim !== null) {
    problems.push({
      field: 'body',
      problem:
        `the text says it sent something ("${sentClaim}"), and an agent answering an ` +
        'instruction has no way to send anything — the notifier runs after this, on ' +
        'this answer. Nobody was contacted. Say what you WILL do, or hand the work ' +
        'over, but do not report a message that does not exist (#237).',
    })
  }

  const readClaim = claimsToHaveRead(m.body ?? '')
  if (readClaim !== null && (m.evidence === 'inferred' || m.evidence === 'speculative')) {
    problems.push({
      field: 'body',
      problem:
        `the text claims to have read something ("${readClaim}") while evidence is ` +
        `"${m.evidence}", which means nothing was read. One of the two is wrong, and ` +
        'the sentence is the half Grant sees (#185).',
    })
  }

  if (m.contradictions !== null && m.contradictions.trim() !== '' && m.confidence === 'high') {
    // The averaging failure, caught at its source. An output that names a
    // material disagreement and then reports high confidence has resolved the
    // disagreement silently - which §16 forbids.
    problems.push({
      field: 'confidence',
      problem:
        'high confidence alongside recorded contradictions. §16 forbids ' +
        'resolving disagreement by averaging; if the contradiction is real the ' +
        'confidence is not high, and if it is not real it should not be recorded.',
    })
  }

  return problems
}

/**
 * Does this review need Grant told about it?
 *
 * §16: *"The output carries both positions; Grant is notified when it
 * matters."* "When it matters" is the part that needs a rule, and the rule is
 * that a disagreement which survived review is exactly the thing a human
 * should see — a reviewer who could resolve it would have.
 */
export const disagreementNeedsGrant = (input: {
  readonly status: ReviewerStatus
  readonly contradictions: string | null
}): boolean => {
  const hasContradiction = input.contradictions !== null && input.contradictions.trim() !== ''
  if (!hasContradiction) return false
  return input.status === 'approved' || input.status === 'approved_with_reservations'
}

/**
 * The statuses that let a job proceed toward `committed`.
 *
 * Mirrors the 0018 trigger. Duplicated deliberately, and the duplication is
 * the point: if this list and the trigger ever disagree, the trigger wins and
 * the caller gets an error — which is the correct direction for a gate to fail.
 */
export const COMMITTABLE_STATUSES: readonly ReviewerStatus[] = [
  'approved',
  'approved_with_reservations',
]

export const canCommit = (statuses: readonly ReviewerStatus[]): boolean =>
  statuses.length === 0 || statuses.every((s) => COMMITTABLE_STATUSES.includes(s))

// ---------------------------------------------------------------------------
// What must not reach a person (#185)
// ---------------------------------------------------------------------------

/*
  `metadataProblems` runs when an output is CREATED. That is the right place to
  catch an incoherent output and it is not the last place it can be caught,
  because it is not the place a person is reached from.

  Two paths reach a channel without passing through output creation:

    - `resumeNotifications` rebuilds an output from its stored row and sends
      it. A row written before this rule existed goes out unexamined.
    - Anything that comes to hold `notifying` by recovery rather than by
      running.

  #185's third box says the check belongs on the SENDING path for exactly that
  reason, so this is the guard `combinedNotifier` consults, once, for every
  channel.

  ## Deliberately narrower than `metadataProblems`

  It refuses the two things that are LIES TO THE READER — a claim of having
  looked from an output that did not, and a claim of verification with nothing
  behind it. It does not refuse the judgement pairings (high confidence on a
  speculative finding, high confidence alongside contradictions). Those are
  real defects and they are already refused at creation; refusing them again
  here would mean a job that ran, produced something usable and then said
  nothing at all, which is how a send guard gets turned off.

  The bar for this list is: **would a person, reading only the message, believe
  something that did not happen?**
*/

/** Why an output was not sent, and the handle #49 counts it under. */
export interface SendRefusal {
  readonly reason: string
  /** Lower-case, no spaces — `job_impediments.needed` groups on it. */
  readonly needed: string
}

/**
 * The citations that are not addresses.
 *
 * Shape only, and a SHAPE rather than a list. Every handler in `src/handlers`
 * writes `<scheme>:<ref>` — `job:<uuid>`, `google:calendar`,
 * `notebooklm:<id>`, `db:projects` — so the form is the office's own. What
 * this rejects is prose: "the project records", "internal notes", "5 sources".
 * The five fabricated project names in #185 arrived alongside a source count,
 * and a count is the only thing about a citation that cannot be checked.
 *
 * **A list of permitted schemes would be the wrong check**, and the first
 * version of this was one: it refused `db:projects`, which is a perfectly good
 * address, because nobody had thought to write `db` down. A whitelist here
 * fails whenever the office grows a source it did not have, and it fails by
 * refusing to speak — which is the expensive direction. The scheme therefore
 * only has to LOOK like a scheme: lower-case, no spaces, something after the
 * colon.
 *
 * False negatives are expected, for the same reason `claimsToHaveRead` accepts
 * them. A false positive silences a job that was fine.
 */
const SCHEME = /^[a-z][a-z0-9_+.-]*$/

export const unresolvableSources = (sources: readonly string[]): readonly string[] =>
  sources.filter((raw) => {
    const s = String(raw ?? '')
    const at = s.indexOf(':')
    if (at < 1) return true
    return !SCHEME.test(s.slice(0, at)) || s.slice(at + 1).trim() === ''
  })

export const refuseToSend = (m: OutputMetadata): SendRefusal | null => {
  const readClaim = claimsToHaveRead(m.body ?? '')
  if (readClaim !== null && (m.evidence === 'inferred' || m.evidence === 'speculative')) {
    return {
      needed: 'evidence for a claimed read',
      reason:
        `the message says "${readClaim}" while the output records evidence ` +
        `"${m.evidence}", which means nothing was read. The sentence is the half ` +
        'a person believes, so it is not sent (#185).',
    }
  }

  if (m.evidence === 'verified') {
    if (m.sources.length === 0) {
      return {
        needed: 'a source that resolves',
        reason:
          'the output claims verified evidence and cites nothing. Verified means ' +
          'somebody can go and check, and there is nowhere to go (#185).',
      }
    }
    const bad = unresolvableSources(m.sources)
    if (bad.length > 0) {
      return {
        needed: 'a source that resolves',
        reason:
          `the output claims verified evidence and ${bad.length} of its ` +
          `${m.sources.length} citations are not addresses: ${bad
            .map((b) => `"${String(b).slice(0, 40)}"`)
            .join(', ')
            .slice(0, 200)} (#185).`,
      }
    }
  }

  return null
}
