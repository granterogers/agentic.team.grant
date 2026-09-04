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
