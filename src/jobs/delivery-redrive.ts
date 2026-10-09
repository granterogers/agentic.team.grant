/**
 * The redrive: a finished answer whose send failed retryably is sent again, until it is sent or visibly given up (N1).
 *
 * `app.record_delivery_failure` keeps a retryably-failed delivery `claimed` with its lease pushed out by a backoff and
 * gives up after `delivery.max_attempts`; `app.claim_delivery` will hand such a row to whoever asks once the lease has
 * lapsed. Nothing asked. This is the asker, and it asks the way the first send did: the SAME notifier, for the same job
 * and its stored output, so every channel rebuilds the SAME dedupe key. The delivery layer then does what it was built
 * to do (dedupes what was sent, fences a second worker, bounds the attempts, parks an ambiguous one).
 *
 * `app.settle_lapsed_deliveries` runs first and gives every other lapsed claim an ending (ambiguous, suppressed,
 * superseded, abandoned), so what is left for this to resend is exactly the rows that are DUE: the provider reported a
 * refusal and the backoff is over. It never calls a handler; the work is done and the output row is the evidence.
 *
 * Both halves are never fatal. A redrive that threw would stop the drain, and the answer is already on the dashboard.
 */
import type { Confidence, Evidence } from '../agents/quality.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { HandlerOutput, Job, Notifier } from './worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface RedriveSummary {
  readonly settled: Record<string, number>
  readonly redriven: number
}

export const redriveLapsedDeliveries = async (
  db: SqlExecutor,
  notify?: Notifier,
  max = 10,
): Promise<RedriveSummary> => {
  const settledRow = await db
    .execute('select app.settle_lapsed_deliveries() as s')
    .catch(() => ({ rows: [] as Record<string, unknown>[] }))
  const settledRaw = (settledRow.rows[0] as { s?: unknown } | undefined)?.s
  const settled = (
    typeof settledRaw === 'string' ? JSON.parse(settledRaw) : (settledRaw ?? {})
  ) as Record<string, number>
  if (notify === undefined) return { settled, redriven: 0 }

  // P3: DEPLOYMENT SCAN. Every row is one job's own delivery, and the job is read back by its own id below.
  const { rows } = await db
    .execute(
      `select l.job_id::text as job_id, l.output_id::text as output_id, j.office_id::text as office_id,
              j.kind, j.correlation_id::text as correlation_id, j.project_id::text as project_id
         from app.deliveries_to_redrive(${String(max)}) l
         join public.jobs j on j.job_id = l.job_id`,
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }))

  let redriven = 0
  for (const r of rows as {
    job_id: string
    output_id: string
    office_id: string
    kind: string
    correlation_id: string
    project_id: string | null
  }[]) {
    const stored = await db.execute(
      `select o.body, o.confidence::text as confidence, o.evidence::text as evidence,
              o.deterministic, o.model, o.sources, o.contradictions
         from public.outputs o
         join public.jobs j on j.job_id = o.job_id
        where o.output_id = ${lit(r.output_id)}::uuid
          and j.job_id = ${lit(r.job_id)}::uuid
          and j.office_id = ${lit(r.office_id)}::uuid`,
    )
    const o = stored.rows[0] as
      | {
          body: string
          confidence: Confidence
          evidence: Evidence
          deterministic: boolean
          model: string | null
          sources: unknown
          contradictions: string | null
        }
      | undefined
    if (o === undefined) continue
    const job: Job = {
      jobId: r.job_id,
      kind: r.kind,
      correlationId: r.correlation_id,
      projectId: r.project_id,
      idempotencyKey: '',
      attempt: 0,
    }
    const output = {
      body: o.body,
      confidence: o.confidence,
      evidence: o.evidence,
      sources: Array.isArray(o.sources) ? o.sources.map((s) => String(s)) : [],
      contradictions: o.contradictions,
      path: o.deterministic ? ('deterministic_retrieval' as const) : ('inference' as const),
      model: o.model,
    } satisfies HandlerOutput
    try {
      await notify(job, output, r.output_id)
      redriven += 1
    } catch (error) {
      console.error(
        `delivery redrive failed for ${r.job_id}: ${String((error as Error).message).slice(0, 200)}`,
      )
    }
  }
  return { settled, redriven }
}
