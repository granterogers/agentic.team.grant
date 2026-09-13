/**
 * Make the channel list readable: plain English, underscores, and no test debris.
 *
 *   npm run slack:tidy            # the plan, nothing changed
 *   npm run slack:tidy -- --go    # rename and archive
 *
 * Grant, twice: *"look at the channel names. They're fucking all over the
 * place. I told you already. Make them all plain English, and I prefer
 * underscore rather than hyphen. It's easier to read."*
 *
 * He is right on both counts, and the second one is our mess rather than a
 * preference: 73 channels, of which about sixty are `slack-office-verification-
 * fixture-<digits>` left behind by verification runs. `verify:slack` provisions
 * a real channel in a real workspace because that is the only way to check that
 * provisioning works — but it archived them under their own names instead of
 * getting them out of the way, so browsing channels shows sixty rooms nobody
 * will ever open.
 *
 * ## What this does, and what it cannot
 *
 *   - **renames** every live channel we own to the underscore convention
 *     (`channelNameFor`), and updates `slack_channel_map` in the same pass so
 *     Postgres does not go on believing the old name;
 *   - **archives** the fixture channels a crashed verification left active.
 *
 * It cannot rename an ARCHIVED channel — Slack refuses — and there is no public
 * API to delete one outside Enterprise Grid. So the sixty already-archived
 * fixtures keep their names. They are out of the sidebar, and the real fix is
 * that no more of them are created; that is a change to `verify:slack`, not
 * something a tidy-up script can do afterwards.
 *
 * ## What it will never touch
 *
 * Any channel this system did not create. `social`, `all-agentic-team-grant`
 * and anything else of Grant's is matched by nothing here: a channel qualifies
 * only by being in `slack_channel_map` or by carrying one of our own fixture
 * prefixes, and both are things we wrote.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { channelNameFor } from '../../src/slack/provision.ts'

const go = process.argv.includes('--go')
const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const credential = (
  await db.execute(`
    select team_id, app.resolve_secret(bot_token_ref) as token
      from public.slack_app_credentials where enabled and revoked_at is null limit 1
  `)
).rows[0] as { team_id?: string; token?: string } | undefined
if (credential?.token === undefined) {
  console.error('no Slack credential')
  process.exit(1)
}
const slack = new SlackClient(String(credential.token))

/** Ours by our own record, not by pattern-matching a name. */
const mapped = (
  await db.execute(`
    select m.channel_id, m.channel_name, m.purpose, m.discipline,
           p.name as project_name, p.slug as project_slug, p.status
      from public.slack_channel_map m
      left join public.projects p using (project_id)
     where m.active
     order by m.channel_name
  `)
).rows as {
  channel_id: string
  channel_name: string
  purpose: string
  discipline: string | null
  project_name: string | null
  project_slug: string | null
  status: string | null
}[]

/**
 * The two workspace rooms, whose names are their identity.
 *
 * Not derived from a project, so `channelNameFor` has nothing to work from —
 * they are named here, the same place the code that posts into them names them.
 */
const WORKSPACE: Record<string, string> = {
  'the-team': 'the_team',
  'the-floor': 'the_floor',
}

/**
 * Left behind by a verification run that did not finish.
 *
 * `[-_]` everywhere a separator can appear, and not by taste. This pattern was
 * written with hyphens, and then Grant asked for underscores in channel names —
 * so the provisioner started producing `slack_office_verification_fixture_…`
 * and this stopped matching it. Two verification channels sat live in his
 * workspace until he said *"I don't want a bunch of weird alphanumeric channel
 * names"*, which is a cleanup rule broken by the change it was supposed to
 * survive.
 *
 * `zz[-_]test[-_]` added with the same change that made `verify:slack` name its
 * channels that way at CREATION rather than at teardown. Both halves are
 * needed: the new name means a crashed run leaves obvious debris, and this
 * means the sweep can still collect it.
 */
const FIXTURE =
  /^(slack[-_]office[-_]verification[-_]fixture|proj[-_]fixture[-_]slack[-_]office|gate\d[-_]probe|probe\d?[-_]|zz[-_]test[-_])/

interface Plan {
  id: string
  from: string
  to: string | null
  action: 'rename' | 'archive' | 'leave'
  why: string
}

const live = (await slack.call('conversations.list', {
  limit: '200',
  types: 'public_channel,private_channel',
  exclude_archived: 'true',
})) as { body: { channels?: { id: string; name: string }[] } }

/**
 * The names already in use, so a rename cannot be planned into a collision.
 *
 * `the-floor` and `the_floor` both existed: the underscore convention created
 * the second, the first was never cleaned up, and planning a rename of one onto
 * the other is a Slack `name_taken` error at the point of writing. A duplicate
 * whose correct name is already taken is not a rename, it is a leftover — so it
 * is archived instead, which is reversible and gets it out of the sidebar.
 */
const takenNames = new Set((live.body.channels ?? []).map((c) => c.name))

const plans: Plan[] = []
for (const channel of live.body.channels ?? []) {
  const record = mapped.find((m) => m.channel_id === channel.id)

  if (FIXTURE.test(channel.name)) {
    plans.push({
      id: channel.id,
      from: channel.name,
      to: null,
      action: 'archive',
      why: 'verification debris a crashed run left active',
    })
    continue
  }

  if (WORKSPACE[channel.name] !== undefined) {
    const want = WORKSPACE[channel.name] as string
    plans.push(
      takenNames.has(want)
        ? {
            id: channel.id,
            from: channel.name,
            to: null,
            action: 'archive',
            why: `a duplicate — ${want} already exists and is the live one`,
          }
        : {
            id: channel.id,
            from: channel.name,
            to: want,
            action: 'rename',
            why: 'a workspace room, renamed to the underscore convention',
          },
    )
    continue
  }

  if (record === undefined) {
    // Not in our map, not one of ours. Grant's own channel, or a Slack
    // default. Named so the report is complete, and left completely alone.
    plans.push({ id: channel.id, from: channel.name, to: null, action: 'leave', why: 'not ours' })
    continue
  }

  // A project channel. The name comes from `channelNameFor`, which is the same
  // function that would name it today — so this is not a one-off rewrite but a
  // reconciliation against the convention.
  const want = channelNameFor(
    record.project_name ?? record.project_slug ?? record.channel_name,
    record.discipline,
  )
  plans.push({
    id: channel.id,
    from: channel.name,
    to: want === channel.name ? null : want,
    action: want === channel.name ? 'leave' : 'rename',
    why: want === channel.name ? 'already correct' : `project “${String(record.project_name)}”`,
  })
}

console.log('| | channel | becomes | why |')
console.log('|---|---|---|---|')
let changed = 0
for (const p of plans.sort((a, b) => a.from.localeCompare(b.from))) {
  const mark = p.action === 'leave' ? '·' : go ? '✅' : '→'
  console.log(
    `| ${mark} | ${p.from} | ${p.to ?? (p.action === 'archive' ? 'archived' : '—')} | ${p.why} |`,
  )
  if (p.action === 'leave' || !go) continue

  try {
    if (p.action === 'archive') {
      await slack.call('conversations.archive', { channel: p.id })
      // `archived_at` too: 0014 makes inactive and archived the same fact
      // (`(active = false) = (archived_at is not null)`), so setting one
      // without the other is refused — which is the constraint doing exactly
      // its job, and caught here on the first real run.
      await db.execute(`
        update public.slack_channel_map
           set active = false, archived_at = app.now_utc()
         where channel_id = ${lit(p.id)}
      `)
    } else {
      await slack.call('conversations.rename', { channel: p.id, name: String(p.to) })
      // In the same pass. A rename that Slack accepts and Postgres does not
      // hear about leaves the map naming a channel that no longer exists under
      // that name — and 0014's whole point is that the map is the truth.
      await db.execute(`
        update public.slack_channel_map set channel_name = ${lit(String(p.to))}
         where channel_id = ${lit(p.id)}
      `)
    }
    changed += 1
  } catch (error) {
    console.log(`|  ⚠️ | ${p.from} | failed | ${(error as Error).message.slice(0, 80)} |`)
  }
}

const archivedFixtures = plans.filter((p) => p.action === 'archive').length
console.log(
  go
    ? `\n${String(changed)} channel(s) changed.`
    : `\nNothing changed. Re-run with --go.\n` +
        `${String(plans.filter((p) => p.action === 'rename').length)} to rename, ` +
        `${String(archivedFixtures)} fixture(s) to archive.`,
)
console.log(
  '\nAlready-archived fixtures keep their names: Slack refuses to rename an archived\n' +
    'channel and offers no way to delete one outside Enterprise Grid. They are out of\n' +
    'the sidebar. The fix that matters is that no more are created.',
)
