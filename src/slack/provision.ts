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

/**
 * The longest discipline suffix, so a prefix can be trimmed to leave room.
 *
 * Computed from the staff slugs rather than guessed: `communications-director`
 * is 23 characters and a prefix trimmed to 48 without checking would produce a
 * name Slack refuses, one project in.
 */
export const DISCIPLINE_SUFFIX_MAX = 24

/**
 * Turn a project name into the stem its channels are built from.
 *
 * Lowercase, non-alphanumerics to hyphens, collapsed, trimmed, and short enough
 * that the longest discipline still fits under Slack's 80.
 */
export function channelPrefixFor(nameOrSlug: string): string {
  const cleaned = nameOrSlug
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const room = CHANNEL_NAME_MAX - DISCIPLINE_SUFFIX_MAX - 1
  const stem = cleaned === '' ? 'untitled-project' : cleaned
  return stem.length <= room ? stem : stem.slice(0, room).replace(/-+$/, '')
}

/**
 * The channel name for a project, optionally for one discipline.
 *
 * **Project first**, deliberately. Slack's channel list is flat — the sidebar
 * "sections" people mean by subchannels are a per-user client feature with no
 * API, so a bot cannot make one — which leaves the name to do the grouping.
 * Alphabetical sorting then groups a project's channels together in every
 * client with no configuration:
 *
 *     money-mastery              ← the lobby, sorts first
 *     money-mastery-finance
 *     money-mastery-research
 *
 * Discipline-first would group by agent instead, which is the wrong axis:
 * Grant thinks in projects, and the team is the same eight people on all of
 * them.
 *
 * The suffix is the role, not the slug: `-research`, not
 * `-research-director`. Every one of them ends in `-director` and a suffix
 * that is the same on every channel is a suffix carrying no information.
 */
export function channelNameFor(prefix: string, staffSlug?: string | null): string {
  const stem = channelPrefixFor(prefix)
  if (staffSlug === undefined || staffSlug === null || staffSlug === '') return stem
  const role = staffSlug.replace(/-director$/, '').replace(/^chief-of-staff$/, 'chief')
  const name = `${stem}-${role}`
  return name.length <= CHANNEL_NAME_MAX ? name : name.slice(0, CHANNEL_NAME_MAX).replace(/-+$/, '')
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
  /**
   * Ensure a project has a channel — its lobby, or one discipline's.
   *
   * `staffSlug` names the discipline. Absent, this is the lobby. A discipline
   * channel is created the first time that staff member has something to say
   * about the project, rather than eight per project on day one: forty mostly
   * empty channels is a sidebar that teaches you to ignore the section.
   */
  async ensureChannel(
    projectId: string,
    projectLabel: string,
    staffSlug?: string | null,
  ): Promise<ProvisionResult> {
    // `channel_prefix` if the project has one — it is editable in the front
    // end, which is the point — then its name, then the caller's label. A slug
    // is a machine's name for a project; a person reading a sidebar wants the
    // name they gave it.
    const named = await this.one<{ name: string | null; channel_prefix: string | null }>(
      `select name, channel_prefix from public.projects
        where project_id = ${lit(projectId)}::uuid`,
    )
    const stem =
      named?.channel_prefix !== null &&
      named?.channel_prefix !== undefined &&
      named.channel_prefix !== ''
        ? named.channel_prefix
        : named?.name !== null && named?.name !== undefined && named.name.trim() !== ''
          ? named.name
          : projectLabel
    const name = channelNameFor(stem, staffSlug)

    const mapped = await this.one<{ channel_id: string; channel_name: string }>(`
      select channel_id, channel_name from public.slack_channel_map
      where project_id = ${lit(projectId)}::uuid and active
        and purpose = 'project'
        and discipline is not distinct from ${staffSlug === undefined || staffSlug === null ? 'null' : lit(staffSlug)}
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
      await this.map(channelId, channel?.name ?? name, projectId, true, staffSlug)
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
   * Ensure a channel that belongs to the workspace rather than to a project.
   *
   * `#the-team`, where the staff introduce themselves. There is no project to
   * hang it on and 0014's constraint says so in as many words — only a
   * project-purpose channel has a project — so this is the same create-map-
   * invite sequence with `project_id` null and a purpose that admits it.
   *
   * Adopting a channel of the same name IS safe here, unlike the project case.
   * There the danger is a project quietly posting into an unrelated channel and
   * nobody noticing which; here the name is the identity. A `#the-team` that
   * already exists is the one we mean.
   */
  async ensureNamedChannel(
    name: string,
    purpose: 'general' | 'alerts' | 'other' = 'general',
  ): Promise<ProvisionResult> {
    const mapped = await this.one<{ channel_id: string; channel_name: string }>(`
      select channel_id, channel_name from public.slack_channel_map
       where channel_name = ${lit(name)} and team_id = ${lit(this.teamId)} and active
       order by created_at limit 1
    `)
    if (mapped !== undefined) {
      return {
        outcome: 'existing',
        channelId: mapped.channel_id,
        channelName: mapped.channel_name,
        errorCode: null,
        // Checked every time, not only on creation. The project path can
        // reasonably invite once, because a channel Grant left is a channel he
        // left on purpose; a workspace channel that has been re-mapped or
        // re-created without him is just an empty room, and 0050 exists because
        // we shipped exactly that once already.
        invited: await this.inviteSubject(mapped.channel_id),
      }
    }

    try {
      const { body } = await this.slack.call('conversations.create', { name, is_private: false })
      const channel = body.channel as { id?: string; name?: string } | undefined
      const channelId = channel?.id ?? ''
      await this.mapWorkspaceChannel(channelId, channel?.name ?? name, purpose)
      return {
        outcome: 'created',
        channelId,
        channelName: channel?.name ?? name,
        errorCode: null,
        invited: await this.inviteSubject(channelId),
      }
    } catch (error) {
      if (!(error instanceof SlackApiError)) throw error
      if (error.code !== 'name_taken') {
        return { outcome: 'failed', channelId: null, channelName: name, errorCode: error.code }
      }
      // Someone — probably a previous run whose response was lost — already
      // made it. Find it by name and adopt it.
      const found = await this.findByName(name)
      if (found === null) {
        return {
          outcome: 'name_conflict',
          channelId: null,
          channelName: name,
          errorCode: 'name_taken',
        }
      }
      await this.mapWorkspaceChannel(found, name, purpose)
      return {
        outcome: 'adopted',
        channelId: found,
        channelName: name,
        errorCode: null,
        invited: await this.inviteSubject(found),
      }
    }
  }

  /** The channel with this name, from Slack's own list, or null. */
  private async findByName(name: string): Promise<string | null> {
    // `exclude_archived`, because an archived channel of the same name is why
    // `conversations.create` said `name_taken` and is not a channel to post in.
    const { body } = await this.slack.call('conversations.list', {
      exclude_archived: true,
      types: 'public_channel',
      limit: 1000,
    })
    const channels = (body.channels ?? []) as { id?: string; name?: string }[]
    return channels.find((c) => c.name === name)?.id ?? null
  }

  private async mapWorkspaceChannel(
    channelId: string,
    channelName: string,
    purpose: string,
  ): Promise<void> {
    if (channelId === '') return
    await this.db.execute(`
      insert into public.slack_channel_map
        (channel_id, team_id, project_id, channel_name, purpose, created_by_app)
      values (${lit(channelId)}, ${lit(this.teamId)}, null, ${lit(channelName)},
              ${lit(purpose)}, true)
      on conflict (channel_id) do update
        set channel_name = excluded.channel_name, active = true, archived_at = null
    `)
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
    discipline?: string | null,
  ): Promise<void> {
    await this.db.execute(`
      insert into public.slack_channel_map
        (channel_id, team_id, project_id, channel_name, purpose, created_by_app, discipline)
      values (${lit(channelId)}, ${lit(this.teamId)}, ${lit(projectId)}::uuid,
              ${lit(channelName)}, 'project', ${createdByApp ? 'true' : 'false'},
              ${discipline === undefined || discipline === null ? 'null' : lit(discipline)})
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
