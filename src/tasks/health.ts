/**
 * Recording whether Vikunja is answering, where Settings can read it (0981).
 *
 * `tasks.sync` already says an outage once, in a deduplicated announcement. That is not somewhere a person looks, and the
 * Settings card stayed green over a copy that had stopped moving. This writes the last round's outcome into the mechanism
 * every other connection uses (`public.connection_health`) through one SQL writer, and `app.task_sync_panel` returns it as
 * `health`.
 *
 * The decision "is this a failure of the connection" is made here from what the round reported, never from text:
 *   - the round ended `down` and the provider turned the credential away  -> refused
 *   - the round ended `down` any other way (network, timeout, 429, 5xx)   -> unreachable
 *   - the round THREW (the server answered and refused it: project gone)  -> failed
 *   - the round finished                                                  -> ok, even when some single tasks failed;
 *     those are listed per task and are not a verdict on the connection.
 *
 * Recording is never allowed to fail the round: a database without 0981 answers "no such function", and the duty must still
 * sync. That failure is returned to the caller (so a suite can see it) rather than swallowed to nothing.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { SyncReport } from './sync.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type HealthOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly kind: 'unreachable' | 'refused' | 'failed'
      readonly detail: string
    }

/** What the round's report says about the connection. */
export function outcomeOfReport(report: Pick<SyncReport, 'down' | 'downKind'>): HealthOutcome {
  if (report.down === null) return { ok: true }
  return {
    detail: report.down,
    kind: report.downKind === 'refused' ? 'refused' : 'unreachable',
    ok: false,
  }
}

/** What a round that threw says about the connection. */
export const outcomeOfError = (error: unknown): HealthOutcome => ({
  detail: `Vikunja refused the round: ${String((error as Error)?.message ?? error).slice(0, 140)}`,
  kind: 'failed',
  ok: false,
})

/** Record it. Returns an error sentence when it could not be recorded, never throws. */
export async function recordVikunjaHealth(
  db: SqlExecutor,
  office: string,
  outcome: HealthOutcome,
): Promise<string | null> {
  try {
    const answer = (
      await db.execute(
        `select app.vikunja_health_record(${lit(office)}::uuid, ${outcome.ok ? 'true' : 'false'}, ${
          outcome.ok ? 'null' : lit(outcome.kind)
        }, ${outcome.ok ? 'null' : lit(outcome.detail)}) as r`,
      )
    ).rows[0]?.r as { error?: string } | string | undefined
    const parsed = typeof answer === 'string' ? (JSON.parse(answer) as { error?: string }) : answer
    return parsed?.error ?? null
  } catch (error) {
    return `could not record the connection reading: ${String((error as Error).message).slice(0, 120)}`
  }
}
