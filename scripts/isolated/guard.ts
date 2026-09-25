/**
 * The connection every isolated proof uses, and the refusal that keeps it
 * isolated (behavioural remediation completion pass, 25 September 2026).
 *
 * The first remediation session proved failure paths against the canonical
 * database and stopped the production worker for 87 minutes (ledger R48).
 * These proofs break things on purpose, so they run against a LOCAL replica
 * built from the repository's own migrations (`scripts/isolated/replica.sh`)
 * and refuse to start anywhere else: the connection must be a Unix socket (no
 * TCP peer at all) and the database must carry the replica's marker table.
 */
import { PgExecutor } from '../../src/db/pg-executor.ts'

export async function isolated(database: string): Promise<PgExecutor> {
  const socket = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
  const port = process.env.ISOLATED_PG_PORT ?? '55432'
  const db = new PgExecutor(`postgresql://postgres@/${database}?host=${socket}&port=${port}`)
  await db.connect()
  const { rows } = await db.execute(`
    select inet_server_addr() is null as local_socket,
           to_regclass('public.isolated_replica_marker') is not null as marked`)
  const r = rows[0] as { local_socket?: boolean; marked?: boolean } | undefined
  if (r?.local_socket !== true || r?.marked !== true) {
    await db.end()
    throw new Error(
      `REFUSED: ${database} is not a marked local replica; isolated proofs never run elsewhere`,
    )
  }
  return db
}
