/**
 * Multi-user P1.2 (#400): ONE resolver for the deployment's fixed-name credentials.
 *
 *   npx tsx scripts/isolated/p1-credentials.ts <replica-db>
 *
 * Groups, each with its positive control (a suite made only of refusals passes against a system that refuses
 * everything):
 *   1. the database resolver: operator, second person, harness, machine, infra, unclassified, unknown name;
 *   2. the job path: a duty (internal), Grant's own turn (trusted + operator), a SECOND person's trusted turn,
 *      a harness job - and the retired readers are gone;
 *   3. the worker's TS path: the same credential read under withJobScope, with and without a scope;
 *   4. the REAL google-oauth function: a callback with no state, a forged state, a replayed state, and the
 *      legitimate flow that reaches Google's token endpoint - and the stored refresh token never changes
 *      unless a live operator state was presented.
 *
 * SABOTAGE (docs/multi-user/P1-CLOSURE.md): drop the operator/job test from app.deployment_credential, or the
 * state check from google-oauth, and the named groups go red.
 */
import { currentJob, readCredential, withJobScope } from '../../src/credentials/deployment.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, realTelegramKey, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

const SECOND = `p1-cred-${run}`
const VALUE = `fixture-secret-${run}`
const NAMES = [
  'google.refresh_token',
  'google.client_secret',
  'notion.integration_token',
  'openrouter.api_key',
]
const created: string[] = []
const config: [string, string | null][] = []

/** Ask the PostgREST door exactly as an edge function does (the public wrapper, service role). */
const door = async (name: string, operator: string | null, job: string | null) => {
  try {
    const r = await one(
      `set local application_name = 'PostgREST 14.5';
       select public.deployment_credential(${lit(name)}, ${operator === null ? 'null' : lit(operator)},
         ${job === null ? 'null' : `${lit(job)}::uuid`}) as v`,
    )
    return { ok: true as const, value: r.v === null ? null : String(r.v) }
  } catch (e) {
    return { ok: false as const, error: String((e as Error).message) }
  }
}

let exit = 1
try {
  // ---- fixtures: secrets that exist only for this run, a second person, a registered chat -------------------
  for (const name of NAMES) {
    const have = Number(
      (await one(`select count(*)::int as n from vault.secrets where name = ${lit(name)}`)).n,
    )
    if (have === 0) {
      await db.execute(
        `insert into vault.secrets (name, secret) values (${lit(name)}, ${lit(VALUE)})`,
      )
      created.push(name)
    }
  }
  const stored = async (name: string) =>
    String(
      (
        await one(
          `select decrypted_secret as v from vault.decrypted_secrets where name = ${lit(name)}`,
        )
      ).v,
    )
  await db.execute(
    `insert into public.office_members (email, note, owner_key, kind)
     values (${lit(`${SECOND}@example.com`)}, 'p1 credentials proof', ${lit(SECOND)}, 'person') on conflict do nothing`,
  )
  await registerBot(db)

  // ---- 1. the database resolver ---------------------------------------------------------------------------
  const refused = (r: { ok: boolean; error?: string }) =>
    !r.ok && (r.error ?? '').includes('deployment credential refused')
  const op = await door('google.refresh_token', 'grant', null)
  check(
    'POSITIVE CONTROL: the operator is served a Google credential',
    op.ok && op.value === (await stored('google.refresh_token')),
    op.ok ? 'served' : String(op.error),
  )
  check(
    'no operator and no job: refused',
    refused(await door('google.refresh_token', null, null)),
    "nobody asked on anyone's behalf",
  )
  check(
    'a second signed-in person is refused',
    refused(await door('google.refresh_token', SECOND, null)),
    SECOND,
  )
  check(
    'a harness member is refused',
    refused(await door('google.refresh_token', 'verify-operator', null)),
    'verify-operator',
  )
  check(
    'an empty operator string is refused (not read as "everyone")',
    refused(await door('google.refresh_token', '   ', null)),
    'blank',
  )
  check(
    'a Notion credential is a human integration too',
    (await door('notion.integration_token', 'grant', null)).ok &&
      refused(await door('notion.integration_token', SECOND, null)),
    'operator yes, second person no',
  )
  const infra = await door('openrouter.api_key', 'grant', null)
  const unknown = await door('no.such.secret', 'grant', null)
  const unclassified = await door(`mystery.${run}`, 'grant', null)
  check(
    'an infrastructure secret is never served by this reader, even to the operator',
    refused(infra),
    'openrouter.api_key',
  )
  check(
    'and an unknown or unclassified name is refused in the SAME words (no existence oracle)',
    refused(unknown) &&
      refused(unclassified) &&
      infra.error === unknown.error &&
      unknown.error === unclassified.error,
    'identical refusal',
  )
  const sys = await one(
    `select app.deployment_credential('google.refresh_token', null, null, true) as v`,
  )
  check(
    'the worker acting for the deployment (system) is served - and that argument is not on the PostgREST door',
    String(sys.v) === (await stored('google.refresh_token')) &&
      !(
        await one(
          `select pg_get_function_arguments('public.deployment_credential(text,text,uuid)'::regprocedure) as a`,
        )
      ).a
        ?.toString()
        .includes('system'),
    'system only via app',
  )
  const svc =
    await one(`select has_function_privilege('service_role', 'app.deployment_credential(text,text,uuid,boolean)', 'execute') as s,
                                has_function_privilege('anon', 'public.deployment_credential(text,text,uuid)', 'execute') as a,
                                has_function_privilege('authenticated', 'public.deployment_credential(text,text,uuid)', 'execute') as u`)
  check(
    'service_role cannot execute the system form; anon and authenticated cannot reach the wrapper',
    svc.s === false && svc.a === false && svc.u === false,
    JSON.stringify(svc),
  )
  const gone = await one(
    `select to_regprocedure('public.vault_secret(text)') is null as wrapper_gone`,
  )
  let legacy = 'served'
  try {
    await db.execute(`select app.vault_secret('google.refresh_token')`)
  } catch (e) {
    legacy = String((e as Error).message).includes('retired')
      ? 'refused'
      : String((e as Error).message)
  }
  check(
    'the raw readers are retired: no PostgREST wrapper, and the app function refuses everything',
    gone.wrapper_gone === true && legacy === 'refused',
    `wrapper gone=${String(gone.wrapper_gone)}, app.vault_secret ${legacy}`,
  )

  // ---- 2. the job path ------------------------------------------------------------------------------------
  const dutySlug = String((await one(`select slug from public.responsibilities limit 1`)).slug)
  const dutyKind = String(
    (await one(`select job_kind from public.responsibilities where slug = ${lit(dutySlug)}`))
      .job_kind,
  )
  const insertJob = async (kind: string, requestedBy: string, extra = '') =>
    String(
      (
        await one(`insert into public.jobs (kind, requested_by, idempotency_key, correlation_id ${extra === '' ? '' : ''})
      values (${lit(kind)}, ${lit(requestedBy)}, 'p1c-' || gen_random_uuid(), gen_random_uuid()) returning job_id::text as id`)
      ).id,
    )
  const dutyJob = await insertJob(dutyKind, `duty:${dutySlug}`)
  const turn = async (subject: string) => {
    const key = realTelegramKey()
    const cmd = await one(`set local application_name = 'PostgREST 14.5';
      insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
      values ('telegram', ${lit(`${CHAT}:${key.split(':').pop() ?? '1'}`)}, ${lit(CHAT)}, 'a turn for a credential proof', ${lit(key)}, ${lit(subject)})
      returning command_id::text as id`)
    const enq = await one(
      `set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`,
    )
    const v = (typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id?: string }
    return String(v.job_id)
  }
  const grantsTurn = await turn('grant')
  const secondsTurn = await turn(SECOND)
  const harnessJob = await insertJob('office.instruction', `verify:p1cred-${run}`)
  const origin = async (j: string) =>
    String((await one(`select app.job_origin(${lit(j)}::uuid) as o`)).o)
  check(
    "the fixtures are what they claim (duty internal, Grant's turn trusted, harness harness)",
    (await origin(dutyJob)) === 'internal' &&
      (await origin(grantsTurn)) === 'trusted' &&
      (await origin(secondsTurn)) === 'trusted' &&
      (await origin(harnessJob)) === 'harness',
    `${await origin(dutyJob)}/${await origin(grantsTurn)}/${await origin(secondsTurn)}/${await origin(harnessJob)}`,
  )
  const asJob = (j: string) => door('google.refresh_token', null, j)
  check(
    "POSITIVE CONTROL: a duty (the deployment's own work) is served",
    (await asJob(dutyJob)).ok,
    'internal',
  )
  check(
    "POSITIVE CONTROL: Grant's own trusted turn is served (operator requester)",
    (await asJob(grantsTurn)).ok,
    'trusted + operator',
  )
  check(
    "a SECOND person's trusted turn is refused: trusted is not enough, the requester must be an operator",
    refused(await asJob(secondsTurn)),
    SECOND,
  )
  check('a harness job is refused', refused(await asJob(harnessJob)), 'harness')
  check(
    'a job id that does not exist is refused',
    refused(await asJob('00000000-0000-4000-8000-000000000001')),
    'unknown',
  )
  // A child inherits its root: the second person's turn cannot launder authority through a child job.
  const child = String(
    (
      await one(`insert into public.jobs (kind, requested_by, parent_job_id, idempotency_key, correlation_id, pinned_config)
    select 'office.instruction', requested_by, job_id, 'p1c-' || gen_random_uuid(), gen_random_uuid(), pinned_config from public.jobs where job_id = ${lit(secondsTurn)}::uuid returning job_id::text as id`)
    ).id,
  )
  check(
    'and neither can a child of that turn',
    refused(await asJob(child)),
    'requester is read from the ROOT',
  )

  // ---- 3. the worker's TS path ---------------------------------------------------------------------------
  const expected = await stored('google.refresh_token')
  check(
    'no job in scope is the worker acting for the deployment (system)',
    currentJob() === null && (await readCredential(db, 'google.refresh_token')) === expected,
    'unscoped',
  )
  check(
    "under a duty's scope the credential is read as that duty",
    (await withJobScope(dutyJob, () => readCredential(db, 'google.refresh_token'))) === expected,
    'scoped to a duty',
  )
  let threw = ''
  try {
    await withJobScope(secondsTurn, () => readCredential(db, 'google.refresh_token'))
  } catch (e) {
    threw = String((e as Error).message)
  }
  check(
    "under a second person's turn the same read THROWS (a refusal is not an absence)",
    threw.includes('deployment credential refused'),
    threw.slice(0, 80),
  )
  let threwH = ''
  try {
    await withJobScope(harnessJob, () => readCredential(db, 'notion.integration_token'))
  } catch (e) {
    threwH = String((e as Error).message)
  }
  check(
    'and under a harness job',
    threwH.includes('deployment credential refused'),
    threwH.slice(0, 80),
  )
  const concurrent = await Promise.all([
    withJobScope(dutyJob, async () => {
      await new Promise((r) => setTimeout(r, 15))
      return currentJob()
    }),
    withJobScope(secondsTurn, async () => currentJob()),
  ])
  check(
    "two jobs at once do not read each other's identity",
    concurrent[0] === dutyJob && concurrent[1] === secondsTurn,
    'async-local scope',
  )

  // ---- 4. the REAL google-oauth function -----------------------------------------------------------------
  /*
    The function refuses everything before it looks at a state when no client id is configured, which would make
    every negative below pass for the wrong reason. So the config is set for the run (and put back after), and each
    negative asserts the SENTENCE it was refused with.
  */
  for (const [key, value] of [
    ['google.client_id', 'p1-client'],
    ['google.redirect_uri', 'https://fn.invalid/google-oauth/callback'],
  ] as const) {
    const was = (
      await one(`select value::text as v from public.system_config where key = ${lit(key)}`)
    )?.v
    config.push([key, was === undefined ? null : String(was)])
    await db.execute(`insert into public.system_config (key, value, description) values (${lit(key)}, to_jsonb(${lit(value)}::text), 'p1 credentials proof')
      on conflict (key) do update set value = excluded.value`)
  }
  const edge = await startEdge({
    db,
    edgeFile: 'supabase/functions/google-oauth/index.ts',
    env: { SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' },
  })
  type Seen = { status: number; location: string; text: string; reachedGoogle: string }
  /** The emulator THROWS when the function tries to reach anywhere but the replica; that throw is the evidence. */
  const hit = async (path: string): Promise<Seen> => {
    try {
      const r = await edge.call(
        new Request(`https://fn.invalid/functions/v1/google-oauth${path}`, { redirect: 'manual' }),
      )
      return {
        status: r.status,
        location: r.headers.get('location') ?? '',
        text: (await r.text()).trim(),
        reachedGoogle: '',
      }
    } catch (e) {
      return { status: 0, location: '', text: '', reachedGoogle: String((e as Error).message) }
    }
  }
  const reachedToken = (r: Seen) => r.reachedGoogle.includes('oauth2.googleapis.com/token')
  /** A refusal FOR THE STATE: back to the app with google=refused and the sentence about Settings. */
  const refusedForState = (r: Seen) =>
    r.status === 302 &&
    r.location.includes('google=refused') &&
    decodeURIComponent(r.location.replace(/\+/g, ' ')).includes('not started from Settings') &&
    !reachedToken(r)
  const refreshBefore = await stored('google.refresh_token')
  const noState = await hit('/callback?code=attackers-code')
  const forged = await hit('/callback?code=attackers-code&state=deadbeef')
  const startNoState = await hit('/start')
  check(
    'a callback with NO state is refused for that reason, and no code is exchanged',
    refusedForState(noState),
    `http ${String(noState.status)} ${noState.location.slice(0, 70)}`,
  )
  check(
    'a forged state is refused the same way',
    refusedForState(forged),
    `http ${String(forged.status)} ${forged.location.slice(0, 70)}`,
  )
  check(
    'starting without a state is refused (no redirect to Google)',
    startNoState.status === 400 &&
      startNoState.location === '' &&
      startNoState.text.includes('Start connecting Google from Settings'),
    `http ${String(startNoState.status)}: ${startNoState.text.slice(0, 60)}`,
  )
  const mint = async (who: string) =>
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select public.hq_google_connect_start(${lit(who)}) as v`,
      )
    ).v as Record<string, unknown>
  const secondMint = await mint(SECOND)
  check(
    'a second person cannot mint a state',
    typeof secondMint.state !== 'string' && typeof secondMint.error === 'string',
    String(secondMint.error ?? ''),
  )
  const minted = await mint('grant')
  const state = String(minted.state)
  check(
    'POSITIVE CONTROL: the operator mints a state',
    /^[0-9a-f]{48}$/.test(state),
    `${state.length} hex chars`,
  )
  const startOk = await hit(`/start?service=calendar&state=${state}`)
  check(
    'POSITIVE CONTROL: starting with a live state redirects to Google carrying that state',
    startOk.status === 302 &&
      startOk.location.includes('accounts.google.com') &&
      startOk.location.includes(`state=${state}`),
    startOk.location.slice(0, 60),
  )
  const good = await hit(`/callback?code=real-code&state=${state}`)
  check(
    "POSITIVE CONTROL: the legitimate callback goes on to Google's token endpoint (the emulator refuses to reach it)",
    reachedToken(good),
    good.reachedGoogle === ''
      ? `http ${String(good.status)} ${good.location}`
      : 'reached oauth2.googleapis.com/token',
  )
  const replay = await hit(`/callback?code=real-code&state=${state}`)
  check(
    'a REPLAYED callback (state already used) is refused for that reason and exchanges nothing',
    refusedForState(replay),
    `http ${String(replay.status)} ${replay.location.slice(0, 70)}`,
  )
  check(
    'the stored refresh token was never changed by any of it',
    (await stored('google.refresh_token')) === refreshBefore,
    'unchanged',
  )
  const left = Number(
    (await one(`select count(*)::int as n from public.google_oauth_states where used_at is null`))
      .n,
  )
  check(
    'and the state table holds only hashes',
    Number(
      (
        await one(
          `select count(*)::int as n from public.google_oauth_states where state_hash = ${lit(state)}`,
        )
      ).n,
    ) === 0,
    `${String(left)} unused`,
  )
} finally {
  for (const name of created)
    await db.execute(`delete from vault.secrets where name = ${lit(name)}`)
  await db.execute(`delete from public.google_oauth_states`)
  for (const [key, was] of config) {
    if (was === null) await db.execute(`delete from public.system_config where key = ${lit(key)}`)
    else
      await db.execute(
        `update public.system_config set value = ${lit(was)}::jsonb where key = ${lit(key)}`,
      )
  }
  await db.execute(`delete from public.office_members where owner_key = ${lit(SECOND)}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
  exit = failed === 0 ? 0 : 1
  await db.end()
}
process.exitCode = exit
void BOT
