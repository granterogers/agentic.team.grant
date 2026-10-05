/**
 * SQL transport.
 *
 * Two implementations exist because this project has two environments with
 * incompatible network policies (ADR-0007):
 *
 * - `ManagementApiExecutor` — HTTPS, for Claude Code build sessions, which
 *   cannot open a Postgres connection at all: non-443 TCP is blocked and the
 *   direct host is IPv6-only.
 * - a `pg`-based executor — for GitHub Actions and anywhere else with ordinary
 *   egress. Added when the backup workflow needs it.
 *
 * Everything above this interface is transport-agnostic, so the same migration
 * files apply identically either way. That is the whole point: the migrations
 * are the artifact, the transport is a detail.
 */

import '../safety/arm.ts'
import { assertProductionChecksAllowed, isProductionUrl } from '../safety/production-gate.ts'
import { admitProductionRequest } from '../safety/request-budget.ts'
import { assertMayTouchProduction } from './suite-guard.ts'

export interface SqlResult {
  readonly rows: readonly Record<string, unknown>[]
}

export interface SqlExecutor {
  /** Human-readable name, for logs and error messages. */
  readonly kind: string
  /**
   * Execute one SQL string.
   *
   * **Atomicity contract:** the whole string is applied as a single
   * all-or-nothing unit. Verified against the Supabase Management API on
   * 2026-09-03 — a `CREATE TABLE` followed by a failing statement in one
   * request left no table behind. A migration file may therefore contain many
   * statements without wrapping them in explicit BEGIN/COMMIT, and a partial
   * migration is not a state this system has to handle.
   */
  execute(sql: string): Promise<SqlResult>
}

export class SqlExecutionError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'SqlExecutionError'
  }
}

/** Executes SQL over the Supabase Management API. HTTPS only — no TCP required. */
export class ManagementApiExecutor implements SqlExecutor {
  readonly kind = 'supabase-management-api'
  private readonly endpoint: string

  constructor(
    projectRef: string,
    private readonly accessToken: string,
    baseUrl = 'https://api.supabase.com',
  ) {
    if (accessToken === '') throw new Error('a Supabase access token is required')
    // An EMPTY ref is refused here rather than sent.
    //
    // Every caller writes `process.env.SUPABASE_PROJECT_REF ?? '<the ref>'`,
    // and `??` does not fire on an empty string. A GitHub Actions workflow that
    // passes `${{ secrets.SUPABASE_PROJECT_REF }}` for a secret that was never
    // set passes exactly that — so the default was overridden by nothing, the
    // URL became `/v1/projects//database/query`, and every scheduled run died
    // with a 404 that named no cause. Thirty consecutive nightly syncs failed
    // that way, and the first worker run after it was scheduled.
    //
    // Refused at construction, with the reason, because the alternative is 82
    // call sites each remembering to write `|| '<the ref>'` instead.
    if (projectRef.trim() === '') {
      throw new Error(
        'SUPABASE_PROJECT_REF is set but empty — an unset GitHub secret looks exactly like this. ' +
          'Unset it to use the default, or give it the project ref.',
      )
    }
    this.endpoint = `${baseUrl}/v1/projects/${projectRef}/database/query`
    // Fail closed at construction: holding a token is not permission to use it (docs/production-access-guard.md).
    // Only the production hosts are gated, so a test pointing `baseUrl` at a local fake is untouched.
    this.assertAllowed()
  }

  private assertAllowed(): void {
    if (isProductionUrl(this.endpoint))
      assertProductionChecksAllowed('the Supabase Management API (SQL)', undefined, this.endpoint)
  }

  /*
    A throttle is not an answer (#252).

    The Management API rate-limits, and CLAUDE.md already records what that
    costs: six concurrent lookups earned a `ThrottlerException`, and a throttle
    falling through as "nobody knows about this" turned a correct routing
    decision into a miss and moved a headline accuracy figure for reasons that
    have nothing to do with the office. An infra failure must never enter a
    measurement as data.

    Five attempts, doubling from two seconds — about half a minute in total,
    which is what the Management API's window actually needed; four attempts
    from one second gave up after seven and the throttle was still on.

    ## Why this asks a property rather than consulting a list

    It used to be `new Set([429, 503])`, and on 21 September the gateway
    returned **502 with an HTML body** twice in one run of `verify:failures`,
    at two different call sites. A 502 is not an answer from Postgres — it is
    Cloudflare saying it could not reach one — and it was raised immediately
    as though it were, which is the thing the paragraph above exists to
    forbid.

    A list of the statuses that mean "ask again later" is an enumeration of
    things the infrastructure will add to, and CLAUDE.md already records what
    those cost: a whitelist "fails by refusing to speak, which is the
    expensive direction", and the correction each time has been to state the
    property instead. The property here is exact, because the two layers use
    disjoint status ranges:

      * **Postgres answers through this API as a 400** carrying
        `{"message": "Failed to run sql query: ERROR: 42601: ..."}`. A syntax
        error, a constraint violation, a permission refusal — every one of
        them is a 400, and every one of them is an ANSWER.
      * **Anything 5xx is the transport**, not the database. The gateway, the
        pooler, the API process. Retrying it is the only correct response.

    So: 429, plus any 5xx. A 401 and a 404 are still answers and still raise
    at once, because retrying a bad token four times is four times the wait
    for the same message.

    The cost of being wrong in each direction is what settles it. A 5xx that
    really did carry a database answer costs thirty seconds and then the same
    message. A 5xx treated as data costs a measurement that is wrong for
    reasons that have nothing to do with the office — and **the production
    worker uses this executor** whenever the direct Postgres connection is
    unavailable, so there it costs a burnt job attempt, five of which is a
    permanently failed job.

    Here rather than in each caller: 219 files construct one, and the ones
    that measure something are exactly the ones where forgetting is invisible.
  */
  private static retryable(status: number): boolean {
    return status === 429 || status >= 500
  }

  async execute(sql: string): Promise<SqlResult> {
    this.assertAllowed()
    assertMayTouchProduction()
    let response!: Response
    for (let attempt = 0; ; attempt += 1) {
      // The fetch guard counts this request against the production budget. If something replaced `fetch` after the guard
      // was installed, the request would go uncounted, so count it here: one per attempt, retries included.
      if (
        (globalThis.fetch as { productionGuarded?: true }).productionGuarded !== true &&
        isProductionUrl(this.endpoint)
      )
        await admitProductionRequest(`POST ${this.endpoint.replace(/\?.*$/, '')}`)
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      })
      if (!ManagementApiExecutor.retryable(response.status) || attempt >= 4) break
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
    }

    const text = await response.text()

    if (!response.ok) {
      // The API returns {"message": "Failed to run sql query: ERROR: 42501: ..."}.
      // Surface the Postgres error rather than the HTTP status, which is always
      // a bare 400 and says nothing.
      let detail = text
      try {
        const parsed: unknown = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object' && 'message' in parsed) {
          detail = String((parsed as { message: unknown }).message)
        }
      } catch {
        // Not JSON; the raw body is the best detail available.
      }
      throw new SqlExecutionError(detail, response.status)
    }

    const parsed: unknown = text === '' ? [] : JSON.parse(text)
    if (!Array.isArray(parsed)) {
      throw new SqlExecutionError(
        `expected a JSON array of rows, got ${typeof parsed}`,
        response.status,
      )
    }
    return { rows: parsed as Record<string, unknown>[] }
  }
}
