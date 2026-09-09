/**
 * A `SqlExecutor` that talks to the database directly, for the edge worker.
 *
 * ## Why this exists
 *
 * Every query in this system goes over the Supabase **Management API**, and
 * that was the right decision: ADR-0007 measured it and found no Postgres
 * connection string of any kind can work from a Claude Code cloud session,
 * because non-443 TCP egress is blocked there.
 *
 * The edge worker is not a Claude Code session. It runs on Supabase's own
 * network, beside the database, and it is handed `SUPABASE_DB_URL` for exactly
 * this. Sending its queries out to a public HTTPS API and back has been
 * costing about **1.5 seconds each**, and a pass with nothing whatsoever to do
 * makes roughly ten of them:
 *
 *     empty pass, Management API:  17–22 seconds
 *
 * That is the whole of Grant's latency problem. His message is answered in
 * twenty-five seconds on Telegram and sixty-five on Slack, against a budget of
 * sixty, and the model call inside it takes three.
 *
 * ADR-0007 is not being overturned. It is about the sandbox, it says so, and
 * the sandbox still cannot do this. This is the one runtime that can.
 *
 * ## Why it falls back rather than replacing anything
 *
 * `ManagementApiExecutor` stays the default everywhere, including here if this
 * cannot connect. A worker that answers slowly is a worker; a worker that
 * cannot reach the database is an outage, and no latency improvement is worth
 * turning the second into a possibility.
 *
 * ## Why the connection is kept
 *
 * An edge instance serves many requests. Reconnecting per request would give
 * back most of what this saves, and postgres.js pools properly. The pool is
 * deliberately small: an instance runs one pass at a time (see `running` in
 * `index.ts`), and a large pool against the shared pooler is a way to exhaust
 * connections for everything else in the project.
 */

import postgres from 'npm:postgres@3.4.5'
import type { SqlExecutor, SqlResult } from '../../../src/db/executor.ts'
import { SqlExecutionError } from '../../../src/db/executor.ts'

type Sql = ReturnType<typeof postgres>

export class PostgresExecutor implements SqlExecutor {
  readonly kind = 'postgres'

  private constructor(private readonly sql: Sql) {}

  /**
   * Connect, or return null.
   *
   * Null rather than throwing, so the caller installs the Management API
   * executor and carries on. Proves the connection with a real query before
   * claiming it works — `postgres()` is lazy and would otherwise "succeed"
   * here and fail on the first query of the first pass.
   */
  static async connect(url: string): Promise<PostgresExecutor | null> {
    if (url === '') return null
    try {
      const sql = postgres(url, {
        max: 2,
        idle_timeout: 30,
        connect_timeout: 10,
        // The pooler speaks the wire protocol but not every session feature;
        // prepared statements across a transaction pooler are the classic way
        // to get "prepared statement already exists" under load.
        prepare: false,
        // Nothing this system runs needs a notice channel, and an unhandled
        // one is noise in the function log.
        onnotice: () => {},
      })
      await sql`select 1`
      return new PostgresExecutor(sql)
    } catch {
      return null
    }
  }

  async execute(sql: string): Promise<SqlResult> {
    try {
      // `unsafe`, because every caller in this codebase composes SQL as text
      // and quotes its own literals — the Management API takes a string too,
      // and this has to be a drop-in for it or it is not a fallback, it is a
      // rewrite. The atomicity contract in `SqlExecutor` holds: postgres.js
      // sends a multi-statement string as one simple query, which Postgres
      // wraps in an implicit transaction.
      const rows = await this.sql.unsafe(sql)
      return { rows: rows as unknown as Record<string, unknown>[] }
    } catch (error) {
      // The same shape the Management API executor raises, so every existing
      // catch keeps working. No status: there is no HTTP here.
      throw new SqlExecutionError(`Failed to run sql query: ${(error as Error).message}`, null)
    }
  }
}
