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
import { raiseBlocker } from '../inference/record.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { SlackClient } from '../slack/api.ts'
import { ChannelProvisioner } from '../slack/provision.ts'
import { governEffect } from './approval-gate.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface ChannelsDeps {
  readonly db: SqlExecutor
  readonly botToken: string
  readonly teamId: string
  /** For a suite that must see every call the office makes at Slack. Absent, the real client. */
  readonly slack?: SlackClient
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

      const provisioner = new ChannelProvisioner(
        db,
        deps.slack ?? new SlackClient(botToken),
        teamId,
      )
      const label = String(row.name ?? 'project')

      /*
        WHY THIS CHANNEL MAY BE MADE (final policy closure, decision 2).

        A channel is permanent in Slack, so making one needs a reason the office can say afterwards. There are exactly
        two. A person made the project (`slack_channel_authority`, written only by the project-creation functions
        from a verified principal or a person's own turn, and spent once here), or a person said yes to this exact
        channel (a question raised below, whose yes starts a child of this job that finds the answer on its parent).
        Anything else - a sweep finding a project with no channel, a duty - asks. Nothing in the job's payload is
        read as a reason; it is not looked at.
      */
      let because = ''
      let spend = false
      if (!(await provisioner.hasChannel(row.id))) {
        // A database without the authority function (a rolled-back migration) means nobody can be said to have
        // authorised it, so it ASKS rather than failing the sweep.
        const authority = (await db
          .execute(`select app.channel_authority(${lit(row.id)}::uuid) as a`)
          .then((r) => r.rows[0])
          .catch(() => undefined)) as { a?: unknown } | undefined
        const a = (typeof authority?.a === 'string' ? JSON.parse(authority.a) : authority?.a) as
          | { authorized_by?: string }
          | null
          | undefined
        if (a !== null && a !== undefined && typeof a.authorized_by === 'string') {
          because = `because ${a.authorized_by} created the project`
          spend = true
        } else {
          const wantedName = await provisioner.wantedName(row.id, label)
          const d = await governEffect(db, job, {
            tool: 'slack.channel',
            material: { op: 'create', name: wantedName },
            summary: `Create the Slack channel #${wantedName} for "${label}"?`,
            detail:
              'Nobody asked me to make this one - the project was not created by a person through me. ' +
              'A Slack channel cannot be deleted once it exists, so I will not make it without your yes.',
            agent: 'operations-director',
            onYes: { yes: 'Yes, create the channel', no: 'No, not now' },
          })
          if (!d.ok) {
            await quiet()
            return {
              ...base,
              facts: { changed: false, looked_at: 1 },
              body: `${label} has no Slack channel and I have not made one: ${d.said}`,
              announce: false,
            }
          }
          because =
            d.how === 'approved'
              ? 'because you said yes to creating it'
              : 'because the settings allowed it'
        }
      }

      const result = await provisioner.ensureChannel(row.id, label)
      if (
        spend &&
        (result.outcome === 'created' ||
          result.outcome === 'adopted' ||
          result.outcome === 'existing')
      ) {
        await db.execute(
          `select app.consume_channel_authority(${lit(row.id)}::uuid, ${lit(job.jobId)}::uuid)`,
        )
      }

      /*
        `failed` is Slack refusing; `name_conflict` is a name taken by a
        channel that is not ours, which a person has to decide about — the
        provisioner deliberately does not adopt a stranger's room. Both are
        reported rather than retried, because neither gets better on a second
        attempt.
      */
      if (result.outcome === 'failed' || result.outcome === 'name_conflict') {
        /*
          A name conflict is a QUESTION, and until 0477 it was a loop.

          The comment above is right that neither outcome improves on a second
          attempt, and the enqueuer knew nothing about that: a debris project
          whose desired name was taken accumulated 740 of these jobs in twelve
          hours, each announcing the same failure. 0477 bounds the sweep; this
          is the other half — the office asks once, where Grant can answer,
          instead of reporting the same impossibility daily for ever.

          Guarded on an open blocker for this project rather than on a count:
          asking twice about one collision is the thing to avoid, and the
          enqueuer reads the same row to decide not to come back.
        */
        if (result.outcome === 'name_conflict') {
          const asked = Number(
            (
              (
                await db.execute(`
                  select count(*)::int as n from public.blockers
                   where project_id = ${lit(String(row.id))}::uuid and state = 'open'
                     and requested_action like '%Slack channel%'`)
              ).rows[0] as { n?: number }
            )?.n ?? 0,
          )
          if (asked === 0) {
            await raiseBlocker(db, {
              projectId: String(row.id),
              jobId: job.jobId,
              requestedAction:
                `“${String(row.name)}” has no Slack channel of its own, because ` +
                `#${String(result.channelName)} already exists and is not one of ours. ` +
                'I will not take over a channel somebody else made, and I cannot make one ' +
                'under a different name on my own. If you free that name in Slack or rename ' +
                'the project, I will make the channel the next time I look.',
              whyNeeded:
                'I will not take over a channel somebody else made, and I cannot ' +
                'guess a second name you would recognise.',
              consequencesOfDelay:
                'Nothing breaks. The project works everywhere else; it just has no ' +
                'room of its own. I look again about once a day and will ask again ' +
                'if the name is still taken.',
              /*
                One answer, and it is a true one (audit B6).

                "Use #<name>_project instead" was offered here, answering it was
                accepted, and nothing created that channel: the provisioner
                derives a channel's name from the project and there is no path
                that takes a different one, so the option promised a room the
                office had no way to make - and a channel is permanent in Slack,
                so this is not a place to grow one on a guess. What answering
                CAN do is settle this question.
              */
              approvalOptions: ['Leave it without a channel for now'],
              originatingAgent: 'operations-director',
              // The office is not stuck: everything else about the project
              // works, so the answer is wanted rather than waited on.
              workCanContinue: true,
            })
          }
        }
        return {
          ...base,
          facts: { changed: false, looked_at: 1 },
          body: `I could not give ${String(row.name)} a Slack channel: ${
            result.outcome === 'name_conflict'
              ? `#${String(result.channelName)} is taken by a channel that is not ours, so I have asked you to choose`
              : String(result.errorCode ?? 'Slack refused')
          }. The project is fine; it just has no room of its own yet.`,
          // The blocker is the notification path for a conflict. Announcing as
          // well would say the same thing twice, which is what 740 of these
          // jobs did once a minute.
          announce: result.outcome !== 'name_conflict',
        }
      }

      const made = result.outcome === 'created'
      if (!made) await quiet()
      return {
        ...base,
        facts: { changed: made, looked_at: 1 },
        body: made
          ? `${String(row.name)} has a Slack channel now: #${String(result.channelName)}${because === '' ? '' : ` (${because})`}.`
          : `${String(row.name)} already has #${String(result.channelName)}.`,
        announce: made,
      }
    },
  }
}
