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
