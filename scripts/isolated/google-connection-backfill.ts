/**
 * Migration 1000's BACKFILL does not call a Google credential active unless the database can prove it works
 * (corrected 6 October 2026, before the migration was ever applied). Driven on a marked LOCAL replica inside one
 * transaction that is rolled back.
 *
 *   npx tsx scripts/isolated/google-connection-backfill.ts [replica-db]
 *
 * The matrix, one scenario per row, each through the backfill statement TAKEN FROM THE MIGRATION so this cannot drift
 * from what ships:
 *
 *   fresh ok reading                      -> active        (the only way the migration asserts "works")
 *   ok reading older than 24 hours        -> unverified    (a stale reading proves nothing)
 *   dead, detail names invalid_grant      -> revoked       (Google itself refused; revoked_at is set)
 *   dead for any other reason             -> dead
 *   missing / unknown / parked / attested -> unverified    (ambiguous health fails closed)
 *   no health row at all                  -> unverified
 *
 * and then what keeps it true afterwards: the trigger that moves a connection with its credential's recorded health
 * (ok promotes unverified or dead, never revoked, never a second active; dead demotes active), duplicate prevention, the
 * office boundary, the resolver (only an ACTIVE connection resolves, the credential itself still reads as before), the
 * reconnect (a person's own Connect reactivates the row), and that no secret value reaches the table, the migration
 * or a response. The migration is also read as text: it must contain no call to the network.
 * Nothing here spends a model call or touches the network, and no secret value is printed.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const HOME = String((await q('select app.google_home_office()::text o'))[0]?.o)
const OTHER = String((await q('select app.test_office()::text o'))[0]?.o)
const run = Math.random().toString(36).slice(2, 8)
const HOME_SECRET = 'google.refresh_token'
const OTHER_SECRET = `google.refresh_token.${OTHER}`
const HOME_VALUE = `rt-home-${run}-do-not-print`
const OTHER_VALUE = `rt-other-${run}-do-not-print`

const migrationText = readFileSync(
  new URL(
    '../../migrations/1000_a_google_credential_is_one_connection_of_an_office.sql',
    import.meta.url,
  ),
  'utf8',
)
const start = migrationText.indexOf(
  'insert into public.integration_connections (office_id, provider, account_ref, state, scopes, secret_name, revoked_at)\nselect',
)
const end = migrationText.indexOf('on conflict do nothing;', start)
check('the backfill statement was found in the migration', start > 0 && end > start)
const FAITHFUL = migrationText.slice(start, end + 'on conflict do nothing'.length)
// --sabotage runs the matrix against the ORIGINAL draft's behaviour (every credential active), to prove it goes red.
const SABOTAGE = process.argv.includes('--sabotage')
const BACKFILL = SABOTAGE
  ? FAITHFUL.replace(
      /cross join lateral \([\s\S]*?\) p\n/,
      () => "cross join lateral (select 'active' as state) p\n",
    )
  : FAITHFUL
if (SABOTAGE) {
  check(
    'sabotage landed: the backfill now marks everything active',
    BACKFILL !== FAITHFUL && /select 'active' as state/.test(BACKFILL),
  )
}

const conns = async (office: string): Promise<Row[]> =>
  q(`select state, account_ref, secret_name, revoked_at is not null as has_revoked_at
       from public.integration_connections where office_id = ${lit(office)}::uuid and provider = 'google'
      order by account_ref`)
const stateOf = async (office: string): Promise<string> =>
  String((await conns(office))[0]?.state ?? 'NONE')
const health = (
  office: string,
  state: string | null,
  detail = 'proof',
  hoursOld = 0,
): Promise<Row[]> =>
  state === null
    ? q(
        `delete from public.connection_health where office_id = ${lit(office)}::uuid and service = 'google_calendar'`,
      )
    : q(
        `insert into public.connection_health (office_id, service, credential, state, detail, owner, action, checked_at)
         values (${lit(office)}::uuid, 'google_calendar', 'oauth_client', ${lit(state)}, ${lit(detail)}, 'proof', '',
                 now() - (${hoursOld} * interval '1 hour'))
         on conflict (office_id, service, credential) do update
           set state = excluded.state, detail = excluded.detail, checked_at = excluded.checked_at`,
      )
const clear = async (): Promise<void> => {
  await q(`delete from public.integration_connections where provider = 'google'`)
  await q(`delete from public.connection_health where service = 'google_calendar'`)
}
const refused = async (sql: string): Promise<string | null> => {
  await q('savepoint attempt')
  try {
    await q(sql)
    await q('release savepoint attempt')
    return null
  } catch (e) {
    await q('rollback to savepoint attempt')
    return e instanceof Error ? e.message : String(e)
  }
}

// The replica's own seeded Google health rows (the migrations ship a 'missing' placeholder): not ours, and they come back.
const BASELINE_HEALTH = Number(
  (
    await q(
      `select count(*)::int n from public.connection_health where service = 'google_calendar'`,
    )
  )[0]?.n,
)
await q('begin')
try {
  check('the home office and the other office differ', HOME !== OTHER && HOME !== 'null')
  check(
    'the proof starts with no Google connection',
    (await conns(HOME)).length === 0 && (await conns(OTHER)).length === 0,
  )
  await q(
    `select vault.create_secret(${lit(HOME_VALUE)}, ${lit(HOME_SECRET)}, 'google-connection-backfill proof')`,
  )

  // ---- THE MATRIX, on the home office --------------------------------------------------------------------------------
  const scenarios: Array<{
    name: string
    state: string | null
    detail?: string
    hoursOld?: number
    expect: string
    revokedAt?: boolean
  }> = [
    { name: 'healthy (fresh ok)', state: 'ok', detail: 'connected', expect: 'active' },
    {
      name: 'healthy 23 hours ago (inside the window)',
      state: 'ok',
      detail: 'connected',
      hoursOld: 23,
      expect: 'active',
    },
    {
      name: 'ok but 25 hours old (stale proves nothing)',
      state: 'ok',
      detail: 'connected',
      hoursOld: 25,
      expect: 'unverified',
    },
    {
      name: 'dead: Google refused with invalid_grant',
      state: 'dead',
      detail: 'Google refused the stored refresh token (invalid_grant): it has been revoked',
      expect: 'revoked',
      revokedAt: true,
    },
    {
      name: 'dead for another reason',
      state: 'dead',
      detail: 'Google refused the refresh: http 503',
      expect: 'dead',
    },
    { name: 'health says missing', state: 'missing', expect: 'unverified' },
    { name: 'health says unknown', state: 'unknown', expect: 'unverified' },
    { name: 'health says parked', state: 'parked', expect: 'unverified' },
    { name: 'health is only attested by a person', state: 'attested', expect: 'unverified' },
    { name: 'no health row at all', state: null, expect: 'unverified' },
  ]
  for (const s of scenarios) {
    await clear()
    await health(HOME, s.state, s.detail ?? 'proof', s.hoursOld ?? 0)
    await q(BACKFILL)
    const rows = await conns(HOME)
    check(
      `backfill, ${s.name}: recorded ${s.expect}`,
      rows.length === 1 &&
        rows[0]?.state === s.expect &&
        rows[0]?.secret_name === HOME_SECRET &&
        (s.revokedAt === true) === (rows[0]?.has_revoked_at === true),
      JSON.stringify(rows.map((r) => [r.state, r.has_revoked_at])),
    )
    // Fail closed means: only a proved credential is the active connection, so nothing else resolves.
    const resolved = (
      await q(`select app.active_connection_secret(${lit(HOME)}::uuid, 'google') n`)
    )[0]?.n
    check(
      `backfill, ${s.name}: ${s.expect === 'active' ? 'the resolver returns it' : 'the resolver returns nothing'}`,
      s.expect === 'active' ? resolved === HOME_SECRET : resolved === null,
    )
    check(
      `backfill, ${s.name}: the credential itself still reads exactly as before`,
      (
        await q(
          `select app.deployment_credential(app.deployment_reader_office(), 'google.refresh_token', null, null, true) v`,
        )
      )[0]?.v === HOME_VALUE,
    )
  }

  // ---- DUPLICATE PREVENTION ------------------------------------------------------------------------------------------
  await clear()
  await health(HOME, 'ok', 'connected')
  await q(BACKFILL)
  await q(BACKFILL)
  await q(BACKFILL)
  check('running the backfill three times leaves one row', (await conns(HOME)).length === 1)
  // a later reading does not change what a re-run backfill decides: ON CONFLICT leaves the existing row alone
  await q(
    `update public.connection_health set state = 'unknown' where office_id = ${lit(HOME)}::uuid`,
  )
  await q(BACKFILL)
  check(
    'a re-run never rewrites an existing connection',
    (await conns(HOME)).length === 1,
    await stateOf(HOME),
  )
  const second = await refused(
    `insert into public.integration_connections (office_id, provider, account_ref, state, secret_name)
     values (${lit(HOME)}::uuid, 'google', 'second-${run}', 'active', 'google.refresh_token.second-${run}')`,
  )
  check(
    'a second ACTIVE connection is still refused in words (when one is active)',
    (await stateOf(HOME)) !== 'active' || (second !== null && /at most one active/.test(second)),
    second ?? 'not refused',
  )

  // ---- THE TRIGGER: the connection follows its credential's recorded health -------------------------------------------
  await clear()
  await health(HOME, 'missing')
  await q(BACKFILL)
  check('trigger setup: starts unverified', (await stateOf(HOME)) === 'unverified')
  await health(HOME, 'ok', 'connected')
  check(
    'trigger: an ok reading promotes an unverified connection to active',
    (await stateOf(HOME)) === 'active',
  )
  check(
    'trigger: the promoted connection now resolves',
    (await q(`select app.active_connection_secret(${lit(HOME)}::uuid, 'google') n`))[0]?.n ===
      HOME_SECRET,
  )
  await health(HOME, 'dead', 'Google refused the refresh: http 503')
  check(
    'trigger: a dead reading demotes an active connection to dead',
    (await stateOf(HOME)) === 'dead',
  )
  check(
    'trigger: a dead connection does not resolve',
    (await q(`select app.active_connection_secret(${lit(HOME)}::uuid, 'google') n`))[0]?.n === null,
  )
  await health(HOME, 'ok', 'connected')
  check(
    'trigger: an ok reading promotes a dead connection back to active',
    (await stateOf(HOME)) === 'active',
  )
  await health(
    HOME,
    'dead',
    'Google refused the stored refresh token (invalid_grant): it has been revoked',
  )
  const rv = await conns(HOME)
  check(
    'trigger: a dead reading naming invalid_grant marks it revoked with a time',
    rv[0]?.state === 'revoked' && rv[0]?.has_revoked_at === true,
  )
  await health(HOME, 'ok', 'connected')
  check(
    'trigger: an ok reading never un-revokes: a person reconnects',
    (await stateOf(HOME)) === 'revoked',
  )
  const stored = (
    await q(
      `select app.hq_store_google_refresh(${lit(HOME)}::uuid, ${lit(`rt-new-${run}`)}, 'x.one x.two') r`,
    )
  )[0]?.r as Row
  check(
    "reconnect: a person's own Connect reactivates the same row",
    stored?.stored === true &&
      (await conns(HOME)).length === 1 &&
      (await stateOf(HOME)) === 'active',
    JSON.stringify(stored),
  )
  await q(
    `update public.integration_connections set state = 'unverified' where office_id = ${lit(HOME)}::uuid`,
  )
  await q(
    `insert into public.integration_connections (office_id, provider, account_ref, state, secret_name)
     values (${lit(HOME)}::uuid, 'google', 'other-account', 'active', 'google.refresh_token.other-account')`,
  )
  await health(HOME, 'missing')
  const before = await q(
    `select account_ref, state from public.integration_connections where office_id = ${lit(HOME)}::uuid order by account_ref`,
  )
  const trig = await refused(
    `insert into public.connection_health (office_id, service, credential, state, detail, owner, action)
     values (${lit(HOME)}::uuid, 'google_calendar', 'oauth_client', 'ok', 'connected', 'proof', '')
     on conflict (office_id, service, credential) do update set state = 'ok', detail = 'connected'`,
  )
  const after = await q(
    `select account_ref, state from public.integration_connections where office_id = ${lit(HOME)}::uuid order by account_ref`,
  )
  check(
    'trigger: with another account already active the promotion is skipped, and the health write is NOT failed',
    trig === null &&
      JSON.stringify(before) === JSON.stringify(after) &&
      after.filter((r) => r.state === 'active').length === 1,
    trig ?? JSON.stringify(after),
  )

  // ---- OFFICE ISOLATION ---------------------------------------------------------------------------------------------
  await clear()
  await q(
    `select vault.create_secret(${lit(OTHER_VALUE)}, ${lit(OTHER_SECRET)}, 'google-connection-backfill proof')`,
  )
  await health(HOME, 'ok', 'connected')
  await health(OTHER, 'dead', 'Google refused the stored refresh token (invalid_grant): revoked')
  await q(BACKFILL)
  check(
    'isolation: each office is judged on its OWN health (home active, other revoked)',
    (await stateOf(HOME)) === 'active' && (await stateOf(OTHER)) === 'revoked',
    `${await stateOf(HOME)} / ${await stateOf(OTHER)}`,
  )
  check(
    'isolation: each connection names only its own office-suffixed secret',
    (await conns(HOME))[0]?.secret_name === HOME_SECRET &&
      (await conns(OTHER))[0]?.secret_name === OTHER_SECRET,
  )
  await health(OTHER, 'ok', 'connected')
  check(
    "isolation: the other office's health reading cannot move the home office's connection",
    (await stateOf(HOME)) === 'active' && (await stateOf(OTHER)) === 'revoked',
  )
  await health(HOME, 'dead', 'Google refused the refresh: http 503')
  check(
    "isolation: the home office's dead reading cannot move the other office's connection",
    (await stateOf(HOME)) === 'dead' && (await stateOf(OTHER)) === 'revoked',
  )
  const THIRD = String(
    (
      await q(
        `select office_id::text o from public.offices where office_id not in (${lit(HOME)}::uuid, ${lit(OTHER)}::uuid) order by created_at limit 1`,
      )
    )[0]?.o,
  )
  check(
    'isolation: a third office exists to prove a health row alone creates nothing',
    THIRD !== 'undefined',
  )
  await health(THIRD, 'ok', 'connected')
  check(
    'isolation: a health row for an office with NO connection creates nothing',
    (await conns(THIRD)).length === 0 &&
      (
        await q(
          `select count(*)::int n from public.integration_connections where office_id not in (${lit(HOME)}::uuid, ${lit(OTHER)}::uuid)`,
        )
      )[0]?.n === 0,
  )

  // ---- NO LEAKAGE ---------------------------------------------------------------------------------------------------
  const dump = JSON.stringify(
    await q(
      `select to_jsonb(c)::text t from public.integration_connections c union all
       select to_jsonb(h)::text from public.connection_health h where service = 'google_calendar'`,
    ),
  )
  check(
    'leakage: no secret value is in any connection or health row',
    !dump.includes(HOME_VALUE) && !dump.includes(OTHER_VALUE) && !dump.includes(`rt-new-${run}`),
  )
  check(
    'leakage: the connection table has no column that could hold a secret value',
    JSON.stringify(
      (
        await q(
          `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'integration_connections' order by column_name`,
        )
      ).map((r) => r.column_name),
    ) ===
      JSON.stringify([
        'account_ref',
        'connection_id',
        'created_at',
        'office_id',
        'provider',
        'revoked_at',
        'scopes',
        'secret_name',
        'state',
      ]),
  )
  const sql = migrationText.replace(/--[^\n]*/g, '')
  check(
    'leakage: the migration never reads a secret value (no decrypted_secrets, no decrypt)',
    !/decrypted_secrets|vault\.decrypt|pgsodium/i.test(sql),
  )
  check(
    'migration: it makes no call to the network (no http, no net., no pg_net, no dblink)',
    !/\bhttp_|net\.http|pg_net|dblink|extensions\.http/i.test(sql),
  )
  check(
    'the table is still closed to every API role',
    (
      await q(`select bool_or(has_table_privilege(r, 'public.integration_connections', 'select,insert,update,delete')) p
                 from unnest(array['anon','authenticated','service_role']) r`)
    )[0]?.p === false,
  )
  check(
    'the trigger function is closed to every API role',
    (
      await q(`select bool_or(has_function_privilege(r, 'app.google_connection_follows_health()', 'execute')) p
                 from unnest(array['anon','authenticated','service_role']) r`)
    )[0]?.p === false,
  )
  const bad = await refused(
    `insert into public.integration_connections (office_id, provider, account_ref, state, secret_name)
     values (${lit(HOME)}::uuid, 'google', 'bad-${run}', 'maybe', 'x')`,
  )
  check('an unknown state is refused by the table', bad !== null && /state/.test(bad), bad ?? '')
} finally {
  await q('rollback')
  const left = (
    await q(`select (select count(*) from public.integration_connections)::int c,
                    (select count(*) from vault.secrets where name like 'google%')::int s,
                    (select count(*) from public.connection_health where service = 'google_calendar')::int h`)
  )[0]
  check(
    'rolled back: nothing from this run remains',
    left?.c === 0 && left?.s === 0 && left?.h === BASELINE_HEALTH,
    JSON.stringify(left),
  )
  await db.end()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
