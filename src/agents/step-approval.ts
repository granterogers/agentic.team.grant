/**
 * What a plan step's approval is ABOUT (COS-092, COS-093; Canary incident 15 October 2026).
 *
 * An approval answers the question "may the office do THIS?". The fingerprint is how the database
 * recognises "this" again when the question comes back. It must change when the work changes, and must
 * NOT change when the planner merely says the same work in other words.
 *
 * The defect this module removes: the fingerprint used to contain the step's id (its POSITION in the
 * plan, `s3`) and its `why` (the planner's prose). Every time the plan was regenerated, the same step
 * arrived with a new id or new wording, so the fingerprint changed, the approval given a moment earlier
 * no longer matched, and the office asked again. Nothing about the work had changed.
 *
 * What an approval is consent to (#131, spec 11.10). The identity is:
 *   - the capability (the kind of effect),
 *   - the project it happens in,
 *   - who acts (`specialist`) and who it reaches (`audience`),
 *   - the inputs it acts on (`needs`),
 *   - the step's reason (`why`) when the work reaches outside the office or Grant himself (DEC-014). There the
 *     words are the content he agreed to: an approval given to "email the caterer about the allergy" must not carry
 *     to "email the caterer about cancelling". Internal work does not bind its reason, so a planner that rewords the
 *     same internal effect is not asked again,
 *   - when the step gives no reason at all, the request, because then the request is the only statement of the work.
 *
 * NOT part of the identity: the step's `id`, which is its position in one plan, and, for internal work, its reason.
 * Removing the id was the first half of the fix (DEC-011). Binding no reason for internal work is the second (DEC-014).
 * Making outside-facing reasons canonical is a follow-up that needs evidence of how plans are regenerated (COS-091).
 *
 * The LEGACY shape is the one written by every question raised before this module existed. It is still
 * consulted, so an approval given under it keeps matching. Nothing already answered is re-asked.
 */
import { fingerprint } from '../jobs/checkpoint.ts'

export interface StepForApproval {
  readonly id: string
  readonly capability: string
  readonly why: string
  readonly needs: readonly string[]
  /** Who the output is for. Null is a value to fingerprint, not an absence. */
  readonly audience: string | null
  /** Null when the work belongs to nobody in particular; a null is a value to fingerprint, not an absence. */
  readonly specialist: string | null
}

export interface StepApprovalContext {
  readonly step: StepForApproval
  /** Null when the plan has no project; the approval is then about the office, not a project. */
  readonly projectId: string | null
  readonly request: string
}

/** The material scope of a step. This is what a new approval is recorded against. */
/**
 * Internal work (audience `office`) is bound to what it IS, not to how the planner described it. Its reason is
 * prose that a regenerated plan rewords for the same effect, and the effect is reversible inside the office.
 * Work that reaches somebody outside, or Grant himself, keeps its reason: there the words are the content he agreed
 * to (DEC-014). A missing audience is treated as outside, so the conservative binding is the default.
 */
export const stepActionBinds = ({ step, projectId, request }: StepApprovalContext) => ({
  capability: step.capability,
  project: projectId,
  audience: step.audience,
  specialist: step.specialist,
  needs: [...step.needs],
  ...(step.audience === 'office' ? {} : { why: step.why }),
  ...(step.why.trim() === '' ? { request: request.slice(0, 400) } : {}),
})

/**
 * The shape every question was fingerprinted with before this module: the planner's position and wording included.
 * Kept only so an approval given under it still matches. Never used to record a new question.
 */
export const stepLegacyBinds = ({ step, projectId, request }: StepApprovalContext) => ({
  step: `${step.id}:${step.capability}`,
  capability: step.capability,
  project: projectId,
  why: step.why,
  needs: [...step.needs],
  audience: step.audience,
  specialist: step.specialist,
  ...(step.why.trim() === '' ? { request: request.slice(0, 400) } : {}),
})

/**
 * The oldest shape (questions raised before migration 0611): the position, capability, project, reason and inputs,
 * without audience, specialist or request. Consulted only when neither of the newer shapes has an answer, so an
 * answer given to a pre-0611 question still decides the step (DEC-015).
 */
export const stepOldestBinds = ({ step, projectId }: StepApprovalContext) => ({
  step: `${step.id}:${step.capability}`,
  capability: step.capability,
  project: projectId,
  why: step.why,
  needs: [...step.needs],
})

export const stepOldestFingerprint = (ctx: StepApprovalContext): Promise<string> =>
  fingerprint(stepOldestBinds(ctx))

export const stepActionFingerprint = (ctx: StepApprovalContext): Promise<string> =>
  fingerprint(stepActionBinds(ctx))

export const stepLegacyFingerprint = (ctx: StepApprovalContext): Promise<string> =>
  fingerprint(stepLegacyBinds(ctx))
