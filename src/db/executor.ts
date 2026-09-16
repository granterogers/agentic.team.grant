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
    from one second gave up after seven and the throttle was still on. Only on
    the two statuses that
    mean "ask again later". Everything else — a 400 carrying a Postgres error,
    a 401, a 404 — is an answer and is raised immediately, because retrying a
    syntax error four times is four times the wait for the same message.

    Here rather than in each caller: 82 call sites cannot each remember it, and
    the ones that measure something are exactly the ones where forgetting is
    invisible.
  */
  private static readonly RETRY_ON = new Set([429, 503])

  async execute(sql: string): Promise<SqlResult> {
    let response!: Response
    for (let attempt = 0; ; attempt += 1) {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      })
      if (!ManagementApiExecutor.RETRY_ON.has(response.status) || attempt >= 4) break
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
