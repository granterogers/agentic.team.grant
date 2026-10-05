/**
 * The duty that keeps project calendars and Google Calendar in step (kind `calendar.sync_events`).
 *
 * Events made inside a dashboard project (`public.project_events`) are owed to Google; Google's own changes to those
 * events are owed back. One pass, in this order, and the order is the design:
 *
 *   1. PROMOTE  events made while Google was not connected become pending once it is.
 *   2. PUSH     create / update / delete what is pending (src/google/calendar-events.ts, one request each).
 *   3. REFRESH  re-read the calendar into the cache (refreshCalendar). After the push, so what was just sent is in it.
 *   4. PULL     Google-side edits and deletions of linked events are applied to the native rows (app.project_events_pull).
 *   5. PURGE    a tombstone whose deletion has been paid is finished.
 *
 * ## Who is writing
 *
 * A row last written by a person (Grant pressing Add in his dashboard, or telling the office on Telegram) is his own
 * act and goes out outright. A row last written by an AGENT is a proposal: `calendar.write` is a level-2 tool, so the
 * approval policy is asked once for the batch (`governOutward`, with a plan that names every event), and a refusal or a
 * question leaves those rows pending rather than writing into his diary on an agent's say-so. The person's rows in the
 * same pass are still sent: one agent's open question does not hold his own edits hostage.
 *
 * ## Conflicts (optimistic concurrency)
 *
 * Every update and delete of a linked event sends `If-Match` with the etag recorded by the last successful push, so a
 * change somebody made in Google since then is a 412 and is NEVER overwritten silently. A row with no recorded etag (linked
 * before etags were kept, or adopted) is sent without the header and falls back to the pull's rule below.
 *
 * On a 412 the event is read back and ONE rule applies, the same one `app.project_events_pull` applies to a change the
 * pull finds: **the later writer wins, and the override is written down** (the row's `sync_error` begins "conflict:", and
 * an Activity event on the channel `google_sync` names the winner).
 *
 *   - Google has nothing newer than the stamp the sides last agreed on (the etag was merely stale, e.g. after the pull
 *     absorbed a change): re-send once with the fresh etag, no conflict.
 *   - UPDATE, local edit later: re-sent ONCE with the fresh etag, then noted. Second 412: left pending, retried next pass.
 *   - UPDATE, Google later: Google's content (title, notes, place, time) is applied here; the local edit is dropped, noted.
 *   - DELETE, the delete later: re-sent once with the fresh etag. Google edited the event AFTER the delete: the event is
 *     restored here with Google's content and the delete is not sent, noted. (Deleting an event somebody just edited
 *     elsewhere is the one silent loss this refuses.)
 *   - Google deleted it (404 / cancelled): Google's deletion wins, as before.
 *
 * There is no field-level merge: nothing records the common ancestor, so which fields "each side changed" cannot be
 * known; the whole event goes to the later writer. Timestamps are Google's `updated` against this row's `updated_at`
 * (content only; a sync never moves it).
 *
 * ## Quiet
 *
 * Nothing pending and nothing changed in Google is the normal case sixteen times a day, so the output is not
 * announced unless something failed, was overridden or came from Google. A person whose event simply reached Google
 * does not need a message about it.
 *
 * ## How it is started
 *
 * By a duty (`calendar-event-sync`, 0897) every fifteen minutes, and by anything that enqueues a job of this kind
 * (a future "sync now" press). It reads the Google connection itself and does nothing, loudly in the Connections
 * panel and quietly here, when Google is not connected.
 */

import { governOutward } from '../agents/approval.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { officeOfJob } from '../db/office.ts'
import {
  type GoogleAccess,
  type GoogleUnavailable,
  googleAccess,
  recordGoogleHealth,
} from '../google/auth.ts'
import { refreshCalendar } from '../google/calendar.ts'
import {
  createEvent,
  deleteEvent,
  type EventDraft,
  patchEvent,
  type ReadOutcome,
  type RemoteEvent,
  readEvent,
  type WriteOutcome,
} from '../google/calendar-events.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { Plan } from '../tools/plan.ts'
import { detail, nothingToDo, summarise } from '../tools/plan.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null | undefined): string =>
  v === null || v === undefined ? 'null' : lit(v)

export interface WorkRow {
  readonly event_id: string
  readonly op: 'create' | 'update' | 'delete'
  readonly title: string
  readonly notes: string | null
  readonly location: string | null
  readonly starts_at: string
  readonly ends_at: string
  readonly all_day: boolean
  readonly external_calendar_id: string | null
  readonly external_event_id: string | null
  readonly external_etag: string | null
  /** Google's own `updated` stamp the last time the two sides agreed (null for a row linked before it was recorded). */
  readonly external_updated_at?: string | null
  readonly authority: 'person' | 'agent'
  readonly project_slug: string
  readonly project_name: string
  readonly updated_at: string
}

export interface CalendarEventsDeps {
  readonly fetchImpl?: typeof fetch
  readonly access?: (
    db: SqlExecutor,
    fetchImpl: typeof fetch,
  ) => Promise<GoogleAccess | GoogleUnavailable>
  readonly refresh?: typeof refreshCalendar
}

export interface SyncSummary {
  readonly ok: boolean
  readonly note: string
  readonly pushed: number
  readonly failed: number
  readonly held: number
  readonly pulledUpdated: number
  readonly pulledDeleted: number
  readonly purged: number
  /** Something a person might want to hear about: a failure, an override, or a change that came from Google. */
  readonly notable: boolean
}

const draftOf = (r: WorkRow): EventDraft => ({
  id: r.event_id,
  title: r.title,
  notes: r.notes,
  location: r.location,
  startsAt: new Date(r.starts_at).toISOString(),
  endsAt: new Date(r.ends_at).toISOString(),
  allDay: r.all_day,
})

const planOf = (rows: readonly WorkRow[]): Plan =>
  rows.length === 0
    ? nothingToDo('calendar.write', 'no project event is waiting to go to Google')
    : {
        tool: 'calendar.write',
        reaches: ['google:calendar'],
        steps: rows.map((r) => ({
          verb:
            r.op === 'delete'
              ? ('remove' as const)
              : r.op === 'create'
                ? ('create' as const)
                : ('update' as const),
          what: `${r.title} (${r.project_name})`,
          where: 'Google Calendar',
          // A create asks first and then posts; everything else is one request. A delete reads the event back first.
          writes: r.op === 'update' ? 1 : 2,
        })),
      }

const readWork = async (db: SqlExecutor, office: string): Promise<WorkRow[]> =>
  ((await db.execute(`select app.project_events_sync_work(${lit(office)}::uuid, 50) as w`)).rows[0]
    ?.w ?? []) as WorkRow[]

type Settled =
  /** The conflict was fully handled here (Google's content was kept, or Google deleted it). */
  | { readonly done: true; readonly pushed: boolean; readonly notes: string[] }
  /** The write must be recorded by the caller: `out` is the re-send's outcome, `note` the sentence to keep. */
  | { readonly done: false; readonly out: WriteOutcome; readonly note: string | null }
  /** Nothing could be decided; leave the row pending (retryable) or parked. */
  | {
      readonly done: false
      readonly out: null
      readonly message: string
      readonly retryable: boolean
    }

const stamp = (v: string | null | undefined): number => {
  const n = v === null || v === undefined ? Number.NaN : Date.parse(v)
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY
}

/**
 * Google refused an update or delete with 412: it holds a change we have not seen. Read it back and apply the rule in the
 * header. Never overwrites a newer remote change, and re-sends at most once.
 */
async function resolveConflict(
  db: SqlExecutor,
  office: string,
  token: string,
  row: WorkRow,
  draft: EventDraft,
  calendar: string,
  fetchImpl: typeof fetch | undefined,
): Promise<Settled> {
  const externalId = row.external_event_id ?? ''
  const looked: ReadOutcome = await readEvent(token, calendar, externalId, row.event_id, {
    fetchImpl,
  })
  if (!looked.ok) {
    return { done: false, out: null, message: looked.message, retryable: looked.retryable }
  }
  if (looked.gone) {
    // Google deleted it since: its deletion wins for an update, and is simply what a delete wanted.
    if (row.op === 'delete') {
      await db.execute(
        `select app.project_event_sync_done(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, 'delete', ${lit(row.updated_at)}::timestamptz)`,
      )
      return { done: true, pushed: true, notes: [] }
    }
    await db.execute(
      `select app.project_event_gone(${lit(office)}::uuid, ${lit(row.event_id)}::uuid)`,
    )
    return {
      done: true,
      pushed: false,
      notes: [`"${row.title}" was deleted in Google, so it came off the project calendar`],
    }
  }
  const remote: RemoteEvent = looked.event
  if (!remote.ours) {
    return {
      done: false,
      out: null,
      message: `event ${externalId} is not one we made - left alone`,
      retryable: false,
    }
  }
  const remoteAt = stamp(remote.updated)
  const sideAgreedAt = stamp(row.external_updated_at)
  const localAt = stamp(row.updated_at)
  // Nothing in Google newer than what we already absorbed: the etag was stale, the content is not in dispute.
  const merelyStale = remote.updated !== null && remoteAt <= sideAgreedAt
  const localWins = merelyStale || localAt >= remoteAt

  if (localWins) {
    const retry =
      row.op === 'delete'
        ? await deleteEvent(token, calendar, externalId, row.event_id, {
            fetchImpl,
            ifMatch: remote.etag,
          })
        : await patchEvent(token, calendar, externalId, draft, { fetchImpl, ifMatch: remote.etag })
    if (!retry.ok && retry.kind === 'conflict' && retry.status === 412) {
      return {
        done: false,
        out: null,
        message: `"${row.title}" changed in Google again while it was being resolved; it will be tried again`,
        retryable: true,
      }
    }
    if (!retry.ok && retry.kind === 'not_found') {
      return { done: false, out: retry, note: null }
    }
    return {
      done: false,
      out: retry,
      note: merelyStale
        ? null
        : row.op === 'delete'
          ? 'deleted here after the last change in Google, so the delete was sent'
          : 'a newer change in Google was overridden by this later edit',
    }
  }

  // Google's change is later: it is kept, here, and the local edit (or delete) is not sent.
  const note =
    row.op === 'delete'
      ? 'the event was changed in Google after it was deleted here, so it is back and the delete was not sent'
      : 'a pending edit here was overridden by a newer change in Google'
  const took = (
    await db.execute(
      `select app.project_event_take_remote(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, ${lit(row.updated_at)}::timestamptz,
         ${lit(remote.title)}, ${nul(remote.notes)}, ${nul(remote.location)}, ${lit(remote.startsAt)}::timestamptz,
         ${lit(remote.endsAt)}::timestamptz, ${String(remote.allDay)}, ${nul(remote.etag)}, ${nul(remote.updated)}::timestamptz,
         ${String(row.op === 'delete')}, ${lit(note)}) as r`,
    )
  ).rows[0]?.r as { raced?: boolean; error?: string } | undefined
  if (took?.error !== undefined) {
    return { done: false, out: null, message: took.error, retryable: false }
  }
  // `raced`: a person edited the row again mid-sync. That edit is newer than both, stays pending, and meets Google next pass.
  return {
    done: true,
    pushed: false,
    notes: took?.raced === true ? [] : [`"${row.title}": ${note}`],
  }
}

/** Carry the work out. Exported so a suite can drive it without a job. */
export async function syncProjectEvents(
  db: SqlExecutor,
  office: string,
  token: string,
  rows: readonly WorkRow[],
  options: { readonly fetchImpl?: typeof fetch; readonly calendarId: string },
): Promise<{ pushed: number; failed: number; notes: string[] }> {
  let pushed = 0
  let failed = 0
  const notes: string[] = []
  for (const row of rows) {
    const draft = draftOf(row)
    const calendar = row.external_calendar_id ?? options.calendarId
    let out: WriteOutcome
    if (row.op === 'delete') {
      out =
        row.external_event_id === null
          ? { ok: true, kind: 'already_gone', externalId: '', etag: null, updated: null }
          : await deleteEvent(token, calendar, row.external_event_id, row.event_id, {
              fetchImpl: options.fetchImpl,
              ifMatch: row.external_etag,
            })
    } else if (row.op === 'update' && row.external_event_id !== null) {
      out = await patchEvent(token, calendar, row.external_event_id, draft, {
        fetchImpl: options.fetchImpl,
        ifMatch: row.external_etag,
      })
    } else {
      out = await createEvent(token, calendar, draft, { fetchImpl: options.fetchImpl })
    }

    let conflictNote: string | null = null
    if (
      !out.ok &&
      out.kind === 'conflict' &&
      out.status === 412 &&
      row.external_event_id !== null &&
      row.op !== 'create'
    ) {
      const settled = await resolveConflict(
        db,
        office,
        token,
        row,
        draft,
        calendar,
        options.fetchImpl,
      )
      if (settled.done) {
        notes.push(...settled.notes)
        if (settled.pushed) pushed += 1
        continue
      }
      if (settled.out === null) {
        failed += 1
        notes.push(settled.message)
        await db.execute(
          `select app.project_event_sync_failed(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, ${lit(settled.message)}, ${String(settled.retryable)})`,
        )
        continue
      }
      out = settled.out
      conflictNote = settled.note
    }

    if (out.ok) {
      try {
        await db.execute(
          `select app.project_event_sync_done(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, ${lit(row.op)},
             ${lit(row.updated_at)}::timestamptz, ${lit(calendar)}, ${nul(row.op === 'delete' ? null : out.externalId)},
             ${nul(out.etag)}, ${nul(out.updated)}::timestamptz)`,
        )
        pushed += 1
        if (conflictNote !== null && row.op !== 'delete') {
          await db.execute(
            `select app.project_event_conflict_note(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, ${lit(conflictNote)})`,
          )
          notes.push(`"${row.title}": ${conflictNote}`)
        } else if (conflictNote !== null) {
          notes.push(`"${row.title}": ${conflictNote}`)
        }
      } catch (error) {
        /*
          Google has it and we could not record that. Say so on the row rather than aborting the pass for every event
          behind it; the private tag means the next pass adopts what was made instead of making it twice.
        */
        failed += 1
        const why = `Google accepted it but the id could not be recorded: ${(error as Error).message}`
        notes.push(why.slice(0, 200))
        await db.execute(
          `select app.project_event_sync_failed(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, ${lit(why.slice(0, 400))}, true)`,
        )
      }
      continue
    }
    if (out.kind === 'not_found' && row.op === 'update') {
      // Deleted in Google since we last looked: Google's deletion wins.
      await db.execute(
        `select app.project_event_gone(${lit(office)}::uuid, ${lit(row.event_id)}::uuid)`,
      )
      notes.push(`"${row.title}" was deleted in Google, so it came off the project calendar`)
      continue
    }
    if (out.kind === 'not_found' && row.op === 'delete') {
      await db.execute(
        `select app.project_event_sync_done(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, 'delete', ${lit(row.updated_at)}::timestamptz)`,
      )
      pushed += 1
      continue
    }
    failed += 1
    notes.push(out.message)
    await db.execute(
      `select app.project_event_sync_failed(${lit(office)}::uuid, ${lit(row.event_id)}::uuid, ${lit(out.message)}, ${String(out.retryable)})`,
    )
  }
  return { pushed, failed, notes }
}

export function calendarEventsHandler(db: SqlExecutor, deps: CalendarEventsDeps = {}): Handler {
  const fetchImpl = deps.fetchImpl ?? fetch
  const getAccess = deps.access ?? googleAccess
  const refresh = deps.refresh ?? refreshCalendar

  const quiet = (body: string, extra: Partial<HandlerOutput> = {}): HandlerOutput =>
    ({
      body,
      announce: false,
      confidence: 'high',
      evidence: 'verified',
      sources: ['google:calendar'],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: null,
      ...extra,
    }) satisfies HandlerOutput

  return {
    kind: 'calendar.sync_events',
    /* What it would send, from the same work list the pass sends (#131). Reads nothing outside the office. */
    plan: async (job: Job): Promise<Plan> =>
      planOf(await readWork(db, await officeOfJob(db, job.jobId))),
    handle: async (job: Job): Promise<HandlerOutput> => {
      const office = await officeOfJob(db, job.jobId)

      const access = await getAccess(db, fetchImpl)
      await recordGoogleHealth(db, access, office)
      if (!access.ok) {
        return quiet(`Project calendars: not synced - ${access.reason}`)
      }
      if (
        !access.scopes.some(
          (s) => s.includes('auth/calendar.events') || s.endsWith('auth/calendar'),
        )
      ) {
        return quiet(
          `Project calendars: not synced - the connection has no calendar write scope (granted: ${access.scopes.join(' ') || 'none'})`,
          { announce: true },
        )
      }

      const calendarId = String(
        (
          await db.execute(
            `select coalesce((select value #>> '{}' from public.system_config where key = 'calendar.calendar_id'), 'primary') as id`,
          )
        ).rows[0]?.id ?? 'primary',
      )

      await db.execute(`select app.project_events_promote_local(${lit(office)}::uuid)`)
      const work = await readWork(db, office)

      // A person's own rows go out; an agent's are a proposal and ask the policy first.
      const mine = work.filter((r) => r.authority === 'person')
      const proposed = work.filter((r) => r.authority === 'agent')
      let held = 0
      let go = mine
      const heldNotes: string[] = []
      if (proposed.length > 0) {
        const planned = planOf(proposed)
        const gate = await governOutward(db, {
          jobId: job.jobId,
          tool: planned.tool,
          summary: `Events an agent put on project calendars are waiting for Google: ${summarise(planned)}`,
          detail: detail(planned),
          empty: planned.steps.length === 0,
          agent: 'operations-director',
          standingOption: 'Yes, keep Google in step with project calendars without asking me',
        })
        if (gate.go) go = [...mine, ...proposed]
        else {
          held = proposed.length
          heldNotes.push(gate.said)
        }
      }

      const sent =
        go.length === 0
          ? { pushed: 0, failed: 0, notes: [] as string[] }
          : await syncProjectEvents(db, office, access.accessToken, go, { fetchImpl, calendarId })

      // The cache, then what Google changed. The pull only believes an absence when the refresh really ran.
      const refreshed = await refresh(db, { fetchImpl, officeId: office })
      const pulled = (
        await db.execute(
          `select app.project_events_pull(${lit(office)}::uuid, ${lit(refreshed.calendarId ?? calendarId)},
             ${String(refreshed.ok && refreshed.refreshed === true)}) as p`,
        )
      ).rows[0]?.p as { updated: number; deleted: number } | undefined
      // A tombstone whose deletion has been paid (here or by the pull) is finished.
      await db.execute(`select app.project_events_purge(${lit(office)}::uuid)`)

      const pulledUpdated = pulled?.updated ?? 0
      const pulledDeleted = pulled?.deleted ?? 0
      const trouble = [...sent.notes, ...heldNotes]
      const parts = [
        sent.pushed > 0 ? `${String(sent.pushed)} sent to Google` : '',
        pulledUpdated > 0 ? `${String(pulledUpdated)} changed in Google` : '',
        pulledDeleted > 0 ? `${String(pulledDeleted)} deleted in Google` : '',
        held > 0 ? `${String(held)} waiting for your say-so` : '',
        sent.failed > 0 ? `${String(sent.failed)} failed` : '',
        !refreshed.ok ? `Google could not be read (${refreshed.note})` : '',
      ].filter((p) => p !== '')
      const notable = trouble.length > 0 || pulledUpdated > 0 || pulledDeleted > 0 || !refreshed.ok

      const body =
        parts.length === 0
          ? 'Project calendars and Google are already in step.'
          : `Project calendars: ${parts.join(', ')}.${trouble.length > 0 ? ` ${trouble.slice(0, 3).join('; ')}` : ''}`
      return quiet(body, {
        announce: notable,
        shape: 'nothing_happened',
        facts: { changed: sent.pushed + pulledUpdated + pulledDeleted > 0, looked_at: work.length },
      })
    },
  }
}
