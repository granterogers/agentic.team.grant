/**
 * Run 3 (#385): a credential is not a person, and a test principal decides only test traffic.
 *
 *   npx tsx scripts/isolated/principals.ts <replica-db>
 *
 * The REAL `hq-api`, `signin` and `voice` handlers run against the replica; the DATABASE is asked
 * what happened. The attacks are the ones the brief names: hold the office key, spoof the
 * principal, be a test member, mint a session for a person with the key, speak as Grant with the
 * key. Each group has its positive control (the person who should succeed does), because a suite
 * of refusals passes against a system that refuses everything.
 *
 * Sabotage (see docs/architecture-run-3/SABOTAGE.md): restoring the key -> 'grant' attribution, the
 * signin kind check, the harness rule and the voice speaker each turn a named group here red.
 */
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'principals')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const TOKEN = 'isolated-hq-token'
const GRANT_EMAIL = 'grant.e.rogers@gmail.com'
const HARNESS_EMAIL = 'verify.operator@example.com'
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const S_HARNESS = `aaa.bbb.${'h'.repeat(70)}`
const S_STRANGER = `aaa.bbb.${'x'.repeat(70)}`

// ---- 0. the model, asked of the database ---------------------------------------------
const kind = async (who: string | null) =>
  String((await one(`select app.principal_kind(${who === null ? 'null' : lit(who)}) as k`)).k)
check('the owner is a person', (await kind('grant')) === 'person', await kind('grant'))
check(
  'the test member is a harness principal',
  (await kind('verify-operator')) === 'harness',
  await kind('verify-operator'),
)
check(
  'a harness NAME is a harness principal whatever row lists it (the restrictive reading wins)',
  (await kind('verify-echo')) === 'harness',
  await kind('verify-echo'),
)
for (const who of [null, '', '  ', 'mallory', 'GRANT', '5550001111']) {
  check(`"${who ?? 'null'}" is unknown`, (await kind(who)) === 'unknown', await kind(who))
}
const project = async (label: string, fixture: boolean): Promise<string> => {
  const name = fixture ? `fixture-principals-${label}-${run}` : `Principals ${label} ${run}`
  return String(
    json(
      (
        await one(
          `select app.hq_create_project(${lit(name)}, 'upload', ${lit(`principals-${label}-${run}`)}, ${lit(name)}, true) as v`,
        )
      ).v,
    ).project_id,
  )
}
const realProject = await project('real', false)
const fixtureProject = await project('fixture', true)
const isFixture = async (p: string) =>
  (await one(`select is_fixture as f from public.projects where project_id = ${lit(p)}::uuid`)).f
check(
  'the fixtures are what they claim (a real project and a fixture project)',
  (await isFixture(realProject)) === false && (await isFixture(fixtureProject)) === true,
  `${String(await isFixture(realProject))}/${String(await isFixture(fixtureProject))}`,
)
const refusal = async (by: string, job: string | null, proj: string | null) =>
  (
    await one(
      `select app.authority_refusal(${lit(by)}, ${job === null ? 'null' : `${lit(job)}::uuid`}, ${proj === null ? 'null' : `${lit(proj)}::uuid`}) as r`,
    )
  ).r
check(
  'a harness principal is refused with no context, and on a real project',
  (await refusal('verify-operator', null, null)) !== null &&
    (await refusal('verify-operator', null, realProject)) !== null,
  'no permission without proof',
)
check(
  'a harness principal is allowed on a fixture project',
  (await refusal('verify-operator', null, fixtureProject)) === null,
  String(await refusal('verify-operator', null, fixtureProject)),
)
check(
  'a person is allowed everywhere',
  (await refusal('grant', null, null)) === null &&
    (await refusal('grant', null, realProject)) === null,
  'grant',
)

// ---- fixtures for a question ---------------------------------------------------------
const questionOn = async (job: string) =>
  String(
    (
      await one(
        `select app.request_generation_approval(${lit(job)}::uuid, 'notebook.generate', ${lit(`a deck ${run}`)}, 'proof') as id`,
      )
    ).id,
  )
const harnessJob = async (p: string): Promise<string> =>
  String(
    (
      await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values ('office.instruction', ${lit(`verify:principals-${run}`)}, ${lit(p)}::uuid, 'pr-' || gen_random_uuid(), gen_random_uuid())
        returning job_id::text as id`)
    ).id,
  )
const realQ = async () => {
  const job = await realParent(db)
  return { job, id: await questionOn(job) }
}
const harnessQ = async () => {
  const job = await harnessJob(fixtureProject)
  return { job, id: await questionOn(job) }
}
const stateOf = async (id: string) =>
  String(
    (await one(`select state::text as s from public.blockers where blocker_id = ${lit(id)}::uuid`))
      .s,
  )
const answeredBy = async (id: string) =>
  String(
    (
      await one(
        `select coalesce(answered_by, '(nobody)') as b from public.blockers where blocker_id = ${lit(id)}::uuid`,
      )
    ).b,
  )

// ---- 1. the real gateway ---------------------------------------------------------------
const env = {
  HQ_API_TOKEN: TOKEN,
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
}
const authUsers = {
  [S_GRANT]: GRANT_EMAIL,
  [S_HARNESS]: HARNESS_EMAIL,
  [S_STRANGER]: 'not.a.member@example.com',
}
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })
const act = async (bearer: string, action: string, args: Record<string, unknown>) => {
  const r = await gw.call(
    new Request('https://gw.invalid/functions/v1/hq-api', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const ZERO = '00000000-0000-0000-0000-000000000000'

// 1a. the key, on every action that decides, speaks, reaches or connects
const DECIDERS: [string, Record<string, unknown>][] = [
  ['answer_blocker', { p_blocker_id: ZERO, p_answer: 'Go ahead' }],
  ['withdraw_refusal', { p_blocker_id: ZERO }],
  ['task_state', { p_task_id: ZERO, p_state: 'done' }],
  ['approve_tool', { p_request_id: ZERO }],
  ['decline_tool', { p_request_id: ZERO }],
  ['revoke_tool', { p_slug: 'chief-of-staff', p_tool: 'db.read' }],
  ['grant_standing', { p_tool: 'notion.write', p_reason: 'proof' }],
  ['revoke_standing', { p_authorization: ZERO }],
  ['autonomy_set', { p_level: 'act', p_project_id: realProject }],
  ['staff_tool_set', { p_slug: 'chief-of-staff', p_tool: 'db.read', p_granted: false }],
  ['document_approve', { p_document: ZERO }],
  ['document_discard', { p_document: ZERO }],
  ['output_decide', { p_output: ZERO, p_decision: 'approve' }],
  ['proposal_decide', { p_proposal: ZERO, p_decision: 'approve' }],
  ['suggestion_decide', { p_suggestion: ZERO, p_decision: 'accept' }],
  ['say', { p_project_id: realProject, p_text: 'do a thing' }],
  ['send_to_agent', { p_kind: 'document', p_id: ZERO, p_action: 'summarise' }],
  ['undo', { p_action_id: ZERO }],
  ['staff_hire', { p_name: 'Nobody' }],
  ['set_google_secret', { p_secret: 'x' }],
  ['set_slack_credentials', { p_bot_token: 'x' }],
  ['disconnect', { p_service: 'notion' }],
  ['register_connector', { p_name: 'x', p_endpoint: 'https://example.com' }],
  ['project_instruction', { p_slug: 'x', p_instruction: 'x' }],
  ['automation_create', { p_project: realProject }],
  ['document_upload', { p_project_id: realProject, p_name: 'x', p_base64: 'eA==' }],
]
const before = {
  autonomy: Number((await one(`select count(*)::int as c from public.autonomy_settings`)).c),
  msgs: Number(
    (
      await one(
        `select count(*)::int as c from public.inbound_commands where origin_channel = 'teamhq'`,
      )
    ).c,
  ),
}
for (const [action, args] of DECIDERS) {
  const r = await act(TOKEN, action, { ...args, p_by: 'grant' })
  check(
    `the office key cannot ${action}, even naming itself grant`,
    r.status === 403 && r.body.error === 'person_required',
    `http ${String(r.status)} ${String(r.body.error ?? '')}`,
  )
}
check(
  'and none of those left a trace: no autonomy row, no dashboard message',
  Number((await one(`select count(*)::int as c from public.autonomy_settings`)).c) ===
    before.autonomy &&
    Number(
      (
        await one(
          `select count(*)::int as c from public.inbound_commands where origin_channel = 'teamhq'`,
        )
      ).c,
    ) === before.msgs,
  'state unchanged',
)
{
  const q = await realQ()
  const r = await act(TOKEN, 'answer_blocker', {
    p_blocker_id: q.id,
    p_answer: 'Go ahead',
    p_by: 'grant',
  })
  check(
    'a REAL question stays open when the key tries to answer it as grant',
    r.status === 403 && (await stateOf(q.id)) === 'open',
    `http ${String(r.status)} ${await stateOf(q.id)}`,
  )
}
// its positive control: the key still does what a machine may
{
  const r = await act(TOKEN, 'project_seen', {})
  check(
    'the office key still reaches what a machine may (the gate is not a wall)',
    r.status !== 403 && r.status !== 401,
    `http ${String(r.status)} ${JSON.stringify(r.body).slice(0, 80)}`,
  )
}

// 1b. a person, a test member, a stranger
{
  const q = await realQ()
  const r = await act(S_GRANT, 'answer_blocker', {
    p_blocker_id: q.id,
    p_answer: 'Go ahead',
    p_by: 'mallory',
  })
  check(
    "Grant's own session answers a real question, recorded as him whatever the page sent",
    r.status === 200 &&
      (await stateOf(q.id)) === 'resolved' &&
      (await answeredBy(q.id)) === 'grant',
    `http ${String(r.status)} by ${await answeredBy(q.id)}`,
  )
}
{
  const q = await realQ()
  const r = await act(S_HARNESS, 'answer_blocker', { p_blocker_id: q.id, p_answer: 'Go ahead' })
  check(
    'a TEST member cannot answer a REAL question, and says why',
    (await stateOf(q.id)) === 'open' && /test principal/i.test(JSON.stringify(r.body)),
    `http ${String(r.status)} ${JSON.stringify(r.body).slice(0, 120)}`,
  )
}
{
  const q = await harnessQ()
  const r = await act(S_HARNESS, 'answer_blocker', {
    p_blocker_id: q.id,
    p_answer: 'Go ahead',
    p_by: 'grant',
  })
  check(
    'a TEST member answers a test question, recorded as itself and never as grant',
    r.status === 200 &&
      (await stateOf(q.id)) === 'resolved' &&
      (await answeredBy(q.id)) === 'verify-operator',
    `http ${String(r.status)} by ${await answeredBy(q.id)}`,
  )
}
{
  const q = await harnessQ()
  const r = await act(S_STRANGER, 'answer_blocker', { p_blocker_id: q.id, p_answer: 'Go ahead' })
  check(
    'a valid session that is not a member is refused before anything is answered',
    r.status === 401 && (await stateOf(q.id)) === 'open',
    `http ${String(r.status)}`,
  )
}
{
  const r = await act(S_GRANT, 'autonomy_set', {
    p_level: 'act_with_review',
    p_project_id: realProject,
  })
  const row = await one(
    `select level::text as l, set_by from public.autonomy_settings where project_id = ${lit(realProject)}::uuid order by set_at desc limit 1`,
  )
  check(
    'autonomy: a person sets it, recorded as them',
    r.status === 200 && row?.l === 'act_with_review' && row?.set_by === 'grant',
    `http ${String(r.status)} ${JSON.stringify(row)}`,
  )
  const n = Number(
    (
      await one(
        `select count(*)::int as c from public.autonomy_settings where project_id = ${lit(realProject)}::uuid`,
      )
    ).c,
  )
  const h = await act(S_HARNESS, 'autonomy_set', { p_level: 'act', p_project_id: realProject })
  check(
    'autonomy: a test member cannot change a REAL project',
    Number(
      (
        await one(
          `select count(*)::int as c from public.autonomy_settings where project_id = ${lit(realProject)}::uuid`,
        )
      ).c,
    ) === n && /test principal/i.test(JSON.stringify(h.body)),
    JSON.stringify(h.body).slice(0, 100),
  )
  const f = await act(S_HARNESS, 'autonomy_set', {
    p_level: 'observe',
    p_project_id: fixtureProject,
  })
  const frow = await one(
    `select level::text as l, set_by from public.autonomy_settings where project_id = ${lit(fixtureProject)}::uuid order by set_at desc limit 1`,
  )
  check(
    'autonomy: a test member can change a FIXTURE project, recorded as itself',
    f.status === 200 && frow?.l === 'observe' && frow?.set_by === 'verify-operator',
    JSON.stringify(frow),
  )
}
{
  const r = await act(S_HARNESS, 'staff_tool_set', {
    p_slug: 'chief-of-staff',
    p_tool: 'db.read',
    p_granted: false,
  })
  const still = Number(
    (
      await one(
        `select count(*)::int as c from public.staff_tools where staff_slug = 'chief-of-staff' and tool = 'db.read'`,
      )
    ).c,
  )
  check(
    "a test member cannot change a REAL specialist's grants",
    still === 1 && /test principal/i.test(JSON.stringify(r.body)),
    `held ${String(still)} ${JSON.stringify(r.body).slice(0, 90)}`,
  )
}
{
  const d = json(
    (await one(`select public.discard_document(${lit(ZERO)}::uuid, 'x', 'verify-operator') as r`))
      .r,
  )
  const u = json(
    (await one(`select public.discard_document(${lit(ZERO)}::uuid, 'x', null) as r`)).r,
  )
  check(
    'discarding a document: a test principal and nobody are both refused before the row is read',
    /test principal/i.test(String(d.error)) && /who is answering/i.test(String(u.error)),
    `${String(d.error)} | ${String(u.error)}`,
  )
}

// 1c. saying something
{
  const say = async (bearer: string, by?: string) => {
    const r = await act(bearer, 'say', {
      p_project_id: realProject,
      p_text: `hello ${run} ${bearer.slice(4, 6)}`,
      ...(by ? { p_by: by } : {}),
    })
    return r
  }
  const g = await say(S_GRANT, 'mallory')
  const gRow = await one(
    `select actor, origin_channel from public.inbound_commands where instruction = ${lit(`hello ${run} ${S_GRANT.slice(4, 6)}`)} order by received_at desc limit 1`,
  )
  check(
    "Grant's session says something as grant",
    g.status === 200 && gRow?.actor === 'grant',
    JSON.stringify(gRow),
  )
  const h = await say(S_HARNESS)
  const hRow = await one(
    `select c.actor, j.requested_by, j.is_fixture from public.inbound_commands c left join public.jobs j on j.job_id = c.job_id
      where c.instruction = ${lit(`hello ${run} ${S_HARNESS.slice(4, 6)}`)} order by c.received_at desc limit 1`,
  )
  check(
    'a test member says something as ITSELF, so the job is harness traffic by its own name',
    h.status === 200 && hRow?.actor === 'verify-operator' && hRow?.is_fixture === true,
    JSON.stringify(hRow),
  )
}

// ---- 2. the sign-in function: the key mints a session for a TEST member only ---------------
const signin = await startEdge({
  db,
  edgeFile: 'supabase/functions/signin/index.ts',
  env,
  authUsers,
})
const link = async (bearer: string, email: string) => {
  const r = await signin.call(
    new Request('https://gw.invalid/functions/v1/signin', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Origin: 'https://page.invalid',
      },
      body: JSON.stringify({ action: 'link_for_operator', email }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
{
  const minted = signin.linksMinted.length
  const g = await link(TOKEN, GRANT_EMAIL)
  check(
    "the office key cannot mint a session for Grant's own address, and never asks the identity service",
    g.status === 403 &&
      /test member/.test(String(g.body.error)) &&
      signin.linksMinted.length === minted,
    `http ${String(g.status)} ${String(g.body.error ?? '')}; minted ${String(signin.linksMinted.length - minted)}`,
  )
  const h = await link(TOKEN, HARNESS_EMAIL)
  check(
    'the office key can mint one for the TEST member (the suites keep a signed-in way in)',
    h.status === 200 &&
      typeof h.body.action_link === 'string' &&
      signin.linksMinted.includes(HARNESS_EMAIL),
    `http ${String(h.status)}`,
  )
  const n = await link(TOKEN, 'not.a.member@example.com')
  check(
    'and not for a stranger',
    n.status === 403 && /not somebody the office works for/.test(String(n.body.error)),
    `http ${String(n.status)} ${String(n.body.error)}`,
  )
  const w = await link('wrong-key', HARNESS_EMAIL)
  check(
    'and not without the key',
    w.status === 401 && signin.linksMinted.filter((e) => e === HARNESS_EMAIL).length === 1,
    `http ${String(w.status)}`,
  )
}

// ---- 3. the voice door: the key is not a voice --------------------------------------------
const voice = await startEdge({ db, edgeFile: 'supabase/functions/voice/index.ts', env, authUsers })
const turn = async (bearer: string, session: string, said: string) => {
  const r = await voice.call(
    new Request('https://gw.invalid/functions/v1/voice/turn', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ said, session, turn: 1 }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const rowFor = async (said: string) =>
  await one(
    `select actor from public.inbound_commands where origin_channel = 'voice' and instruction = ${lit(said)} order by received_at desc limit 1`,
  )
{
  const said1 = `voice key real-looking ${run}`
  const a = await turn(TOKEN, `page${run}abc`, said1)
  check(
    'the office key cannot speak under a real-looking session, and nothing is stored',
    a.status === 403 && (await rowFor(said1)) === undefined,
    `http ${String(a.status)}`,
  )
  const said2 = `voice key test session ${run}`
  const b = await turn(TOKEN, `verify-principals-${run}`, said2)
  check(
    'the key can speak in a declared TEST session, and only as a test speaker',
    b.status === 200 && (await rowFor(said2))?.actor === 'verify-service',
    `http ${String(b.status)} ${JSON.stringify(await rowFor(said2))}`,
  )
  const said3 = `voice grant ${run}`
  const c = await turn(S_GRANT, `page${run}def`, said3)
  check(
    "Grant's session speaks as him",
    c.status === 200 && (await rowFor(said3))?.actor === 'grant',
    `http ${String(c.status)}`,
  )
  const said4 = `voice harness ${run}`
  const d = await turn(S_HARNESS, `page${run}ghi`, said4)
  check(
    'a test member speaks as itself, never as him',
    d.status === 200 && (await rowFor(said4))?.actor === 'verify-operator',
    `http ${String(d.status)} ${JSON.stringify(await rowFor(said4))}`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
