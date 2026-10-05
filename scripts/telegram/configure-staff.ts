/**
 * Give each staff bot its name, description and profile photo.
 *
 *   npm run telegram:configure-staff
 *
 * §14: never ask Grant to type something Claude can execute. `/newbot` is the
 * only genuinely manual step — everything a bot looks like afterwards is
 * API-settable, so it is set here rather than in a checklist.
 *
 * Descriptions come from `public.staff`, not from a table in this file. The
 * roster document records an intention; the staff table is what the system
 * actually believes about who these people are, and two sources for one fact
 * is one source too many.
 *
 * Idempotent: every call is a `set`, so re-running changes nothing that is
 * already right. Failures are reported per bot and never stop the others — one
 * revoked token must not leave the other five unconfigured.
 */

import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { avatarBaseUrl } from '../../src/staff/presentation.ts'
import { roster } from '../../src/telegram/roster.ts'

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

/** Telegram caps a bot name at 64 characters and a short description at 120. */
const NAME_MAX = 64
const SHORT_MAX = 120
const DESCRIPTION_MAX = 512
const clip = (v: string, max: number): string => (v.length <= max ? v : `${v.slice(0, max - 1)}…`)

const base = await avatarBaseUrl(db)
const entries = (await roster(db)).filter((e) => e.staffSlug !== null && e.enabled && e.hasToken)

let configured = 0
for (const entry of entries) {
  const slug = String(entry.staffSlug)
  const staff = (
    await db.execute(`
      select name, title, responsibilities, avatar_ref
        from public.staff where slug = ${lit(slug)}
    `)
  ).rows[0] as
    | { name: string; title: string; responsibilities: string | null; avatar_ref: string | null }
    | undefined
  if (staff === undefined) {
    console.log(`⬜ ${slug}: no staff row — skipped`)
    continue
  }

  const token = String(
    (
      await db.execute(
        `select app.resolve_secret(token_ref) as t from public.telegram_bots
          where bot_id = ${lit(entry.botId)}`,
      )
    ).rows[0]?.t,
  )
  const api = async (method: string, body: unknown): Promise<Record<string, unknown>> =>
    (await (
      await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json()) as Record<string, unknown>

  const results: string[] = []
  const step = async (label: string, method: string, body: unknown): Promise<void> => {
    const r = await api(method, body)
    // `setMyName` and friends return an error when the value is unchanged. That
    // is a success for our purposes — the bot already reads correctly — and
    // reporting it as a failure would make a green run impossible on the second
    // invocation of an idempotent script.
    const unchanged =
      r.ok !== true &&
      String(r.description ?? '')
        .toLowerCase()
        .includes('not modified')
    results.push(`${r.ok === true || unchanged ? '' : '!'}${label}`)
  }

  // The name is what appears at the top of the chat: the role, short enough to
  // read on a phone. Not the person's full title, which is for the office.
  await step('name', 'setMyName', { name: clip(`${staff.title} · AI Team`, NAME_MAX) })
  await step('short', 'setMyShortDescription', {
    short_description: clip(staff.title, SHORT_MAX),
  })
  await step('description', 'setMyDescription', {
    description: clip(
      staff.responsibilities ??
        `${staff.name}, part of AI Team HQ. Full conversations live in Slack and Team HQ.`,
      DESCRIPTION_MAX,
    ),
  })
  // A staff bot is not the pager, so it does not offer the pager's controls.
  // Offering /mute on six bots would imply six things to mute.
  await step('commands', 'setMyCommands', { commands: [] })

  // The same photorealistic avatar the office uses. Set through the file
  // upload endpoint, which needs multipart rather than JSON.
  let photo = 'photo:skipped'
  if (base !== null && staff.avatar_ref !== null) {
    const image = await fetch(`${base.replace(/\/+$/, '')}/${staff.avatar_ref}`)
    if (image.ok) {
      const form = new FormData()
      form.set(
        'photo',
        new Blob([await image.arrayBuffer()], { type: 'image/jpeg' }),
        staff.avatar_ref,
      )
      const r = (await (
        await fetch(`https://api.telegram.org/bot${token}/setUserProfilePhotos`, {
          method: 'POST',
          body: form,
        })
      ).json()) as { ok?: boolean; description?: string }
      // Bots cannot set their own photo through the Bot API — it is a
      // BotFather-only operation. Named here rather than left as a silent gap,
      // because "the avatar is missing" is otherwise a mystery.
      photo = r.ok === true ? 'photo' : 'photo:botfather-only'
    } else {
      photo = 'photo:unreachable'
    }
  }

  configured += 1
  console.log(`✅ @${entry.username} (${slug}): ${results.join(', ')}, ${photo}`)
}

console.log(`\n${String(configured)} bot(s) configured.`)
if (entries.length < 7) {
  console.log(
    `${String(7 - entries.length)} of the roster's seven staff bots do not exist yet — ` +
      'see docs/telegram-bot-roster.md. Nothing else waits on them.',
  )
}
