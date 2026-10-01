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
const SECOND_EMAIL = 'second.person@example.com'
const SECOND_KEY = 'p1-second-person'

// The second person exists for this run only, and is removed in the finally block below.
const grantRow = (
  await db.execute(`select email from public.office_members where owner_key = 'grant'`)
).rows[0] as { email: string } | undefined
const harnessRow = (
  await db.execute(`select email from public.office_members where owner_key = 'verify-operator'`)
).rows[0] as { email: string } | undefined
if (grantRow === undefined || harnessRow === undefined) throw new Error('replica has no members')

await db.execute(
  `insert into public.office_members (email, note, owner_key, kind)
   values (${lit(SECOND_EMAIL)}, 'p1-operator proof', ${lit(SECOND_KEY)}, 'person') on conflict do nothing`,
)

// The operator list is a fact the DATABASE holds; assert the starting point before attacking it.
const operatorNow = async (key: string) =>
  (await db.execute(`select public.deployment_operator(${lit(key)}) as o`)).rows[0]?.o === true

let exit = 1
try {
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
    if (x.status === 401) stranger += 1
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
    'a stranger is refused all of them (401)',
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
    const via = await act(S_HARNESS, 'approve_tool', {
      p_request_id: '00000000-0000-0000-0000-000000000000',
    })
    check(
      'and the gateway still refuses it',
      refusedAnyway(via),
      `http ${String(via.status)} ${String(via.body.error ?? '')}`,
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
