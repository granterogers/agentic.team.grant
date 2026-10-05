/**
 * An offer may only promise what the press can perform — as a check.
 *
 * CLAUDE.md records that sentence NINE times, about nine different controls:
 * the Governance page's Decline button, drive.ts's "do not ask again",
 * `app.discard_document`, `app.undo_offer`, the four defects in 0390. Every
 * one was found by driving a function by hand, months after it shipped, and
 * every entry ends by saying so. It was never a check.
 *
 * The tenth was #366. Three of the four questions open on Grant's dashboard
 * were notebook generation approvals, and answering one returned
 * `ok=true, state=resolved, started=0` — the office says yes, marks the
 * question answered, and queues nothing. He had no way to tell, because the
 * answer was accepted.
 *
 * ## THE PROPERTY, AND WHY IT IS NOT A LIST
 *
 * A blocker Grant can answer must have somewhere for the answer to GO. There
 * are exactly two roads, and both are structural:
 *
 *   - RESUME. The job that asked is still parked, so `app.let_job_go` puts it
 *     back in the queue and the handler carries on. That is how a plan step's
 *     approval works.
 *   - START. The job that asked has finished, so answering must name the work:
 *     `blockers.on_answer` (a job kind and payloads) or the job's
 *     `pinned_config.approval_next` (a generation approval).
 *
 * A blocker with NEITHER — a finished job, no `on_answer`, no `approval_next`
 * — is a question whose affirmative answer resolves the row and does nothing
 * else. That is checkable without reading one word of English, which matters:
 * deciding this from the option text would be #130's parsing defect on the
 * path that enqueues work.
 *
 * ## ONE DIRECTION ONLY
 *
 * It reports a blocker that CANNOT act, never one that merely did not. A
 * question legitimately answered "Not now" starts nothing and is not a
 * finding, so the check never looks at what was answered — only at whether
 * there was anywhere for an answer to go.
 *
 * Harness blockers are excluded through `app.harness_job`, the canonical
 * predicate, because a suite's fixture question is not one he can see.
 */
import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

/** An open question, and the two roads an answer could take from it. */
export type Question = {
  readonly blockerId: string
  readonly asks: string
  readonly jobState: string
  /** The job is still parked, so answering resumes it. */
  readonly canResume: boolean
  /** The blocker or its job names the work answering starts. */
  readonly canStart: boolean
}

/**
 * THE PREDICATE THAT DECIDES THE LIVE CHECK, named so the controls can run an
 * injected reading through the same code rather than asserting what a query
 * happened to see.
 */
export const startsNothing = (q: Question): boolean => !q.canResume && !q.canStart

const main = async (): Promise<void> => {
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    process.env.SUPABASE_ACCESS_TOKEN ?? '',
  )

  const { rows } = await db.execute(
    `select b.blocker_id,
            left(b.requested_action, 70) as asks,
            j.state::text as job_state,
            (j.state not in ('complete', 'failed', 'cancelled')) as can_resume,
            (b.on_answer is not null
             or coalesce(j.pinned_config ->> 'approval_next', '') <> '') as can_start
       from public.blockers b
       join public.jobs j on j.job_id = b.job_id
      where b.state = 'open'
        and not app.harness_job(b.job_id)
      order by b.created_at`,
  )

  const questions: Question[] = (
    rows as {
      blocker_id: string
      asks: string
      job_state: string
      can_resume: boolean
      can_start: boolean
    }[]
  ).map((r) => ({
    blockerId: r.blocker_id,
    asks: r.asks,
    jobState: r.job_state,
    canResume: r.can_resume === true,
    canStart: r.can_start === true,
  }))

  /* Prove the predicate can fail, on an injected reading, every run. A check
     that has only ever reported zero is indistinguishable from one that cannot
     report anything — and this one's clean state IS zero. */
  const dead: Question = {
    blockerId: 'control',
    asks: 'control',
    jobState: 'complete',
    canResume: false,
    canStart: false,
  }
  if (!startsNothing(dead)) {
    console.error('check:answerable CANNOT RUN — the predicate does not fire on a dead offer.')
    process.exit(1)
  }
  for (const alive of [
    { ...dead, canResume: true },
    { ...dead, canStart: true },
  ]) {
    if (startsNothing(alive)) {
      console.error('check:answerable CANNOT RUN — the predicate fires on an answerable question.')
      process.exit(1)
    }
  }

  const broken = questions.filter(startsNothing)

  for (const q of questions) {
    console.log(
      `  ${q.asks} — job ${q.jobState}, ` +
        `${q.canResume ? 'resumes' : q.canStart ? 'starts work' : 'STARTS NOTHING'}`,
    )
  }

  if (broken.length === 0) {
    console.log(
      `check:answerable clean — ${String(questions.length)} open question(s) of his; ` +
        `every one has somewhere for an answer to go`,
    )
    process.exit(0)
  }

  for (const q of broken) {
    console.error(
      `DEAD OFFER: "${q.asks}" is open on his dashboard, the job that asked is ` +
        `${q.jobState}, and the blocker names neither an on_answer payload nor an ` +
        `approval_next. Answering it would resolve the row and queue nothing (#366).`,
    )
  }
  process.exit(1)
}

await main()
