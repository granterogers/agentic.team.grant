/**
 * The `worker` deploy, as a function whose every outside effect is passed in.
 *
 * `scripts/deploy/worker.ts` is the command; this is what it does, split out so the ORDER of the steps can be
 * tested without production. The order is the point:
 *
 *   1. resolve the import graph and validate the bundle        (local, nothing is written)
 *   2. read / create the kick secret, set the function secrets (production writes)
 *   3. deploy the function
 *   4. probe it, then state `slack.per_office_delivery`
 *
 * Step 1 comes first because a bundle the platform will refuse is known locally, and step 2 resets the function's
 * secrets, which makes the platform advance every function's version number. On 6 October 2026 the graph walk
 * missed a bare side-effect import, step 2 ran, and step 3 was refused: production had been changed by a deploy that
 * could not succeed. Anything that can be known before the first write is now known before it.
 *
 * What cannot be known locally (the platform's own resolution of remote and `npm:` specifiers, its size limits, whether
 * it accepts the request) is still only learned at step 3.
 */
import { prepareBundle } from './bundle.ts'

/** A deploy that stopped, with the sentence to show. Thrown instead of exiting, so a test can see it. */
export class DeployFailure extends Error {}

export type WorkerDeployDeps = {
  entry: string
  slug: string
  ref: string
  token: string
  /** Management API base for the project, and the function host. Passed in by the command, which holds the gate. */
  api: string
  functionsBase: string
  db: { execute: (sql: string) => Promise<{ rows: readonly Record<string, unknown>[] }> }
  fetchFn: typeof fetch
  log: (line: string) => void
  error: (line: string) => void
}

export const deployWorker = async (d: WorkerDeployDeps): Promise<void> => {
  const { entry, slug, ref, token, api, functionsBase, db, fetchFn, log, error } = d

  // --- 1. everything that can be known without production ----------------------
  const prepared = await prepareBundle(slug, entry)
  log(`bundling ${String(prepared.files.size)} file(s) from the import graph (closure verified)`)
  const form = prepared.form

  // --- 2. secrets ---------------------------------------------------------------
  //
  // The function needs a Management API token to reach the database over the
  // same transport everything else uses (ADR-0007), and a kick secret so an
  // anonymous caller cannot make the office work on demand.
  //
  // The kick secret is generated here if it does not exist and stored in the
  // vault (§15). It is NEVER printed: this script says whether one is configured
  // and nothing more.
  const existing = (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'worker.kick_secret'`,
    )
  ).rows[0]
  let kick = existing?.v === undefined ? '' : String(existing.v)
  if (kick === '') {
    kick = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
    await db.execute(
      `select vault.create_secret(${`'${kick.replace(/'/g, "''")}'`}, 'worker.kick_secret',
       'Shared secret the telegram webhook and pg_cron present to kick a worker pass.')`,
    )
    log('kick secret: generated and stored in the vault')
  } else {
    log('kick secret: already in the vault')
  }

  const setSecret = await fetchFn(`${api}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      // NOT prefixed `SUPABASE_`: that prefix is reserved and the API rejects
      // the entire batch with a 400, silently leaving the function unconfigured.
      { name: 'HQ_MANAGEMENT_TOKEN', value: token },
      { name: 'HQ_PROJECT_REF', value: ref },
      { name: 'WORKER_KICK_SECRET', value: kick },
    ]),
  })
  log(`function secrets set: http ${String(setSecret.status)}`)
  if (!setSecret.ok) {
    // Refused rather than carried on. A 400 here deploys a function that reports
    // healthy and answers 401 to every kick, which is the most expensive kind of
    // working-looking failure.
    error(`  ${(await setSecret.text()).slice(0, 200)}`)
    throw new DeployFailure('the function secrets were refused')
  }

  // --- 3. deploy ----------------------------------------------------------------
  const deployed = await fetchFn(`${api}/functions/deploy?slug=${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const result = (await deployed.json()) as {
    slug?: string
    version?: number
    status?: string
    message?: string
  }
  if (!deployed.ok) {
    throw new DeployFailure(`deploy failed: ${String(deployed.status)} ${JSON.stringify(result)}`)
  }
  log(`deployed ${String(result.slug)} v${String(result.version)} status=${String(result.status)}`)

  const url = `${functionsBase}/${slug}`

  // --- 4. does it actually run? -------------------------------------------------
  //
  // A deploy that reports success and a function that throws on its first import
  // is the failure this whole script exists to avoid, so it is checked here
  // rather than discovered by Grant waiting for a reply.
  const live = (await (await fetchFn(url)).json()) as { ok?: boolean; configured?: boolean }
  log(`liveness: ok=${String(live.ok)} configured=${String(live.configured)}`)

  const refused = await fetchFn(url, { method: 'POST' })
  log(`unauthenticated kick: http ${String(refused.status)} (must be 401)`)

  const kicked = await fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kick}` },
  })
  const body = (await kicked.json()) as Record<string, unknown>
  log(
    `authenticated kick: http ${String(kicked.status)} ok=${String(body.ok)} ` +
      `handled=${String(body.handled ?? '-')} buttons=${String(body.buttons ?? '-')} ` +
      `duties=${String(body.duties ?? '-')}`,
  )
  if (body.error !== undefined) log(`  error: ${String(body.error)}`)
  for (const line of (body.log as string[] | undefined) ?? []) log(`  ${line}`)

  if (refused.status !== 401 || live.configured !== true || body.ok !== true) {
    throw new DeployFailure('the worker is not usable - see above')
  }
  // The deployed worker answers a person in their own Slack workspace with that person's token (src/slack/installs.ts,
  // ADR-0065). The Settings page says "replying in Slack is not switched on" until this is true, so it is stated HERE, by the
  // deploy that proved the worker runs, and by nothing earlier: a flag set before the code is live is a promise the product
  // cannot keep (a migration is not a deploy).
  await db.execute(`
  insert into public.system_config (key, value, description)
  values ('slack.per_office_delivery', 'true'::jsonb,
          'The deployed worker answers a person in their own Slack workspace with their own token (ADR-0065). Set by deploy:worker after its probe passes.')
  on conflict (key) do update set value = excluded.value`)
  log('slack.per_office_delivery: true (this worker answers personal Slack workspaces)')

  log(`\nworker: ${url}`)
  log('kick secret is in the vault as `worker.kick_secret`, deliberately not printed.')
}
