/**
 * The handler behind the `proposal-round` duty (#49, #272).
 *
 * The office records an impediment every time an agent cannot do something —
 * 589 of them on the day this was written — and `app.raise_proposals` turns
 * the recurring ones into proposals Grant can answer on the Governance page.
 *
 * **Nothing had ever called it.** `check:callers` had it in the baseline, and
 * the consequence was not an unused function: it was that the only proposals
 * in the table were the ones verification suites raised with
 * `p_include_fixtures => true`, so the section headed *What it wants* showed
 * Grant sixteen rows of test traffic and zero real ones. 0473 swept those and
 * filtered the reader; this is the half that makes real ones appear.
 *
 * ## Quiet on purpose
 *
 * `announce` is false. The proposals land where he already reads them, and
 * eleven things the office cannot do arriving on his phone is exactly the
 * narration he has asked twice not to receive. The daily cadence is for the
 * same reason: a proposal is a standing request, not news.
 *
 * ## What it does NOT do
 *
 * It does not deliver, decide, or act. `raise_proposals` refuses to rewrite a
 * proposal Grant has answered, and a declined one stays silent for three
 * months — both are the RPC's rules, not this handler's, and it must stay that
 * way: a handler that re-raised a decline would be arguing with him once a
 * day.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { count } from '../text/plain.ts'

export function proposeHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.propose',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`, 'db:job_impediments'],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
        announce: false,
      }

      /*
        Thirty days and three occurrences, which are `raise_proposals`'s own
        defaults, stated rather than assumed: a duty that relied on the
        defaults would change behaviour silently the day somebody changed them.

        Fixtures excluded, which is the parameter's whole point (0297).
      */
      const row = (await db.execute(`select app.raise_proposals(30, 3, false) as r`)).rows[0] as
        | { r?: unknown }
        | undefined
      const raw = row?.r
      const outcome = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as {
        raised?: number
        updated?: number
        left_declined?: number
      }
      const raised = Number(outcome.raised ?? 0)
      const updated = Number(outcome.updated ?? 0)
      const silent = Number(outcome.left_declined ?? 0)

      const open = Number(
        (
          (
            await db.execute(
              `select count(*)::int as n from public.proposals
                where state = 'open' and not app.harness_label(needed)`,
            )
          ).rows[0] as { n?: number }
        )?.n ?? 0,
      )

      const body =
        raised === 0 && updated === 0
          ? 'Nothing new the office could not do often enough to be worth asking about.' +
            (open === 0 ? '' : ` ${count(open, 'proposal', 'proposals')} still open.`)
          : `${count(raised, 'new proposal', 'new proposals')}` +
            (updated === 0 ? '' : `, ${String(updated)} seen again`) +
            (silent === 0
              ? ''
              : `, ${String(silent)} left alone because you have already said no`) +
            `. ${count(open, 'proposal', 'proposals')} open on the Governance page.`

      return { ...base, body } satisfies HandlerOutput
    },
  }
}
