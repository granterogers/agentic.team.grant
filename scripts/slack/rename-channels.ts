/**
 * Rename app-created channels to the current naming convention.
 *
 *   npm run slack:rename-channels            # show what would change
 *   npm run slack:rename-channels -- --go    # do it
 *
 * The convention changed from `proj-<slug>` to the project's plain-English
 * name: `#proj-ai-team-hq-test` became `#ai-team-hq-test`. A convention change
 * that only applies to channels created after it is not a convention — it is
 * two conventions, and the older channels are the ones a person has already
 * pinned and muted.
 *
 * Renaming a Slack channel keeps its id, its history, its members and its
 * pins, so the mapping in Postgres stays valid and nothing in flight breaks.
 * `channel_name` there is refreshed anyway, because a stale copy of a mutable
 * fact is how `name_taken` stops being informative.
 *
 * Only channels this app created are touched (`created_by_app`), and only
 * those whose current name differs from what the convention now proposes.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { SlackApiError, SlackClient } from '../../src/slack/api.ts'
import { channelNameFor } from '../../src/slack/provision.ts'

const go = process.argv.includes('--go')
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const botToken = String(
  (
    await db.execute(
      `select app.resolve_secret(bot_token_ref) as t
         from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  ).rows[0]?.t ?? '',
)
if (botToken === '') {
  console.error('no enabled Slack install with a resolvable bot token')
  process.exit(1)
}
const slack = new SlackClient(botToken)

const rows = (
  await db.execute(`
    select m.channel_id, m.channel_name, p.name as project_name, p.slug as project_slug
      from public.slack_channel_map m
      join public.projects p on p.project_id = m.project_id
     where m.created_by_app and m.active
     order by m.created_at
  `)
).rows as {
  channel_id: string
  channel_name: string
  project_name: string | null
  project_slug: string
}[]

let changed = 0
let skipped = 0
let reconciled = 0

for (const row of rows) {
  // Postgres says active; Slack is the authority on archived. They disagree
  // for every channel whose suite was interrupted before its cleanup ran, and
  // a mapping that claims a channel is live when it is archived is worse than
  // no mapping: it is a destination the office would try to post into. Fixed
  // here because this is the script already reading both sides.
  const info = await slack.call('conversations.info', { channel: row.channel_id })
  const archived =
    (info.body.channel as { is_archived?: boolean } | undefined)?.is_archived === true
  if (archived) {
    if (go) {
      await db.execute(`
        update public.slack_channel_map
           set active = false, archived_at = coalesce(archived_at, app.now_utc())
         where channel_id = ${lit(row.channel_id)}
      `)
    }
    console.log(`#${row.channel_name} is archived in Slack — mapping marked inactive`)
    reconciled += 1
    continue
  }

  const label =
    row.project_name === null || row.project_name.trim() === ''
      ? row.project_slug
      : row.project_name
  const proposed = channelNameFor(label)
  if (proposed === row.channel_name) {
    skipped += 1
    continue
  }

  if (!go) {
    console.log(`would rename #${row.channel_name} -> #${proposed}`)
    changed += 1
    continue
  }

  try {
    await slack.call('conversations.rename', { channel: row.channel_id, name: proposed })
    await db.execute(`
      update public.slack_channel_map set channel_name = ${lit(proposed)}
       where channel_id = ${lit(row.channel_id)}
    `)
    console.log(`#${row.channel_name} -> #${proposed}`)
    changed += 1
  } catch (error) {
    // Reported and skipped, never fatal. A name already taken by an unrelated
    // channel is a real answer — the old name keeps working, and taking the
    // channel offline to satisfy a naming preference would be a poor trade.
    const code = error instanceof SlackApiError ? error.code : (error as Error).message.slice(0, 60)
    console.log(`#${row.channel_name} left alone: ${code}`)
    skipped += 1
  }
}

console.log(
  `\n${String(changed)} ${go ? 'renamed' : 'to rename'}, ${String(skipped)} already correct or left alone, ` +
    `${String(reconciled)} archived mapping(s) ${go ? 'reconciled' : 'to reconcile'}.` +
    (go ? '' : '\nRe-run with --go to apply.'),
)
