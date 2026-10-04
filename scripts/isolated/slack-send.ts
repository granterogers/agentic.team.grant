/**
 * A person's own Slack workspace, both directions, through the REAL code (ADR-0065, migrations 0891-0893).
 *
 *   npx tsx scripts/isolated/slack-send.ts <replica-db>
 *
 * RECEIVING: the real `slack-events` handler runs against the replica with a real signature. A person who installed the
 * app into their own workspace is admitted as THEIR office, in THEIR workspace; the same person claiming another
 * workspace, a user from another office speaking through this one, and a stranger are each acknowledged and stored nowhere.
 *
 * SENDING: the real `slackChannel` / `SlackOffice` / `SlackClient`, wrapped by the install-aware channel the worker uses, post
 * the reply through a recorded Slack TRANSPORT DOUBLE. What the double records is what Slack would have received, so "which
 * token posted this" is an observation: each person's reply carries their own token, an office with no install posts nothing,
 * and the operator's office is served by the deployment's channel. A SABOTAGE then points one install at another's token and
 * the same assertion must go red (proving it discriminates), and the row is restored.
 *
 * Nothing leaves the machine: every URL that is neither the replica nor Slack's chat API is refused and recorded.
 */

import type { Job } from '../../src/jobs/worker.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { installAwareSlackChannel, type SlackChannelLike } from '../../src/slack/installs.ts'
import { slackChannel } from '../../src/slack/notifier.ts'
import { SlackOffice } from '../../src/slack/office.ts'
import { computeSignature } from '../../src/slack/signature.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'slacksend')
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
const A = await office('send.a', `Send A ${run}`)
const B = await office('send.b', `Send B ${run}`)
const C = await office('send.c', `Send C ${run}`)
const suffix = run
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, 'X')
  .padEnd(8, 'X')
  .slice(0, 8)
const TEAM_A = `T0${suffix}`
const TEAM_B = `T1${suffix}`
const USER_A = `U0${suffix}`
const USER_B = `U1${suffix}`
const STRANGER = `U7${suffix}`
const BOT_A = `U8${suffix}`
const BOT_B = `U9${suffix}`
// Made-up specimens assembled from pieces so no token-shaped literal sits in the repository (check:secrets).
const TOKEN_A = `${'xo'}xb-0000000001-${suffix.toLowerCase()}tokenforofficea`
const TOKEN_B = `${'xo'}xb-0000000002-${suffix.toLowerCase()}tokenforofficeb`
const DM_A = `D0${suffix}`
const DM_B = `D1${suffix}`
const SECRET = 'isolated-slack-signing-secret'

await db.execute(`insert into public.system_config (key, value, description)
  values ('slack.client_id', to_jsonb('1111.2222'::text), 'isolated') on conflict (key) do update set value = excluded.value`)
const install = async (
  o: string,
  team: string,
  user: string,
  bot: string,
  token: string,
): Promise<void> => {
  const begun = (await one(`select public.slack_link_begin(${lit(o)}::uuid) r`)).r as {
    state?: string
  }
  const done = (
    await one(
      `select public.slack_link_redeem(${lit(String(begun.state))}, ${lit(team)}, ${lit(`Workspace ${team}`)}, ${lit(bot)}, 'A0ISOLATED1', ${lit(user)}, ${lit(token)}) r`,
    )
  ).r as { ok?: boolean }
  if (done.ok !== true) throw new Error(`install refused: ${JSON.stringify(done)}`)
}
await install(A, TEAM_A, USER_A, BOT_A, TOKEN_A)
await install(B, TEAM_B, USER_B, BOT_B, TOKEN_B)

// ---- RECEIVING: the real door ---------------------------------------------------------------------------------------------
const door = await startEdge({
  db,
  edgeFile: 'supabase/functions/slack-events/index.ts',
  beside: [
    ['src/slack/events.ts', 'events.ts'],
    ['src/slack/interactions.ts', 'interactions.ts'],
    ['src/slack/signature.ts', 'signature.ts'],
  ],
  env: {
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_USER_ID: BOT_A,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  },
})
let n = 0
const post = async (team: string, user: string, channel: string, text: string) => {
  n += 1
  const raw = JSON.stringify({
    type: 'event_callback',
    team_id: team,
    event_id: `Ev${run}${String(n)}`,
    event: {
      type: 'message',
      user,
      channel,
      channel_type: 'im',
      text,
      ts: `1790000${String(100 + n)}.000100`,
    },
  })
  const ts = String(Math.floor(Date.now() / 1000) - 3)
  const r = await door.call(
    new Request('https://door.invalid/functions/v1/slack-events', {
      method: 'POST',
      headers: {
        'X-Slack-Signature': await computeSignature(SECRET, ts, raw),
        'X-Slack-Request-Timestamp': ts,
        'Content-Type': 'application/json',
      },
      body: raw,
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const commandOf = async (text: string) =>
  (await one(
    `select command_id::text id, office_id::text office, job_id::text job from public.inbound_commands where instruction = ${lit(text)} limit 1`,
  )) as { id?: string; office?: string; job?: string } | undefined

const tA = `hello from A ${run}`
const rA = await post(TEAM_A, USER_A, DM_A, tA)
const cA = await commandOf(tA)
check(
  'a connected person’s message in THEIR workspace is stored as THEIR office’s, and becomes a job',
  rA.status === 200 && cA?.office === A && typeof cA?.job === 'string',
  JSON.stringify(rA.body),
)

const tB = `hello from B ${run}`
const rB = await post(TEAM_B, USER_B, DM_B, tB)
const cB = await commandOf(tB)
check(
  'and the second person’s is their own office’s, not the first’s',
  rB.status === 200 && cB?.office === B && cB.job !== cA?.job,
)

const x1 = `A claims workspace B ${run}`
const r1 = await post(TEAM_B, USER_A, DM_B, x1)
check(
  'a person speaking through ANOTHER office’s workspace is refused and stored nowhere',
  r1.body.ignored !== undefined && (await commandOf(x1)) === undefined,
  JSON.stringify(r1.body),
)
const x2 = `B claims workspace A ${run}`
const r2 = await post(TEAM_A, USER_B, DM_A, x2)
check(
  'and so is the other way round',
  r2.body.ignored !== undefined && (await commandOf(x2)) === undefined,
  JSON.stringify(r2.body),
)
const x3 = `stranger in A ${run}`
const r3 = await post(TEAM_A, STRANGER, DM_A, x3)
check(
  'a stranger in a connected workspace is acknowledged and stored nowhere',
  r3.body.ignored === 'unrecognised sender' && (await commandOf(x3)) === undefined,
  JSON.stringify(r3.body),
)
const x4 = `unknown workspace ${run}`
const r4 = await post(`T9${suffix}`, USER_A, DM_A, x4)
check(
  'an unknown workspace is refused',
  r4.body.ignored !== undefined && (await commandOf(x4)) === undefined,
)
const st = (await one(`select app.slack_install_status(${lit(A)}::uuid) -> 'slack' s`)).s as Record<
  string,
  unknown
>
check(
  'the status says what the door will say: connected, can receive (asked of the door’s own predicate)',
  st.state === 'connected' && st.can_receive === true && st.can_reply === false,
  JSON.stringify(st),
)

// ---- CONTROL: the defect this proof found. With the workspace predicate as it was before 0893 (credentials only), the same
// message from the same connected person is ignored: the page would say "connected" and the door would never answer.
{
  const FN = 'app.slack_team_ok(text)'
  const now = String((await one(`select pg_get_functiondef('${FN}'::regprocedure) d`)).d)
  await db.execute(`create or replace function app.slack_team_ok(p_team text) returns boolean language sql stable security definer set search_path to '' as $f$
    select coalesce(p_team ~ '^T[A-Z0-9]{8,}$', false) and exists (select 1 from public.slack_app_credentials c where c.team_id = p_team and c.enabled and c.revoked_at is null) $f$`)
  const t = `before 0893 ${run}`
  const r = await post(TEAM_A, USER_A, DM_A, t)
  check(
    'CONTROL: with the pre-0893 predicate the connected person’s message is ignored (the defect, seen)',
    r.body.ignored === 'unrecognised workspace' && (await commandOf(t)) === undefined,
    JSON.stringify(r.body),
  )
  await db.execute(now)
  const back = String((await one(`select pg_get_functiondef('${FN}'::regprocedure) d`)).d)
  const t2 = `after 0893 ${run}`
  const r2b = await post(TEAM_A, USER_A, DM_A, t2)
  check(
    'restored: the same message is accepted again',
    back === now && r2b.status === 200 && (await commandOf(t2))?.office === A,
  )
}

// ---- SENDING: the real channel through a recorded Slack double ----------------------------------------------------------------
type Posted = { auth: string; channel: string; threadTs: string | null; text: string }
const posted: Posted[] = []
const slackDouble = (async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith('/chat.postMessage')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      channel?: string
      thread_ts?: string
      text?: string
    }
    posted.push({
      auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''),
      channel: String(body.channel),
      threadTs: body.thread_ts ?? null,
      text: String(body.text ?? ''),
    })
    return Response.json({
      ok: true,
      ts: `1790000999.${String(posted.length).padStart(6, '0')}`,
      channel: body.channel,
    })
  }
  return Response.json({ ok: false, error: 'not_expected_in_this_proof' })
}) as typeof fetch

const deploymentCalls: string[] = []
const deployment: SlackChannelLike = {
  name: 'slack',
  notify: async () => {
    deploymentCalls.push('deployment')
    return { delivered: true, note: 'deployment channel' }
  },
}
const channel = installAwareSlackChannel({
  db,
  deployment,
  make: ({ teamId, token }) =>
    slackChannel(
      db,
      new SlackOffice(
        db,
        new SlackClient(token, { fetchImpl: slackDouble, sleep: async () => undefined }),
      ),
      {
        teamId,
      },
    ),
})
const jobOf = async (jobId: string): Promise<Job> => {
  const r = await one(
    `select job_id::text id, kind, correlation_id::text corr, project_id::text project, idempotency_key key, attempt from public.jobs where job_id = ${lit(jobId)}::uuid`,
  )
  return {
    jobId: String(r.id),
    kind: String(r.kind),
    correlationId: String(r.corr),
    projectId: (r.project as string | null) ?? null,
    idempotencyKey: String(r.key),
    attempt: Number(r.attempt),
  } as Job
}
const OUTPUT = {
  body: `Here is your answer ${run}`,
  confidence: 'medium',
  evidence: 'inferred',
  sources: [],
  contradictions: null,
  path: 'model',
  model: 'isolated',
} as never
const CONTEXT = {
  staff: null,
  staffId: null,
  reviewed: true,
  routine: false,
  actions: [],
  projectUrl: null,
  blockerId: null,
} as never

const sendFor = async (
  jobId: string,
): Promise<{ outcome: Awaited<ReturnType<typeof channel.notify>>; calls: Posted[] }> => {
  posted.length = 0
  const outcome = await channel.notify(await jobOf(jobId), OUTPUT, crypto.randomUUID(), CONTEXT)
  return { outcome, calls: [...posted] }
}

{
  const a = await sendFor(String(cA?.job))
  check(
    'A’s answer is posted with A’s OWN token, into A’s own conversation, under the message that asked',
    a.outcome.delivered === true &&
      a.calls.length === 1 &&
      a.calls[0]?.auth === `Bearer ${TOKEN_A}` &&
      a.calls[0]?.channel === DM_A &&
      /^\d+\.\d+$/.test(a.calls[0]?.threadTs ?? ''),
    JSON.stringify({
      ...a.outcome,
      calls: a.calls.map((c) => ({ ...c, auth: c.auth.slice(0, 12) })),
    }),
  )
  const delivered = await one(
    `select count(*)::int c from public.deliveries where office_id = ${lit(A)}::uuid and job_id = ${lit(String(cA?.job))}::uuid`,
  )
  check('and the delivery is recorded in A’s office', Number(delivered.c) >= 1)
  const b = await sendFor(String(cB?.job))
  check(
    'B’s answer is posted with B’s own token into B’s own conversation',
    b.outcome.delivered === true &&
      b.calls.length === 1 &&
      b.calls[0]?.auth === `Bearer ${TOKEN_B}` &&
      b.calls[0]?.channel === DM_B,
    JSON.stringify(b.calls.map((c) => ({ ...c, auth: c.auth.slice(0, 12) }))),
  )
  check(
    'and neither used the other’s token, and none used the deployment’s',
    a.calls[0]?.auth !== b.calls[0]?.auth && deploymentCalls.length === 0,
  )
}

// ---- the operator’s office is served by the deployment’s channel; an office with no install by nothing ----------------------
{
  const op = String((await one(`select app.operator_office()::text o`)).o)
  const j =
    await one(`insert into public.jobs (office_id, project_id, kind, requested_by, idempotency_key, correlation_id)
    values (${lit(op)}::uuid, app.unnamed_project(${lit(op)}::uuid), 'office.instruction', 'telegram:isolated-send', ${lit(`send-op-${run}`)}, gen_random_uuid()) returning job_id::text id`)
  posted.length = 0
  const r = await channel.notify(
    await jobOf(String(j.id)),
    OUTPUT,
    '00000000-0000-4000-8000-000000000001',
    CONTEXT,
  )
  check(
    'the operator’s own office is served by the deployment’s channel, and no install’s client is used',
    r.delivered === true && deploymentCalls.length === 1 && posted.length === 0,
  )

  const jc =
    await one(`insert into public.jobs (office_id, project_id, kind, requested_by, idempotency_key, correlation_id)
    values (${lit(C)}::uuid, app.unnamed_project(${lit(C)}::uuid), 'office.instruction', 'slack:isolated-c', ${lit(`send-c-${run}`)}, gen_random_uuid()) returning job_id::text id`)
  posted.length = 0
  const before = deploymentCalls.length
  const rc = await channel.notify(
    await jobOf(String(jc.id)),
    OUTPUT,
    '00000000-0000-4000-8000-000000000002',
    CONTEXT,
  )
  check(
    'an office with NO install is served by nothing: no post, and the deployment’s channel is not borrowed',
    rc.delivered === false && posted.length === 0 && deploymentCalls.length === before,
    String(rc.note),
  )
}

// ---- SABOTAGE: B's install points at A's token; the same assertion must now fail --------------------------------------------
{
  const refA = String(
    (
      await one(
        `select bot_token_ref::text r from public.slack_installs where office_id = ${lit(A)}::uuid and state = 'active'`,
      )
    ).r,
  )
  const refB = String(
    (
      await one(
        `select bot_token_ref::text r from public.slack_installs where office_id = ${lit(B)}::uuid and state = 'active'`,
      )
    ).r,
  )
  await db.execute(
    `update public.slack_installs set bot_token_ref = ${lit(refA)}::uuid where office_id = ${lit(B)}::uuid and state = 'active'`,
  )
  // a new message from B so the delivery is not a duplicate of the one already sent
  const t2 = `second from B ${run}`
  await post(TEAM_B, USER_B, DM_B, t2)
  const c2 = await commandOf(t2)
  const wrong = await sendFor(String(c2?.job))
  check(
    'SABOTAGE CONTROL: with B’s install pointing at A’s token, B’s answer carries A’s token (the check can see it)',
    wrong.calls[0]?.auth === `Bearer ${TOKEN_A}`,
    wrong.calls[0]?.auth.slice(0, 12),
  )
  await db.execute(
    `update public.slack_installs set bot_token_ref = ${lit(refB)}::uuid where office_id = ${lit(B)}::uuid and state = 'active'`,
  )
  const t3 = `third from B ${run}`
  await post(TEAM_B, USER_B, DM_B, t3)
  const c3 = await commandOf(t3)
  const right = await sendFor(String(c3?.job))
  check(
    'restored: B’s answer carries B’s token again',
    right.calls[0]?.auth === `Bearer ${TOKEN_B}`,
  )
}

check(
  'nothing left the machine except the recorded Slack calls',
  door.refusedUrls.length === 0,
  door.refusedUrls.join(' | '),
)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} checks passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
