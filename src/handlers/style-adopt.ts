/**
 * The `style.adopt` job: the performance of a YES (HQ-STYLE-018).
 *
 * `handlers/style-keep.ts` never replaces a style the project already has. It raises a question whose answer, when it
 * is "Yes, replace the project style", enqueues this job with the report, the project and `confirm: true` already
 * written into its payload (`blockers.on_answer`: what answering performs is named by the writer, not read out of the
 * option text). This is the other half, and it is deliberately only a caller: the replacing is
 * `app.style_adopt_from_document`, through `adoptStyleFromDocument`, the same call the viewer's button makes.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { adoptStyleFromDocument, saidAboutAdoption } from '../style/adopt.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export function styleAdoptHandler(db: SqlExecutor): Handler {
  return {
    kind: 'style.adopt',
    handle: async (job: Job): Promise<HandlerOutput> => {
      // raw-sql[2]: keyed by the claimed job; it reads the payload of the job the worker holds.
      const payload =
        ((
          (
            await db.execute(
              `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
            )
          ).rows[0] as { pinned_config?: Record<string, unknown> | string } | undefined
        )?.pinned_config as Record<string, unknown> | undefined) ?? {}
      const p =
        typeof payload === 'string' ? (JSON.parse(payload) as Record<string, unknown>) : payload
      const title = String(p.title ?? 'that report')
      const result = await adoptStyleFromDocument(db, {
        jobId: job.jobId,
        slug: String(p.slug ?? ''),
        documentId: String(p.document_id ?? ''),
        confirm: p.confirm === true,
        channel: typeof p.channel === 'string' ? p.channel : null,
        by: typeof p.by === 'string' ? p.by : null,
      })
      return {
        body: saidAboutAdoption(title, result),
        confidence: 'high',
        evidence: 'verified',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      }
    },
  }
}
