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
export const NOTION_VERSION = '2022-06-28'

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
}

export class NotionClient {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRateLimitRetries: number
  private readonly maxRetryAfterSeconds: number
  private readonly baseUrl: string

  constructor(
    private readonly token: string,
    options: NotionClientOptions = {},
  ) {
    if (token === '') throw new Error('a Notion integration token is required')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 3
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 30
    this.baseUrl = options.baseUrl ?? BASE
  }

  async call(
    endpoint: string,
    init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    const method = init.method ?? 'GET'
    let waits = 0

    for (;;) {
      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': NOTION_VERSION,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })

      const body = (await response.json()) as Record<string, unknown>
      if (response.ok) return body

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
        waits += 1
        await this.sleep(seconds * 1_000)
        continue
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
  ): AsyncGenerator<Record<string, unknown>> {
    let cursor: string | undefined
    for (;;) {
      const page = await this.call(
        method === 'GET'
          ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}page_size=100${cursor === undefined ? '' : `&start_cursor=${cursor}`}`
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
      cursor = page.next_cursor
    }
  }
}
