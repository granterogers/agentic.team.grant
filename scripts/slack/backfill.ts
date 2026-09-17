/**
 * Bring a project's existing Slack history into its conversation.
 *
 *   npm run slack:backfill -- --project <slug>          # dry run, says what it would do
 *   npm run slack:backfill -- --project <slug> --go
 *   npm run slack:backfill -- --project <slug> --go --most 2000
 *
 * Issue #193's last criterion: a project connected today should not be a
 * conversation that starts today.
 *
 * ## The safety property, stated once and enforced in the database
 *
 * Nothing here enqueues anything. `app.record_slack_history` (0340) writes the
 * message and stamps `processed_at`; it never calls `enqueue_inbound`.
 *
 * That is not a detail. Every message in a channel's history is an instruction
 * as far as the router is concerned, so importing six months of a project
 * channel and enqueueing it would have the office act on every request Grant
 * made since March — re-generating decks, re-reading folders, re-asking
 * questions he answered in April, and messaging him about all of it. Each job
 * doing exactly what it was told.
 *
 * The rule lives in the RPC rather than here so a second caller cannot get it
 * wrong.
 *
 * ## Dry by default
 *
 * Grant: *"You should always check before making any destructive action with
 * me."* An import is not destructive — the dedupe key makes a re-run a no-op —
 * but it does put hundreds of rows on a page he reads, so it says what it will
 * do and stops until told `--go`.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { SlackClient } from '../../src/slack/api.ts'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const GO = process.argv.includes('--go')
const SLUG = arg('project')
const MOST = Number(arg('most') ?? '1000')

if (SLUG === undefined || SLUG === '') {
  console.error('usage: npm run slack:backfill -- --project <slug> [--go] [--most N]')
  process.exit(2)
}

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const project = await one(`
  select p.project_id::text as id, p.name, m.channel_id, m.channel_name
    from public.projects p
    join public.slack_channel_map m on m.project_id = p.project_id and m.active
   where p.slug = ${lit(SLUG)}
   order by m.discipline nulls first
   limit 1
`)
if (project.channel_id === undefined) {
  console.error(`no active Slack channel is mapped to the project "${SLUG}"`)
  console.error('  #187 gives every dashboard project a channel; this one has none yet.')
  process.exit(1)
}
const channelId = String(project.channel_id)

const botToken = String(
  (
    await one(
      `select app.resolve_secret(bot_token_ref) as t
         from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  ).t ?? '',
)
if (botToken === '') {
  console.error('no enabled Slack install with a resolvable bot token')
  process.exit(1)
}
const slack = new SlackClient(botToken)

console.log(`\n${String(project.name)} — #${String(project.channel_name)}`)
console.log(GO ? '  importing' : '  DRY RUN — nothing will be written; add --go')

interface SlackMessage {
  ts?: string
  user?: string
  text?: string
  thread_ts?: string
  subtype?: string
  bot_id?: string
}

let cursor: string | undefined
let seen = 0
let added = 0
let already = 0
let skipped = 0

/*
  Oldest-first is not available from `conversations.history` — it pages
  backwards from now. That is fine: order in the conversation comes from
  `received_at`, which is the message's own ts, not from insertion order.
*/
for (;;) {
  const page = await slack.call('conversations.history', {
    channel: channelId,
    limit: 200,
    ...(cursor === undefined ? {} : { cursor }),
  })
  const body = page.body as unknown as {
    ok?: boolean
    error?: string
    messages?: SlackMessage[]
    response_metadata?: { next_cursor?: string }
  }
  if (body.ok !== true) {
    console.error(`  Slack refused: ${String(body.error)}`)
    if (body.error === 'not_in_channel') {
      console.error('  The app is not in that channel. Invite it, then run this again.')
    }
    process.exit(1)
  }

  for (const m of body.messages ?? []) {
    seen += 1
    /*
      The office's own posts are not part of what was said TO it, and importing
      them would put every answer in the conversation twice — once from
      `outputs`, which is where the office's side already comes from, and once
      as though Grant had said it. Same rule as the live path (#195), applied to
      history.
    */
    if (m.bot_id !== undefined || m.subtype !== undefined) {
      skipped += 1
      continue
    }
    if (GO) {
      const r = (
        await one(`
          select app.record_slack_history(
            ${lit(channelId)}, ${lit(String(m.ts ?? ''))}, ${lit(String(m.user ?? ''))},
            ${lit(String(m.text ?? ''))},
            ${m.thread_ts === undefined ? 'null' : lit(m.thread_ts)}) as v
        `)
      ).v as { ok?: boolean; outcome?: string; error?: string }
      if (r?.ok !== true) {
        console.error(`  ${String(m.ts)}: ${String(r?.error)}`)
        skipped += 1
      } else if (r.outcome === 'added') added += 1
      else if (r.outcome === 'already there') already += 1
      else skipped += 1
    }
    if (seen >= MOST) break
  }

  cursor = body.response_metadata?.next_cursor
  if (cursor === undefined || cursor === '' || seen >= MOST) break
}

console.log(`\n  ${String(seen)} message(s) read from Slack`)
if (GO) {
  console.log(
    `  ${String(added)} added · ${String(already)} already there · ${String(skipped)} skipped`,
  )
  console.log(
    '\n  None of them was enqueued. Importing history does not make the office act on it.',
  )
} else {
  console.log(
    `  ${String(skipped)} of those are the office's own posts or joins and would be skipped`,
  )
  console.log('\n  Add --go to import. A re-run is safe: the dedupe key makes it a no-op.')
}
