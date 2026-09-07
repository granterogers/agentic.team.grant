/**
 * Every member of the team messaging Grant directly, once, on both surfaces.
 *
 *   npm run team:hello              # who would say what, and where
 *   npm run team:hello -- --go      # send it
 *
 * Grant: *"get each team member to message me individually on Slack. I am also
 * waiting for the same on telegram."*
 *
 * ## Why this is not the #the-team channel again
 *
 * That channel is a noticeboard: eight introductions posted into one room,
 * which is how you meet a team. This is eight private conversations, which is
 * how you get a colleague — the difference is that afterwards there is a DM
 * thread with Grace in his sidebar, and replying in it reaches Grace.
 *
 * On Telegram that is already true: each person has their own bot and a reply
 * goes to that person. On Slack there is one app, so the DM comes from the app
 * wearing that person's name and face (`chat:write.customize`), which is the
 * same mechanism the project channels use.
 *
 * ## Once, and the delivery table decides that
 *
 * The dedupe key is the person and the surface. Running this daily sends
 * nothing on the second day, and there is no "introduced_at" column to fall out
 * of step with the messages it claims to describe.
 *
 * ## Why the text is written and not generated
 *
 * Same reason as the channel introductions: eight paragraphs read once and then
 * scrolled past, where a model would produce eight variations on one paragraph
 * every time this ran. What each person is FOR is a fact from §9's roster.
 */

import { DeliveryService } from '../../src/channels/delivery.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { SlackOffice } from '../../src/slack/office.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { escapeHtml } from '../../src/telegram/message.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

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

/**
 * What each of them says when they message him directly.
 *
 * Shorter than the channel introductions and pointed at the thing a DM is for:
 * what to send THIS person, as opposed to what they do in general. A private
 * message that repeats a noticeboard post is a private message he closes.
 */
const HELLO: Record<string, string> = {
  'chief-of-staff':
    'Hello — Claire. This chat reaches me directly. Send me anything you have not ' +
    'decided who should handle: I read it, decide who picks it up, and tell you which. ' +
    'Links work too — paste one and say what you want done with it, or say nothing and ' +
    'I will file it. If it needs several steps I will write them out and wait for you ' +
    'to say go.',
  'strategy-director':
    'Tom. Use this one for “should we” rather than “how”: positioning, what to stop ' +
    'doing, which of two roads is worth the year. I will usually give you the case ' +
    'both ways and then say which way I would go, and how strongly.',
  'research-director':
    'Emma here. Send me questions and send me sources — a link, a video, a paper — and ' +
    'I will read them and come back with what they actually say, with citations. If our ' +
    'material does not answer something I will tell you that rather than filling the gap.',
  'finance-director':
    'Daniel. Numbers, models, unit economics, and the awkward question under the ' +
    'spreadsheet. If I send you a figure with no source, that is a bug — tell me.',
  'growth-director':
    'Ruby — growth and marketing. Channels, funnels, pricing, positioning to a market ' +
    'rather than an audience. Send me something you want tested and I will tell you what ' +
    'would have to be true for it to work before we spend anything.',
  'operations-director':
    'Marcus, operations. Sequencing, process, who is waiting on whom, and the thing that ' +
    'quietly breaks in six weeks. Anything you find yourself doing twice, send it here.',
  'quality-director':
    'Grace — quality and risk. I read what the rest of us produce before it reaches you, ' +
    'and I say when it is not good enough yet. Send me anything you want a second, ' +
    'unfriendly pair of eyes on.',
  'communications-director':
    'Oliver, communications and creative. Anything that goes outside: copy, decks, the ' +
    'shape of an announcement. Send me something rough and you get it back sharper, ' +
    'not longer.',
}

const team = (
  await db.execute(`
    select s.slug, s.name, s.title, s.avatar_ref,
           t.bot_id, app.resolve_secret(t.token_ref) as bot_token,
           ch.chat_id
      from public.staff s
      -- The chief's bot is registered as the PAGER, with a null staff_slug,
      -- because it also carries alerts that belong to no one person (0082). A
      -- join on staff_slug alone therefore finds a bot for every director and
      -- none for Claire, which is the one person Grant messages most.
      -- (No backticks in here: this comment lives inside a template literal,
      -- and the first version of it ended the string.)
      left join public.telegram_bots t
        on (t.staff_slug = s.slug
            or (s.slug = 'chief-of-staff' and t.staff_slug is null))
       and t.enabled and t.token_ref is not null
      left join public.telegram_chats ch
        on ch.bot_id = t.bot_id and ch.subject = 'grant' and ch.deliverable
     where s.active and s.slug not like 'fixture-%'
     order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name
  `)
).rows as {
  slug: string
  name: string
  title: string
  avatar_ref: string | null
  bot_id: string | null
  bot_token: string | null
  chat_id: string | null
}[]

// --- Slack: one app, eight faces, a DM each ---------------------------------

const credential = (
  await db.execute(`
    select team_id, app.resolve_secret(bot_token_ref) as token
      from public.slack_app_credentials where enabled and revoked_at is null limit 1
  `)
).rows[0] as { team_id?: string; token?: string } | undefined

let dm: string | null = null
let office: SlackOffice | null = null
const teamId = String(credential?.team_id ?? '')

if (credential?.token !== undefined && credential.token !== '') {
  const slack = new SlackClient(String(credential.token))
  office = await SlackOffice.configured(db, slack)
  const subject = (
    await db.execute(
      "select value #>> '{}' as u from public.system_config where key = 'slack.subject_user_id'",
    )
  ).rows[0] as { u?: string } | undefined
  if (subject?.u !== undefined) {
    // `conversations.open` rather than a stored channel id: a DM channel is
    // created on first use and the id is stable afterwards, so asking is both
    // correct on day one and free on day two.
    const { body } = await slack.call('conversations.open', { users: subject.u })
    dm = String((body.channel as { id?: string } | undefined)?.id ?? '') || null
  }
}

console.log(`| | who | slack | telegram |`)
console.log(`|---|---|---|---|`)

let sent = 0
for (const person of team) {
  const text = HELLO[person.slug]
  if (text === undefined) {
    // Named, not skipped: a new director with no introduction is someone who
    // never says hello and nobody notices.
    console.log(`| ⚠️ | ${person.name} | no introduction written | — |`)
    continue
  }

  let slackSaid = 'no slack'
  if (go && office !== null && dm !== null) {
    const result = await office.deliver({
      dedupeKey: `hello:dm:${person.slug}`,
      teamId,
      channelId: dm,
      purpose: 'notice',
      staff: {
        slug: person.slug,
        name: person.name,
        title: person.title,
        avatarRef: person.avatar_ref,
      },
      message: {
        staffTitle: person.title,
        body: text,
        metadata: null,
        correlationId: `hello-${person.slug}`,
        // No buttons on a hello. An Undo on an introduction would do nothing,
        // and a button that does nothing teaches that buttons do nothing.
        actions: [],
      },
    })
    slackSaid = result.outcome
    if (result.outcome === 'sent') sent += 1
  } else if (!go) {
    slackSaid = dm === null ? 'no dm channel' : 'would send'
  }

  let tgSaid = 'no bot'
  if (person.bot_token !== null && person.chat_id !== null) {
    if (!go) tgSaid = 'would send'
    else {
      const service = new DeliveryService(
        db,
        new TelegramTransport(new TelegramClient(person.bot_token)),
      )
      const result = await service.deliver({
        dedupeKey: `hello:telegram:${person.slug}`,
        accountRef: String(person.bot_id),
        targetRef: person.chat_id,
        purpose: 'notice',
        // No correlation: the column is a uuid and a hello has no job behind
        // it. The first version passed `hello-<slug>` and the insert refused
        // it — on Telegram only, because the Slack path never set it.
        staffId: null,
        body: { text: escapeHtml(text), silent: false },
      })
      tgSaid = result.outcome
      if (result.outcome === 'sent') sent += 1
    }
  } else if (person.bot_token !== null) {
    // The bot exists but Grant has never opened it. Telegram forbids a bot
    // messaging first, so this is not a fault to fix in code — he taps Start
    // once and the chat registers itself (0041).
    // The username, not the slug: he has to be able to tap it.
    tgSaid = 'you have not opened it'
  }

  console.log(`| ${go ? '✅' : '·'} | ${person.name} | ${slackSaid} | ${tgSaid} |`)
}

// Which bots he has never opened, named once at the end rather than eight
// times in the table — this is the only manual step and it should be findable.
const unopened = team.filter((p) => p.bot_token !== null && p.chat_id === null)
if (unopened.length > 0) {
  const names = (
    await db.execute(`
      select s.name, t.username from public.staff s
      join public.telegram_bots t on t.staff_slug = s.slug
      where s.slug in (${unopened.map((p) => lit(p.slug)).join(',')})
    `)
  ).rows as { name: string; username: string }[]
  console.log(
    `\nTelegram forbids a bot messaging first. Open each of these once and press Start:\n` +
      names.map((n) => `  ${n.name} — https://t.me/${n.username}`).join('\n'),
  )
}

console.log(go ? `\n${String(sent)} message(s) sent.` : '\nNothing sent. Re-run with --go.')
