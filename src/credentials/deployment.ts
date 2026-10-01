/**
 * The worker's door to the deployment's fixed-name credentials (multi-user P1.2, #400, migration 0648).
 *
 * A vault name like `google.refresh_token` is ONE credential for the whole deployment. Reading it used to be a
 * SELECT against `vault.decrypted_secrets` in about a dozen files, none of which asked whose work was being
 * done. Now there is one reader, `app.deployment_credential`, and one way to reach it from the worker:
 *
 *   - while a handler runs, the worker records WHICH JOB it is running (`withJobScope`, applied at the one place
 *     handlers are invoked). A credential read during that work is read AS that job, and the database refuses
 *     unless the job is the deployment's own duty or a trusted turn from an operator;
 *   - a read with NO job in scope is the worker acting for the deployment itself (a tick, a probe, a duty's
 *     setup), the `system` caller. That is not reachable from a request: the function is in `app`, which
 *     PostgREST does not expose.
 *
 * The scope is ambient (AsyncLocalStorage) rather than a parameter because most handlers are built once around
 * a database handle and ignore the one `handle()` is given; a scope on the handle would never reach them. It is
 * per async call chain, so two jobs running at once cannot read each other's identity.
 *
 * `npm run check:system-secrets` fails when a human-integration vault name is read any other way.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const scope = new AsyncLocalStorage<string>()

/** Run `work` as `jobId`: every credential it reads is read on that job's authority. */
export const withJobScope = <T>(jobId: string, work: () => Promise<T>): Promise<T> => {
  if (!UUID.test(jobId)) throw new Error('a job scope needs a job id')
  return scope.run(jobId, work)
}

/** The job whose work is running, or null when this is the deployment acting for itself. */
export const currentJob = (): string | null => {
  const job = scope.getStore()
  return job !== undefined && UUID.test(job) ? job : null
}

/**
 * A SQL expression that evaluates to the credential, for splicing into an existing query.
 *
 * The credential is read ON BEHALF OF an office (migration 0800). Inside a job that is the CLAIMED job's office, so a
 * Google token is the one that office holds and a deployment-level secret is refused to an office that does not see
 * the deployment. With no job the worker is acting for the deployment itself, as the system office, which reads the
 * deployment's own Google. Never an id taken from a request, a payload or a model answer.
 */
export const credentialSql = (name: string): string => {
  const job = currentJob()
  const DEPLOYMENT_OFFICE = 'app.deployment_reader_office()'
  return job === null
    ? `app.deployment_credential(${DEPLOYMENT_OFFICE}, ${lit(name)}, null, null, true)`
    : `app.deployment_credential(app.job_office(${lit(job)}::uuid), ${lit(name)}, null, ${lit(job)}::uuid, false)`
}

/** One credential, or null when the vault holds none. A refusal throws: it is not an absence. */
export const readCredential = async (db: SqlExecutor, name: string): Promise<string | null> => {
  const { rows } = await db.execute(`select ${credentialSql(name)} as v`)
  const v = (rows[0] as { v?: unknown } | undefined)?.v
  return v === undefined || v === null || String(v) === '' ? null : String(v)
}
