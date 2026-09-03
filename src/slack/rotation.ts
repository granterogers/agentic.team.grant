/**
 * Slack config-token rotation.
 *
 * §15: *"Only the human-provided config token pair lives in the bootstrap
 * store, and its rotating state belongs in the database."* The pair expires
 * roughly every twelve hours, so everything Slack depends on a credential that
 * turns over twice a day — which is why `docs/implementation-plan.md`
 * front-loads this into Phase 2 rather than discovering it in Phase 7.
 *
 * Confirmed 2026-09-03: the access token issued the previous day returned
 * `token_expired`. That is the normal state of affairs, not a fault, and it is
 * exactly why rotation cannot be a manual step.
 *
 * The refresh token is **single-use**. A rotation that succeeds and then fails
 * to persist loses access entirely and needs a human to regenerate the pair, so
 * the order of operations below is the whole design:
 *
 *   1. persist the CURRENT pair, so there is a durable copy to fall back on
 *   2. rotate
 *   3. persist the NEW pair immediately, before doing anything else with it
 *   4. only then verify
 *
 * Verifying before persisting would be the natural order and is wrong: a
 * verification failure after a successful rotation would leave the new pair
 * only in memory.
 */

export interface TokenPair {
  readonly accessToken: string
  readonly refreshToken: string
  /** Unix seconds. Slack returns `exp` on the rotated token. */
  readonly expiresAt: number
}

export class RotationError extends Error {
  constructor(
    message: string,
    readonly slackError: string | undefined,
    /** True when only a human can recover — the refresh token itself is dead. */
    readonly needsHuman: boolean,
  ) {
    super(message)
    this.name = 'RotationError'
  }
}

/**
 * Slack errors that mean the refresh token is unusable and no retry will help.
 *
 * Distinguishing these from transient failures matters: a transient failure
 * should be retried, while these need `HUMAN_ONLY_PREREQUISITES.md` updated and
 * Grant told. Retrying a dead refresh token forever, silently, is the failure
 * mode this list prevents.
 */
const UNRECOVERABLE = new Set([
  'invalid_refresh_token',
  'token_revoked',
  'token_expired',
  'invalid_auth',
  'account_inactive',
])

export interface RotateResponse {
  ok: boolean
  error?: string
  token?: string
  refresh_token?: string
  exp?: number
  team_id?: string
  user_id?: string
}

/**
 * Exchange a refresh token for a new pair.
 *
 * `tooling.tokens.rotate` is unauthenticated in the header sense — the refresh
 * token IS the credential and travels as a form parameter, so it must never be
 * placed in a URL query string where it would reach access logs.
 */
export async function rotateTokens(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenPair> {
  const response = await fetchImpl('https://slack.com/api/tooling.tokens.rotate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken }).toString(),
  })

  const payload = (await response.json()) as RotateResponse

  if (!payload.ok) {
    const slackError = payload.error
    throw new RotationError(
      `Slack refused the rotation: ${slackError ?? 'unknown error'}`,
      slackError,
      slackError !== undefined && UNRECOVERABLE.has(slackError),
    )
  }

  if (
    typeof payload.token !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    // A response that says ok but omits a field would otherwise persist
    // `undefined` over a working credential.
    throw new RotationError(
      'Slack reported ok but omitted token, refresh_token or exp',
      undefined,
      false,
    )
  }

  return {
    accessToken: payload.token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.exp,
  }
}

/**
 * Should this pair be rotated now?
 *
 * Rotating early is nearly free; rotating late costs an outage. The margin is
 * generous for that reason: a scheduler that runs hourly can miss a run or two
 * and still rotate in time.
 */
export function shouldRotate(
  expiresAt: number,
  now: number = Math.floor(Date.now() / 1000),
  marginSeconds = 3600,
): boolean {
  return expiresAt - now <= marginSeconds
}

/** Seconds until expiry. Negative means already expired. */
export function secondsUntilExpiry(
  expiresAt: number,
  now: number = Math.floor(Date.now() / 1000),
): number {
  return expiresAt - now
}
