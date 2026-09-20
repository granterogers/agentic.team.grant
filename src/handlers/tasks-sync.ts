/**
 * The duty behind `tasks.sync` (#259, Phase 2, migration 0519).
 *
 * `npm run verify:vikunja` proves the whole two-way contract against a real
 * server, and proves it as a SCRIPT. CLAUDE.md's long-range rule is that a
 * capability which exists only as a script an agent runs is a capability Grant
 * does not have — so this is the same engine, on a schedule, reading the
 * address and the credential he supplied.
 *
 * ## Silent unless it has something to say
 *
 * `office.chores` established the default and this follows it: a duty that
 * announces every quarter of an hour is ninety-six messages a day saying two
 * lists still agree. It speaks when something CHANGED, and when the provider
 * is unreachable — because Grant's tasks quietly drifting out of step with a
 * server he thinks is connected is exactly the failure a projection is not
 * allowed to have.
 *
 * ## Not configured is not an error
 *
 * Vikunja is optional. With no address and no token the duty does nothing,
 * says nothing and reports success — which is why the duty ships DISABLED and
 * `hq_set_vikunja` is what starts it. A handler that raised here would fill
 * the impediment ledger with a decision Grant made on purpose.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { syncOnce } from '../tasks/sync.ts'
import { VikunjaProvider } from '../tasks/vikunja.ts'

interface Settings {
  readonly base_url?: string | null
  readonly project_id?: number | null
  readonly configured?: boolean
}

const asJson = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v)

export function syncBody(r: {
  pushed: number
  pulled: number
  created: number
  deleted: number
  conflicts: number
  failed: number
  down: string | null
}): string {
  if (r.down !== null) return `Vikunja could not be reached (${r.down}). Nothing was changed here.`
  const said: string[] = []
  if (r.pushed > 0) said.push(`sent ${String(r.pushed)}`)
  if (r.created > 0) said.push(`took ${String(r.created)} new one${r.created === 1 ? '' : 's'}`)
  if (r.deleted > 0) said.push(`removed ${String(r.deleted)}`)
  if (r.conflicts > 0) {
    said.push(`kept the copy here for ${String(r.conflicts)} that changed in both places`)
  }
  if (r.failed > 0) said.push(`could not send ${String(r.failed)}`)
  return said.length === 0
    ? 'Your tasks and Vikunja already agree.'
    : `Vikunja: ${said.join(', ')}.`
}

export function tasksSyncHandler(db: SqlExecutor): Handler {
  return {
    kind: 'tasks.sync',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`, 'db:tasks'],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }
      const settings = (asJson(
        (await db.execute('select app.vikunja_settings() as v')).rows[0]?.v,
      ) ?? {}) as Settings
      if (settings.configured !== true) {
        return { ...base, announce: false, body: 'No task provider is connected.' }
      }
      /*
        The token is resolved HERE and never travels through
        `vikunja_settings`, whose answer can end up on a page. One value, read
        once, used once, and not returned in anything this function produces.
      */
      const token = String(
        (
          (
            await db.execute(
              `select decrypted_secret as v from vault.decrypted_secrets
              where name = 'vikunja.api_token'`,
            )
          ).rows[0] as { v?: string } | undefined
        )?.v ?? '',
      )
      if (token === '') {
        return { ...base, announce: false, body: 'No task provider is connected.' }
      }

      const report = await syncOnce(
        db,
        new VikunjaProvider({
          baseUrl: String(settings.base_url ?? ''),
          token,
          projectId: Number(settings.project_id ?? 0),
        }),
      )
      const moved =
        report.pushed + report.created + report.deleted + report.conflicts + report.failed
      return {
        ...base,
        /*
          Silent when the two already agree, which is almost every tick. An
          outage speaks, because a projection drifting behind a server Grant
          believes is connected is the one failure it may not have quietly.
        */
        announce: report.down !== null || moved > 0,
        body: syncBody(report),
      } satisfies HandlerOutput
    },
  }
}
