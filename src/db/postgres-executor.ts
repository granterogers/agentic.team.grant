/**
 * A `pg`-backed SqlExecutor — the second transport `executor.ts` has always
 * described and nothing ever built.
 *
 * ## Why it exists now
 *
 * The fresh-install run has to answer one question: does the migration corpus
 * apply to a database with no application schema and no data? That cannot be
 * answered against Grant's project, which has every migration already applied,
 * and it must never be answered by pointing anything at Grant's project anyway.
 * It needs a blank database — and a blank database needs a transport that is
 * not the Supabase Management API, because a disposable local Postgres has no
 * Management API in front of it.
 *
 * `executor.ts`'s own header names this implementation and says it will be
 * "added when the backup workflow needs it". The fresh-install harness needed
 * it first.
 *
 * ## Atomicity — the contract this has to honour
 *
 * `SqlExecutor.execute` promises the whole string is applied all-or-nothing.
 * 343 of the 533 migrations open with `begin;` and close with `commit;` of
 * their own, so wrapping every call in an outer BEGIN would nest — and in
 * Postgres a nested BEGIN is a warning, not a transaction, so the file's own
 * COMMIT would end the wrapper and the remainder would run unprotected. That is
 * exactly the "partial migration" state the interface says is not a state this
 * system has to handle.
 *
 * So the string is sent as ONE simple query. Postgres runs a multi-statement
 * simple query inside an implicit transaction, and a file carrying its own
 * BEGIN/COMMIT controls its own boundaries. Both shapes get the contract they
 * were written against, and neither needs the caller to know which it is.
 *
 * ## One session per call, like an HTTP request
 *
 * Each `execute` opens its own connection and closes it. That is not an
 * oversight about connection reuse — it is the behaviour being matched.
 * `ManagementApiExecutor` sends one HTTPS request per migration and each
 * request gets a fresh backend, so anything session-scoped dies between
 * migrations.
 *
 * Holding one session instead makes the harness DISAGREE with the transport it
 * stands in for, and it disagrees silently until it does not: 0128 and 0137
 * both `create temporary table _dq_probe`, a temp table lives for the session,
 * and over a reused connection 0137 died with `42P07: relation "_dq_probe"
 * already exists` — a failure that says "the product is broken" about a product
 * that is fine, 84 migrations after the one that actually planted it.
 *
 * CLAUDE.md's rule is the general form: a verification pointed at something
 * other than what the user reaches passes, or fails, for the wrong reason.
 *
 * ## What it refuses
 *
 * A connection string naming anything but a local host, unless the caller says
 * in as many words that it means it. The whole point of this transport is to
 * reach a throwaway database; a typo that reached a real one would be the
 * single worst outcome available to this workstream.
 */
import { Client } from 'pg'
import { type SqlExecutor, type SqlResult, SqlExecutionError } from './executor.ts'

/** Hosts a disposable harness database may live on. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '', '0.0.0.0'])

export function isLocalConnectionString(url: string): boolean {
  // A bare socket path or a libpq keyword string with no host is local.
  if (!url.includes('://')) return true
  try {
    const host = new URL(url).hostname
    return LOCAL_HOSTS.has(host)
  } catch {
    return false
  }
}

export interface PostgresExecutorOptions {
  /**
   * Permit a non-local host. Off by default and named this bluntly so that
   * switching it on is a decision somebody made in writing, not a default that
   * was never noticed. Nothing in the fresh-install harness sets it.
   */
  readonly allowRemoteHost?: boolean
}

export class PostgresExecutor implements SqlExecutor {
  readonly kind = 'postgres'

  constructor(
    private readonly connectionString: string,
    options: PostgresExecutorOptions = {},
  ) {
    if (connectionString.trim() === '') {
      throw new Error('a Postgres connection string is required')
    }
    if (!options.allowRemoteHost && !isLocalConnectionString(connectionString)) {
      // Never name the connection string in the message: it carries a password.
      throw new Error(
        'PostgresExecutor refuses a non-local host. This transport exists for a ' +
          'disposable harness database. If you genuinely mean to reach a remote ' +
          'database, pass allowRemoteHost — and read scripts/fresh/sql/supabase-shim.sql ' +
          'first, because a shimmed database stores vault secrets in plaintext.',
      )
    }
  }

  async execute(sql: string): Promise<SqlResult> {
    const client = new Client({ connectionString: this.connectionString })
    await client.connect()
    try {
      // One simple query. See the header for why this is not wrapped.
      const result = await client.query(sql)
      // A multi-statement query returns an array, one entry per statement. The
      // Management API returns the rows of the LAST statement that produced
      // any, which is what every caller of this interface is written against.
      const results = Array.isArray(result) ? result : [result]
      for (let i = results.length - 1; i >= 0; i -= 1) {
        const rows = results[i]?.rows
        if (Array.isArray(rows) && rows.length > 0) {
          return { rows: rows as Record<string, unknown>[] }
        }
      }
      const last = results[results.length - 1]
      return { rows: (last?.rows ?? []) as Record<string, unknown>[] }
    } catch (error) {
      /*
        Roll back before the connection is discarded.

        This looks redundant now that every call owns its connection, and it is
        not: `client.end()` on a session sitting inside an open transaction
        leaves the server to notice the disconnect and abort it, and until it
        does the locks that transaction holds are still held. Rolling back first
        makes the release immediate and deterministic, which matters when 533
        migrations run back to back.

        The original reason is worth keeping written down. When this executor
        reused one session, a failed `begin;` migration left it aborted, every
        later statement returned 25P02, and the harness reported that from
        `ledgerExists` -- naming neither the migration that broke nor why.

        343 of the 533 migrations open with their own `begin;`. When one of
        those fails partway, Postgres does not end the transaction — it puts the
        session in the aborted state, where every subsequent statement returns
        25P02 "current transaction is aborted" and nothing else can be learned
        from this connection ever again.

        The Management API cannot have this problem, because each request is its
        own session. Over the wire protocol the session outlives the call, so
        the executor has to clean up after a failure or the FIRST failure
        becomes the only failure anybody can see — the zero-state harness
        reported 25P02 from `ledgerExists` and named neither the migration that
        broke nor the reason, which is a failure message pointing somewhere, and
        somewhere wrong.

        Swallowed deliberately: the rollback failing tells us nothing the
        original error has not already said, and the original error is the one
        worth raising.
      */
      try {
        await client.query('rollback')
      } catch {
        // The session may not have been in a transaction at all.
      }
      // Surface the Postgres error the way ManagementApiExecutor does: the
      // message, with the SQLSTATE where there is one, and never the SQL —
      // a migration body can be thousands of characters and the code is the
      // part that names the cause.
      const message = error instanceof Error ? error.message : String(error)
      const code =
        error !== null && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : null
      throw new SqlExecutionError(code === null ? message : `${code}: ${message}`, null)
    } finally {
      await client.end().catch(() => undefined)
    }
  }

  /**
   * Nothing to close — each call owns its connection. Kept so callers written
   * against a pooled executor need no special case.
   */
  async close(): Promise<void> {
    return
  }
}
