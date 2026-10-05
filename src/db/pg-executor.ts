/**
 * SqlExecutor over the Postgres wire protocol.
 *
 * The other half of ADR-0007. Unusable from a Claude Code session — all
 * non-443 TCP egress is blocked there — but the only option where `pg_dump`
 * lives, which is GitHub Actions. Same interface, so migrations and
 * verification scripts run unchanged in either place.
 */
import pg from 'pg'
import { assertProductionChecksAllowed, isRemotePgTarget } from '../safety/production-gate.ts'
import type { SqlExecutor, SqlResult } from './executor.ts'
import { SqlExecutionError } from './executor.ts'

export class PgExecutor implements SqlExecutor {
  readonly kind = 'postgres-wire'
  private readonly client: pg.Client

  /**
   * @param connectionString Omit to use the standard PG* environment variables
   *   (PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD), which node-postgres
   *   reads natively. Preferred where possible: it keeps password-bearing
   *   connection strings out of code, config and logs entirely.
   */
  constructor(connectionString?: string) {
    // A Unix socket or localhost is never production; any other Postgres host is, and needs the flag (docs/production-access-guard.md).
    if (isRemotePgTarget(connectionString))
      assertProductionChecksAllowed('a remote Postgres connection')
    this.client =
      connectionString === undefined ? new pg.Client() : new pg.Client({ connectionString })
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async end(): Promise<void> {
    await this.client.end()
  }

  async execute(sql: string): Promise<SqlResult> {
    try {
      // `query` with a multi-statement string uses the simple query protocol,
      // which Postgres wraps in an implicit transaction — matching the
      // Management API's all-or-nothing contract, so a migration behaves
      // identically over either transport.
      const result = await this.client.query(sql)
      const rows = Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows
      return { rows: rows as Record<string, unknown>[] }
    } catch (error) {
      const err = error as { message?: string; code?: string }
      // Prefix the SQLSTATE so error assertions are identical across
      // transports: the Management API embeds it in the message, node-postgres
      // exposes it as `code`.
      const code = err.code === undefined ? '' : `${err.code}: `
      throw new SqlExecutionError(`${code}${err.message ?? String(error)}`, null)
    }
  }
}
