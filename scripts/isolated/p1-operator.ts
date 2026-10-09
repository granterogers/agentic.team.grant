/**
 * Multi-user P1.3 (#400): deployment-wide actions need the OPERATOR, not merely "a person".
 *
 *   npx tsx scripts/isolated/p1-operator.ts <replica-db>
 *
 * The REAL hq-api runs against the replica with a SECOND signed-in person, a harness member, the machine
 * key and a stranger. Every operator-only action is tried by each; the operator (Grant) is the positive
 * control, and a per-office action by the second person shows the gate is not a wall. SABOTAGE: remove the
 * enforcement block in hq-api (or add the harness to deployment_operators with the function's person join
 * removed) and the named groups go red - see docs/multi-user/P1-CLOSURE.md.
 */
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const TOKEN = 'isolated-hq-token'
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const S_SECOND = `aaa.bbb.${'s'.repeat(70)}`
const S_HARNESS = `aaa.bbb.${'h'.repeat(70)}`
const S_STRANGER = `aaa.bbb.${'x'.repeat(70)}`
// One per run: an office is retired, never deleted (0654), so a fixed identity could be provisioned once per database.
const RUN = Date.now().toString(36)
const SECOND_EMAIL = `p1-second-person-${RUN}@example.com`
const SECOND_KEY = `p1-second-person-${RUN}`

// The second person exists for this run only, and is removed in the finally block below.
const grantRow = (
  await db.execute(`select email from public.office_members where owner_key = 'grant'`)
).rows[0] as { email: string } | undefined
const harnessRow = (
  await db.execute(`select email from public.office_members where owner_key = 'verify-operator'`)
).rows[0] as { email: string } | undefined
if (grantRow === undefined || harnessRow === undefined) throw new Error('replica has no members')

// A second PERSON is a login, a member row and an office, which the product creates together through
// app.provision_person_office (0863). The first version of this fixture inserted only the member row: the gateway then
// resolves the session's office from the AUTH USER ID (0654/P3), found no login and no office, and answered 503
// "could not check who you are" to everything the second person did - the fixture was not a person any more.
await db.execute(
  `insert into auth.users (id, email) select gen_random_uuid(), ${lit(SECOND_EMAIL)}
    where not exists (select 1 from auth.users u where lower(u.email) = ${lit(SECOND_EMAIL)})`,
)
await db.execute(
  `select app.provision_person_office('p1-operator second person', ${lit(SECOND_EMAIL)}, ${lit(SECOND_KEY)})`,
)

// The operator list is a fact the DATABASE holds; assert the starting point before attacking it.
const operatorNow = async (key: string) =>
  (await db.execute(`select public.deployment_operator(${lit(key)}) as o`)).rows[0]?.o === true

let exit = 1
try {
  const secondRow = await db.execute(
    `select owner_key from public.office_members where email = ${lit(SECOND_EMAIL)}`,
  )
  check(
    "the second person exists for this run under their own key (not another suite's leftover)",
    (secondRow.rows[0] as { owner_key?: string } | undefined)?.owner_key === SECOND_KEY,
    JSON.stringify(secondRow.rows[0] ?? null),
  )
  check('Grant is an operator', await operatorNow('grant'), 'seeded from the existing person')
  check('the second person is not', !(await operatorNow(SECOND_KEY)), SECOND_KEY)
  check('a harness member is not', !(await operatorNow('verify-operator')), 'verify-operator')

  const gw = await startEdge({
    db,
    edgeFile: 'supabase/functions/hq-api/index.ts',
    env: {
      HQ_API_TOKEN: TOKEN,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'isolated-anon',
      SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
    },
    authUsers: {
      [S_GRANT]: grantRow.email,
      [S_SECOND]: SECOND_EMAIL,
      [S_HARNESS]: harnessRow.email,
      [S_STRANGER]: 'not.a.member@example.com',
    },
  })
  const act = async (bearer: string, action: string, args: Record<string, unknown> = {}) => {
    const r = await gw.call(
      new Request('https://gw.invalid/functions/v1/hq-api', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, args }),
      }),
    )
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const read = async (bearer: string, section: string) => {
    const r = await gw.call(
      new Request(`https://gw.invalid/functions/v1/hq-api?section=${section}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    )
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }

  // The same list the gateway holds, read from its source so this cannot drift from it.
  const { readFileSync } = await import('node:fs')
  const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
  const setBody = source.slice(
    source.indexOf('const OPERATOR_ONLY'),
    source.indexOf('const operators = new Map'),
  )
  const OPERATOR_ONLY = [...setBody.matchAll(/^ {2}'([a-z_]+)',?$/gm)].map((m) => m[1] as string)
  check(
    'the operator-only set was read from the gateway',
    OPERATOR_ONLY.length >= 15,
    `${String(OPERATOR_ONLY.length)} actions`,
  )

  const refusedOperator = (r: { status: number; body: Record<string, unknown> }) =>
    r.status === 403 && r.body.error === 'operator_required'
  const refusedAnyway = (r: { status: number; body: Record<string, unknown> }) =>
    r.status === 403 && (r.body.error === 'operator_required' || r.body.error === 'person_required')

  // 1. every operator action: the second person, the harness member, the machine key, a stranger
  let second = 0
  let harness = 0
  let machine = 0
  let stranger = 0
  let operatorPasses = 0
  const leaked: string[] = []
  for (const action of OPERATOR_ONLY) {
    const s = await act(S_SECOND, action, { p_by: 'grant' })
    if (refusedOperator(s)) second += 1
    else leaked.push(`second:${action}:${String(s.status)}`)
    const h = await act(S_HARNESS, action, { p_by: 'grant' })
    if (refusedAnyway(h)) harness += 1
    else leaked.push(`harness:${action}:${String(h.status)}`)
    const m = await act(TOKEN, action, { p_by: 'grant' })
    if (m.status === 403 && m.body.error === 'person_required') machine += 1
    else leaked.push(`machine:${action}:${String(m.status)}`)
    const x = await act(S_STRANGER, action)
    // A verified login that is nobody's member is told 'no_office' (403, can_create) since self-service accounts (P4):
    // still a refusal that runs nothing, just a kinder one than 401. Anything else is a leak.
    if (x.status === 401 || (x.status === 403 && x.body.error === 'no_office')) stranger += 1
    else leaked.push(`stranger:${action}:${String(x.status)}`)
    // The operator passes the gate: anything but 403 means the request reached argument validation or beyond.
    const o = await act(S_GRANT, action, {})
    if (o.status !== 403 && o.status !== 401) operatorPasses += 1
    else leaked.push(`operator-refused:${action}:${String(o.status)}`)
  }
  const n = OPERATOR_ONLY.length
  check(
    `a second signed-in PERSON is refused all ${String(n)} operator actions`,
    second === n,
    `${String(second)}/${String(n)}`,
  )
  check('a harness member is refused all of them', harness === n, `${String(harness)}/${String(n)}`)
  check(
    'the machine key is refused all of them (it is not a person)',
    machine === n,
    `${String(machine)}/${String(n)}`,
  )
  check(
    'a stranger is refused all of them (401, or 403 no_office for a confirmed login with no office)',
    stranger === n,
    `${String(stranger)}/${String(n)}`,
  )
  check(
    "POSITIVE CONTROL: the operator reaches all of them (Grant's admin path is preserved)",
    operatorPasses === n,
    `${String(operatorPasses)}/${String(n)}`,
  )
  if (leaked.length > 0) console.log(`      unexpected: ${leaked.slice(0, 8).join(', ')}`)

  // 2. the gate is not a wall: the second person still does their OWN office's work
  const own = await act(S_SECOND, 'my_task_add', {})
  check(
    'the second person reaches a per-office action (argument validation, not the operator gate)',
    own.status === 400,
    `http ${String(own.status)} ${String(own.body.error ?? '')}`,
  )

  // 3. a planted operator row cannot make a harness member an operator
  await db.execute(
    `insert into public.deployment_operators (owner_key, note) values ('verify-operator', 'p1 proof') on conflict do nothing`,
  )
  try {
    check(
      'a harness member in deployment_operators is still not an operator (kind is checked)',
      !(await operatorNow('verify-operator')),
      'person join',
    )
    // An action that is STILL operator-only. (This probed approve_tool, which P3 moved out of OPERATOR_ONLY: a request
    // for reach is answered in ONE office by that office's own person, so the operator gate never applied to it and
    // the gateway rightly let it through to the database.)
    const via = await act(S_HARNESS, 'set_setting', {})
    check(
      'and the gateway still refuses it',
      refusedAnyway(via),
      `http ${String(via.status)} ${String(via.body.error ?? '')}`,
    )
    // approve_tool is office-scoped now, so what protects it is the database: a harness member cannot approve reach.
    const approve = await act(S_HARNESS, 'approve_tool', {
      p_request_id: '00000000-0000-0000-0000-000000000000',
    })
    check(
      'a harness member cannot approve reach either (refused by the gateway or by the database, never approved)',
      refusedAnyway(approve) ||
        (approve.body.approved !== true &&
          typeof (approve.body.result as { error?: unknown } | undefined)?.error === 'string'),
      `http ${String(approve.status)} ${JSON.stringify(approve.body).slice(0, 110)}`,
    )
  } finally {
    await db.execute(`delete from public.deployment_operators where owner_key = 'verify-operator'`)
  }

  // 4. the Drive browse (a GET section) is the operator's too
  const dSecond = await read(S_SECOND, 'drive')
  const dHarness = await read(S_HARNESS, 'drive')
  const dMachine = await read(TOKEN, 'drive')
  const dGrant = await read(S_GRANT, 'drive')
  check(
    'Drive browse: second person refused',
    refusedOperator(dSecond),
    `http ${String(dSecond.status)}`,
  )
  check(
    'Drive browse: harness member refused',
    refusedOperator(dHarness),
    `http ${String(dHarness.status)}`,
  )
  check(
    'Drive browse: the machine key refused',
    refusedOperator(dMachine),
    `http ${String(dMachine.status)}`,
  )
  check(
    'Drive browse: POSITIVE CONTROL - the operator is not refused (Google is simply not connected here)',
    dGrant.status !== 403 && dGrant.status !== 401,
    `http ${String(dGrant.status)}`,
  )

  // 4b. no member is Grant by default (0652): the one-line insert for a second human must not make them the first
  const tryInsert = async (sql: string) => {
    try {
      await db.execute(sql)
      return 'inserted'
    } catch (e) {
      return String((e as Error).message)
    }
  }
  const noKey = await tryInsert(
    `insert into public.office_members (email, note) values ('nokey.${SECOND_KEY}@example.com', 'p1 proof')`,
  )
  check(
    'a member added WITHOUT an owner key is refused (it used to become grant)',
    noKey.includes('owner_key') && noKey.includes('null value'),
    noKey.slice(0, 90),
  )
  const reserved = await tryInsert(
    `insert into public.office_members (email, note, owner_key) values ('reserved.${SECOND_KEY}@example.com', 'p1 proof', 'chief-of-staff')`,
  )
  check(
    'a PERSON may not take a reserved name',
    reserved.includes('office_members_person_key_not_reserved'),
    reserved.slice(0, 90),
  )
  const harnessName = await tryInsert(
    `insert into public.office_members (email, note, owner_key) values ('hn.${SECOND_KEY}@example.com', 'p1 proof', 'verify-sam')`,
  )
  check(
    'nor a harness-shaped name (the office would read them as a test principal)',
    harnessName.includes('office_members_person_key_not_reserved'),
    harnessName.slice(0, 90),
  )
  const shape = await tryInsert(
    `insert into public.office_members (email, note, owner_key) values ('sh.${SECOND_KEY}@example.com', 'p1 proof', 'telegram:grant')`,
  )
  check(
    'a key with a colon is refused (it would add a field to requested_by)',
    shape.includes('office_members_owner_key_shape'),
    shape.slice(0, 90),
  )
  const dup = await tryInsert(
    `insert into public.office_members (email, note, owner_key) values ('dup.${SECOND_KEY}@example.com', 'p1 proof', 'grant')`,
  )
  check(
    'two people cannot share a key (a second "grant" is refused)',
    dup.includes('office_members_one_person_per_key'),
    dup.slice(0, 90),
  )
  const okRow = await tryInsert(
    `insert into public.office_members (email, note, owner_key) values ('ok.${SECOND_KEY}@example.com', 'p1 proof', ${lit(`${SECOND_KEY}-b`)})`,
  )
  check(
    'POSITIVE CONTROL: a member with their own key is added',
    okRow === 'inserted',
    okRow.slice(0, 90),
  )
  await db.execute(`delete from public.office_members where email = 'ok.${SECOND_KEY}@example.com'`)

  // 5. becoming an operator is a row, and only a row
  await db.execute(
    `insert into public.deployment_operators (owner_key, note) values (${lit(SECOND_KEY)}, 'p1 proof')`,
  )
  const promoted = await act(S_SECOND, 'set_setting', {})
  check(
    'a person added to deployment_operators passes the gate (and only then)',
    promoted.status === 400,
    `http ${String(promoted.status)} ${String(promoted.body.error ?? '')}`,
  )
} finally {
  await db.execute(`delete from public.deployment_operators where owner_key = ${lit(SECOND_KEY)}`)
  await db.execute(`delete from public.office_members where owner_key = ${lit(SECOND_KEY)}`)
  // The office provisioned above is RETIRED, the way the product retires one (offices are never deleted, 0654).
  try {
    await db.execute(
      `update public.offices set state = 'disabled', disabled_at = now() where auth_user_id in (select id from auth.users where lower(email) = ${lit(SECOND_EMAIL)})`,
    )
  } catch (e) {
    console.log(
      `      retiring the second office was refused: ${String((e as Error).message).slice(0, 140)}`,
    )
  }
  const left = Number(
    (
      await db.execute(
        `select count(*)::int as n from public.office_members where owner_key = ${lit(SECOND_KEY)}`,
      )
    ).rows[0]?.n,
  )
  check('teardown left nothing behind', left === 0, `${String(left)} row(s)`)
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
  exit = failed === 0 ? 0 : 1
  await db.end()
}
process.exitCode = exit
