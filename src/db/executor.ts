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
    this.endpoint = `${baseUrl}/v1/projects/${projectRef}/database/query`
  }

  async execute(sql: string): Promise<SqlResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    })

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
