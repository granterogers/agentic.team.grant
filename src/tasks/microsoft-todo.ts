/**
 * Microsoft To Do, as one implementation of `TaskProvider` and nothing more.
 *
 * Everything Microsoft-shaped is in this file: the Graph URLs, the OAuth token
 * exchange, the importance scale, and the body marker. `src/tasks/sync.ts`
 * imports none of it, exactly as it imports none of `vikunja.ts`.
 *
 * ## Delegated, on Grant's own account
 *
 * The same decision as the Google connection (ADR-0013): the office reads and
 * writes HIS To Do lists with HIS consent. The durable credential is a refresh
 * token from the consent screen (`supabase/functions/microsoft-oauth`), held
 * in the vault. This file exchanges it for the one-hour access token each
 * round needs, and tells the caller when Microsoft rotated the refresh token,
 * because a rotated token that is not stored is a connection that silently
 * dies at the next round.
 */
import {
  type CanonicalTask,
  ProviderAuthError,
  ProviderDownError,
  type RemoteTask,
  type TaskProvider,
  type UpsertResult,
} from './provider.ts'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const SCOPE = 'Tasks.ReadWrite offline_access'
const PAGE = 100
const MAX_PAGES = 100
const TITLE_MAX = 255

/**
 * The importance scale, as a table, in both directions.
 *
 * `public.tasks.priority` is an integer where LOWER is more important (10
 * urgent, 20 important, 50 normal, 100 whenever). Microsoft To Do has three
 * levels, so urgent and important share "high". On the way back "high" becomes
 * 20, which means an urgent task that a person edits in To Do comes back as
 * important. That is the honest limit of the provider, and it is said here so
 * nobody mistakes it for a bug in the engine.
 */
const OUT: ReadonlyArray<readonly [canonical: number, graph: 'low' | 'normal' | 'high']> = [
  [10, 'high'],
  [20, 'high'],
  [50, 'normal'],
  [100, 'low'],
]

/** Canonical priority → Microsoft importance. Unknown becomes "normal". */
export const importanceOut = (p: number | null): 'low' | 'normal' | 'high' => {
  if (p === null) return 'normal'
  let best = OUT[0] as readonly [number, string]
  for (const row of OUT) {
    if (Math.abs(row[0] - p) < Math.abs(best[0] - p)) best = row
  }
  return best[1] as 'low' | 'normal' | 'high'
}

/** Microsoft importance → canonical. Every importance maps to a level, so this is never "do not touch". */
export const importanceIn = (v: string | null | undefined): number => {
  if (v === 'high') return 20
  if (v === 'low') return 100
  return 50
}

/**
 * A DATE, as Microsoft holds it.
 *
 * The office writes MIDNIGHT UTC and reads back the DATE PART of what comes
 * back, the same policy as Vikunja (`dueIn`/`dueOut`). A due time set inside
 * To Do is kept as its day, not its hour: the office has nowhere to put a time.
 */
export const dueOut = (dueOn: string | null): { dateTime: string; timeZone: string } | null =>
  dueOn === null || dueOn === '' ? null : { dateTime: `${dueOn}T00:00:00.0000000`, timeZone: 'UTC' }

export const dueIn = (
  due: { dateTime?: string; timeZone?: string } | null | undefined,
): string | null => {
  const t = String(due?.dateTime ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null
}

/**
 * The office's own mark on a task it wrote: the canonical id, at the end of the body.
 *
 * The same guard as Vikunja's: a crash between the remote create and the
 * office recording its id leaves a task with no link, and the next round would
 * create a second. The mark lets that round find the first and adopt it.
 */
const MARK = /\s*\[agentic:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*/i
export const markerOf = (body: string | undefined): string | null =>
  MARK.exec(String(body ?? ''))?.[1]?.toLowerCase() ?? null
export const withMark = (detail: string, id: string): string =>
  `${detail.replace(MARK, ' ').trim()}\n\n[agentic:${id.toLowerCase()}]`.trim()

/** A body as plain text, with the mark taken off. Graph returns text because the request asks for it. */
export const plainText = (body: string | undefined): string =>
  String(body ?? '')
    .replace(MARK, ' ')
    .replace(/\r\n/g, '\n')
    .trim()

/** The shape of one Microsoft To Do task, as this office reads it. */
interface GraphTask {
  readonly id?: string
  readonly title?: string
  readonly body?: { readonly content?: string }
  readonly status?: string
  readonly importance?: string
  readonly dueDateTime?: { readonly dateTime?: string; readonly timeZone?: string } | null
  readonly lastModifiedDateTime?: string
}

export const readTask = (t: GraphTask, listId: string): RemoteTask => ({
  externalId: String(t.id ?? ''),
  externalRevision: String(t.lastModifiedDateTime ?? ''),
  title: String(t.title ?? ''),
  detail: plainText(t.body?.content),
  done: t.status === 'completed',
  priority: importanceIn(t.importance),
  dueOn: dueIn(t.dueDateTime),
  externalProjectId: listId,
  canonicalId: markerOf(t.body?.content),
})

export interface MicrosoftTodoOptions {
  /** The Azure application (client) id. Not secret, but never logged. */
  readonly clientId: string
  /** The Azure client secret value. NEVER logged, never returned in an error. */
  readonly clientSecret: string
  /** The delegated refresh token from the consent screen. NEVER logged. */
  readonly refreshToken: string
  /** The To Do list every task of this office lives in. Empty means "resolve the default list first". */
  readonly listId: string
  /**
   * Called with a NEW refresh token when Microsoft rotates it. The caller must store it: the old one may stop working
   * at any time after this.
   */
  readonly onRefreshTokenRotated?: (token: string) => Promise<void>
  /** Injectable for the suite; the real one is `globalThis.fetch`. */
  readonly fetch?: typeof fetch
  /** How long one request may take before it counts as an outage. */
  readonly timeoutMs?: number
}

export class MicrosoftTodoProvider implements TaskProvider {
  readonly name = 'microsoft_todo'
  private readonly http: typeof fetch
  private readonly timeoutMs: number
  private listId: string
  private accessToken: Promise<string> | null = null
  private refreshToken: string
  private readonly opts: MicrosoftTodoOptions

  constructor(opts: MicrosoftTodoOptions) {
    this.opts = opts
    this.http = opts.fetch ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? 20_000
    this.listId = opts.listId
    this.refreshToken = opts.refreshToken
  }

  /*
    ONE place that talks to the network, so one place can be sure no secret reaches a message. The thrown text is
    built from the status alone, never from the caught error: `fetch` puts the request in a network error's message,
    and the Google connection already had a refresh token reach a health row that way (see `vikunja.ts`).
  */
  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: BodyInit,
  ): Promise<Response> {
    try {
      return await this.http(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new ProviderDownError(
        'microsoft_todo',
        (error as Error).name || 'the request did not complete',
      )
    }
  }

  /** The access token for this round, exchanged once and reused until the round ends. */
  private token(): Promise<string> {
    this.accessToken ??= this.exchange().catch((error) => {
      // A failed exchange is not remembered, so the next call tries again rather than repeating a stale failure.
      this.accessToken = null
      throw error
    })
    return this.accessToken
  }

  private async exchange(): Promise<string> {
    const res = await this.send(
      'POST',
      TOKEN_URL,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        scope: SCOPE,
      }).toString(),
    )
    if (!res.ok) {
      /*
        `invalid_grant` is the answer for a revoked, expired or rotated-away refresh token, and it is the one the
        office must hear about: nothing will work until Grant connects again. Everything else from the token endpoint
        that is a server problem is an outage.
      */
      const said = (await res.json().catch(() => ({}))) as { error?: string }
      if (said.error === 'invalid_grant' || said.error === 'unauthorized_client') {
        throw new ProviderAuthError('microsoft_todo', res.status)
      }
      if (res.status >= 500 || res.status === 429) {
        throw new ProviderDownError('microsoft_todo', `http ${String(res.status)}`)
      }
      throw new ProviderAuthError('microsoft_todo', res.status)
    }
    const got = (await res.json().catch(() => ({}))) as {
      access_token?: string
      refresh_token?: string
    }
    if (typeof got.access_token !== 'string' || got.access_token === '') {
      throw new ProviderDownError('microsoft_todo', 'the token endpoint answered without a token')
    }
    if (typeof got.refresh_token === 'string' && got.refresh_token !== '') {
      // Microsoft rotated it. Keep the new one in memory for this round, and hand it to the caller to store.
      this.refreshToken = got.refresh_token
      await this.opts.onRefreshTokenRotated?.(got.refresh_token)
    }
    return got.access_token
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    return (await this.callRaw(method, path, body)).json
  }

  private async callRaw(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ json: unknown; next: string | null }> {
    const access = await this.token()
    const res = await this.send(
      method,
      path.startsWith('http') ? path : `${GRAPH}${path}`,
      {
        Authorization: `Bearer ${access}`,
        // Plain text bodies, so the office never has to strip HTML it did not write.
        Prefer: 'outlook.body-content-type="text"',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body === undefined ? undefined : JSON.stringify(body),
    )
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ProviderAuthError('microsoft_todo', res.status)
      }
      if (res.status >= 500 || res.status === 429) {
        throw new ProviderDownError('microsoft_todo', `http ${String(res.status)}`)
      }
      throw new Error(`microsoft_todo refused: http ${String(res.status)}`)
    }
    if (res.status === 204) return { json: null, next: null }
    const json = (await res.json().catch(() => null)) as { '@odata.nextLink'?: string } | null
    return { json, next: json?.['@odata.nextLink'] ?? null }
  }

  async reachable(): Promise<boolean> {
    try {
      await this.call('GET', '/me/todo/lists?$top=1')
      return true
    } catch {
      return false
    }
  }

  /**
   * The list the office uses when none was chosen: Microsoft's own default list (`wellknownListName` = defaultList).
   * Returns null when the account has no such list, which is an answer and not an outage.
   */
  async defaultList(): Promise<{ id: string; name: string } | null> {
    let next: string | null = `${GRAPH}/me/todo/lists?$top=${String(PAGE)}`
    for (let page = 0; next !== null && page < MAX_PAGES; page += 1) {
      const { json, next: after } = await this.callRaw('GET', next)
      const lists = ((json as { value?: unknown[] } | null)?.value ?? []) as {
        id?: string
        displayName?: string
        wellknownListName?: string
      }[]
      const found = lists.find((l) => l.wellknownListName === 'defaultList')
      if (found?.id !== undefined) {
        this.listId = found.id
        return { id: found.id, name: String(found.displayName ?? '') }
      }
      next = after
    }
    return null
  }

  private tasksPath(): string {
    return `/me/todo/lists/${encodeURIComponent(this.listId)}/tasks`
  }

  private body(task: CanonicalTask): Record<string, unknown> {
    return {
      title: task.title.slice(0, TITLE_MAX),
      body: { contentType: 'text', content: withMark(task.detail, task.id) },
      status: task.done ? 'completed' : 'notStarted',
      importance: importanceOut(task.priority),
      dueDateTime: dueOut(task.dueOn),
    }
  }

  async upsert(task: CanonicalTask): Promise<UpsertResult> {
    if (this.listId === '') {
      throw new Error('microsoft_todo has no list to write to; resolve the default list first')
    }
    /*
      The external id decides create-or-update, and it comes from `task_links`, never from a title match. A create first
      looks for the office's own mark, so a create whose record was lost is adopted rather than duplicated.
    */
    const creating = task.externalId === null || task.externalId === ''
    const adopted = creating ? await this.alreadyMine(task.id) : null
    const target = creating ? adopted : task.externalId
    const got = (
      target === null || target === ''
        ? await this.call('POST', this.tasksPath(), this.body(task))
        : await this.call(
            'PATCH',
            `${this.tasksPath()}/${encodeURIComponent(target)}`,
            this.body(task),
          )
    ) as GraphTask | null
    return {
      externalId: String(got?.id ?? task.externalId ?? adopted ?? ''),
      externalRevision: String(got?.lastModifiedDateTime ?? ''),
      externalProjectId: this.listId,
    }
  }

  private mine: Map<string, string> | null = null
  private async alreadyMine(id: string): Promise<string | null> {
    if (this.mine === null) {
      this.mine = new Map()
      for (const r of await this.list()) {
        if (r.canonicalId !== null && r.canonicalId !== undefined) {
          this.mine.set(r.canonicalId, r.externalId)
        }
      }
    }
    return this.mine.get(id.toLowerCase()) ?? null
  }

  async remove(externalId: string): Promise<void> {
    try {
      await this.call('DELETE', `${this.tasksPath()}/${encodeURIComponent(externalId)}`)
    } catch (error) {
      // Already gone is the outcome we wanted. Only a 404 is that, never an outage.
      if (error instanceof ProviderDownError) throw error
      if (!/http 404/.test((error as Error).message)) throw error
    }
  }

  async list(): Promise<RemoteTask[]> {
    const out: RemoteTask[] = []
    let next: string | null = `${GRAPH}${this.tasksPath()}?$top=${String(PAGE)}`
    for (let page = 0; next !== null; page += 1) {
      // A cut-off list presented as the whole list is the one thing a listing may not do.
      if (page >= MAX_PAGES) {
        throw new Error(
          `microsoft_todo holds more than ${String(MAX_PAGES * PAGE)} tasks in this list; refusing to read part of it`,
        )
      }
      const { json, next: after } = await this.callRaw('GET', next)
      for (const t of (json as { value?: GraphTask[] } | null)?.value ?? []) {
        out.push(readTask(t, this.listId))
      }
      // Graph's own `@odata.nextLink` is the authority on the end. A short page is not a sign of it.
      next = after
    }
    return out
  }
}
