/**
 * Where a catalogue check reads the database from: production (as it always did) or, with `--replica`, the local replica.
 *
 * check:callers, check:consumed, check:gateway-wrappers, check:anon-exposure, check:machine-key and check:carrier-writers ask the catalogue what
 * exists (functions, tables, grants, defaults). They were production-only because production was the one place that catalogue could be read.
 * The replica (scripts/isolated/replica.sh) is built from this repository's migrations, so for the objects THIS branch creates it is the same
 * catalogue; for objects another branch applied to the shared production database it is not, and a replica run says nothing about those.
 *
 * Nothing here weakens the production path. Without `--replica` the calling script's own first import (require-production-unless-replica)
 * refuses unless ALLOW_PRODUCTION_CHECKS=1, exactly as require-production-checks does. With `--replica` this module connects ONLY to a Unix socket
 * and refuses a database that does not carry the replica's marker table, and it never constructs the Management API executor.
 */
import '../../src/safety/require-production-unless-replica.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'

export const replicaMode: boolean = process.argv.includes('--replica')

export const REPLICA_NOTE =
  "REPLICA RUN: the catalogue was read from the local replica built from this repository's migrations, not from production. It does not establish production verification."

export async function openCatalogue(
  ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token = process.env.SUPABASE_ACCESS_TOKEN ?? '',
): Promise<SqlExecutor> {
  if (!replicaMode) return new ManagementApiExecutor(ref, token)
  const socket = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
  const port = process.env.ISOLATED_PG_PORT ?? '55432'
  const database = process.env.ISOLATED_PG_DB ?? 'post'
  const db = new PgExecutor(`postgresql://postgres@/${database}?host=${socket}&port=${port}`)
  await db.connect()
  const { rows } = await db.execute(
    `select inet_server_addr() is null as local_socket, to_regclass('public.isolated_replica_marker') is not null as marked`,
  )
  const r = rows[0] as { local_socket?: boolean; marked?: boolean } | undefined
  if (r?.local_socket !== true || r?.marked !== true) {
    await db.end()
    throw new Error(`REFUSED: ${database} is not a marked local replica`)
  }
  console.log(REPLICA_NOTE)
  // These checks never close their executor (the Management API one holds no connection). A pg client's open socket would keep the process alive
  // after the verdict, so the socket is held only while a query is in flight.
  const stream = (
    db as unknown as { client?: { connection?: { stream?: { ref(): void; unref(): void } } } }
  ).client?.connection?.stream
  stream?.unref()
  return {
    kind: db.kind,
    execute: async (sql: string) => {
      stream?.ref()
      try {
        return await db.execute(sql)
      } finally {
        stream?.unref()
      }
    },
  } as SqlExecutor
}

/** The token is only demanded where a token is used. */
export const needsToken = (): boolean => !replicaMode
