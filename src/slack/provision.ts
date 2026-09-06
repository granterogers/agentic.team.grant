/**
 * Giving a project a room.
 *
 * Gate 4 proved a channel can be created and mapped. What it did not settle is
 * the part that bites in use: **channel creation is not idempotent and channel
 * names are a namespace we do not own.**
 *
 * `conversations.create` with a name that exists returns `name_taken` — and the
 * existing channel might be ours from a previous attempt whose response we
 * lost, or it might be a channel a human made last year about something else
 * entirely. Adopting whatever is sitting on the name would silently attach a
 * project to a stranger's conversation. So `name_taken` is resolved by LOOKING,
 * never by assuming, and adoption happens only when the mapping in Postgres
 * already says that channel belongs to this project.
 *
 * The naming rules are Slack's: lowercase, 1–80 characters, letters, digits,
 * hyphens and underscores only. A name that violates them is rejected with
 * `invalid_name_specials` — after the create call, which is a wasted round trip
 * and a confusing error, so the normalisation is done here first.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { SlackApiError, type SlackClient } from './api.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export const CHANNEL_NAME_MAX = 80
/** Prefix so a project channel is recognisable in a workspace full of them. */
export const PROJECT_CHANNEL_PREFIX = 'proj-'

/**
 * Turn a project slug into a legal Slack channel name.
 *
 * Deterministic: the same project always proposes the same name, which is what
 * makes `name_taken` informative rather than a coin flip. Truncation is from
 * the END and keeps the prefix, because the discriminating part of a project
 * slug is usually its start.
 */
export function channelNameFor(slug: string): string {
  const cleaned = slug
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const name = `${PROJECT_CHANNEL_PREFIX}${cleaned === '' ? 'unnamed' : cleaned}`
  return name.length <= CHANNEL_NAME_MAX ? name : name.slice(0, CHANNEL_NAME_MAX)
}

export type ProvisionOutcome =
  /** The mapping already existed. Nothing was created. */
  | 'existing'
  | 'created'
  /** The name was taken by a channel already mapped to this project. Adopted. */
  | 'adopted'
  /** The name is taken by something that is not ours. A human must decide. */
  | 'name_conflict'
  | 'failed'

export interface ProvisionResult {
  readonly outcome: ProvisionOutcome
  readonly channelId: string | null
  readonly channelName: string
  readonly errorCode: string | null
  /**
   * What happened to the human invitation, for a channel we just created.
   *
   * Reported rather than silent because the first real project channel was
   * created, posted into, and read by nobody: the bot was its only member, and
   * every delivery check passed because each asks whether the message arrived
   * and none asks whether it arrived to anyone.
   */
  readonly invited?: InviteOutcome
}

export type InviteOutcome = 'invited' | 'already_in_channel' | 'no_subject_configured' | 'failed'

export class ChannelProvisioner {
  constructor(
    private readonly db: SqlExecutor,
    private readonly slack: SlackClient,
    private readonly teamId: string,
  ) {}

  /**
   * Ensure the project has a channel, and that Postgres knows about it.
   *
   * Postgres is asked first, always. Slack's channel list is a cache of
   * something we already recorded; treating it as the source of truth would
   * make the mapping depend on a `conversations.list` page we might not have
   * read, and 0014 exists precisely so that it does not.
   */
  async ensureChannel(projectId: string, projectSlug: string): Promise<ProvisionResult> {
    const name = channelNameFor(projectSlug)

    const mapped = await this.one<{ channel_id: string; channel_name: string }>(`
      select channel_id, channel_name from public.slack_channel_map
      where project_id = ${lit(projectId)}::uuid and active
      order by created_at limit 1
    `)
    if (mapped !== undefined) {
      return {
        outcome: 'existing',
        channelId: mapped.channel_id,
        channelName: mapped.channel_name,
        errorCode: null,
      }
    }

    try {
      const { body } = await this.slack.call('conversations.create', { name, is_private: false })
      const channel = body.channel as { id?: string; name?: string } | undefined
      const channelId = channel?.id ?? ''
      await this.map(channelId, channel?.name ?? name, projectId, true)
      const invited = await this.inviteSubject(channelId)
      return {
        outcome: 'created',
        channelId,
        channelName: channel?.name ?? name,
        errorCode: null,
        invited,
      }
    } catch (error) {
      if (!(error instanceof SlackApiError)) throw error
      if (error.code !== 'name_taken') {
        return { outcome: 'failed', channelId: null, channelName: name, errorCode: error.code }
      }
      return this.resolveNameTaken(projectId, name)
    }
  }

  /**
   * Invite the human this workspace exists for.
   *
   * Failure is reported, never thrown. A channel that exists and has the wrong
   * membership is recoverable by one click; a provisioning call that throws
   * because of an invitation leaves the project with no channel at all, which
   * is the worse of the two by a distance.
   */
  private async inviteSubject(channelId: string): Promise<InviteOutcome> {
    if (channelId === '') return 'failed'
    const row = await this.one<{ user_id: string | null }>(
      `select value #>> '{}' as user_id from public.system_config
        where key = 'slack.subject_user_id'`,
    )
    const userId = row?.user_id
    if (userId === undefined || userId === null || userId.trim() === '') {
      return 'no_subject_configured'
    }
    try {
      await this.slack.call('conversations.invite', { channel: channelId, users: userId })
      return 'invited'
    } catch (error) {
      if (error instanceof SlackApiError && error.code === 'already_in_channel') {
        return 'already_in_channel'
      }
      return 'failed'
    }
  }

  /**
   * Somebody already has the name. Find out who.
   *
   * The only safe adoption is a channel this project is ALREADY mapped to in
   * Postgres — which happens when a previous create succeeded and its response
   * was lost, the same indeterminate case the delivery path has. Anything else
   * is reported as a conflict for a human, because a project quietly posting
   * into an unrelated channel is worse than a project with no channel: the
   * second is visible.
   */
  private async resolveNameTaken(projectId: string, name: string): Promise<ProvisionResult> {
    const known = await this.one<{ channel_id: string; project_id: string | null }>(`
      select channel_id, project_id::text as project_id
      from public.slack_channel_map
      where channel_name = ${lit(name)}
      order by created_at desc limit 1
    `)

    if (known !== undefined && known.project_id === projectId) {
      await this.db.execute(`
        update public.slack_channel_map
           set active = true, archived_at = null
         where channel_id = ${lit(known.channel_id)}
      `)
      return {
        outcome: 'adopted',
        channelId: known.channel_id,
        channelName: name,
        errorCode: null,
      }
    }

    return { outcome: 'name_conflict', channelId: null, channelName: name, errorCode: 'name_taken' }
  }

  private async map(
    channelId: string,
    channelName: string,
    projectId: string,
    createdByApp: boolean,
  ): Promise<void> {
    await this.db.execute(`
      insert into public.slack_channel_map
        (channel_id, team_id, project_id, channel_name, purpose, created_by_app)
      values (${lit(channelId)}, ${lit(this.teamId)}, ${lit(projectId)}::uuid,
              ${lit(channelName)}, 'project', ${createdByApp ? 'true' : 'false'})
      on conflict (channel_id) do update
        set project_id = excluded.project_id,
            channel_name = excluded.channel_name,
            active = true,
            archived_at = null
    `)
  }

  private async one<T>(sql: string): Promise<T | undefined> {
    return (await this.db.execute(sql)).rows[0] as T | undefined
  }
}
