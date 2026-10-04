/**
 * Writing a project's own events to Google Calendar, and nothing else.
 *
 * `calendar-write.ts` puts dated TASKS in the diary and `calendar.ts` caches what is there. This is the third thing:
 * the events a person (or an agent) made INSIDE a dashboard project, mirrored toward Google as create, edit and delete.
 * It is a thin REST adapter. It decides nothing about WHICH events to send (the SQL work list does, and the approval
 * policy gates an agent's writes before this is reached); it shapes them, sends them, and reports what happened as a
 * typed outcome.
 *
 * ## Typed outcomes, never a throw with a secret in it
 *
 * Every function returns a `WriteOutcome`. A network failure, a refusal and a success are all values. The access token
 * lives in an Authorization header, so it cannot appear in a URL or a body, and the message of anything that goes wrong
 * is built from Google's own error text and then scrubbed twice: the token is removed BY VALUE (exact, nothing to get
 * wrong, with a length floor so a one-character test token cannot turn the message into a find-and-replace) and
 * `redactSecrets` runs after it for what cannot be enumerated.
 *
 * ## Idempotence: the private tag
 *
 * Every event we create carries `extendedProperties.private.agenticEventId = <our event id>`. A crash between Google
 * accepting an event and our row recording its id leaves an event nothing points at, and the next pass, seeing no id,
 * would POST a second one. So a create first ASKS Google whether an event with this tag exists and adopts it if so
 * (src/tasks/vikunja.ts `alreadyMine` and calendar-write.ts do the same). A failed lookup is not evidence of absence:
 * it is reported and the create is not attempted.
 *
 * ## Deleting
 *
 * The event is read back and its tag compared with the one we mean to delete before the DELETE goes out. A link that
 * is stale or wrong deletes nothing of a person's.
 *
 * ## All-day versus timed
 *
 * An all-day event carries `date` (YYYY-MM-DD) and its end is EXCLUSIVE; a timed one carries `dateTime`. When an event
 * changes between the two, the PATCH names the field it stops using as null, because Google merges and would otherwise
 * refuse an event with both.
 */

import { redactSecrets } from '../text/secrets.ts'

const API = 'https://www.googleapis.com/calendar/v3'

/** The private property every event we own carries. */
export const EVENT_TAG = 'agenticEventId'

/** A native project event, as the SQL work list describes it. Timestamps are ISO-8601 strings. */
export interface EventDraft {
  readonly id: string
  readonly title: string
  /** null: never set, so it is not sent (Google's own description is left alone). '' clears it. */
  readonly notes: string | null
  readonly location: string | null
  readonly startsAt: string
  readonly endsAt: string
  readonly allDay: boolean
}

export type WriteKind = 'created' | 'adopted' | 'updated' | 'deleted' | 'already_gone'
export type FailureKind =
  | 'unauthorised'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'transient'
  | 'rejected'
  | 'not_ours'
  | 'network'

export type WriteOutcome =
  | {
      readonly ok: true
      readonly kind: WriteKind
      readonly externalId: string
      readonly etag: string | null
      /** Google's own `updated` stamp, so the pull can tell its own writes from somebody else's. */
      readonly updated: string | null
    }
  | {
      readonly ok: false
      readonly kind: FailureKind
      readonly status: number | null
      /** Whether trying again later could work: a rate limit, a 5xx, a dropped connection. */
      readonly retryable: boolean
      readonly message: string
    }

export interface WriteOptions {
  readonly fetchImpl?: typeof fetch | undefined
  /** Send If-Match with this etag, so a concurrent change in Google becomes a 412 `conflict` rather than being overwritten. */
  readonly ifMatch?: string | null
}

interface GoogleEventBody {
  id?: string
  etag?: string
  updated?: string
  status?: string
  error?: { message?: string; errors?: { reason?: string }[] }
  items?: { id?: string; etag?: string; updated?: string }[]
  extendedProperties?: { private?: Record<string, string> }
}

const dayOf = (iso: string): string => iso.slice(0, 10)

/**
 * The body Google wants.
 *
 * `forPatch` adds the explicit nulls for the other representation, and sends an empty location as null (clears it)
 * where a create simply leaves it out.
 */
export function toGoogleEvent(draft: EventDraft, forPatch = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: draft.title,
    extendedProperties: { private: { [EVENT_TAG]: draft.id } },
  }
  if (draft.notes !== null) body.description = draft.notes
  if (draft.location !== null && draft.location !== '') body.location = draft.location
  else if (forPatch) body.location = null

  if (draft.allDay) {
    body.start = forPatch
      ? { date: dayOf(draft.startsAt), dateTime: null }
      : { date: dayOf(draft.startsAt) }
    body.end = forPatch
      ? { date: dayOf(draft.endsAt), dateTime: null }
      : { date: dayOf(draft.endsAt) }
  } else {
    const start = new Date(draft.startsAt).toISOString()
    const end = new Date(draft.endsAt).toISOString()
    body.start = forPatch ? { dateTime: start, date: null } : { dateTime: start }
    body.end = forPatch ? { dateTime: end, date: null } : { dateTime: end }
  }
  return body
}

/** Remove a credential held by value, then anything credential-shaped. Short values are not replaced (a length floor). */
function scrub(text: string, token: string): string {
  const cleaned = token.length >= 8 ? text.split(token).join('[redacted]') : text
  return redactSecrets(cleaned)
}

function failure(
  kind: FailureKind,
  status: number | null,
  message: string,
  token: string,
  retryable = false,
): WriteOutcome {
  return { ok: false, kind, status, retryable, message: scrub(message, token).slice(0, 400) }
}

/** One request, with every way it can go wrong turned into a value. */
async function send(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  options: WriteOptions,
  body?: unknown,
): Promise<
  { readonly out: WriteOutcome } | { readonly status: number; readonly json: GoogleEventBody }
> {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.ifMatch !== undefined && options.ifMatch !== null && options.ifMatch !== '') {
    headers['If-Match'] = options.ifMatch
  }
  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    // The message of a thrown fetch names the URL and the cause, never the header, but it is scrubbed regardless.
    return {
      out: failure(
        'network',
        null,
        `could not reach Google Calendar: ${(error as Error).message ?? 'network error'}`,
        token,
        true,
      ),
    }
  }
  const json = (await response.json().catch(() => ({}))) as GoogleEventBody
  return { status: response.status, json }
}

/** Map a non-2xx answer to a typed failure. */
function refusal(status: number, json: GoogleEventBody, what: string, token: string): WriteOutcome {
  const detail = json.error?.message ?? ''
  const reason = json.error?.errors?.[0]?.reason ?? ''
  const say = `${what}: Google answered ${String(status)}${detail === '' ? '' : ` - ${detail}`}`
  if (status === 401) return failure('unauthorised', status, say, token, true)
  if (status === 403 && /rateLimit|quotaExceeded/i.test(reason)) {
    return failure('rate_limited', status, say, token, true)
  }
  if (status === 403) return failure('forbidden', status, say, token)
  if (status === 404 || status === 410) return failure('not_found', status, say, token)
  if (status === 409 || status === 412) return failure('conflict', status, say, token)
  if (status === 429) return failure('rate_limited', status, say, token, true)
  if (status >= 500) return failure('transient', status, say, token, true)
  return failure('rejected', status, say, token)
}

const eventUrl = (calendarId: string, externalId?: string): string =>
  `${API}/calendars/${encodeURIComponent(calendarId)}/events${
    externalId === undefined ? '' : `/${encodeURIComponent(externalId)}`
  }`

const done = (kind: WriteKind, externalId: string, json: GoogleEventBody): WriteOutcome => ({
  ok: true,
  kind,
  externalId,
  etag: json.etag ?? null,
  updated: json.updated ?? null,
})

/** Change an event we already created. */
export async function patchEvent(
  token: string,
  calendarId: string,
  externalId: string,
  draft: EventDraft,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const got = await send(
    'PATCH',
    eventUrl(calendarId, externalId),
    token,
    options,
    toGoogleEvent(draft, true),
  )
  if ('out' in got) return got.out
  if (got.status < 200 || got.status >= 300) {
    return refusal(got.status, got.json, `could not change "${draft.title}"`, token)
  }
  return done('updated', got.json.id ?? externalId, got.json)
}

/**
 * Create an event, or adopt the one a crashed earlier attempt already made.
 *
 * Asking first costs one GET and is the only thing that makes running the sync twice safe.
 */
export async function createEvent(
  token: string,
  calendarId: string,
  draft: EventDraft,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const lookup = await send(
    'GET',
    `${eventUrl(calendarId)}?privateExtendedProperty=${encodeURIComponent(`${EVENT_TAG}=${draft.id}`)}&maxResults=1&showDeleted=false`,
    token,
    { fetchImpl: options.fetchImpl },
  )
  if ('out' in lookup) return lookup.out
  if (lookup.status < 200 || lookup.status >= 300) {
    // Not evidence of absence. Reported, and nothing is created.
    return refusal(
      lookup.status,
      lookup.json,
      `could not check the diary for "${draft.title}"`,
      token,
    )
  }
  const existing = lookup.json.items?.find((e) => typeof e.id === 'string' && e.id !== '')
  if (existing?.id !== undefined) {
    const patched = await patchEvent(token, calendarId, existing.id, draft, {
      fetchImpl: options.fetchImpl,
    })
    return patched.ok ? { ...patched, kind: 'adopted' } : patched
  }

  const got = await send('POST', eventUrl(calendarId), token, options, toGoogleEvent(draft))
  if ('out' in got) return got.out
  if (got.status < 200 || got.status >= 300) {
    return refusal(got.status, got.json, `could not add "${draft.title}"`, token)
  }
  if (typeof got.json.id !== 'string' || got.json.id === '') {
    return failure(
      'rejected',
      got.status,
      `Google accepted "${draft.title}" without returning an id`,
      token,
    )
  }
  return done('created', got.json.id, got.json)
}

/**
 * Delete an event we created. Gone already is the outcome we wanted. An event that does not carry OUR id is left
 * alone and reported as `not_ours`.
 */
export async function deleteEvent(
  token: string,
  calendarId: string,
  externalId: string,
  ourId: string,
  options: WriteOptions = {},
): Promise<WriteOutcome> {
  const look = await send('GET', eventUrl(calendarId, externalId), token, {
    fetchImpl: options.fetchImpl,
  })
  if ('out' in look) return look.out
  if (look.status === 404 || look.status === 410) {
    return { ok: true, kind: 'already_gone', externalId, etag: null, updated: null }
  }
  if (look.status < 200 || look.status >= 300) {
    return refusal(look.status, look.json, 'could not read the event before deleting it', token)
  }
  if (look.json.status === 'cancelled') {
    return { ok: true, kind: 'already_gone', externalId, etag: null, updated: null }
  }
  if (look.json.extendedProperties?.private?.[EVENT_TAG] !== ourId) {
    return failure(
      'not_ours',
      look.status,
      `event ${externalId} is not one we made - left alone`,
      token,
    )
  }
  const got = await send('DELETE', eventUrl(calendarId, externalId), token, options)
  if ('out' in got) return got.out
  if (got.status === 404 || got.status === 410) {
    return { ok: true, kind: 'already_gone', externalId, etag: null, updated: null }
  }
  if (got.status < 200 || got.status >= 300) {
    return refusal(got.status, got.json, 'could not delete the event', token)
  }
  return { ok: true, kind: 'deleted', externalId, etag: null, updated: null }
}
