/**
 * Putting dated tasks in the diary (#94, ADR-0020).
 *
 * The other direction from `calendar.ts`, which caches what is already there.
 * This one WRITES, into a real human calendar, which is why almost all of the
 * care below is about not touching anything we did not create.
 *
 * ## The one rule
 *
 * Every event carries `extendedProperties.private.hqTaskId`. Every update and
 * every delete is matched on a link row we stored AND is re-checked against
 * that property before the call goes out. An implementation that found "its"
 * events by matching titles would eventually match a meeting Grant typed
 * himself, and there is no version of that which is acceptable.
 *
 * ## Off by default
 *
 * `calendar.sync_tasks` is false until he turns it on. Writing into someone's
 * diary is not something to begin because a feature shipped, and the switch is
 * checked here rather than by the caller, because the caller is not the only
 * possible caller.
 *
 * ## Why the plan comes from SQL
 *
 * `app.calendar_task_plan()` decides what to create, update and remove in one
 * query, hash included. Three round trips would leave a window where the answer
 * changes between them, and putting the "has this task moved" rule in SQL keeps
 * it beside the query that uses it.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { officeOf, type RetrievalOffice } from '../knowledge/office.ts'
import { nothingToDo, type Plan } from '../tools/plan.ts'
import { type GoogleAccess, googleAccess, recordGoogleHealth } from './auth.ts'

const API = 'https://www.googleapis.com/calendar/v3'

/** The property every event we own carries, and the only way we recognise one. */
const TAG = 'hqTaskId'

export interface SyncOutcome {
  readonly ok: boolean
  readonly note: string
  readonly created: number
  readonly updated: number
  readonly removed: number
}

interface PlanRow {
  readonly task_id: string
  readonly title: string
  readonly detail: string | null
  readonly due_on: string
  readonly project: string
  readonly hash: string
  readonly calendar_id?: string
  readonly event_id?: string
}

/** What the SQL decided. Named apart from the shared `Plan` contract (#131),
    which is what this becomes for anyone outside this file. */
interface CalendarWork {
  readonly create: PlanRow[]
  readonly update: PlanRow[]
  readonly remove: { task_id: string; calendar_id: string; event_id: string }[]
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * An all-day event for a dated task.
 *
 * `due_on` is a DATE — note the column name, not `due_at` — so these are all-day
 * events. Google's all-day `end.date` is EXCLUSIVE, so a one-day event ends on
 * the following day; getting that wrong renders a zero-length event that some
 * clients hide entirely.
 */
function eventFor(row: PlanRow): Record<string, unknown> {
  const end = new Date(`${row.due_on}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  return {
    summary: row.title,
    // The project, so a diary entry says which piece of work it belongs to
    // without opening anything.
    description: [row.detail, `— ${row.project}, via the AI team`]
      .filter((x) => x !== null && String(x).trim() !== '')
      .join('\n\n'),
    start: { date: row.due_on },
    end: { date: end.toISOString().slice(0, 10) },
    // The tag. Everything downstream depends on this being here.
    extendedProperties: { private: { [TAG]: row.task_id } },
    // A task is not an appointment: it should not make him look busy, and it
    // should not fire a reminder at 9am for something with no time on it.
    transparency: 'transparent',
    reminders: { useDefault: false },
  }
}

/**
 * Work out what would change in the diary, without changing anything (#131).
 *
 * Everything `syncTasksToCalendar` does BEFORE the first outward write lives
 * here: the settings, the credential, the scope, and the SQL that decides what
 * to create, update and remove. The sync then calls this and carries the answer
 * out.
 *
 * That is the whole point, and it is why this is an extraction rather than a
 * `describe what I would do` function written alongside: **there is no second
 * description to drift from the first.** A dry run is the first half without
 * the second half.
 *
 * `access` comes back so the caller does not fetch the credential twice.
 */
export async function planTasksForCalendar(
  db: SqlExecutor,
  office: RetrievalOffice,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<{
  readonly ok: boolean
  readonly note: string
  readonly plan: Plan
  readonly work?: CalendarWork
  readonly access?: GoogleAccess
  readonly target?: string
}> {
  const fetchImpl = options.fetchImpl ?? fetch

  const settings = (
    await db.execute(`
      select
        coalesce((select value::text::boolean from public.system_config
                   where key = 'calendar.sync_tasks'), false) as on,
        -- calendar.calendar_id, not a new key. It already exists, already
        -- defaults to 'primary', and its own description already says "which
        -- calendar to read and write" -- so this is what it was for. A second
        -- key for the write side is how the two end up pointed at different
        -- calendars and events appear where nobody is looking.
        coalesce((select value #>> '{}' from public.system_config
                   where key = 'calendar.calendar_id'), 'primary') as target
    `)
  ).rows[0] as { on: boolean; target: string }

  if (!settings.on) {
    const why = 'task sync to the calendar is switched off in Settings'
    return { ok: true, note: why, plan: nothingToDo('calendar.write', why) }
  }

  const access = await googleAccess(db, fetchImpl)
  await recordGoogleHealth(db, access)
  if (!access.ok) {
    return { ok: false, note: access.reason, plan: nothingToDo('calendar.write', access.reason) }
  }

  const granted = access as GoogleAccess
  /*
    The WRITE scope, which is a different string from the read one.
    `calendar.readonly` is enough to cache his diary and cannot create
    anything; asking for it and then posting gets a 403 that reads like a bug
    in the request rather than a missing permission.
  */
  if (
    !granted.scopes.some((s) => s.includes('auth/calendar.events') || s.endsWith('auth/calendar'))
  ) {
    const why = `the connection has no calendar write scope — granted: ${granted.scopes.join(' ') || 'none'}`
    return { ok: false, note: why, plan: nothingToDo('calendar.write', why) }
  }

  const answer = (await db.execute(`select app.calendar_task_plan(${officeOf(office)}) as p`))
    .rows[0] as {
    p: CalendarWork
  }
  const work = answer.p

  /*
    One step per event, because one event appearing in his diary is what a
    person is approving -- not the HTTP call that puts it there. `writes` is 1
    for each because each is exactly one request.
  */
  const plan: Plan = {
    tool: 'calendar.write',
    reaches:
      work.create.length + work.update.length + work.remove.length > 0 ? ['google:calendar'] : [],
    steps: [
      ...work.create.map((r) => ({
        verb: 'create' as const,
        what: `${r.title} on ${r.due_on}`,
        where: 'Google Calendar',
        writes: 1,
      })),
      ...work.update.map((r) => ({
        verb: 'update' as const,
        what: `${r.title} on ${r.due_on}`,
        where: 'Google Calendar',
        writes: 1,
      })),
      ...work.remove.map((r) => ({
        verb: 'remove' as const,
        what: `the event for task ${r.task_id.slice(0, 8)}`,
        where: 'Google Calendar',
        writes: 1,
      })),
    ],
    ...(work.create.length + work.update.length + work.remove.length === 0
      ? { note: 'the diary already matches the task list' }
      : {}),
  }

  return { ok: true, note: 'planned', plan, work, access: granted, target: settings.target }
}

/** Put dated, open tasks in the diary, and take away the ones that are done. */
export async function syncTasksToCalendar(
  db: SqlExecutor,
  office: RetrievalOffice,
  options: { readonly fetchImpl?: typeof fetch; readonly dryRun?: boolean } = {},
): Promise<SyncOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch
  const nothing = { created: 0, updated: 0, removed: 0 }

  const planned = await planTasksForCalendar(db, office, options)
  if (planned.work === undefined || planned.access === undefined) {
    return { ok: planned.ok, note: planned.note, ...nothing }
  }
  const { create, update, remove } = planned.work
  const granted = planned.access

  if (options.dryRun) {
    return {
      ok: true,
      note: `dry run: ${String(create.length)} to add, ${String(update.length)} to change, ${String(remove.length)} to take away`,
      created: create.length,
      updated: update.length,
      removed: remove.length,
    }
  }

  const headers = {
    Authorization: `Bearer ${granted.accessToken}`,
    'Content-Type': 'application/json',
  }
  const target = planned.target ?? 'primary'
  const cal = encodeURIComponent(target)
  let created = 0
  let updated = 0
  let removed = 0
  const trouble: string[] = []

  for (const row of create) {
    /*
      ASK THE DIARY BEFORE CREATING (final audit, invariant 27).

      A crash between Google accepting the event and the link being written leaves an event nothing points at, and the
      next pass - seeing no link - POSTed a second one for the same task. Every event carries the task's own tag, so
      the diary itself says whether this task already has one: if it does, adopt it (and let the next pass update it)
      instead of making another. A failed lookup is not evidence of absence, so it falls through to the old behaviour
      only when Google answered that there is none; any other answer skips this task until the next pass.
    */
    const existing = await fetchImpl(
      `${API}/calendars/${cal}/events?privateExtendedProperty=${encodeURIComponent(`${TAG}=${row.task_id}`)}&maxResults=1&showDeleted=false`,
      { method: 'GET', headers },
    )
    if (!existing.ok) {
      trouble.push(`could not check the diary for ${row.title} (${String(existing.status)})`)
      continue
    }
    const listed = (await existing.json().catch(() => ({}))) as { items?: { id?: string }[] }
    const already = listed.items?.find((e) => typeof e.id === 'string' && e.id !== '')?.id
    if (already !== undefined) {
      await db.execute(
        `select app.calendar_link_set(${lit(row.task_id)}::uuid, ${lit(target)}, ${lit(already)}, ${lit(row.hash)})`,
      )
      created += 1
      continue
    }
    const r = await fetchImpl(`${API}/calendars/${cal}/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(eventFor(row)),
    })
    if (!r.ok) {
      trouble.push(`could not add ${row.title} (${String(r.status)})`)
      continue
    }
    const body = (await r.json()) as { id?: string }
    if (!body.id) {
      trouble.push(`Google accepted ${row.title} without returning an id`)
      continue
    }
    await db.execute(
      `select app.calendar_link_set(${lit(row.task_id)}::uuid, ${lit(target)}, ${lit(body.id)}, ${lit(row.hash)})`,
    )
    created += 1
  }

  for (const row of update) {
    const on = row.calendar_id ?? target
    const r = await fetchImpl(
      `${API}/calendars/${encodeURIComponent(on)}/events/${encodeURIComponent(row.event_id ?? '')}`,
      { method: 'PATCH', headers, body: JSON.stringify(eventFor(row)) },
    )
    /*
      Gone at the far end is not an error, it is a fact.

      He can delete one of these in Google, and a 404 or 410 here means he did.
      Clearing the link makes the next pass create it again — which is the
      wrong answer if he deleted it deliberately, and is still better than
      retrying a PATCH against a dead id for ever. A "he removed it, leave it
      alone" flag is a real improvement and is not this change.
    */
    if (r.status === 404 || r.status === 410) {
      await db.execute(`select app.calendar_link_clear(${lit(row.task_id)}::uuid)`)
      continue
    }
    if (!r.ok) {
      trouble.push(`could not change ${row.title} (${String(r.status)})`)
      continue
    }
    await db.execute(
      `select app.calendar_link_set(${lit(row.task_id)}::uuid, ${lit(on)}, ${lit(row.event_id ?? '')}, ${lit(row.hash)})`,
    )
    updated += 1
  }

  for (const row of remove) {
    /*
      Read it back before deleting it.

      The link table says this event is ours. That is one record, and records
      drift — an id could be stale, reused, or edited by hand. So the tag on
      the event itself is checked immediately before the delete, and an event
      that does not carry OUR task id is left alone and reported.

      Two calls per removal instead of one. Deleting the wrong entry from a
      person's calendar is not a thing to be efficient about.
    */
    const url = `${API}/calendars/${encodeURIComponent(row.calendar_id)}/events/${encodeURIComponent(row.event_id)}`
    const look = await fetchImpl(url, { headers })
    if (look.status === 404 || look.status === 410) {
      await db.execute(`select app.calendar_link_clear(${lit(row.task_id)}::uuid)`)
      removed += 1
      continue
    }
    if (!look.ok) {
      trouble.push(`could not read the event for ${row.task_id} (${String(look.status)})`)
      continue
    }
    const found = (await look.json()) as {
      extendedProperties?: { private?: Record<string, string> }
    }
    if (found.extendedProperties?.private?.[TAG] !== row.task_id) {
      trouble.push(`event ${row.event_id} is not ours — left alone`)
      // The link is wrong, and keeping it would mean trying again for ever.
      await db.execute(`select app.calendar_link_clear(${lit(row.task_id)}::uuid)`)
      continue
    }
    const gone = await fetchImpl(url, { method: 'DELETE', headers })
    if (!gone.ok && gone.status !== 404 && gone.status !== 410) {
      // The link stays, so the next pass tries again rather than forgetting an
      // event that is still sitting in his diary.
      trouble.push(`could not remove the event for ${row.task_id} (${String(gone.status)})`)
      continue
    }
    await db.execute(`select app.calendar_link_clear(${lit(row.task_id)}::uuid)`)
    removed += 1
  }

  const moved = created + updated + removed
  return {
    ok: trouble.length === 0,
    note:
      trouble.length > 0
        ? trouble.slice(0, 3).join('; ')
        : moved === 0
          ? 'the diary already matches'
          : `${String(created)} added, ${String(updated)} changed, ${String(removed)} taken away`,
    created,
    updated,
    removed,
  }
}
