/**
 * The Telegram Bot API client.
 *
 * Small, like the Slack one, and for the same reason: the interesting content
 * is the handful of places where the obvious implementation is wrong.
 *
 * **1. `ok: false` arrives as an HTTP 200**, exactly as it does on Slack — but
 * Telegram also uses a real 4xx for the same conditions, so both have to be
 * handled and neither can be trusted alone.
 *
 * **2. `retry_after` is inside the JSON, not in a header.** Telegram returns
 * `{"ok":false,"error_code":429,"parameters":{"retry_after":31}}`. Code that
 * reads a `Retry-After` header — the habit every other API teaches — gets
 * nothing and retries immediately, which is how a rate limit becomes a longer
 * rate limit.
 *
 * **3. The errors are English sentences, not codes.** There is no
 * `chat_not_found` field; there is `"Bad Request: chat not found"`. Matching on
 * prose is unpleasant and unavoidable, so it happens in one place, on
 * lowercased substrings, with an explicit fallback rather than a guess.
 *
 * **4. `sendMessage` is not idempotent and has no idempotency key.** Same
 * conclusion as Slack: a write is never retried after a network error and the
 * caller is told the outcome is unknown. Unlike Slack it can never be
 * reconciled — a bot cannot read its own sent messages back — so unknown is
 * permanent. See `src/channels/delivery.ts`.
 */

import type { TransportFailureKind } from '../channels/delivery.ts'

export interface TelegramResponse {
  readonly ok: boolean
  readonly result?: unknown
  readonly description?: string
  readonly error_code?: number
  readonly parameters?: { retry_after?: number; migrate_to_chat_id?: number }
}

export class TelegramApiError extends Error {
  constructor(
    readonly code: string,
    readonly kind: TransportFailureKind,
    readonly method: string,
    readonly retryAfter: number | null = null,
  ) {
    super(`telegram ${method} failed: ${code}`)
    this.name = 'TelegramApiError'
  }
}

/**
 * Telegram's prose, mapped onto something a caller can branch on.
 *
 * Ordered most specific first: "bot was blocked by the user" and "bot was
 * kicked" both begin the same way and need different remedies — one is Grant's
 * own choice to undo, the other is somebody re-adding the bot.
 */
const DESCRIPTIONS: readonly [string, string, TransportFailureKind][] = [
  ['bot was blocked by the user', 'blocked_by_user', 'needs_human'],
  ['bot was kicked', 'kicked_from_chat', 'needs_human'],
  ['user is deactivated', 'user_deactivated', 'needs_human'],
  ['chat not found', 'chat_not_found', 'terminal'],
  ['not enough rights', 'insufficient_rights', 'needs_human'],
  ['unauthorized', 'unauthorized', 'needs_human'],
  ['message is not modified', 'not_modified', 'terminal'],
  ['message to delete not found', 'message_not_found', 'terminal'],
  ['message to edit not found', 'message_not_found', 'terminal'],
  ['message is too long', 'message_too_long', 'terminal'],
  ["can't parse entities", 'bad_markup', 'terminal'],
  ['too many requests', 'rate_limited', 'retryable'],
  ['internal server error', 'internal_error', 'retryable'],
  ['bad gateway', 'bad_gateway', 'retryable'],
]

export function classifyDescription(
  description: string | undefined,
  errorCode?: number,
): { code: string; kind: TransportFailureKind } {
  const text = (description ?? '').toLowerCase()
  for (const [needle, code, kind] of DESCRIPTIONS) {
    if (text.includes(needle)) return { code, kind }
  }
  if (errorCode === 429) return { code: 'rate_limited', kind: 'retryable' }
  if (errorCode !== undefined && errorCode >= 500) {
    return { code: `http_${String(errorCode)}`, kind: 'retryable' }
  }
  // Unknown is terminal, not retryable: an unknown failure retried in a loop is
  // how a rate limit becomes a ban, and an unknown that was transient costs one
  // delivery and shows up in `deliveries.error_code` to be classified properly.
  return { code: 'unknown_error', kind: 'terminal' }
}

/** Methods safe to repeat after an indeterminate failure. */
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set([
  'getMe',
  'getChat',
  'getWebhookInfo',
  'deleteMessage',
  'answerCallbackQuery',
])

/**
 * The token is a path segment in Telegram's URLs, so it leaks through logs.
 *
 * The character class deliberately includes `:` even though a real token has
 * exactly one. Over-redacting costs a slightly less readable log line;
 * under-redacting puts a live credential in one, and the pattern that assumed
 * one colon left the tail of a test token visible. `/` is excluded, so the
 * match still stops at the method name.
 */
const TOKEN_IN_URL = /\/bot[0-9]+:[A-Za-z0-9_:-]+/g

export function redact(value: string): string {
  return value.replace(TOKEN_IN_URL, '/bot[redacted]')
}

export interface TelegramClientOptions {
  readonly fetchImpl?: typeof fetch
  readonly maxRateLimitRetries?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly maxRetryAfterSeconds?: number
  readonly baseUrl?: string
}

export class TelegramClient {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRateLimitRetries: number
  private readonly maxRetryAfterSeconds: number
  private readonly baseUrl: string

  constructor(
    private readonly token: string,
    options: TelegramClientOptions = {},
  ) {
    if (token === '') throw new Error('a Telegram bot token is required')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 3
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 60
    this.baseUrl = options.baseUrl ?? 'https://api.telegram.org'
  }

  async call(method: string, body: Record<string, unknown> = {}): Promise<TelegramResponse> {
    const idempotent = IDEMPOTENT_METHODS.has(method)
    let waits = 0

    for (;;) {
      let response: Response
      try {
        response = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (error) {
        const detail = redact(error instanceof Error ? error.message : String(error))
        if (idempotent && waits < this.maxRateLimitRetries) {
          waits += 1
          await this.sleep(250 * waits)
          continue
        }
        throw new TelegramApiError(
          idempotent ? `network_error:${detail}` : `indeterminate:${detail}`,
          idempotent ? 'retryable' : 'indeterminate',
          method,
        )
      }

      let parsed: TelegramResponse
      try {
        parsed = (await response.json()) as TelegramResponse
      } catch {
        // A body that is not JSON is a proxy or an outage, not the API. For a
        // write that means we do not know whether it happened.
        throw new TelegramApiError(
          idempotent ? `http_${String(response.status)}` : 'indeterminate:non_json_response',
          idempotent ? 'retryable' : 'indeterminate',
          method,
        )
      }

      if (parsed.ok) return parsed

      const { code, kind } = classifyDescription(parsed.description, parsed.error_code)

      if (code === 'rate_limited') {
        // From the JSON body, where it actually lives.
        const seconds = parsed.parameters?.retry_after ?? 1
        if (waits >= this.maxRateLimitRetries) {
          throw new TelegramApiError('rate_limited', 'retryable', method, seconds)
        }
        waits += 1
        await this.sleep(Math.min(seconds, this.maxRetryAfterSeconds) * 1000)
        continue
      }

      if (kind === 'retryable' && idempotent && waits < this.maxRateLimitRetries) {
        waits += 1
        await this.sleep(500 * waits)
        continue
      }

      throw new TelegramApiError(code, kind, method, null)
    }
  }

  /**
   * The same call, with a multipart body.
   *
   * Issue #66. Sending a file Telegram cannot fetch itself means uploading it,
   * and an upload is `multipart/form-data` — which `call` cannot do, because it
   * sets a JSON content type and stringifies the body.
   *
   * Deliberately a separate method rather than a branch inside `call`. `call`
   * retries, and retrying an upload of an audio file is a second copy of a
   * twenty-megabyte body against a rate limit; a `sendAudio` that failed
   * indeterminately is reconciled the same way every other Telegram write is,
   * which is to say not at all — a bot cannot read its own sent messages back,
   * so never sending it again is the only guarantee available and it is the
   * safe one.
   *
   * The content type is deliberately NOT set: `fetch` derives it from the
   * FormData along with the multipart boundary, and setting it by hand omits
   * the boundary and produces a 400 that reads like a bad request.
   */
  async callForm(method: string, form: FormData): Promise<TelegramResponse> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        body: form,
      })
    } catch (error) {
      const detail = redact(error instanceof Error ? error.message : String(error))
      throw new TelegramApiError(`indeterminate:${detail}`, 'indeterminate', method)
    }

    let parsed: TelegramResponse
    try {
      parsed = (await response.json()) as TelegramResponse
    } catch {
      throw new TelegramApiError('indeterminate:non_json_response', 'indeterminate', method)
    }
    if (parsed.ok) return parsed

    const { code, kind } = classifyDescription(parsed.description, parsed.error_code)
    throw new TelegramApiError(code, kind, method, parsed.parameters?.retry_after ?? null)
  }
}
