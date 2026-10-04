/**
 * A person installing Slack into their own workspace, through the REAL callback handler (ADR-0065, migrations 0891-0892).
 *
 *   npx tsx scripts/isolated/slack-oauth.ts <replica-db>
 *
 * The real `slack-oauth` function (and the `oauth.ts` it is uploaded with) runs in Node against the isolated replica. The
 * emulator refuses and records every URL that is not the replica; Slack's OAuth endpoint is answered by a TRANSPORT DOUBLE
 * laid in front of it, which records what was sent to it, so "the client secret went to Slack and nowhere else" is an
 * observation. Nothing leaves the machine and no real credential exists here.
 *
 * Driven: a good consent connects the person to THEIR office; a replay, a forged state, an expired state, a workspace another
 * office holds, a Slack user another office holds, a refusal from Slack and an unreachable database all connect nothing and
 * (where the state is not the problem) spend nothing; an office named in the request is ignored; the token is in the vault
 * and in no response; disconnect retires it. A SABOTAGE then removes the workspace-ownership rule from the redeem function
 * and the same probe must connect the wrong office (proving the detector can see it), and the function is restored.
 */
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'slackoauth')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const office = async (mail: string, name: string): Promise<string> => {
  const auth = String((await one(`select gen_random_uuid()::text a`)).a)
  await db.execute(
    `insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${mail}.${run}@example.invalid`)})`,
  )
  await db.execute(
    `insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(name)})`,
  )
  return String(
    (await one(`select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`)).o,
  )
}
const A = await office('slack.a', `Slack A ${run}`)
const B = await office('slack.b', `Slack B ${run}`)
const suffix = run
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, 'X')
  .padEnd(8, 'X')
  .slice(0, 8)
const TEAM_A = `T0${suffix}`
const USER_A = `U0${suffix}`
const USER_B = `U1${suffix}`
const BOTU = `U9${suffix}`
const TOKEN = `xoxb-0000000000-${suffix.toLowerCase()}isolatedfake`
const CLIENT_SECRET = `isolated-client-secret-${run}`

await db.execute(`insert into public.system_config (key, value, description)
  values ('slack.client_id', to_jsonb('1111.2222'::text), 'isolated') on conflict (key) do update set value = excluded.value`)

// ---- the Slack transport double, laid in front of the emulator's fetch ------------------------------------------------
type Sent = { url: string; body: string }
const slackCalls: Sent[] = []
let slackAnswer: Record<string, unknown> = {}
const reply = (team: string, user: string, token = TOKEN) => ({
  ok: true,
  access_token: token,
  bot_user_id: BOTU,
  app_id: 'A0ISOLATED1',
  team: { id: team, name: `Workspace ${team}` },
  authed_user: { id: user },
})

const edge = await startEdge({
  db,
  edgeFile: 'supabase/functions/slack-oauth/index.ts',
  beside: [['src/slack/oauth.ts', 'oauth.ts']],
  env: {
    SLACK_CLIENT_SECRET: CLIENT_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
    HQ_SITE_URL: 'https://site.invalid',
  },
})
const emulatorFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith('https://slack.com/api/')) {
    slackCalls.push({ url, body: String(init?.body ?? '') })
    return Response.json(slackAnswer)
  }
  return emulatorFetch(input, init)
}) as typeof fetch

const begin = async (o: string): Promise<string> => {
  const r = (await one(`select public.slack_link_begin(${lit(o)}::uuid) r`)).r as {
    ok?: boolean
    state?: string
  }
  if (r.ok !== true || typeof r.state !== 'string')
    throw new Error(`begin refused: ${JSON.stringify(r)}`)
  return r.state
}
const callback = async (state: string, extra = ''): Promise<string> => {
  const res = await edge.call(
    new Request(
      `${'http://replica.invalid'}/functions/v1/slack-oauth?code=isolatedcode123&state=${state}${extra}`,
    ),
  )
  return res.headers.get('location') ?? `http ${String(res.status)}`
}
const word = (loc: string): string => /slack=(\w+)/.exec(loc)?.[1] ?? loc
const workspaceOf = async (team: string): Promise<string | null> =>
  ((
    (await one(
      `select office_id::text o from public.slack_workspaces where team_id = ${lit(team)}`,
    )) ?? {}
  ).o as string | null) ?? null
const installs = async (o: string): Promise<number> =>
  Number(
    (
      await one(
        `select count(*)::int c from public.slack_installs where office_id = ${lit(o)}::uuid and state = 'active'`,
      )
    ).c,
  )

// ---- a good consent -----------------------------------------------------------------------------------------------------
{
  const state = await begin(A)
  slackAnswer = reply(TEAM_A, USER_A)
  const loc = await callback(state, `&office=${B}&p_office=${B}`)
  check(
    'a good consent connects ("slack=connected" is the only thing the person is told)',
    word(loc) === 'connected',
    loc,
  )
  check(
    'the workspace belongs to the office the STATE named, though the request named another',
    (await workspaceOf(TEAM_A)) === A,
  )
  check(
    'and so does the install, with the sender admitted as that office',
    (await installs(A)) === 1 &&
      (
        await one(
          `select public.sender_admitted('slack', ${lit(USER_A)}, 'C0ISOLATED1') ->> 'office_id' o`,
        )
      ).o === A,
  )
  check(
    'the office the request named has nothing',
    (await installs(B)) === 0 && (await workspaceOf(TEAM_A)) !== B,
  )
  check(
    'the bot token is in the vault and is in no redirect',
    (
      await one(
        `select count(*)::int c from vault.decrypted_secrets where name = ${lit(`slack.install.${TEAM_A}`)} and decrypted_secret = ${lit(TOKEN)}`,
      )
    ).c === 1 && !loc.includes(TOKEN),
  )
  const exchange = slackCalls.find((c) => c.url.endsWith('/oauth.v2.access'))
  check(
    'the client secret went to Slack and nowhere else (every refused URL is a non-replica one)',
    (exchange?.body ?? '').includes(CLIENT_SECRET) &&
      edge.refusedUrls.every((u) => !u.includes(CLIENT_SECRET)) &&
      !loc.includes(CLIENT_SECRET),
  )
  const replay = await callback(state)
  check(
    'a replay of the same state connects nothing',
    word(replay) === 'refused' && (await installs(A)) === 1,
    replay,
  )
}

// ---- refusals, each beside a state that is NOT spent by it ------------------------------------------------------------
{
  const sB = await begin(B)
  slackAnswer = reply(TEAM_A, USER_B) // A's workspace
  check(
    'a workspace another office holds is refused',
    word(await callback(sB)) === 'refused' && (await workspaceOf(TEAM_A)) === A,
  )
  check(
    'and the state is not spent by it',
    Number(
      (
        await one(
          `select count(*)::int c from public.channel_link_challenges where office_id = ${lit(B)}::uuid and channel = 'slack' and used_at is null`,
        )
      ).c,
    ) === 1,
  )

  slackAnswer = reply(`T1${suffix}`, USER_A) // A's Slack user
  check(
    'a Slack user another office holds is refused',
    word(await callback(sB)) === 'refused' && (await installs(B)) === 0,
  )

  slackAnswer = { ok: false, error: 'invalid_code' }
  check(
    'Slack refusing the code is a refusal',
    word(await callback(sB)) === 'refused' && (await installs(B)) === 0,
  )

  slackAnswer = reply(`T1${suffix}`, USER_B)
  check(
    'a forged state connects nothing and creates nothing',
    word(await callback('0'.repeat(36))) === 'refused' &&
      (await workspaceOf(`T1${suffix}`)) === null,
  )

  await db.execute(
    `update public.channel_link_challenges set expires_at = app.now_utc() - interval '1 minute', created_at = app.now_utc() - interval '11 minutes' where office_id = ${lit(B)}::uuid and channel = 'slack' and used_at is null`,
  )
  check(
    'an expired state connects nothing',
    word(await callback(sB)) === 'refused' && (await installs(B)) === 0,
  )

  const sB2 = await begin(B)
  edge.outage(true)
  const down = await callback(sB2)
  edge.outage(false)
  check(
    'an unreachable database is "failed", not a connection and not a refusal',
    word(down) === 'failed' && (await installs(B)) === 0,
    down,
  )
  check(
    'and it spent nothing: the same state then connects',
    word(await callback(sB2)) === 'connected' && (await installs(B)) === 1,
  )
}

// ---- disconnect ----------------------------------------------------------------------------------------------------------
{
  const gone = (await one(`select public.slack_link_disconnect(${lit(A)}::uuid) r`)).r as {
    removed?: number
    bot_token?: string
  }
  check(
    'disconnect hands the token back once and retires the install',
    gone.removed === 1 && gone.bot_token === TOKEN && (await installs(A)) === 0,
  )
  check(
    'the vault copy is gone and the sender is a stranger again',
    (
      await one(
        `select count(*)::int c from vault.secrets where name = ${lit(`slack.install.${TEAM_A}`)}`,
      )
    ).c === 0 &&
      (
        await one(
          `select public.sender_admitted('slack', ${lit(USER_A)}, 'C0ISOLATED1') ->> 'office_id' o`,
        )
      ).o === null,
  )
}

// ---- SABOTAGE: remove the workspace-ownership rule; the answer must change, and the database must still hold ----------------
{
  const FN = 'app.slack_install_redeem(text,text,text,text,text,text,text)'
  const def = String((await one(`select pg_get_functiondef('${FN}'::regprocedure) d`)).d)
  const broken = def.replace(
    'if v_owner is not null and v_owner <> v_row.office_id then',
    'if false then',
  )
  check('SABOTAGE landed (the definition changed)', broken !== def)
  // B holds this workspace (connected above); A, disconnected, tries to claim it.
  const TEAM_B = `T1${suffix}`
  slackAnswer = reply(TEAM_B, USER_A)
  const before = word(await callback(await begin(A)))
  await db.execute(broken)
  const after = word(await callback(await begin(A)))
  check(
    'SABOTAGE CONTROL: without the ownership rule the answer to the same probe changes (it is no longer "refused")',
    before === 'refused' && after !== 'refused',
    `${before} -> ${after}`,
  )
  check(
    'and even then the database will not give A the workspace: the same-office composite key is a second line',
    (await workspaceOf(TEAM_B)) === B && (await installs(A)) === 0,
  )
  await db.execute(def) // restore the original, byte for byte
  const back = String((await one(`select pg_get_functiondef('${FN}'::regprocedure) d`)).d)
  check('the function is restored exactly', back === def)
  slackAnswer = reply(TEAM_B, USER_A)
  check('and the probe is refused again', word(await callback(await begin(A))) === 'refused')
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} checks passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
