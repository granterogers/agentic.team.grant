/**
 * The Slack Web API client.
 *
 * Small on purpose. The interesting content is not the HTTP — it is the two
 * places where the obvious implementation is wrong, and both are Phase 7
 * failure injections:
 *
 * **1. Retrying a `chat.postMessage` after a connection interrupt posts twice.**
 * There is no idempotency key in the Slack API. A request that fails with a
 * network error after Slack processed it is indistinguishable, from here, from
 * one that never arrived — so a blanket retry is a duplicate-message generator,
 * and a blanket give-up is a lost-message generator. Neither is acceptable, so
 * this client refuses to guess: unsafe methods are never retried on a network
 * error, the failure is reported as `indeterminate`, and the caller reconciles
 * (§7: *"Webhooks and push events are hints, not truth ... reconcile state"*).
 * `postMessage` carries Slack message metadata precisely so that reconciliation
 * has something to match on.
 *
 * **2. `ok: false` is an HTTP 200.** Slack signals almost every failure with a
 * 200 and `{"ok": false, "error": "..."}`. Code that checks `response.ok` — the
 * fetch property, which is about the status code — sees success for a revoked
 * token. The two `ok`s are one letter apart and mean unrelated things.
 *
 * The token never appears in an error message, a log line or a thrown value.
 */

import { failedBeforeSending } from '../channels/network-failure.ts'

export interface SlackApiResponse {
  readonly ok: boolean
  readonly error?: string
  readonly [key: string]: unknown
}

/** How the caller should treat a failure. */
export type FailureKind =
  /** Try again, possibly after a wait. The state of the world is unchanged. */
  | 'retryable'
  /** This call will never succeed as written. Change something. */
  | 'terminal'
  /** Only a human can fix it: a revoked token, an app limit, a lost install. */
  | 'needs_human'
  /** We do not know whether it happened. Reconcile before doing anything. */
  | 'indeterminate'

export class SlackApiError extends Error {
  constructor(
    readonly code: string,
    readonly kind: FailureKind,
    readonly method: string,
    /** Seconds Slack asked us to wait, when it said. */
    readonly retryAfter: number | null = null,
  ) {
    super(`slack ${method} failed: ${code}`)
    this.name = 'SlackApiError'
  }
}

/**
 * Slack error codes this system has an opinion about.
 *
 * Anything absent is treated as `terminal`, which is the conservative default:
 * an unknown failure retried in a loop is how a rate limit becomes a ban, and
 * an unknown failure that actually was transient costs one delivery and shows
 * up in `slack_deliveries.error_code` where it can be classified properly.
 */
const CLASSIFICATION: Readonly<Record<string, FailureKind>> = {
  // The token is gone. No retry helps; Grant must reinstall or reissue.
  token_revoked: 'needs_human',
  invalid_auth: 'needs_human',
  account_inactive: 'needs_human',
  token_expired: 'needs_human',
  not_authed: 'needs_human',
  // The workspace has hit its installed-app ceiling. Named explicitly because
  // §13 reserves app slots and this is what running out looks like.
  app_limit_reached: 'needs_human',
  // Scope missing: a code change, not a retry.
  missing_scope: 'needs_human',

  ratelimited: 'retryable',
  rate_limited: 'retryable',
  service_unavailable: 'retryable',
  internal_error: 'retryable',
  fatal_error: 'retryable',
  request_timeout: 'retryable',

  // Recoverable by doing something else first, which the office knows how to
  // do — join the channel, then post again. `terminal` for the CALL, not for
  // the delivery.
  not_in_channel: 'terminal',
  channel_not_found: 'terminal',
  is_archived: 'terminal',
  msg_too_long: 'terminal',
  invalid_blocks: 'terminal',
  restricted_action: 'terminal',
}

export function classify(code: string): FailureKind {
  return CLASSIFICATION[code] ?? 'terminal'
}

/**
 * Methods sent as a GET with a query string rather than as a JSON body.
 *
 * Found the hard way, against the live workspace: `conversations.history` with
 * a JSON body works, and `conversations.replies` with the same body returns
 * `invalid_arguments`. Slack's read methods are documented as form-encoded and
 * only some of them tolerate JSON, so "it worked for the method I tried" is not
 * evidence about the next one. Reads take no body worth POSTing anyway.
 */
const QUERY_METHODS: ReadonlySet<string> = new Set([
  'auth.test',
  'conversations.list',
  'conversations.info',
  'conversations.history',
  'conversations.replies',
  // Added after `conversations.members` returned `invalid_arguments` to a JSON
  // body, exactly as `conversations.replies` had. The list is discovered one
  // method at a time because Slack's tolerance for JSON is per-method and
  // undocumented; a read added here is a read that will not fail this way.
  'conversations.members',
  'users.list',
  'users.info',
  'team.info',
  'chat.getPermalink',
])

/** Methods that may be safely repeated after an indeterminate failure. */
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set([
  'auth.test',
  'conversations.list',
  'conversations.info',
  'conversations.history',
  'conversations.replies',
  'conversations.members',
  'users.list',
  'conversations.join',
  'users.info',
  'team.info',
  'chat.getPermalink',
  // Deleting an already-deleted message returns message_not_found, which is
  // the outcome we wanted; repeating it is safe.
  'chat.delete',
  // Adding a reaction twice returns already_reacted. Also safe.
  'reactions.add',
])

/** Flatten a body into query parameters, dropping nothing silently. */
const queryString = (body: Record<string, unknown>): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue
    params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  return params.toString()
}

const TOKEN_PATTERN = /\bxox[abposr]-[A-Za-z0-9-]+/g

/** Strip anything token-shaped before a string is logged or thrown. */
export function redact(value: string): string {
  return value.replace(TOKEN_PATTERN, 'xox…-[redacted]')
}

export interface SlackClientOptions {
  readonly fetchImpl?: typeof fetch
  /** Attempts spent waiting out a 429 before giving up. */
  readonly maxRateLimitRetries?: number
  /** Injected so tests do not actually sleep. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Ceiling on any single wait, so a hostile Retry-After cannot park us. */
  readonly maxRetryAfterSeconds?: number
  readonly baseUrl?: string
}

export interface CallOutcome {
  readonly body: SlackApiResponse
  /** How many 429s were waited out. Zero on the ordinary path. */
  readonly rateLimitWaits: number
}

export class SlackClient {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRateLimitRetries: number
  private readonly maxRetryAfterSeconds: number
  private readonly baseUrl: string

  constructor(
    private readonly token: string,
    options: SlackClientOptions = {},
  ) {
    if (token === '') throw new Error('a Slack bot token is required')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 3
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 60
    this.baseUrl = options.baseUrl ?? 'https://slack.com/api'
  }

  /**
   * Call a method.
   *
   * Throws `SlackApiError` for every failure, including the `ok: false` ones
   * that arrive as HTTP 200.
   */
  async call(method: string, body: Record<string, unknown> = {}): Promise<CallOutcome> {
    const idempotent = IDEMPOTENT_METHODS.has(method)
    let waits = 0

    for (;;) {
      let response: Response
      try {
        response = await (QUERY_METHODS.has(method)
          ? this.fetchImpl(`${this.baseUrl}/${method}?${queryString(body)}`, {
              method: 'GET',
              headers: { Authorization: `Bearer ${this.token}` },
            })
          : this.fetchImpl(`${this.baseUrl}/${method}`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json; charset=utf-8',
              },
              body: JSON.stringify(body),
            }))
      } catch (error) {
        // The connection-interrupted case. For a read, just try again; for a
        // write, we genuinely do not know, and saying so is the only honest
        // answer available.
        const detail = redact(error instanceof Error ? error.message : String(error))
        if (idempotent && waits < this.maxRateLimitRetries) {
          waits += 1
          await this.sleep(250 * waits)
          continue
        }
        if (!idempotent && failedBeforeSending(error)) {
          throw new SlackApiError(`network_before_send:${detail}`, 'retryable', method)
        }
        throw new SlackApiError(
          idempotent ? `network_error:${detail}` : `indeterminate:${detail}`,
          idempotent ? 'retryable' : 'indeterminate',
          method,
        )
      }

      if (response.status === 429) {
        const header = response.headers.get('retry-after')
        const parsed = header === null ? Number.NaN : Number.parseInt(header, 10)
        // Slack's own guidance is to obey Retry-After. Where it is absent or
        // unparseable, one second is the documented floor; the ceiling is ours,
        // because an unbounded wait is an outage we chose.
        const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
        if (waits >= this.maxRateLimitRetries) {
          throw new SlackApiError('ratelimited', 'retryable', method, seconds)
        }
        waits += 1
        await this.sleep(Math.min(seconds, this.maxRetryAfterSeconds) * 1000)
        continue
      }

      if (response.status >= 500) {
        if (idempotent && waits < this.maxRateLimitRetries) {
          waits += 1
          await this.sleep(500 * waits)
          continue
        }
        throw new SlackApiError(
          `http_${String(response.status)}`,
          idempotent ? 'retryable' : 'indeterminate',
          method,
        )
      }

      const parsed = (await response.json()) as SlackApiResponse
      // The trap named in the header: `response.ok` is about the status code
      // and is true here. `parsed.ok` is Slack's verdict.
      if (parsed.ok) return { body: parsed, rateLimitWaits: waits }

      const code = typeof parsed.error === 'string' ? parsed.error : 'unknown_error'
      throw new SlackApiError(code, classify(code), method, null)
    }
  }
}
