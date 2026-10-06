/**
 * Vikunja, as one implementation of `TaskProvider` and nothing more (#259).
 *
 * Everything Vikunja-shaped is in this file: its URLs, its auth header, its
 * priority scale, and the two sentinels below that would quietly corrupt data
 * if they were read as ordinary values. `src/tasks/sync.ts` imports none of it.
 *
 * Proved against a REAL Vikunja v2.6.0, not a fake. `npm run verify:vikunja`
 * starts one, registers a user, mints a scoped API token and drives the whole
 * two-way contract through the HTTP API.
 */
import {
  type CanonicalTask,
  ProviderAuthError,
  ProviderDownError,
  type RemoteTask,
  type TaskProvider,
  type UpsertResult,
} from './provider.ts'

/**
 * VIKUNJA'S NULL DATE, and the reason this constant has a name.
 *
 * Vikunja is written in Go, its date fields are `time.Time`, and an unset one
 * marshals as the zero value rather than as JSON null. Reading it as a date
 * files the task on the 1st of January in the year 1 — a value that sorts
 * before everything, renders as "overdue by 2025 years", and looks like a
 * corrupt database rather than a missing due date. Every date crossing this
 * boundary goes through `dueIn`/`dueOut`, which know about it.
 */
const NO_DATE = '0001-01-01T00:00:00Z'

/**
 * The priority scales, which run in OPPOSITE directions.
 *
 * `public.tasks.priority` is an integer where LOWER is more important and 100
 * is ordinary — the live rows are 20 and 100, and `my_task_add` floors at 1.
 * Vikunja's is 0 unset · 1 low · 2 medium · 3 high · 4 urgent · 5 DO NOW, where
 * HIGHER is more important. Mapping one onto the other by arithmetic would
 * invert the meaning of every task on the list, which is the expensive
 * direction: an urgent task rendered as "whenever" is a missed deadline.
 *
 * Stated as a table, in both directions, and asserted as a round trip in
 * `tests/tasks/vikunja-mapping.test.ts`.
 */
const OUT: ReadonlyArray<readonly [canonical: number, vikunja: number]> = [
  [10, 4],
  [20, 3],
  [50, 2],
  [100, 1],
]

/** Canonical priority → Vikunja. Unknown becomes 0, which is "not set". */
export const priorityOut = (p: number | null): number => {
  if (p === null) return 0
  let best = OUT[0] as readonly [number, number]
  for (const row of OUT) {
    if (Math.abs(row[0] - p) < Math.abs(best[0] - p)) best = row
  }
  return best[1]
}

/**
 * Vikunja priority → canonical, and 0 means DO NOT TOUCH IT.
 *
 * Vikunja's 0 is "nobody said", not "lowest". Mapping it to 100 would silently
 * demote every task Grant marked urgent here the first time the provider
 * reported one back without a priority — the sentinel trap again, one column
 * along. Null means the puller leaves the canonical value alone, and
 * `app.task_pulled` is written to do exactly that.
 */
export const priorityIn = (v: number | null): number | null => {
  if (v === null || v === 0) return null
  let best = OUT[0] as readonly [number, number]
  for (const row of OUT) {
    if (Math.abs(row[1] - v) < Math.abs(best[1] - v)) best = row
  }
  return best[0]
}

/**
 * A DATE here, an INSTANT there — the mismatch policy, written down.
 *
 * `public.tasks.due_on` is a `date`: "the 25th", with no time and no zone.
 * Vikunja's `due_date` is an instant. There is no lossless mapping, so the
 * policy is stated rather than discovered: the office writes MIDNIGHT UTC, and
 * reads back the DATE PART of whatever comes in, in UTC.
 *
 * The consequence is deliberate and small: if Grant sets a due time inside
 * Vikunja, the office keeps the day and drops the time. Losing a time the
 * office has nowhere to put is better than inventing a `due_on` a day either
 * side of it, which is what a local-zone conversion would do for half the year.
 */
export const dueOut = (dueOn: string | null): string =>
  dueOn === null || dueOn === '' ? NO_DATE : `${dueOn}T00:00:00Z`

export const dueIn = (iso: string | null | undefined): string | null => {
  const t = String(iso ?? '')
  if (t === '' || t === NO_DATE || t.startsWith('0001-01-01')) return null
  const at = new Date(t)
  if (Number.isNaN(at.getTime())) return null
  return at.toISOString().slice(0, 10)
}

interface VikunjaTask {
  readonly id?: number
  readonly title?: string
  readonly description?: string
  readonly done?: boolean
  readonly due_date?: string
  readonly priority?: number
  readonly project_id?: number
  readonly updated?: string
}

/**
 * The office's own mark on a task it wrote: the canonical id, in the description.
 *
 * The recorded crash hazard is a crash between the remote create and `app.task_pushed`: the task then has no
 * `external_id`, the next round creates it again, and the board holds two. A mark the office can read back turns that
 * second create into an adoption (the round looks for its own mark before it creates). It is stripped when a task is
 * read, so the detail Grant sees and the detail compared on a pull are what he wrote, not what the mark adds.
 */
const MARK = /\s*\[agentic:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*/i
export const markerOf = (description: string | undefined): string | null =>
  MARK.exec(String(description ?? ''))?.[1]?.toLowerCase() ?? null
export const withMark = (detail: string, id: string): string =>
  `${detail.replace(MARK, ' ').trim()}\n\n[agentic:${id.toLowerCase()}]`.trim()

/**
 * A description as plain text, keeping what a person wrote.
 *
 * Vikunja's editor writes HTML; the API stores whatever it is sent. Two things must both hold: HTML from the editor
 * becomes readable text (block ends become line breaks, entities are decoded), and PLAIN text the office pushed comes
 * back exactly as it went. The first version collapsed every run of whitespace, so a two-paragraph note was one line
 * after its first round trip and the flattened copy was then written back over the original; and it removed anything
 * between a "<" and a ">", so "stock < 5 and price > 3" lost its middle. Only something shaped like a tag is a tag.
 */
export const plainText = (description: string | undefined): string =>
  String(description ?? '')
    .replace(MARK, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)\s*>/gi, '\n')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** The shape of one Vikunja task, as this office reads it. */
export const readTask = (t: VikunjaTask): RemoteTask => ({
  externalId: String(t.id ?? ''),
  externalRevision: String(t.updated ?? ''),
  title: String(t.title ?? ''),
  /*
    Vikunja's description is HTML from its own editor. A task detail here is
    plain text, so the tags come off rather than being stored and rendered as
    literal angle brackets on Grant's phone.
  */
  detail: plainText(t.description),
  done: t.done === true,
  priority: priorityIn(typeof t.priority === 'number' ? t.priority : null),
  dueOn: dueIn(t.due_date),
  externalProjectId: String(t.project_id ?? ''),
  canonicalId: markerOf(t.description),
})

export interface VikunjaOptions {
  /** The server's base URL, with or without a trailing slash. */
  readonly baseUrl: string
  /** A scoped API token. NEVER logged, never returned in an error. */
  readonly token: string
  /** The Vikunja project every task of this office lives in. */
  readonly projectId: number
  /** Injectable for the suite; the real one is `globalThis.fetch`. */
  readonly fetch?: typeof fetch
  /** How long one request may take before it counts as an outage. A server that accepts and never answers is down. */
  readonly timeoutMs?: number
}

const PER_PAGE = 50
const MAX_PAGES = 100

export class VikunjaProvider implements TaskProvider {
  readonly name = 'vikunja'
  private readonly api: string
  private readonly token: string
  private readonly projectId: number
  private readonly http: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: VikunjaOptions) {
    this.api = `${opts.baseUrl.replace(/\/+$/, '')}/api/v1`
    this.token = opts.token
    this.projectId = opts.projectId
    this.http = opts.fetch ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  /*
    ONE place that talks to the network, so one place can be sure the token
    never reaches a message. `fetch` puts the whole request in the message of a
    network error, and CLAUDE.md records a Google refresh token reaching
    `connection_health.detail` exactly that way — so the thrown text is built
    here from the status and a trimmed body, never from the caught error.
  */
  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    return (await this.callRaw(method, path, body)).json
  }

  private async callRaw(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ json: unknown; pages: number | null }> {
    let res: Response
    try {
      res = await this.http(`${this.api}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Without this a server that accepts the connection and never answers holds the duty for ever.
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new ProviderDownError(
        'vikunja',
        (error as Error).name || 'the request did not complete',
      )
    }
    if (!res.ok) {
      const said = (await res.text().catch(() => '')).slice(0, 200)
      /*
        5xx and 429 are the SERVER having a bad time; 4xx is this office asking
        for something wrong. Only the first kind is an outage, and only an
        outage may leave the canonical side untouched and try again later — a
        400 retried for ever is a task that never syncs and never says why.
      */
      if (res.status === 401 || res.status === 403)
        throw new ProviderAuthError('vikunja', res.status)
      if (res.status >= 500 || res.status === 429) {
        throw new ProviderDownError('vikunja', `http ${String(res.status)}`)
      }
      throw new Error(`vikunja refused: http ${String(res.status)} ${said.replace(this.token, '')}`)
    }
    const total = Number(res.headers.get('x-pagination-total-pages'))
    const pages = Number.isInteger(total) && total > 0 ? total : null
    if (res.status === 204) return { json: null, pages }
    return { json: await res.json().catch(() => null), pages }
  }

  async reachable(): Promise<boolean> {
    try {
      await this.call('GET', '/info')
      return true
    } catch {
      return false
    }
  }

  async upsert(task: CanonicalTask): Promise<UpsertResult> {
    const body = {
      title: task.title.slice(0, 250),
      description: withMark(task.detail, task.id),
      done: task.done,
      due_date: dueOut(task.dueOn),
      priority: priorityOut(task.priority),
    }
    /*
      The external id decides create-or-update, and it comes from
      `task_links` rather than from a title match. A provider integration that
      matches on title duplicates every task Grant renames and merges every two
      he names the same — #259 asks for duplicate prevention and this is where
      it lives.
    */
    /*
      A create looks for the office's own mark first. Found, the earlier create did happen and only its record was
      lost, so this adopts it (an update) rather than making a second. The look is one listing per provider instance,
      and only when a create is actually about to happen; a listing that fails is an outage and ends the round, which
      is the safe direction.
    */
    const creating = task.externalId === null || task.externalId === ''
    const adopted = creating ? await this.alreadyMine(task.id) : null
    const target = creating ? adopted : task.externalId
    const got =
      target === null || target === ''
        ? await this.call('PUT', `/projects/${String(this.projectId)}/tasks`, body)
        : await this.call('POST', `/tasks/${target}`, body)
    const t = (got ?? {}) as VikunjaTask
    return {
      externalId: String(t.id ?? task.externalId ?? ''),
      externalRevision: String(t.updated ?? ''),
      externalProjectId: String(t.project_id ?? this.projectId),
    }
  }

  private mine: Map<string, string> | null = null
  private async alreadyMine(id: string): Promise<string | null> {
    if (this.mine === null) {
      this.mine = new Map()
      for (const r of await this.list()) {
        if (r.canonicalId !== null && r.canonicalId !== undefined)
          this.mine.set(r.canonicalId, r.externalId)
      }
    }
    return this.mine.get(id.toLowerCase()) ?? null
  }

  async remove(externalId: string): Promise<void> {
    try {
      await this.call('DELETE', `/tasks/${externalId}`)
    } catch (error) {
      /*
        Already gone is the outcome we wanted. Only a 404 — never an outage,
        which must be retried rather than treated as a completed deletion.
      */
      if (error instanceof ProviderDownError) throw error
      if (!/http 404/.test((error as Error).message)) throw error
    }
  }

  async list(): Promise<RemoteTask[]> {
    /*
      Per PROJECT, not `/tasks/all`, which answers http 400 to an API token —
      established by asking the real server rather than by reading the docs.
      It is also the right question: this office syncs one Vikunja project and
      has no business reading the rest of somebody's account.
    */
    const out: RemoteTask[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { json: got, pages } = await this.callRaw(
        'GET',
        `/projects/${String(this.projectId)}/tasks?per_page=${String(PER_PAGE)}&page=${String(page)}`,
      )
      /*
        The end is an EMPTY page (or the server's own page count), never a short one: `service.maxitemsperpage` can cap
        the page below what was asked for, and "fewer than 50 means last" then stopped after the first page and called
        the rest of the board nonexistent - which the pull never imports and the adoption check never finds.
      */
      if (!Array.isArray(got) || got.length === 0) return out
      for (const t of got as VikunjaTask[]) out.push(readTask(t))
      // The server's own page count is authoritative. Without it (a proxy that drops headers) a short page is the best
      // available sign of the end - the old rule, kept only as the fallback.
      if (pages !== null ? page >= pages : got.length < PER_PAGE) return out
    }
    // A cut-off list presented as the whole list is the one thing a listing may not do.
    throw new Error(
      `vikunja holds more than ${String(MAX_PAGES * PER_PAGE)} tasks in this project; refusing to read part of it`,
    )
  }
}
