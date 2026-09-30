/**
 * What a handler asks before it acts on an approval (#386, 0616).
 *
 * `notebook.generate` and `office.execute_plan` are started by answering a question, and until now the
 * gate at the door was the PRESENCE of `approved_by` in the job's config (generate) or nothing at all
 * (plan). This asks the DATABASE: is the question the job names real, answered yes by a person, on the
 * job that asked, not taken back, and does what it asked about still equal what this job is about to do
 * (`app.approval_verdict`)? And then the boundary every other effect goes through - `mayAct` - because
 * a yes does not outrank a dial that says observe, or a No he gave to this very request.
 *
 * Two rules it keeps deliberately:
 *   - it never trusts anything the job CARRIES: a claim of approval is read as a claim, and only the
 *     question row is evidence;
 *   - a refusal is an ANSWER, not a failure: the handler returns it as its output, so nothing retries
 *     into `failed` and Grant is told, in words, that nothing was done and why.
 */
import { mayAct } from '../agents/approval.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { fingerprint } from '../jobs/checkpoint.ts'
import type { HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type ApprovalState = 'none' | 'forged' | 'mismatch' | 'approved' | 'approved_legacy'

export interface ApprovalCheck {
  readonly state: ApprovalState
  readonly why: string
  /** What THIS job is about to do, fingerprinted the way the question's was. */
  readonly fingerprint: string | null
  /** The job whose question it was. */
  readonly askingJob: string | null
}

const STATES: ReadonlySet<string> = new Set([
  'none',
  'forged',
  'mismatch',
  'approved',
  'approved_legacy',
])

export const checkApproval = async (db: SqlExecutor, jobId: string): Promise<ApprovalCheck> => {
  const { rows } = await db.execute(`select app.approval_verdict(${lit(jobId)}::uuid) as v`)
  const raw = rows[0]?.v
  const v = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as Record<string, unknown>
  // An answer nobody recognises is not an approval.
  const state: ApprovalState =
    typeof v.state === 'string' && STATES.has(v.state) ? (v.state as ApprovalState) : 'forged'
  return {
    state,
    why: typeof v.why === 'string' ? v.why : 'the approval could not be read',
    fingerprint: typeof v.fingerprint === 'string' ? v.fingerprint : null,
    askingJob: typeof v.asking_job === 'string' ? v.asking_job : null,
  }
}

export type Start = { readonly ok: true } | { readonly ok: false; readonly why: string }

/** May this job go ahead with what it was approved to do? */
export const mayStart = async (
  db: SqlExecutor,
  job: Job,
  check: ApprovalCheck,
  tool: string,
): Promise<Start> => {
  if (check.state === 'forged' || check.state === 'mismatch') {
    return { ok: false, why: check.why }
  }
  if (check.state === 'none') return { ok: false, why: 'nothing has been approved' }
  const decision = await mayAct(db, {
    projectId: job.projectId,
    tool,
    jobAskedFor: job.jobId,
    audience: 'office',
    fingerprint: check.fingerprint,
    job: check.askingJob,
  })
  // A recorded yes exists (that was the verdict above), so the only thing that stops it here is the
  // policy saying no - a dial set to observe, a switched-off tool, or a No that stands.
  if (decision.verdict === 'refuse') return { ok: false, why: decision.because }
  return { ok: true }
}

/**
 * The answer when an approval does not hold. Spoken plainly and noted, and never a throw: a throw
 * retries, and a refusal that retries is a refusal that eventually stops being one.
 */
export const refusedApproval = async (
  db: SqlExecutor,
  job: Job,
  what: string,
  why: string,
): Promise<HandlerOutput> => {
  // The office records what it declined to do, so the Governance page can show it. Best effort:
  // failing to record must not turn a refusal into a retry.
  await db
    .execute(
      `select app.cannot(${lit(job.jobId)}::uuid, 'not_capable', 'approval-binding',
         'chief-of-staff', ${lit(`did not ${what}`)}, ${lit(why.slice(0, 280))})`,
    )
    .catch(() => undefined)
  await db
    .execute(`update public.jobs set announce = true where job_id = ${lit(job.jobId)}::uuid`)
    .catch(() => undefined)
  return {
    body:
      `I did not ${what}, and nothing was started. ${why} ` +
      'If you do want it, ask me again and I will check with you first.',
    confidence: 'high',
    evidence: 'verified',
    sources: [`job:${job.jobId}`],
    contradictions: null,
    path: 'deterministic_retrieval',
    model: null,
  }
}

/**
 * The boundary for a write that needs no question of its own: somebody asked for it, and the office
 * must still honour the dial, a switched-off tool, and a No that stands (#386).
 *
 * `material` is what identifies THIS write (the link and the notebook, the document), so a No given to
 * one is not a No to the next. It reads the job as the one that ASKED for the tool, which is what it is
 * for a link he pasted or a document he pushed; a write nobody asked for (a job whose requester is a
 * duty or unknown) reads as unprompted, and unprompted external writes ask first. This helper does not
 * raise that question: it refuses and says why, so nothing outside the office changes on a maybe.
 */
export const mayWrite = async (
  db: SqlExecutor,
  job: Job,
  tool: string,
  material: unknown,
): Promise<Start> => {
  const fp = await fingerprint({ tool, project: job.projectId, material })
  const decision = await mayAct(db, {
    projectId: job.projectId,
    tool,
    jobAskedFor: job.jobId,
    job: job.jobId,
    audience: 'office',
    fingerprint: fp,
  })
  if (decision.verdict === 'proceed') return { ok: true }
  return {
    ok: false,
    why:
      decision.verdict === 'ask'
        ? `${decision.because} Nobody has asked for this yet, so it waits for you.`
        : decision.because,
  }
}
