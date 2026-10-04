/**
 * Reading recent mail into the cache the team answers from.
 *
 * Grant asked for Gmail, and 0123 gave it a Connect button. A button that
 * connects to nothing is worse than no button: it reports success and changes
 * nothing, which is the failure shape this project keeps finding. This is the
 * half that makes it mean something.
 *
 * Deliberately shaped like `calendar.ts`, down to the outcome type and the page
 * bound. That pattern is proven here — cache what was seen, answer from the
 * cache, keep answering when Google is unreachable (§18 case 3) — and two
 * different shapes for two Google readers would be two sets of bugs.
 *
 * ## Two requests per message, and what the second one now asks for
 *
 * `messages.list` returns ids only, so each message needs a `messages.get`.
 *
 * That call used to ask for `format=metadata`, so the body was never
 * transferred at all — ADR-0037's decision, made unasked, and the right one to
 * make that way. **#172 and ADR-0038 reverse it on Grant's explicit written
 * authorisation**, because every attempt at "what decisions have been made by
 * email" and "are there outstanding commitments I have forgotten" had ended at
 * the same wall: a subject line and a hundred-character snippet cannot support
 * either without a model guessing about his own business.
 *
 * The reversal is narrow rather than total, and `body.ts` holds all of it:
 * bulk mail is refused BEFORE it is decoded, the quoted reply chain is
 * stripped so a ten-message thread is not stored ten times, a letter over
 * 30,000 characters is refused, and a body is forgotten at 90 days while the
 * fact that the message existed survives to 180. What is stored is fenced as
 * untrusted at every reader, because a message body is the cheapest injection
 * surface in the product: anybody can send Grant an email.
 *
 * ## Why the cap is low
 *
 * Fifty messages. Not a rate limit — Gmail's quota is generous — but a
 * usefulness one: the question the team gets asked is "what has come in", and
 * the answer to that is the last day or two. An inbox mirror would be a
 * liability that grows every hour whether or not anyone reads it.
 */
import type { SqlExecutor } from '../db/executor.ts'
import { soleOffice } from '../db/office.ts'
import type { OfficeId } from '../office/context.ts'
import { count } from '../text/plain.ts'
import { type GoogleAccess, type GoogleProblem, googleAccess, recordGoogleHealth } from './auth.ts'
import { heldBody, type Part } from './body.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nullable = (v: string | null | undefined): string =>
  v === null || v === undefined || v === '' ? 'null' : lit(v)

/** Matches `CalendarOutcome` so the two handlers can report identically. */
export interface MailOutcome {
  readonly ok: boolean
  /** Set when `ok` is false: what kind of problem, for the incident layer (#413). */
  readonly problem?: GoogleProblem
  readonly note: string
  readonly seen: number
  readonly stored: number
  readonly removed: number
}

interface GmailMessage {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: Part & { headers?: { name?: string; value?: string }[] }
}

/** `"Jane Smith" <jane@example.com>` → name and address, separately. */
export const parseFrom = (raw: string): { name: string | null; address: string | null } => {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw)
  if (angled !== null) {
    const name = (angled[1] ?? '').replace(/^"|"$/g, '').trim()
    return { name: name === '' ? null : name, address: (angled[2] ?? '').trim().toLowerCase() }
  }
  const bare = raw.trim()
  // A bare address is an address, not a name. Storing it as a name would make
  // "who emailed about this" return a display name nobody chose.
  return bare === '' ? { name: null, address: null } : { name: null, address: bare.toLowerCase() }
}

const header = (m: GmailMessage, name: string): string => {
  const found = (m.payload?.headers ?? []).find(
    (h) => (h.name ?? '').toLowerCase() === name.toLowerCase(),
  )
  return (found?.value ?? '').trim()
}

/** How many addresses a header lists, without keeping any of them. */
const countAddresses = (raw: string): number =>
  raw.trim() === '' ? 0 : raw.split(',').filter((p) => p.trim() !== '').length

export async function refreshMail(
  db: SqlExecutor,
  options: {
    readonly hours?: number
    readonly max?: number
    readonly fetchImpl?: typeof fetch
    /**
     * The office this refresh caches mail for: the claimed job's. Absent, the deployment's only person office (a
     * single-office deployment's legacy callers); with two real offices that is `no_office`, never a guess.
     */
    readonly officeId?: OfficeId
  } = {},
): Promise<MailOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch
  const office = options.officeId ?? (await soleOffice(db))
  const hours = options.hours ?? 48
  const max = Math.max(1, Math.min(100, options.max ?? 50))

  const enabled = (
    await db.execute(`
      select coalesce((select value::text::boolean from public.system_config
                        where key = 'gmail.enabled'), false) as on
    `)
  ).rows[0] as { on: boolean }
  if (!enabled.on) {
    // §17: an integration turned off stays off and says so, rather than being
    // quietly skipped. What is already cached stays readable.
    return { ok: true, note: 'gmail is switched off in Settings', seen: 0, stored: 0, removed: 0 }
  }

  const access = await googleAccess(db, fetchImpl)
  await recordGoogleHealth(db, access, office)
  if (!access.ok) {
    return { ok: false, problem: access.code, note: access.reason, seen: 0, stored: 0, removed: 0 }
  }

  const granted = access as GoogleAccess
  if (!granted.scopes.some((s) => s.includes('gmail.readonly') || s.includes('gmail.modify'))) {
    return {
      ok: false,
      problem: 'missing_scope',
      // A scope unchecked on the consent screen. Named, because the alternative
      // symptom is a 403 from an endpoint that looks fine.
      note: `the connection has no Gmail read scope — granted: ${granted.scopes.join(' ') || 'none'}`,
      seen: 0,
      stored: 0,
      removed: 0,
    }
  }

  // --- which messages -------------------------------------------------------
  const ids: string[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 3 && ids.length < max; page += 1) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
    // Gmail's own query language. `newer_than` is in days and takes whole
    // numbers, so the hours are rounded UP: asking for 36 hours and getting
    // one day would silently miss half the window.
    url.searchParams.set('q', `newer_than:${String(Math.ceil(hours / 24))}d -in:chats`)
    url.searchParams.set('maxResults', String(Math.min(100, max - ids.length)))
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken)

    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${granted.accessToken}` },
    })
    const body = (await response.json().catch(() => ({}))) as {
      messages?: { id?: string }[]
      nextPageToken?: string
      error?: { message?: string; code?: number }
    }
    if (body.error !== undefined) {
      return {
        ok: false,
        problem: 'api_error',
        note: `Google refused: ${String(body.error.code ?? '')} ${String(body.error.message ?? '')}`.trim(),
        seen: ids.length,
        stored: 0,
        removed: 0,
      }
    }
    for (const m of body.messages ?? []) if (m.id !== undefined) ids.push(m.id)
    pageToken = body.nextPageToken
    if (pageToken === undefined) break
  }

  // --- and what is in their headers ----------------------------------------
  const seenIds: string[] = []
  let stored = 0
  for (const id of ids) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`)
    /*
      `full`, not `metadata` — changed by #172 and ADR-0038, on Grant's explicit
      authorisation. The body comes back as a MIME tree of base64url leaves and
      `heldBody` decides, in this order, whether any of it is stored: bulk mail
      is refused before it is decoded, the quoted reply chain is stripped, and
      a letter over 30,000 characters is refused as too large.

      `metadataHeaders` is deliberately NOT sent with it: `full` returns every
      header anyway, and a narrowing parameter Gmail ignores is a comment that
      looks like a control.
    */
    url.searchParams.set('format', 'full')
    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${granted.accessToken}` },
    })
    const m = (await response.json().catch(() => ({}))) as GmailMessage & {
      error?: { message?: string }
    }
    if (m.error !== undefined || m.id === undefined) continue

    const from = parseFrom(header(m, 'From'))
    const labels = m.labelIds ?? []
    const held = heldBody(m.payload, labels, m.payload?.headers ?? [])
    const sentAt =
      m.internalDate === undefined || m.internalDate === ''
        ? null
        : new Date(Number(m.internalDate)).toISOString()

    await db.execute(`
      insert into public.mail_messages
        (message_id, thread_id, subject, from_name, from_address, to_count,
         sent_at, excerpt, labels, has_attachments, unread, last_seen_at, vanished_at,
         body, body_at, body_withheld, office_id)
      values (
        ${lit(m.id)}, ${lit(String(m.threadId ?? m.id))},
        ${nullable(header(m, 'Subject').slice(0, 400))},
        ${nullable(from.name?.slice(0, 200))}, ${nullable(from.address?.slice(0, 320))},
        ${String(countAddresses(header(m, 'To')) + countAddresses(header(m, 'Cc')))},
        ${sentAt === null ? 'null' : `${lit(sentAt)}::timestamptz`},
        ${nullable((m.snippet ?? '').slice(0, 400))},
        array[${labels.map((l) => lit(l)).join(', ')}]::text[],
        ${labels.includes('HAS_ATTACHMENT') ? 'true' : 'false'},
        ${labels.includes('UNREAD') ? 'true' : 'false'},
        app.now_utc(), null,
        ${held.body === null ? 'null' : lit(held.body)},
        ${held.body === null ? 'null' : 'app.now_utc()'},
        ${held.withheld === null ? 'null' : lit(held.withheld)},
        ${lit(office)}::uuid
      )
      on conflict (message_id) do update
        set subject = excluded.subject,
            labels = excluded.labels,
            unread = excluded.unread,
            last_seen_at = app.now_utc(),
            -- A message that came back was not deleted after all.
            vanished_at = null,
            /*
              A re-read REPLACES the body rather than merging with it, because
              a message is immutable and a second read of the same id is the
              same letter. The one case that matters is a body the office aged
              out at 90 days seeing its message again inside the 48-hour
              window, which cannot happen — and if the window were ever widened
              past the retention, restoring the body is the honest answer
              anyway.
            */
            body = excluded.body,
            body_at = excluded.body_at,
            body_withheld = excluded.body_withheld
        -- The key is still global (message_id): a message another office holds is never overwritten.
        where public.mail_messages.office_id = excluded.office_id
    `)
    seenIds.push(m.id)
    stored += 1
  }

  // --- what has gone ---------------------------------------------------------
  //
  // Only within the window we just asked about: a message older than the window
  // is not missing, it is simply not something we looked for. Marking those as
  // vanished would flag the whole cache every run.
  let removed = 0
  if (seenIds.length > 0) {
    const kept = seenIds.map((i) => lit(i)).join(', ')
    const gone = await db.execute(`
      update public.mail_messages
         set vanished_at = app.now_utc()
       where office_id = ${lit(office)}::uuid
         and vanished_at is null
         and sent_at > app.now_utc() - make_interval(hours => ${String(hours)})
         and message_id not in (${kept})
      returning message_id
    `)
    removed = gone.rows.length
  }

  return {
    ok: true,
    note:
      stored === 0 && removed === 0
        ? 'nothing new in the inbox'
        : `${count(stored, 'message', 'messages')}${
            removed === 0 ? '' : `, and ${count(removed, 'one', 'ones')} no longer there`
          }`,
    seen: ids.length,
    stored,
    removed,
  }
}
