/**
 * The Notion HTTP client.
 *
 * ADR-0013 makes Notion the first-class knowledge connector, and the reason is
 * exactly what this file gets to be: an official API, a documented version
 * header, documented rate limits and documented errors. There is no private
 * RPC to reverse-engineer and no browser session to impersonate, which is the
 * whole difference between this connector and the one that got an account
 * banned.
 *
 * What it must get right, in order of how much it would cost to get wrong:
 *
 *   - **Pin the API version.** Notion dates its API and changes shape between
 *     versions. An unpinned client is one that breaks on a day nobody deployed.
 *   - **Respect `Retry-After`.** Notion rate-limits at roughly three requests
 *     a second and says how long to wait. Ignoring it earns a longer block.
 *   - **Never log the token.** It is `ntn_…` in an Authorization header and
 *     nowhere else, ever — not in an error, not in a debug line.
 */

/** The version this client is written against. Changing it is a code change. */
/**
 * The API version every call is made at.
 *
 * Moved from `2022-06-28` on 2026-09-09, and the move buys two things that
 * cannot be had on the old version:
 *
 * **File uploads.** `POST /v1/file_uploads` requires `2026-03-11`. On the old
 * version there is no upload endpoint at all, so "attach the audio overviews to
 * Notion" was impossible rather than unimplemented.
 *
 * **Multi-source databases.** From `2025-09-03` a database can hold several
 * data sources, and Notion's own upgrade guide is explicit that an old
 * connection BREAKS against one — creating pages, querying, and relations all
 * fail once a second source is added to a database somebody is using. That is a
 * failure that arrives later, caused by something Grant does in the Notion UI,
 * with nothing in our code having changed.
 *
 * Verified live against this workspace before switching: search returns 200 on
 * all three versions with our token, and at `2026-03-11` the six workspace
 * databases come back as `data_source` objects.
 *
 * The cost is that `database_id` is no longer the id to use for querying or for
 * parenting a page — `data_source_id` is. Both call sites that cared were
 * changed with this constant.
 */
export const NOTION_VERSION = '2026-03-11'

const BASE = 'https://api.notion.com/v1'

export type NotionFailureKind =
  /** Retrying will not help: a bad request, a page that is not shared. */
  | 'terminal'
  /** Retrying might: a 429, a 5xx, a network fault. */
  | 'transient'
  /** The token is wrong, revoked, or the integration was removed. */
  | 'auth'

export class NotionApiError extends Error {
  constructor(
    readonly code: string,
    readonly kind: NotionFailureKind,
    readonly endpoint: string,
    readonly status: number,
    readonly retryAfter: number | null,
  ) {
    super(`notion ${endpoint} failed: ${code}`)
    this.name = 'NotionApiError'
  }
}

export function classify(status: number, code: string): NotionFailureKind {
  if (status === 401 || code === 'unauthorized') return 'auth'
  if (status === 429 || status >= 500) return 'transient'
  // `restricted_resource` and `object_not_found` both mean "not shared with
  // this integration". Terminal, and the fix is a human sharing a page — which
  // is why the sync reports the count rather than retrying forever.
  return 'terminal'
}

export interface NotionClientOptions {
  readonly fetchImpl?: typeof fetch
  readonly maxRateLimitRetries?: number
  readonly sleep?: (ms: number) => Promise<void>
  /** Ceiling on any single wait, so a hostile Retry-After cannot park us. */
  readonly maxRetryAfterSeconds?: number
  readonly baseUrl?: string
  /** Deadline for one request including reading its body. Injectable so tests need not wait. */
  readonly requestTimeoutMs?: number
  /**
   * Ceiling on ONE `call`, every attempt and every rate-limit wait included. Without it the worst case of a call was
   * (retries + 1) x request timeout + retries x Retry-After clamp = 4 x 20 + 3 x 30 = 170 s, longer than the edge
   * runtime's 150 s wall clock for a single request. Each attempt now gets what is left, and a wait that would not
   * leave time for another attempt is not started: the 429 is thrown (transient, with its Retry-After) instead.
   */
  readonly callDeadlineMs?: number
  /** Milliseconds; a test passes its own. */
  readonly clock?: () => number
}

/** Longest a single Notion request may take before it is abandoned as `timeout` (transient, retryable). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

/** Longest one `call` may take in total, waits and retries included (see `callDeadlineMs`). */
export const DEFAULT_CALL_DEADLINE_MS = 20_000

/** A cursor cannot legitimately be followed this many times; a loop that does is a broken API, not a big workspace. */
export const MAX_PAGES_PER_LIST = 5_000

export class NotionClient {
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRateLimitRetries: number
  private readonly maxRetryAfterSeconds: number
  private readonly baseUrl: string
  private readonly callDeadlineMs: number
  private readonly clock: () => number

  constructor(
    private readonly token: string,
    options: NotionClientOptions = {},
  ) {
    if (token === '') throw new Error('a Notion integration token is required')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 3
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 10
    this.baseUrl = options.baseUrl ?? BASE
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
    this.callDeadlineMs = Math.max(1, options.callDeadlineMs ?? DEFAULT_CALL_DEADLINE_MS)
    this.clock = options.clock ?? Date.now
  }

  /**
   * Auth and version, without a content type.
   *
   * A file upload is `multipart/form-data` sent to a URL Notion hands back,
   * rather than JSON sent to a path, so it cannot go through `call`. It still
   * has to carry the same credentials and the same API version, and those are
   * this class's business — `src/notion/files.ts` should not learn the token.
   *
   * No `Content-Type`: `fetch` sets it from the `FormData`, including the
   * boundary, and a hand-set one omits the boundary and produces a 400.
   */
  uploadHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, 'Notion-Version': NOTION_VERSION }
  }

  async call(
    endpoint: string,
    init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    const method = init.method ?? 'GET'
    let waits = 0
    const startedAt = this.clock()
    const left = (): number => this.callDeadlineMs - (this.clock() - startedAt)

    for (;;) {
      // The whole call has a ceiling, not just each attempt: what is left is what this attempt may use.
      if (left() <= 0) throw new NotionApiError('timeout', 'transient', endpoint, 0, null)
      // Both the request AND the body read sit under one deadline (M2): a Notion that accepts the connection and then
      // says nothing used to hold the whole duty until the platform killed it, and the heartbeat kept the lease alive
      // meanwhile. An abandoned request's late answer is never read.
      const { response, body: parsed } = await this.withDeadline(
        endpoint,
        async (signal) => {
          const res = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
            method,
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Notion-Version': NOTION_VERSION,
              ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
            signal,
          })
          let json: unknown
          try {
            json = await res.json()
          } catch {
            // An HTML 502 from a proxy or CDN is not JSON. It is still a status, and the status says what it was: a
            // raw SyntaxError here read as an unclassified fault and was neither retried as transient nor named.
            json = undefined
          }
          return { response: res, body: json }
        },
        Math.min(this.requestTimeoutMs, left()),
      )
      const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      if (response.ok) {
        if (isObject) return parsed as Record<string, unknown>
        // A 200 that is not a JSON object is a malformed response, never an empty result: reading it as `{}` would
        // make a broken API look like an empty workspace ("0 shared pages. Nothing new.").
        throw new NotionApiError('malformed_response', 'transient', endpoint, response.status, null)
      }
      const body: Record<string, unknown> = isObject ? (parsed as Record<string, unknown>) : {}

      const code = String(body.code ?? `http_${String(response.status)}`)
      const kind = classify(response.status, code)

      if (kind === 'transient' && response.status === 429 && waits < this.maxRateLimitRetries) {
        const header = Number(response.headers.get('retry-after') ?? '1')
        // Notion's own number, clamped. Trusting it unclamped hands an upstream
        // header control over how long this process blocks.
        const seconds = Math.min(
          Number.isFinite(header) && header > 0 ? header : 1,
          this.maxRetryAfterSeconds,
        )
        // No time for another attempt after the wait: do not spend the wait, hand the 429 up (transient, so the
        // caller defers the work and the next run takes it).
        if (seconds * 1_000 < left()) {
          waits += 1
          await this.sleep(seconds * 1_000)
          continue
        }
      }

      const retryAfter = Number(response.headers.get('retry-after') ?? '')
      throw new NotionApiError(
        code,
        kind,
        endpoint,
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : null,
      )
    }
  }

  /**
   * One request under a hard deadline: the AbortSignal tells a real `fetch` to drop the socket, and the race frees
   * this caller even when the transport ignores it. Whichever settles first wins; the loser is discarded.
   */
  private async withDeadline<T>(
    endpoint: string,
    run: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new NotionApiError('timeout', 'transient', endpoint, 0, null))
        controller.abort()
      }, timeoutMs)
    })
    const running = run(controller.signal)
    running.catch(() => undefined)
    try {
      return await Promise.race([running, deadline])
    } catch (error) {
      // A socket-level failure (DNS, reset, refused) is the network, and the network is transient: without this it
      // escaped as a bare TypeError, which a caller could only read as "something else", never retry or defer.
      if (error instanceof NotionApiError) throw error
      throw new NotionApiError('network_error', 'transient', endpoint, 0, null)
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Every page of a paginated endpoint.
   *
   * Notion pages at 100 and hands back a cursor. A caller that reads only the
   * first page gets a plausible, wrong answer — the commonest way an
   * integration silently syncs a subset — so paging is not optional here.
   */
  async *paginate(
    endpoint: string,
    body: Record<string, unknown> = {},
    method: 'GET' | 'POST' = 'POST',
    /** Called before EVERY request, the first included; throwing from it ends the listing (a spent run budget). */
    beforeRequest?: () => void,
  ): AsyncGenerator<Record<string, unknown>> {
    let cursor: string | undefined
    for (let requests = 0; ; requests += 1) {
      // A cursor that never ends is a broken API, and nothing else bounds this loop but the caller's clock.
      if (requests >= MAX_PAGES_PER_LIST)
        throw new NotionApiError('malformed_response', 'transient', endpoint, 200, null)
      beforeRequest?.()
      const page = await this.call(
        method === 'GET'
          ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}page_size=100${cursor === undefined ? '' : `&start_cursor=${encodeURIComponent(cursor)}`}`
          : endpoint,
        method === 'GET'
          ? { method }
          : {
              method,
              body: {
                ...body,
                page_size: 100,
                ...(cursor === undefined ? {} : { start_cursor: cursor }),
              },
            },
      )
      for (const result of (page.results as Record<string, unknown>[]) ?? []) yield result
      if (page.has_more !== true || typeof page.next_cursor !== 'string') return
      // The same cursor handed back is a loop, not a next page.
      if (page.next_cursor === cursor)
        throw new NotionApiError('malformed_response', 'transient', endpoint, 200, null)
      cursor = page.next_cursor
    }
  }
}
