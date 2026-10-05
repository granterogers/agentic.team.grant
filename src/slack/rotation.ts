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

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * One rotation, end to end, against a database.
 *
 * ## Why this is a module and not just the script
 *
 * The sequence used to live only in `scripts/slack/rotate.ts`, which meant its
 * most important property could not be tested: **a failed rotation must not
 * destroy the credential it still holds.** That is §18's *invalid refresh
 * token* case, and it is the one path in this codebase that can lock us out of
 * Slack entirely — the config token is how the app is administered, and a
 * rotation that overwrote a working pair with nothing would need a human at
 * api.slack.com to recover.
 *
 * `rotateTokens` was well covered; the sequence around it was not covered at
 * all, and the sequence is where the danger is.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Persist the current refresh token first.** It is single-use: the moment
 *    Slack accepts it, it is gone. A crash between "sent" and "stored the
 *    reply" would otherwise leave nothing on either side.
 * 2. **Rotate.**
 * 3. **On failure, write only the failure.** No credential is touched, so the
 *    existing access token keeps working until it expires — which buys hours,
 *    and hours are the difference between a retry and a human.
 * 4. **On success, persist the new pair before anything else** — before the
 *    row update, before verification. A verification that fails must not lose
 *    a pair Slack has already issued and already invalidated the old one for.
 */
export interface RotationDeps {
  /**
   * SQL for the office whose installation is being rotated: the claimed job's (app.job_office of it), or the
   * operator's for the script. The credential row is addressed by app id AND office, never by app id alone.
   */
  readonly office: string
  readonly execute: (sql: string) => Promise<{ readonly rows: readonly Record<string, unknown>[] }>
  readonly fetchImpl?: typeof fetch
}

export type RotationOutcome =
  | { readonly kind: 'rotated'; readonly expiresAt: number }
  | { readonly kind: 'failed'; readonly error: string; readonly needsHuman: boolean }

const sqlLit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export async function rotateAndPersist(
  deps: RotationDeps,
  appId: string,
  refreshToken: string,
): Promise<RotationOutcome> {
  const store = async (name: string, value: string, description: string): Promise<void> => {
    await deps.execute(
      `select app.store_secret(${sqlLit(name)}, ${sqlLit(value)}, ${sqlLit(description)})`,
    )
  }

  // 1. Durable copy before consuming a single-use credential. Costs nothing.
  await store(
    'slack.config_refresh_token',
    refreshToken,
    'Slack config refresh token (pre-rotation copy)',
  )

  let pair: TokenPair
  try {
    pair = await rotateTokens(refreshToken, deps.fetchImpl ?? fetch)
  } catch (error) {
    const rotation = error as RotationError
    // 3. Only the failure is written. `slack.config_token` is deliberately
    // untouched: the access token in the vault still works until it expires.
    await deps.execute(`
      update public.slack_app_credentials
      set rotation_failures = rotation_failures + 1,
          last_rotation_error = ${sqlLit(rotation.message.slice(0, 400))}
      where office_id = ${deps.office} and slack_app_id = ${sqlLit(appId)}
    `)
    return { kind: 'failed', error: rotation.message, needsHuman: rotation.needsHuman === true }
  }

  /*
    4. The new pair, immediately, AS ONE STATEMENT.

    Two statements left a window in which the new ACCESS token was stored and the new REFRESH token was not: the
    refresh token still in the vault was the one Slack had just consumed, so the next rotation failed with
    invalid_refresh_token and only a person at api.slack.com could repair it (final audit, review L2). One statement
    is one transaction: both are written or neither is. What remains is the window between Slack accepting the
    rotation and this statement landing - Slack has consumed the old token and the reply exists only in memory. That
    is the provider's single-use design and is not closable from here; `needsHuman` says so when it happens.
  */
  await deps.execute(
    `select app.store_secret(${sqlLit('slack.config_token')}, ${sqlLit(pair.accessToken)}, ${sqlLit('Slack config access token (rotates ~12h)')}),
            app.store_secret(${sqlLit('slack.config_refresh_token')}, ${sqlLit(pair.refreshToken)}, ${sqlLit('Slack config refresh token')})`,
  )

  /*
    AND WHEN THE NEW PAIR EXPIRES, which nothing recorded (final policy closure).

    The handler decides whether a rotation is due from `config_token_expires_at`, and this function never moved it, so
    after the first successful rotation the row kept saying the pair had expired and the duty believed a rotation was
    due on every tick - burning a single-use refresh token six times a day, and, now that every rotation asks, asking
    six times a day. Written AFTER the pair is safely stored and as its own statement: a failure here costs one spurious
    question, never the credential. Production's row still reads 10 September for this reason.
  */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wrote = await deps
      .execute(
        `update public.slack_app_credentials
          set config_token_expires_at = to_timestamp(${String(Math.floor(pair.expiresAt))}),
              config_token_rotated_at = app.now_utc(), rotation_failures = 0, last_rotation_error = null
        where office_id = ${deps.office} and slack_app_id = ${sqlLit(appId)}`,
      )
      .then(() => true)
      .catch(() => false)
    if (wrote) break
  }

  return { kind: 'rotated', expiresAt: pair.expiresAt }
}
