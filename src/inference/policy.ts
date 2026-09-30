/**
 * What happens when inference cannot be had.
 *
 * Gate 5's acceptance is not only "no paid call". It is:
 *
 *   "no paid call, non-urgent work queues, blocked urgent work raises a
 *    blocker, local usage records stay correct. **Enforced by deterministic
 *    code, not by a prompt.**"
 *
 * The emphasis in the spec is the whole reason this file exists rather than a
 * system-prompt paragraph. The decision is a pure function of the failure and
 * the job, so it is testable, and it cannot be talked out of its answer.
 *
 * The classification deliberately separates two things that look alike in a
 * stack trace and are opposites operationally:
 *
 *   - *transient* — the provider is down, throttled, or unreachable. Retrying
 *     later is likely to work. Non-urgent work should simply wait.
 *   - *systemic* — the request would have cost money, or the model is not on
 *     the measured-free allow-list. Retrying changes nothing, because the
 *     enforcement layers will refuse it again for the same reason. Waiting is
 *     not a strategy; a human has to look.
 *
 * Treating a systemic refusal as transient is the failure mode that matters:
 * a job would sit in `retrying` forever, its retry budget would drain, and the
 * PaidCallPreventedError — a defect report — would be silently absorbed as
 * "provider trouble".
 */

import { PaidCallPreventedError } from '../providers/guards.ts'
import {
  EmptyCompletionError,
  NoUsableModelError,
  ProviderUnavailableError,
} from '../providers/router.ts'

/** Where a failed inference attempt is recorded in `inference_usage.outcome`. */
export type UsageOutcome =
  | 'ok'
  | 'empty_completion'
  | 'provider_error'
  | 'rate_limited'
  | 'transport_error'
  | 'malformed_response'
  | 'refused_paid'
  | 'unavailable'

export type FailureNature = 'transient' | 'systemic'

export interface FailureClassification {
  readonly nature: FailureNature
  readonly outcome: UsageOutcome
  /** Short, non-secret, safe to store and to show. */
  readonly summary: string
}

/**
 * A rate-limit response arrives as a generic provider error carrying a code.
 * Matching on the code rather than the message keeps this independent of
 * provider wording, which changes without notice.
 */
const RATE_LIMIT_CODES = new Set([429])

const rateLimited = (message: string): boolean => {
  for (const code of RATE_LIMIT_CODES) if (message.includes(String(code))) return true
  return /rate.?limit|too many requests|quota/i.test(message)
}

/**
 * Classify a thrown error from the router.
 *
 * Anything unrecognised is `transient`. That is the deliberate default: an
 * unknown error is not evidence that a human must be paged, and the urgent path
 * below still raises a blocker for work that actually cannot wait. Defaulting
 * the other way would page Grant for every novel provider hiccup, which §12's
 * "prevents random agent messages from becoming the approval system" rules out
 * as surely as it rules out a missing blocker.
 */
export const classifyFailure = (error: unknown): FailureClassification => {
  if (error instanceof PaidCallPreventedError) {
    return {
      nature: 'systemic',
      outcome: 'refused_paid',
      // The enforcement layers refused this. Retrying reaches the same refusal,
      // so this is a defect to surface, not a delay to wait out.
      summary: 'a guard refused the call because it was not provably free',
    }
  }

  if (error instanceof NoUsableModelError) {
    return {
      nature: 'systemic',
      outcome: 'unavailable',
      // Every free endpoint is refusing us, or discovery has never run. Both
      // need a human; neither improves by itself.
      summary: 'no model is currently measured as usable',
    }
  }

  if (error instanceof ProviderUnavailableError) {
    return {
      nature: 'transient',
      outcome: 'unavailable',
      summary: `provider ${error.provider} circuit breaker is open`,
    }
  }

  if (error instanceof EmptyCompletionError) {
    // The call worked and cost nothing; the budget was wrong. A retry with a
    // larger budget is a real prospect, so this is transient.
    return {
      nature: 'transient',
      outcome: 'empty_completion',
      summary: `${error.model} returned no content (finish_reason=${error.finishReason})`,
    }
  }

  if (error instanceof SyntaxError) {
    // `response.json()` threw: the provider sent something that is not JSON.
    // Transient, because the next response usually is.
    return {
      nature: 'transient',
      outcome: 'malformed_response',
      summary: 'provider response was not valid JSON',
    }
  }

  const message = error instanceof Error ? error.message : String(error)

  if (rateLimited(message)) {
    return { nature: 'transient', outcome: 'rate_limited', summary: 'provider rate-limited us' }
  }

  if (/provider .* refused:/.test(message)) {
    return {
      nature: 'transient',
      outcome: 'provider_error',
      summary: 'provider refused the request',
    }
  }

  return {
    nature: 'transient',
    outcome: 'transport_error',
    summary: 'inference call failed before a response was read',
  }
}

export interface JobContext {
  readonly jobId: string
  readonly correlationId: string
  readonly projectId?: string | undefined
  readonly priority: number
  readonly attempt: number
  readonly maxAttempts: number
  readonly kind: string
  readonly recipientAgent?: string | undefined
}

export type Disposition =
  | { readonly action: 'retry'; readonly reason: string }
  | { readonly action: 'queue'; readonly reason: string }
  | { readonly action: 'blocker'; readonly reason: string; readonly blocker: BlockerDraft }

export interface BlockerDraft {
  readonly requestedAction: string
  readonly whyNeeded: string
  readonly consequencesOfDelay: string
  readonly approvalOptions: readonly string[]
  readonly originatingAgent: string
  readonly workCanContinue: boolean
  readonly projectId?: string | undefined
  readonly jobId: string
  /**
   * The capability answering `standingOption` authorizes from now on (#15).
   *
   * Both or neither — a CHECK on `public.blockers` enforces it, because a tool
   * with no option is a permission nobody can grant and an option with no tool
   * is a button that does nothing.
   *
   * Named rather than parsed: `approvalOptions` is free text a handler writes
   * in whatever English reads best, and deciding a permission by matching words
   * in it would be #130's parsing defect applied to a security boundary.
   */
  readonly standingTool?: string | undefined
  readonly standingOption?: string | undefined
  /**
   * The exact action this question asks about, as `fingerprint()` computes it
   * (the value `job_pauses.binds_to` holds). An answer approves or declines
   * THIS action and nothing that merely resembles it (0611).
   */
  readonly actionFingerprint?: string | undefined
  /**
   * Which of `approvalOptions` is the No. Named by the writer, as
   * `standingOption` names the standing Yes, so nothing reads English to find
   * out. An option not in the list is refused, for the same reason (0611).
   */
  readonly declineOption?: string | undefined
  /**
   * What answering with a particular option PERFORMS (#257).
   *
   * A job kind and one payload per thing, written HERE rather than read out of
   * the option text — `approvalOptions` is free English and deriving work from
   * it would be #130's parsing defect on a path that enqueues jobs.
   *
   * `handlers/drive.ts` is why this exists: it has offered "Add them to the
   * project as source documents" since #62 and answering it could never work,
   * because the page token advances whether or not Grant was asked and the
   * files are gone from the next change list.
   */
  readonly onAnswer?:
    | {
        readonly option: string
        /**
         * Further options that perform the SAME work (0610). Each must be one of
         * the approval options, for the reason the primary one must.
         */
        readonly also?: readonly string[]
        readonly kind: string
        readonly payloads: readonly Record<string, unknown>[]
      }
    | undefined
}

/**
 * The decision.
 *
 * `urgentPriorityMax` is read from `system_config` by the caller rather than
 * hard-coded, so the urgency boundary is configuration (§4). It is passed in as
 * a number so this function stays pure and unit-testable.
 */
export const decide = (
  classification: FailureClassification,
  job: JobContext,
  urgentPriorityMax: number,
): Disposition => {
  const urgent = job.priority <= urgentPriorityMax
  const budgetLeft = job.attempt < job.maxAttempts

  // Systemic first, and regardless of urgency for the non-urgent branch below:
  // a systemic refusal never becomes correct by waiting, so it must not consume
  // retry budget pretending otherwise.
  if (classification.nature === 'systemic') {
    return {
      action: 'blocker',
      reason: `systemic: ${classification.summary}`,
      blocker: {
        jobId: job.jobId,
        ...(job.projectId === undefined ? {} : { projectId: job.projectId }),
        requestedAction:
          classification.outcome === 'refused_paid'
            ? 'Investigate why an inference call was not provably free, then re-enable the job'
            : 'Restore a usable free inference model, or approve an alternative',
        whyNeeded: `${job.kind} needs inference and ${classification.summary}. No retry can change this.`,
        consequencesOfDelay: urgent
          ? 'This job is urgent and is not progressing. Work downstream of it is stalled.'
          : 'This job is not progressing. It is not urgent, but it will not recover on its own.',
        approvalOptions: ['Investigate now', 'Approve a paid model for this job', 'Cancel the job'],
        originatingAgent: job.recipientAgent ?? 'inference_router',
        // Systemic inference failure affects every job that needs inference, so
        // it does not claim that other work continues unaffected.
        workCanContinue: false,
      },
    }
  }

  // Transient and urgent: waiting is not acceptable, but there is nothing to fix
  // in code. Raise a blocker so Grant can decide, and say plainly that other
  // work is unaffected — that is the field that stops this being an alarm.
  if (urgent) {
    return {
      action: 'blocker',
      reason: `urgent work blocked: ${classification.summary}`,
      blocker: {
        jobId: job.jobId,
        ...(job.projectId === undefined ? {} : { projectId: job.projectId }),
        requestedAction: 'Decide whether to wait for free inference or authorise a paid call',
        whyNeeded: `Urgent job ${job.kind} cannot run: ${classification.summary}.`,
        consequencesOfDelay:
          'The job was marked urgent, so the delay is the cost. Free inference may return by itself.',
        approvalOptions: [
          'Wait for free capacity',
          'Authorise a paid call for this job',
          'Cancel the job',
        ],
        originatingAgent: job.recipientAgent ?? 'inference_router',
        workCanContinue: true,
      },
    }
  }

  // Transient and not urgent: exactly the case the spec says should queue.
  return budgetLeft
    ? { action: 'retry', reason: `transient: ${classification.summary}` }
    : {
        // Retry budget spent. Still not a blocker — it is not urgent, and §12
        // reserves Grant's attention for work that is actually blocked. It goes
        // back to the queue for the next sweep.
        action: 'queue',
        reason: `transient, retry budget spent: ${classification.summary}`,
      }
}
