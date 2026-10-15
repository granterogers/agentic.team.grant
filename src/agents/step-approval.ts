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
 *   - the step's reason (`why`), which is what Grant reads when he agrees to it. Content, not wording
 *     trivia: an approval given to "email the caterer about the allergy" must not carry to "email the caterer
 *     about cancelling", even though both are the same capability with the same inputs,
 *   - when the step gives no reason at all, the request, because then the request is the only statement of the work.
 *
 * NOT part of the identity: the step's `id`. That is its position in one plan, and a regenerated plan renumbers
 * the same work. Removing the id is the proven part of the fix; the reason stays bound (DEC-011), so a planner
 * that rewords the reason is still asked once more. Making `why` canonical is a follow-up that needs evidence
 * of how plans are regenerated in production (COS-091).
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
export const stepActionBinds = ({ step, projectId, request }: StepApprovalContext) => ({
  capability: step.capability,
  project: projectId,
  audience: step.audience,
  specialist: step.specialist,
  needs: [...step.needs],
  why: step.why,
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

export const stepActionFingerprint = (ctx: StepApprovalContext): Promise<string> =>
  fingerprint(stepActionBinds(ctx))

export const stepLegacyFingerprint = (ctx: StepApprovalContext): Promise<string> =>
  fingerprint(stepLegacyBinds(ctx))
