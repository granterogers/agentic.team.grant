/**
 * Every dashboard project has a channel, and nobody had to remember (#187).
 *
 * Grant, 13 September: *"all projects have a dedicated channel name in
 * Slack."* Measured before this handler existed: four of the five active
 * dashboard projects had none.
 *
 * ## Why they did not
 *
 * Not for want of machinery. `ChannelProvisioner` is good and has been for
 * weeks — project-first underscored names so Slack's flat list groups a
 * project's rooms together, `name_taken` resolved by looking rather than by
 * adopting a stranger's channel, a human invited on creation because the first
 * real project channel had the bot as its only member.
 *
 * Its only callers were `scripts/verify/slack.ts` and
 * `scripts/projects/manage.ts`. So a channel existed exactly where somebody
 * had happened to run a script, which is CLAUDE.md's standing complaint word
 * for word: **a capability that exists only as a script an agent runs is a
 * capability Grant does not have.**
 *
 * ## And `office.rename_channels` had no handler at all
 *
 * `app.hq_rename_project` has enqueued that kind since 0073 and nothing in
 * `src/handlers` implemented it — eleven such jobs exist and every one is
 * cancelled, never run. Renaming a project has therefore never renamed its
 * channel. The same handler answers both kinds, because "make this project's
 * channels match its name" is one operation whichever direction it is asked
 * from: `ensureChannel` is idempotent, and a rename is the case where the row
 * exists and the name has moved.
 *
 * ## It never creates a channel for a fixture
 *
 * 0266 exists because the rename path was enqueuing for fixture projects. A
 * channel is a permanent, visible thing in Grant's workspace — Slack offers no
 * delete outside Enterprise Grid — so the cost of getting this wrong is not a
 * row, it is a room in his sidebar for ever.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { SlackClient } from '../slack/api.ts'
import { ChannelProvisioner } from '../slack/provision.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface ChannelsDeps {
  readonly db: SqlExecutor
  readonly botToken: string
  readonly teamId: string
}

export function channelsHandler(deps: ChannelsDeps, kind: string): Handler {
  const { db, botToken, teamId } = deps
  return {
    kind,
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        shape: 'nothing_happened' as const,
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }
      const quiet = async (): Promise<void> => {
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
      }

      /*
        No Slack is an OUTCOME. The office runs perfectly well without it, and
        a job that failed because a connector is off is a job that will retry
        three times and then look like a defect.
      */
      if (botToken === '' || teamId === '') {
        await quiet()
        return {
          ...base,
          facts: { changed: false, looked_at: 0 },
          body: 'Slack is not connected, so there is no channel to make.',
          announce: false,
        }
      }

      /*
        The project comes from the job, and the job's project is the only one
        this may touch. A handler that swept every project would turn one
        rename into a workspace-wide operation.
      */
      const row = (
        await db.execute(`
          select p.project_id::text as id, p.name, p.status, p.is_fixture
            from public.projects p
           where p.project_id = ${lit(String(job.projectId ?? ''))}::uuid`)
      ).rows[0] as { id?: string; name?: string; status?: string; is_fixture?: boolean } | undefined

      if (row?.id === undefined) {
        await quiet()
        return {
          ...base,
          facts: { changed: false, looked_at: 0 },
          body: 'That project is gone, so there is nothing to name.',
          announce: false,
        }
      }
      if (row.is_fixture === true) {
        // 0266's rule, enforced here as well as there: a fixture never gets a
        // room in Grant's sidebar, because Slack cannot take one away.
        await quiet()
        return {
          ...base,
          facts: { changed: false, looked_at: 1 },
          body: 'That is a fixture project, so it gets no channel.',
          announce: false,
        }
      }

      const provisioner = new ChannelProvisioner(db, new SlackClient(botToken), teamId)
      const result = await provisioner.ensureChannel(row.id, String(row.name ?? 'project'))

      /*
        `failed` is Slack refusing; `name_conflict` is a name taken by a
        channel that is not ours, which a person has to decide about — the
        provisioner deliberately does not adopt a stranger's room. Both are
        reported rather than retried, because neither gets better on a second
        attempt.
      */
      if (result.outcome === 'failed' || result.outcome === 'name_conflict') {
        return {
          ...base,
          facts: { changed: false, looked_at: 1 },
          body: `I could not give ${String(row.name)} a Slack channel: ${
            result.outcome === 'name_conflict'
              ? `#${String(result.channelName)} is taken by a channel that is not ours, so somebody has to choose`
              : String(result.errorCode ?? 'Slack refused')
          }. The project is fine; it just has no room of its own yet.`,
          announce: true,
        }
      }

      const made = result.outcome === 'created'
      if (!made) await quiet()
      return {
        ...base,
        facts: { changed: made, looked_at: 1 },
        body: made
          ? `${String(row.name)} has a Slack channel now: #${String(result.channelName)}.`
          : `${String(row.name)} already has #${String(result.channelName)}.`,
        announce: made,
      }
    },
  }
}
