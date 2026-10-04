/**
 * Answering a person in THEIR OWN Slack workspace (ADR-0065, the sending half).
 *
 * The worker's Slack channel was built once, around the deployment's one bot token. A person who installs the Slack app into
 * their own workspace has a token of their own, held in the vault and referenced by `public.slack_installs`, and an answer to
 * a message typed there has to be posted with THAT token and no other. This is the one place that choice is made.
 *
 * The rules, each asserted in tests/slack/installs.test.ts:
 *   - the token is chosen by the DELIVERING JOB's office (`app.job_office`), never by anything in the message or the request;
 *   - an office with an active install is served by that install's own token and workspace, and only that;
 *   - an office with NO install is never served by an install, and is never served by the deployment's token unless it is the
 *     operator's own office: a personal office cannot borrow the operator's workspace, whatever else is true;
 *   - a revoked install, or one whose token cannot be resolved, delivers nothing and says why (it never falls back);
 *   - a client is built once per workspace and not per message, and a token never appears in a note, a log line or an error.
 */
import type { ResultContext } from '../channels/notify.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { HandlerOutput, Job, NotifyOutcome } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** The shape `slackChannel` returns, so the worker's channel list can hold either. */
export interface SlackChannelLike {
  readonly name: string
  readonly notify: (
    job: Job,
    output: HandlerOutput,
    outputId: string,
    context: ResultContext,
  ) => Promise<NotifyOutcome>
}

export interface InstallChannelDeps {
  readonly db: SqlExecutor
  /** The deployment's own channel (the operator's workspace), or null when there is no deployment-level Slack. */
  readonly deployment: SlackChannelLike | null
  /** Builds the channel for one install. Called once per workspace; the token is passed in and never stored here. */
  readonly make: (install: { teamId: string; token: string }) => SlackChannelLike
}

interface Choice {
  readonly operator: boolean
  readonly install: { readonly teamId: string; readonly token: string | null } | null
}

/** A cache key that changes when the token does and reveals none of it (not a security hash: it never leaves memory). */
function fingerprint(token: string): string {
  let h = 5381
  for (let i = 0; i < token.length; i += 1) h = ((h << 5) + h + token.charCodeAt(i)) | 0
  return `${String(token.length)}.${(h >>> 0).toString(36)}`
}

/** Which Slack serves the office this job belongs to. One query; the office is resolved in SQL from the claimed job. */
async function choose(db: SqlExecutor, job: Job): Promise<Choice> {
  const { rows } = await db.execute(`
    select (app.job_office(${lit(job.jobId)}::uuid) = app.operator_office()) as operator,
           i.team_id,
           case when i.install_id is null or i.bot_token_ref is null then null else app.resolve_secret(i.bot_token_ref) end as token
      from (select 1) x
      left join public.slack_installs i
        on i.office_id = app.job_office(${lit(job.jobId)}::uuid) and i.state = 'active'
     limit 1`)
  const row = rows[0] as
    | { operator?: boolean; team_id?: string | null; token?: string | null }
    | undefined
  return {
    operator: row?.operator === true,
    install:
      row?.team_id === undefined || row.team_id === null
        ? null
        : {
            teamId: row.team_id,
            token: typeof row.token === 'string' && row.token !== '' ? row.token : null,
          },
  }
}

/**
 * The Slack channel the worker holds: per-office where an office has installed its own workspace, the deployment's where it
 * is the operator's own office, and nothing otherwise.
 */
export function installAwareSlackChannel(deps: InstallChannelDeps): SlackChannelLike {
  // One channel per workspace, built the first time it is needed. Keyed by team id AND token, so a rotated token is a new
  // client and a stale one is never used.
  const built = new Map<string, SlackChannelLike>()
  return {
    name: 'slack',
    notify: async (job, output, outputId, context): Promise<NotifyOutcome> => {
      let choice: Choice
      try {
        choice = await choose(deps.db, job)
      } catch {
        // Could not ask who this belongs to: delivering with ANY token would be a guess, so nothing is delivered.
        return {
          delivered: false,
          note: 'slack: could not tell which workspace this belongs to; nothing delivered',
        }
      }
      if (choice.install !== null) {
        if (choice.install.token === null) {
          return {
            delivered: false,
            note: 'slack: this workspace is connected but its token cannot be read; nothing delivered',
          }
        }
        const key = `${choice.install.teamId}:${fingerprint(choice.install.token)}`
        let channel = built.get(key)
        if (channel === undefined) {
          channel = deps.make({ teamId: choice.install.teamId, token: choice.install.token })
          built.set(key, channel)
        }
        return await channel.notify(job, output, outputId, context)
      }
      if (choice.operator && deps.deployment !== null) {
        return await deps.deployment.notify(job, output, outputId, context)
      }
      return {
        delivered: false,
        note: 'slack: this office has no Slack workspace connected; nothing delivered',
      }
    },
  }
}
