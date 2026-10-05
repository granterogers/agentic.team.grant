/**
 * Create, rename and inspect projects.
 *
 *   npm run project -- --list
 *   npm run project -- --create="Money Mastery" --notebook=<id>
 *   npm run project -- --create="Money Mastery" --notion=<database id>
 *   npm run project -- --rename=money-mastery --to="Money Mastery Q3"
 *   npm run project -- --attach=money-mastery --notion=<id> --role=home --kind=document
 *
 * ## Why a CLI before the front end
 *
 * Grant asked for project configuration to live in the web app — attaching
 * notebooks, naming projects, connecting the dots. That is right, and it is
 * also a screen. Everything the screen will need to do has to exist as an
 * operation first, and an operation with a CLI is one that can be used and
 * checked today rather than when the UI lands.
 *
 * The front end will call the same functions. This is not a stopgap to throw
 * away; it is the layer underneath it.
 *
 * ## What renaming actually has to do
 *
 * A project's name appears in three places that can disagree: the row, the
 * Slack channel prefix, and the channels themselves. Renaming only the row
 * leaves `#money-mastery-research` under a project called something else, which
 * is precisely the mess Grant is trying to avoid. So a rename renames all of
 * them, and reports each.
 */

import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { SlackApiError, SlackClient } from '../../src/slack/api.ts'
import { channelNameFor, channelPrefixFor } from '../../src/slack/provision.ts'

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
const arg = (name: string): string | null => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found === undefined ? null : found.slice(name.length + 3)
}
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const slug = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

// --- list --------------------------------------------------------------------

if (process.argv.includes('--list') || process.argv.length <= 2) {
  const rows = (
    await db.execute(`
      select p.slug, p.name, p.channel_prefix, p.status,
             (select count(*) from public.documents d where d.project_id = p.project_id) as docs,
             (select count(*) from public.slack_channel_map m
               where m.project_id = p.project_id and m.active) as channels,
             (select string_agg(a.connector || ':' || a.role, ', ' order by a.role)
                from public.project_attachments a
               where a.project_id = p.project_id and a.enabled) as attachments
        from public.projects p
       where p.status = 'active'
       order by p.name
    `)
  ).rows as Record<string, unknown>[]

  console.log('| project | prefix | docs | channels | attached to |')
  console.log('|---|---|---|---|---|')
  for (const r of rows) {
    console.log(
      `| ${String(r.name)} (\`${String(r.slug)}\`) | ${String(r.channel_prefix)} | ${String(r.docs)} | ` +
        `${String(r.channels)} | ${String(r.attachments ?? '—')} |`,
    )
  }
  console.log(`\n${String(rows.length)} active project(s).`)
  process.exit(0)
}

// --- create ------------------------------------------------------------------

const create = arg('create')
if (create !== null) {
  const notebook = arg('notebook')
  const notion = arg('notion')
  if (notebook === null && notion === null) {
    // 0067's rule, restated where a person meets it. A project attached to
    // nothing has nothing to read and nowhere to write, and the database will
    // refuse it anyway — better to say so before the transaction than after.
    console.error(
      'a project needs at least one source: pass --notebook=<id> or --notion=<database id>.\n' +
        'You cannot start a project in isolation; there would be nothing in it.',
    )
    process.exit(2)
  }
  const connector = notebook !== null ? 'notebooklm' : 'notion'
  const ref = notebook ?? String(notion)

  const created = await one(`
    with created as (
      insert into public.projects (slug, name, channel_prefix, status)
      values (${lit(slug(create))}, ${lit(create)}, ${lit(channelPrefixFor(create))}, 'active')
      returning project_id, slug, name
    ),
    attached as (
      insert into public.project_attachments
        (project_id, connector, external_ref, display_name, role)
      select project_id, ${lit(connector)}, ${lit(ref)}, ${lit(create)}, 'source' from created
      returning project_id
    )
    select project_id::text as id, slug, name from created
  `)
  console.log(
    `created "${String(created?.name)}" (${String(created?.slug)}), attached to ${connector} ${ref}`,
  )
  console.log(
    `channels will be named ${channelNameFor(create)}, ${channelNameFor(create, 'research-director')}, …`,
  )
  process.exit(0)
}

// --- attach ------------------------------------------------------------------

const attach = arg('attach')
if (attach !== null) {
  const notebook = arg('notebook')
  const notion = arg('notion')
  const role = arg('role') ?? 'source'
  const kind = arg('kind')
  if (notebook === null && notion === null) {
    console.error('pass --notebook=<id> or --notion=<database id>')
    process.exit(2)
  }
  if (role === 'home' && kind === null) {
    // A home must say what it is the home for. "The home for everything" is how
    // one connector quietly becomes the store again (ADR-0014).
    console.error('--role=home also needs --kind=document|artifact|task')
    process.exit(2)
  }
  const project = await one(
    `select project_id::text as id, name from public.projects where slug = ${lit(attach)}`,
  )
  if (project === undefined) {
    console.error(`no project with slug ${attach}`)
    process.exit(1)
  }
  const connector = notebook !== null ? 'notebooklm' : 'notion'
  await db.execute(`
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role, artifact_kind)
    values (${lit(String(project.id))}::uuid, ${lit(connector)}, ${lit(notebook ?? String(notion))},
            ${lit(String(project.name))}, ${lit(role)}, ${kind === null ? 'null' : lit(kind)})
    on conflict do nothing
  `)
  console.log(
    `attached ${connector} to "${String(project.name)}" as ${role}${kind === null ? '' : ` (${kind})`}`,
  )
  process.exit(0)
}

// --- rename -------------------------------------------------------------------

const rename = arg('rename')
const to = arg('to')
if (rename !== null) {
  if (to === null) {
    console.error('--rename=<slug> also needs --to="New Name"')
    process.exit(2)
  }
  const project = await one(
    `select project_id::text as id, name from public.projects where slug = ${lit(rename)}`,
  )
  if (project === undefined) {
    console.error(`no project with slug ${rename}`)
    process.exit(1)
  }
  const prefix = channelPrefixFor(to)

  await db.execute(`
    update public.projects
       set name = ${lit(to)}, channel_prefix = ${lit(prefix)}
     where project_id = ${lit(String(project.id))}::uuid
  `)
  console.log(`"${String(project.name)}" → "${to}" (prefix ${prefix})`)

  // And the channels, or the rename is half done. A project called one thing
  // whose channels are called another is exactly the mess this is meant to
  // prevent.
  const botToken = String(
    (
      await one(
        `select app.resolve_secret(bot_token_ref) as t
           from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
      )
    )?.t ?? '',
  )
  if (botToken === '') {
    console.log('no Slack install; channels not renamed')
    process.exit(0)
  }
  const slack = new SlackClient(botToken)
  const channels = (
    await db.execute(`
      select channel_id, channel_name, discipline from public.slack_channel_map
       where project_id = ${lit(String(project.id))}::uuid and active and purpose = 'project'
    `)
  ).rows as { channel_id: string; channel_name: string; discipline: string | null }[]

  for (const c of channels) {
    const proposed = channelNameFor(prefix, c.discipline)
    if (proposed === c.channel_name) continue
    try {
      await slack.call('conversations.rename', { channel: c.channel_id, name: proposed })
      await db.execute(`
        update public.slack_channel_map set channel_name = ${lit(proposed)}
         where channel_id = ${lit(c.channel_id)}
      `)
      console.log(`  #${c.channel_name} → #${proposed}`)
    } catch (error) {
      // Reported and skipped. A name taken by an unrelated channel is a real
      // answer, and taking a channel offline to satisfy a rename would be a
      // poor trade.
      const code =
        error instanceof SlackApiError ? error.code : (error as Error).message.slice(0, 60)
      console.log(`  #${c.channel_name} left alone: ${code}`)
    }
  }
  process.exit(0)
}

console.error('usage: npm run project -- --list | --create=… | --attach=… | --rename=… --to=…')
process.exit(2)
