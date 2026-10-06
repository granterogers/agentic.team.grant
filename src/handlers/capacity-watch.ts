/**
 * The handler behind the `capacity-watch` duty (migration 1026, G-1).
 *
 * The free tier is a hard constraint of this project (~GBP 0 a month) and the database went from 63 MB to 372 MB in
 * eighteen days against a 500 MB line, with backups that are never deleted sharing a 1 GB Storage allowance. The
 * headroom was DISPLAYED and nothing watched it.
 *
 * ## Thin, like the other duties
 *
 * `app.capacity_watch()` does the measuring, the history, the level (with hysteresis) and the projection. This file
 * turns that reading into one notice, in code, from numbers: a model is never asked to say a figure (§11).
 *
 * ## It speaks on a crossing, and then at most daily
 *
 * Whether to speak is NOT decided here. The handler says "worth saying" when any resource is at a warning level and
 * gives a `topic` that changes on a crossing in either direction and on nothing else; the worker's `app.say_once`
 * (0584/0589) then lets a changed topic through at once and an unchanged one once in twenty hours. The handler cannot
 * know what was said an hour ago, because it sees one run. A level that is merely still high is therefore one notice
 * a day, not one a pass, and a level that has not been reached says nothing at all.
 *
 * ## Nothing is deleted here
 *
 * The notice names the biggest tables so the decision has something to stand on, and points at the retention
 * analysis. Grant: *"you should always check before making any destructive action with me."*
 */

import type { SqlExecutor } from '../db/executor.ts'
import { teamHqUrl } from '../incidents/link.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { composeNotice, type Level, type Reading, topicFor } from '../ops/capacity.ts'

interface RawReading {
  readonly scope: string
  readonly bytes: number | string
  readonly limit_bytes: number | string
  readonly level: number
  readonly days_to_limit: number | null
  readonly largest?: readonly { table: string; bytes: number | string }[]
}

/** The reading as the database returned it, validated into the shape the pure functions take. */
export function readingsFrom(raw: unknown): Reading[] {
  const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { readings?: unknown }
  const list = Array.isArray(parsed?.readings) ? (parsed.readings as RawReading[]) : []
  const out: Reading[] = []
  for (const r of list) {
    if (r.scope !== 'database' && r.scope !== 'storage') continue
    const level = Number(r.level)
    if (!(level === 0 || level === 1 || level === 2 || level === 3)) continue
    out.push({
      scope: r.scope,
      bytes: Number(r.bytes),
      limitBytes: Number(r.limit_bytes),
      level: level as Level,
      daysToLimit: r.days_to_limit === null ? null : Number(r.days_to_limit),
      ...(r.largest === undefined
        ? {}
        : { largest: r.largest.map((t) => ({ table: String(t.table), bytes: Number(t.bytes) })) }),
    })
  }
  return out
}

export function capacityWatchHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.capacity_watch',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const row = (await db.execute('select app.capacity_watch() as r')).rows[0] as
        | { r?: unknown }
        | undefined
      const readings = readingsFrom(row?.r)

      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`, 'db:capacity_samples'],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      // Two readings or the sampler is broken: say so rather than reporting "fine" about a reading never taken.
      if (readings.length !== 2) {
        return {
          ...base,
          body: 'The capacity reading did not return both the database and storage, so nothing about the free tier is known today.',
          announce: true,
          severity: 'important',
          topic: 'capacity:unreadable',
        } satisfies HandlerOutput
      }

      const notice = composeNotice(readings)
      if (notice === null) {
        return {
          ...base,
          body: 'Database and storage are both below the first warning line.',
          announce: false,
          shape: 'nothing_happened' as const,
          facts: { changed: false, looked_at: readings.length },
        } satisfies HandlerOutput
      }

      const worst = Math.max(...readings.map((r) => r.level))
      const link = await teamHqUrl(db, '/?settings=health')
      return {
        ...base,
        body: notice,
        announce: true,
        severity: worst >= 3 ? 'urgent' : worst === 2 ? 'important' : 'routine',
        topic: topicFor(readings),
        notice: {
          heading: worst >= 3 ? 'Free-tier limit close' : 'Free tier getting tight',
          ...(link === null ? {} : { link: { label: 'Open health', url: link } }),
        },
      } satisfies HandlerOutput
    },
  }
}
