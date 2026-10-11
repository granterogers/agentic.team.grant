/**
 * Stop every job that has a live Hermes run, before the worker is rolled back (INTERFACE-CONTRACTS section 11, blueprint D4).
 *
 * Why this exists: a worker that predates the engine seam would resume a parked Hermes job as an ordinary instruction and answer it
 * with the team, which is the silent engine switch the design forbids. So the order of a rollback is fixed: switch Hermes off, stop the
 * jobs that hold a run, and only then restore the older worker. This does the second step, and REFUSES to do it while Hermes is still
 * switched on for an office that holds a live run, because a run opened a second after the list was read would be missed.
 *
 * It stops jobs with the office's own stop (`app.request_stop`), the same one a person's Stop button reaches, so each job is cancelled
 * with a reason and its open questions withdrawn. It never edits a run directly: the bridge's next heartbeat is told to stop, and a run
 * whose bridge has gone expires on its own deadline.
 */
import type { SqlExecutor } from '../../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export interface LiveRun {
  readonly run_id: string
  readonly job_id: string
  readonly office_id: string
  readonly state: string
  readonly enabled: boolean
}

export interface DrainResult {
  /** True when every live run's job was dealt with (stopped, or already finished). */
  readonly ok: boolean
  /** Why nothing was stopped, when the order of the rollback was not respected. */
  readonly refused?: string
  readonly live: readonly LiveRun[]
  readonly stopped: readonly {
    readonly run_id: string
    readonly job_id: string
    readonly note: string
  }[]
  readonly failed: readonly {
    readonly run_id: string
    readonly job_id: string
    readonly why: string
  }[]
}

/** The runs a rollback must account for: opened or running, in one office or in all of them. */
export async function liveRuns(db: SqlExecutor, officeId: string | null): Promise<LiveRun[]> {
  if (officeId !== null && !isUuid(officeId)) throw new Error('the office is not an office id')
  const { rows } = await db.execute(
    `select r.run_id::text as run_id, r.job_id::text as job_id, r.office_id::text as office_id, r.state,
            app.engine_enabled(r.office_id, r.engine) as enabled
       from public.engine_runs r
      where r.state in ('open', 'running')
        ${officeId === null ? '' : `and r.office_id = ${lit(officeId)}::uuid`}
      order by r.created_at, r.run_id`,
  )
  return rows as unknown as LiveRun[]
}

export async function drainEngineRuns(
  db: SqlExecutor,
  officeId: string | null = null,
): Promise<DrainResult> {
  const live = await liveRuns(db, officeId)
  const stillOn = live.filter((r) => r.enabled)
  if (stillOn.length > 0) {
    const offices = new Set(stillOn.map((r) => r.office_id)).size
    return {
      ok: false,
      refused: `Hermes is still switched on for ${String(offices)} office(s) that hold a live run. Remove the office from engine.hermes.offices first, then run this again: a run opened after the list was read would be missed.`,
      live,
      stopped: [],
      failed: [],
    }
  }
  const stopped: { run_id: string; job_id: string; note: string }[] = []
  const failed: { run_id: string; job_id: string; why: string }[] = []
  for (const r of live) {
    try {
      const { rows } = await db.execute(
        `select app.request_stop(${lit(r.office_id)}::uuid, ${lit(r.job_id)}::uuid, null) as r`,
      )
      const raw = (rows[0] as { r?: unknown } | undefined)?.r
      const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        ok?: boolean
        error?: string
        note?: string
      } | null
      if (v?.error !== undefined) failed.push({ run_id: r.run_id, job_id: r.job_id, why: v.error })
      else
        stopped.push({
          run_id: r.run_id,
          job_id: r.job_id,
          note: v?.note ?? 'stopped',
        })
    } catch (error) {
      failed.push({
        run_id: r.run_id,
        job_id: r.job_id,
        why: String((error as Error).message).slice(0, 160),
      })
    }
  }
  return { ok: failed.length === 0, live, stopped, failed }
}
