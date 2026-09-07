/**
 * The channel where the team says hello.
 *
 *   npm run slack:introductions
 *
 * Grant: *"create a channel where it's just kind of a meet and greet where
 * every other staff says hello, what the role is, that kind of thing."*
 *
 * The point is not the text. It is that eight people with names, faces and
 * remits exist in the sidebar before any of them has been asked to do anything
 * — *"the point is to make this look like as close as possible to humans"*.
 * A workspace whose only members are a bot and Grant reads as a bot, however
 * good the messages are.
 *
 * ## Why the introductions are written and not generated
 *
 * Every other message in this system is produced by a model, and should be.
 * These are eight fixed paragraphs that will be read once and then sit at the
 * top of a channel for a year, and a model would write eight variations on the
 * same paragraph, in the same voice, each time this ran. What each person is
 * FOR is a fact from §9's roster, not an opinion to be regenerated.
 *
 * ## Idempotent, because it is not
 *
 * Slack has no "post this once" and re-running would produce eight more
 * hellos. The dedupe key is the staff slug and a generation — not a timestamp,
 * not a run id — so running it every day posts nothing on the second day.
 * Editing an introduction below therefore does NOT update the posted one, which
 * is deliberate: silently rewriting what a colleague said last month is the
 * opposite of what this channel is for.
 *
 * `-- --again` is the exception, and it exists because the team was renamed
 * (0079). Eight messages signed with names nobody has any more is worse than
 * eight new ones, so `--again` deletes the previous introductions — by their
 * recorded message refs, which is why `deliveries` holds them — and posts
 * under the next generation. It is not a repair tool for a typo.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { SlackOffice } from '../../src/slack/office.ts'
import { ChannelProvisioner } from '../../src/slack/provision.ts'

/** The channel. Named as a person would name it, not as a system would. */
const CHANNEL = 'the-team'

/**
 * Bumped only when the introductions genuinely have to be said again.
 *
 *   1  the original eight, with surnames
 *   2  first names (0079)
 */
const GENERATION = 2

/**
 * What each of them says, in their own voice.
 *
 * Grounded in §9's roster ceilings: what each person may decide alone is what
 * each person introduces themselves as being for. An introduction that
 * over-claimed would be the first thing Grant learned about them, and wrong.
 */
const HELLO: Record<string, string> = {
  'chief-of-staff':
    'Hello — I’m Claire. I run the desk: anything you send that isn’t addressed to ' +
    'someone in particular lands with me, and I decide who picks it up. If a piece ' +
    'of work needs three of us, I’m the one who says so and who tells you what it ' +
    'will cost in time. I also open the channels — you shouldn’t have to.',
  'strategy-director':
    'Tom here. I do the “should we” rather than the “how”: positioning, what we ' +
    'stop doing, which of two roads is worth the year. I’ll usually come back with ' +
    'the case for and the case against rather than one answer, and say which way ' +
    'I’d go and how strongly.',
  'research-director':
    'I’m Emma. I find out. Market, competitors, prior art, whatever the question ' +
    'turns out to actually be — and I cite where it came from, so you can check me. ' +
    'If our own documents don’t answer something I will say so plainly rather than ' +
    'filling the gap in with something that sounds right.',
  'finance-director':
    'Daniel. Numbers, models, unit economics, and the awkward question about the ' +
    'assumption underneath the spreadsheet. If a figure in something I send you has ' +
    'no source, treat that as a bug and tell me.',
  'growth-director':
    'Ruby — growth and marketing. Channels, funnels, pricing pages, the difference ' +
    'between an audience and a market. I like small tests with a stated hypothesis ' +
    'better than big launches, and I’ll tell you what would have to be true for ' +
    'something to work before we try it.',
  'operations-director':
    'Marcus, operations. Process, sequencing, who is waiting on whom, and the thing ' +
    'that will quietly break in six weeks. If something we do twice could be done ' +
    'once, that’s mine.',
  'quality-director':
    'Grace — quality and risk. I read what the rest of us produce before it reaches ' +
    'you, and I say when it isn’t good enough yet. That is genuinely the job, so ' +
    'please don’t read a rejection from me as friction: an unreviewed answer that ' +
    'you act on is far more expensive than a slow one.',
  'communications-director':
    'Oliver, communications and creative. Words that go outside: copy, decks, the ' +
    'shape of an announcement, what we sound like. Send me something rough and I ' +
    'will send it back sharper rather than longer.',
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, accessToken)

const credential = (
  await db.execute(`
    select team_id, app.resolve_secret(bot_token_ref) as token
      from public.slack_app_credentials where enabled and revoked_at is null limit 1
  `)
).rows[0] as { team_id?: string; token?: string } | undefined

if (credential?.token === undefined || credential.token === '') {
  console.error('no live Slack installation; run npm run deploy:slack first')
  process.exit(1)
}

const slack = new SlackClient(String(credential.token))
const teamId = String(credential.team_id)
const office = await SlackOffice.configured(db, slack)
const provisioner = new ChannelProvisioner(db, slack, teamId)

// A workspace-level channel, so `purpose = 'general'` and no project. 0014's
// constraint is the one that says so: only a project-purpose channel has a
// project, and this belongs to the whole workspace.
const channel = await provisioner.ensureNamedChannel(CHANNEL, 'general')
if (channel.channelId === null) {
  console.error(`could not open #${CHANNEL}: ${String(channel.errorCode)}`)
  process.exit(1)
}
console.log(
  `#${channel.channelName} — ${channel.outcome}${
    channel.invited === undefined ? '' : `, you were ${channel.invited}`
  }`,
)

// `--again`: take down what the previous generation said before saying it
// differently. By recorded message ref, not by reading the channel back: the
// bot must delete only what it posted, and `deliveries` is the record of that.
if (process.argv.includes('--again')) {
  const previous = (
    await db.execute(`
      select dedupe_key, message_ref from public.deliveries
       where channel = 'slack' and state = 'sent' and message_ref is not null
         and dedupe_key like 'introduction:%'
         and dedupe_key not like ${`'introduction:v${String(GENERATION)}:%'`}
    `)
  ).rows as { dedupe_key: string; message_ref: string }[]

  for (const old of previous) {
    try {
      await slack.call('chat.delete', { channel: channel.channelId, ts: old.message_ref })
      console.log(`  removed ${old.dedupe_key}`)
    } catch (error) {
      // A message already gone is the outcome we wanted. Anything else is
      // reported and not fatal: a failed delete leaves a stale hello, which is
      // untidy, where aborting leaves a channel half-rewritten.
      console.log(`  could not remove ${old.dedupe_key}: ${(error as Error).message.slice(0, 80)}`)
    }
  }
  if (previous.length > 0) console.log('')
}

const staff = (
  await db.execute(`
    select staff_id, slug, name, title, avatar_ref from public.staff
     where active and slug not like 'fixture-%'
     order by case slug when 'chief-of-staff' then 0 else 1 end, name
  `)
).rows as {
  staff_id: string
  slug: string
  name: string
  title: string
  avatar_ref: string | null
}[]

console.log('\n| | who | said |')
console.log('|---|---|---|')

for (const person of staff) {
  const text = HELLO[person.slug]
  if (text === undefined) {
    // Named rather than skipped silently: a new director with no introduction
    // is a person who never says hello, and nobody would notice.
    console.log(`| ⚠️ | ${person.name} | no introduction written for ${person.slug} |`)
    continue
  }

  const result = await office.deliver({
    // The slug, so the second run posts nothing. See the header.
    dedupeKey: `introduction:v${String(GENERATION)}:${person.slug}`,
    teamId,
    channelId: channel.channelId,
    purpose: 'notice',
    staff: {
      slug: person.slug,
      name: person.name,
      title: person.title,
      avatarRef: person.avatar_ref,
    },
    staffId: person.staff_id,
    message: {
      staffTitle: person.title,
      body: text,
      metadata: null,
      // No job produced this, so there is nothing to correlate a click to.
      // Hence also no buttons: an Undo on "hello" would do nothing, and a
      // button that does nothing teaches that buttons do nothing.
      correlationId: `introduction-${person.slug}`,
      actions: [],
    },
  })

  const icon = result.outcome === 'sent' ? '✅' : result.outcome === 'already_sent' ? '·' : '❌'
  console.log(`| ${icon} | ${person.name} — ${person.title} | ${result.outcome} |`)
}

console.log(`\nhttps://app.slack.com/client/${teamId}`)
