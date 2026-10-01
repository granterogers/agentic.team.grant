/**
 * Reading Grant's calendar, and only his.
 *
 * §20: *"Least-privilege scopes on the dedicated account. Calendar
 * read/write."* This is the read half. Nothing here writes an event, and the
 * scope check below refuses to pretend otherwise — a caller that wanted to
 * create one would have to widen `google.scopes`, reconnect, and add a function
 * that says so in its name.
 *
 * ## `singleEvents`, and why it matters more than it looks
 *
 * A recurring event comes back from Google as ONE object with a recurrence rule
 * unless you ask otherwise. A client that stored that would show "Standup" once,
 * on the day the series began, forever. `singleEvents=true` expands the series
 * into the instances that actually fall in the window, which is what a diary is.
 *
 * ## What "cancelled" is doing here
 *
 * Kept rather than filtered, because a cancelled instance of a recurring
 * meeting is the answer to "why is that hour free now" — and because Google
 * reports a deleted event by returning it with `status: cancelled`, so dropping
 * them here would mean an event deleted in Google lived in our cache for ever.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { soleOffice } from '../db/office.ts'
import type { OfficeId } from '../office/context.ts'
import { count } from '../text/plain.ts'
import { type GoogleAccess, googleAccess, recordGoogleHealth } from './auth.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null | undefined): string =>
  v === null || v === undefined || v === '' ? 'null' : lit(v)

/** Enough to tell two "Catch-up" entries apart; never the whole body. */
const EXCERPT_CHARS = 300

export interface CalendarOutcome {
  readonly ok: boolean
  readonly note: string
  readonly seen: number
  readonly stored: number
  readonly removed: number
}

interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  updated?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: unknown[]
}

/**
 * Pull the window into `calendar_events`.
 *
 * The window is bounded at both ends on purpose. Unbounded forward means every
 * annual recurrence to the heat death of the universe; unbounded back means a
 * cache that only grows. Fourteen days forward and one back — yesterday still
 * answers "what did I have on when that happened".
 */
export async function refreshCalendar(
  db: SqlExecutor,
  options: {
    readonly days?: number
    readonly fetchImpl?: typeof fetch
    /**
     * The office this refresh caches the diary for: the claimed job's. Absent, the deployment's only person office
     * (a single-office deployment's legacy callers); with two real offices that is `no_office`, never a guess.
     */
    readonly officeId?: OfficeId
  } = {},
): Promise<CalendarOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch
  const days = options.days ?? 14
  const office = options.officeId ?? (await soleOffice(db))

  const enabled = (
    await db.execute(`
      select coalesce((select value::text::boolean from public.system_config
                        where key = 'calendar.enabled'), false) as on
    `)
  ).rows[0] as { on: boolean }
  if (!enabled.on) {
    // §17: an integration turned off stays off, and says so rather than being
    // quietly skipped. What is already cached stays readable.
    return {
      ok: true,
      note: 'calendar is switched off in Settings',
      seen: 0,
      stored: 0,
      removed: 0,
    }
  }

  const access = await googleAccess(db, fetchImpl)
  await recordGoogleHealth(db, access, office)
  if (!access.ok) return { ok: false, note: access.reason, seen: 0, stored: 0, removed: 0 }

  const granted = access as GoogleAccess
  if (!granted.scopes.some((s) => s.includes('calendar.readonly') || s.includes('auth/calendar'))) {
    return {
      ok: false,
      // A scope he unchecked on the consent screen. Named, because the
      // alternative symptom is a 403 from an endpoint that looks fine.
      note: `the connection has no calendar scope — granted: ${granted.scopes.join(' ') || 'none'}`,
      seen: 0,
      stored: 0,
      removed: 0,
    }
  }

  const calendarId = String(
    (
      await db.execute(`
        select coalesce((select value #>> '{}' from public.system_config
                          where key = 'calendar.calendar_id'), 'primary') as id
      `)
    ).rows[0]?.id ?? 'primary',
  )

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  // Bounded. A calendar with ten thousand events in a fortnight is a calendar
  // something is wrong with, and paging through it for ever is not the fix.
  for (let page = 0; page < 6; page += 1) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    )
    url.searchParams.set('timeMin', from)
    url.searchParams.set('timeMax', to)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('maxResults', '250')
    url.searchParams.set('showDeleted', 'true')
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken)

    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${granted.accessToken}` },
    })
    const body = (await response.json().catch(() => ({}))) as {
      items?: GoogleEvent[]
      nextPageToken?: string
      error?: { message?: string; code?: number }
    }
    if (body.error !== undefined) {
      return {
        ok: false,
        note: `Google refused: ${String(body.error.code ?? '')} ${String(body.error.message ?? '')}`.trim(),
        seen: events.length,
        stored: 0,
        removed: 0,
      }
    }
    events.push(...(body.items ?? []))
    if (body.nextPageToken === undefined) break
    pageToken = body.nextPageToken
  }

  let stored = 0
  const seenIds: string[] = []
  for (const event of events) {
    if (typeof event.id !== 'string' || event.id === '') continue
    // An all-day event carries `date`, a timed one `dateTime`. Both are
    // required by the table, and a missing pair means a malformed event rather
    // than a midnight one.
    const startRaw = event.start?.dateTime ?? event.start?.date
    const endRaw = event.end?.dateTime ?? event.end?.date
    if (startRaw === undefined || endRaw === undefined) continue
    const allDay = event.start?.dateTime === undefined

    seenIds.push(event.id)
    await db.execute(`
      insert into public.calendar_events
        (event_id, calendar_id, summary, excerpt, location, starts_at, ends_at,
         all_day, attendees, status, html_link, remote_updated_at, fetched_at, office_id)
      values (${lit(event.id)}, ${lit(calendarId)}, ${nul(event.summary)},
              ${nul(String(event.description ?? '').slice(0, EXCERPT_CHARS) || null)},
              ${nul(event.location)},
              ${lit(startRaw)}::timestamptz, ${lit(endRaw)}::timestamptz,
              ${String(allDay)}, ${String((event.attendees ?? []).length)},
              ${lit(String(event.status ?? 'confirmed'))}, ${nul(event.htmlLink)},
              ${nul(event.updated)}::timestamptz, app.now_utc(), ${lit(office)}::uuid)
      on conflict (calendar_id, event_id) do update
        set summary = excluded.summary, excerpt = excluded.excerpt,
            location = excluded.location, starts_at = excluded.starts_at,
            ends_at = excluded.ends_at, all_day = excluded.all_day,
            attendees = excluded.attendees, status = excluded.status,
            html_link = excluded.html_link,
            remote_updated_at = excluded.remote_updated_at,
            fetched_at = excluded.fetched_at
        -- The key is still global (calendar_id, event_id): an event another office holds is never overwritten.
        where public.calendar_events.office_id = excluded.office_id
    `)
    stored += 1
  }

  // Anything in the window we did NOT see this pass is gone from Google.
  // Deleted rather than left: an event cancelled through another client returns
  // with `status: cancelled` and is handled above, but one removed before the
  // window opened simply stops appearing, and a diary that keeps meetings
  // nobody is having is worse than one that is briefly empty.
  const removed = (
    await db.execute(`
      delete from public.calendar_events
       where office_id = ${lit(office)}::uuid
         and calendar_id = ${lit(calendarId)}
         and starts_at >= ${lit(from)}::timestamptz
         and starts_at <= ${lit(to)}::timestamptz
         ${seenIds.length === 0 ? '' : `and event_id <> all(array[${seenIds.map(lit).join(',')}]::text[])`}
      returning 1
    `)
  ).rows.length

  return {
    ok: true,
    note: `${count(stored, 'event', 'events')} over the next ${String(days)} days${
      removed === 0 ? '' : `, and ${count(removed, 'that has', 'that have')} come off the diary`
    }`,
    seen: events.length,
    stored,
    removed,
  }
}
