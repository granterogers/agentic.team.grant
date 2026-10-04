/**
 * Telling a person about a problem once (#413).
 *
 * The unit is the problem, not the job that noticed it: an office, a service, and what is wrong with it. The decision to
 * speak lives in the database (`app.incident_seen`, 0877), because a worker's memory does not survive a deploy and two
 * workers can notice the same thing in the same second; here is only the call and what to do when it cannot be made.
 *
 * Both calls are made about the CLAIMED job's office, passed by the caller, never read from the request or the output.
 */
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type IncidentReason = 'first' | 'reminder' | 'quiet'

export interface IncidentVerdict {
  readonly notify: boolean
  readonly reason: IncidentReason
  readonly occurrences: number
}

const asObject = (raw: unknown): Record<string, unknown> => {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * Record that this problem is happening and learn whether the person should be told.
 *
 * FAILS OPEN: if the incident layer cannot be reached the answer is "tell him", which then meets the older duty-level
 * dedupe (`app.say_once`) in the worker. A rule that fails closed silences a real failure report, which is the
 * expensive direction; failing open costs at most the repetition the older layer already limits.
 */
export async function seeProblem(
  db: SqlExecutor,
  office: string,
  service: string,
  problem: string,
  evidence: Readonly<Record<string, string | number | boolean>>,
  remindHours = 24,
): Promise<IncidentVerdict> {
  try {
    const { rows } = await db.execute(
      `select app.incident_seen(${lit(office)}::uuid, ${lit(service)}, ${lit(problem)}, ${lit(JSON.stringify(evidence))}::jsonb, ${String(Math.max(1, Math.trunc(remindHours)))}) as r`,
    )
    const r = asObject((rows[0] as { r?: unknown } | undefined)?.r)
    const reason = r.reason === 'reminder' || r.reason === 'quiet' ? r.reason : 'first'
    return {
      notify: r.notify === true,
      reason,
      occurrences: typeof r.occurrences === 'number' ? r.occurrences : 1,
    }
  } catch {
    return { notify: true, reason: 'first', occurrences: 1 }
  }
}

/**
 * Close the incidents a successful run proves are over. Returns whether the person had been told about any of them,
 * which is the only case where saying "that works again" means anything. Never throws: a recovery notice that could not
 * be decided is simply not sent.
 */
export async function resolveProblems(
  db: SqlExecutor,
  office: string,
  service: string,
  problems: readonly string[],
): Promise<{ readonly closed: number; readonly wasTold: boolean }> {
  if (problems.length === 0) return { closed: 0, wasTold: false }
  try {
    const list = `array[${problems.map(lit).join(', ')}]::text[]`
    const { rows } = await db.execute(
      `select app.incident_resolve(${lit(office)}::uuid, ${lit(service)}, ${list}) as r`,
    )
    const r = asObject((rows[0] as { r?: unknown } | undefined)?.r)
    return {
      closed: typeof r.resolved === 'number' ? r.resolved : 0,
      wasTold: r.was_told === true,
    }
  } catch {
    return { closed: 0, wasTold: false }
  }
}
