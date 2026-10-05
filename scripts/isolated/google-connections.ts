/**
 * HQ-GOOG-003 - a Google credential is one CONNECTION of an office (migration 1000), driven on a marked LOCAL replica
 * inside one transaction that is rolled back.
 *
 *   npx tsx scripts/isolated/google-connections.ts [replica-db]
 *
 * Proves: the backfill makes one active connection from a credential that already exists, is idempotent and inserts
 * nothing when there is none; the existing read path returns the SAME credential before and after; at most one active
 * connection per office, refused in words naming the rule and, with the trigger removed, still refused by the index;
 * a revoked connection then a new one works; reconnecting the same account reactivates its row; signing out marks the
 * connection revoked; another office neither sees nor resolves it; the table is closed to every API role.
 * Nothing here spends a model call or touches the network, and no secret value is printed.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_goog2')
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
/** Run a statement that must be refused; returns the message, or null when it was NOT refused. */
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

const HOME = String((await q('select app.google_home_office()::text o'))[0]?.o)
const OTHER = String((await q('select app.test_office()::text o'))[0]?.o)
const SYSTEM_READ = `app.deployment_credential(app.deployment_reader_office(), 'google.refresh_token', null, null, true)`
const run = Math.random().toString(36).slice(2, 8)
const secret = (name: string, value: string): Promise<Row[]> =>
  q(`select vault.create_secret(${lit(value)}, ${lit(name)}, 'google-connections proof')`)
const conns = async (office: string): Promise<Row[]> =>
  q(`select state, account_ref, secret_name, scopes from public.integration_connections
      where office_id = ${lit(office)}::uuid and provider = 'google' order by created_at, account_ref`)

// The backfill statement, taken from the migration itself so the proof cannot drift from what ships.
const migration = readFileSync(
  new URL(
    '../../migrations/1000_a_google_credential_is_one_connection_of_an_office.sql',
    import.meta.url,
  ),
  'utf8',
)
const start = migration.indexOf(
  'insert into public.integration_connections (office_id, provider, account_ref, state, scopes, secret_name)\nselect',
)
const end = migration.indexOf('on conflict do nothing;', start)
check('the backfill statement was found in the migration', start > 0 && end > start)
const BACKFILL = migration.slice(start, end + 'on conflict do nothing'.length)

await q('begin')
try {
  check(
    'the proof starts with no Google connection and no Google secret',
    (await conns(HOME)).length === 0,
  )
  check('the home office and the other office differ', HOME !== OTHER && HOME !== 'null')

  // backfill on none inserts nothing
  await q(BACKFILL)
  check(
    'backfill with no credential inserts nothing',
    (await conns(HOME)).length === 0 && (await conns(OTHER)).length === 0,
  )

  // THE EXISTING PATH BEFORE: a credential held under the legacy name, no connection row at all
  await secret('google.refresh_token', `rt-home-${run}`)
  check(
    'before: a legacy credential with no connection row resolves exactly as it did',
    (await q(`select ${SYSTEM_READ} v`))[0]?.v === `rt-home-${run}`,
  )
  check(
    'before: the vault name is the legacy one',
    (await q(`select app.google_vault_name(${lit(HOME)}::uuid, 'google.refresh_token') n`))[0]
      ?.n === 'google.refresh_token',
  )
  await q(
    `insert into public.system_config (key, value, description) values ('google.granted_scopes', to_jsonb('scope.a scope.b'::text), 'proof')
       on conflict (key) do update set value = excluded.value`,
  )
  await secret(`google.refresh_token.${OTHER}`, `rt-other-${run}`)

  // BACKFILL on rows
  await q(BACKFILL)
  const home = await conns(HOME)
  check(
    'backfill: the home office has one ACTIVE connection naming the existing secret',
    home.length === 1 &&
      home[0]?.state === 'active' &&
      home[0]?.secret_name === 'google.refresh_token',
    JSON.stringify(home.map((r) => [r.state, r.secret_name])),
  )
  check(
    'backfill: the scopes Google granted were carried over',
    JSON.stringify(home[0]?.scopes) === JSON.stringify(['scope.a', 'scope.b']),
  )
  const other = await conns(OTHER)
  check(
    'backfill: the other office got its own connection, naming its own suffixed secret',
    other.length === 1 && other[0]?.secret_name === `google.refresh_token.${OTHER}`,
  )
  await q(BACKFILL)
  check(
    'backfill is idempotent',
    (await conns(HOME)).length === 1 && (await conns(OTHER)).length === 1,
  )

  // THE EXISTING PATH AFTER: same credential, now through the resolver
  check(
    'after: the same call returns the same credential',
    (await q(`select ${SYSTEM_READ} v`))[0]?.v === `rt-home-${run}`,
  )
  check(
    'after: the resolver is what picks the name',
    (await q(`select app.active_connection_secret(${lit(HOME)}::uuid, 'google') n`))[0]?.n ===
      (await q(`select app.google_vault_name(${lit(HOME)}::uuid, 'google.refresh_token') n`))[0]?.n,
  )
  check(
    'the parked (revoking) name is untouched by the resolver',
    (
      await q(`select app.google_vault_name(${lit(HOME)}::uuid, 'google.revoking_refresh_token') n`)
    )[0]?.n === 'google.revoking_refresh_token',
  )

  // TENANT ISOLATION
  check(
    'isolation: each office resolves only its own connection',
    (await q(`select app.active_connection_secret(${lit(OTHER)}::uuid, 'google') n`))[0]?.n ===
      `google.refresh_token.${OTHER}` &&
      (await q(`select app.active_connection_secret(${lit(HOME)}::uuid, 'google') n`))[0]?.n ===
        'google.refresh_token',
  )
  check(
    'isolation: no office resolves a connection through another office or through nobody',
    (await q(`select app.active_connection_secret(null, 'google') n`))[0]?.n === null &&
      (await q(`select count(*)::int n from app.active_connection(gen_random_uuid(), 'google')`))[0]
        ?.n === 0,
  )
  check(
    'isolation: another provider does not resolve a Google connection',
    (await q(`select count(*)::int n from app.active_connection(${lit(HOME)}::uuid, 'notion')`))[0]
      ?.n === 0,
  )
  check(
    'the table is closed to every API role, with row security on',
    (
      await q(`select bool_or(has_table_privilege(r, 'public.integration_connections', 'select,insert,update,delete')) any_priv,
                      (select relrowsecurity from pg_class where oid = 'public.integration_connections'::regclass) rls
                 from unnest(array['anon','authenticated','service_role']) r`)
    )[0]?.any_priv === false &&
      (
        await q(
          `select relrowsecurity r from pg_class where oid = 'public.integration_connections'::regclass`,
        )
      )[0]?.r === true,
  )
  const wo = await refused(
    `update public.integration_connections set office_id = ${lit(OTHER)}::uuid where office_id = ${lit(HOME)}::uuid`,
  )
  check('office_id is write-once', wo !== null && /write-once/.test(wo), wo ?? 'NOT REFUSED')

  // ONE ACTIVE PER OFFICE
  const second = `insert into public.integration_connections (office_id, provider, account_ref, secret_name)
                  values (${lit(HOME)}::uuid, 'google', 'second-${run}', 'google.refresh_token.second-${run}')`
  const r1 = await refused(second)
  check(
    'a second ACTIVE connection is refused, in words that name the rule',
    r1 !== null &&
      /at most one active google connection/.test(r1) &&
      /revoke the current one/.test(r1),
    r1 ?? 'NOT REFUSED',
  )
  await q('savepoint nowords')
  await q('drop trigger b1_one_active_connection on public.integration_connections')
  const r2 = await refused(second)
  check(
    'with the trigger gone the partial unique index still refuses it',
    r2 !== null && /integration_connections_one_active_per_provider/.test(r2),
    r2 ?? 'NOT REFUSED',
  )
  await q('rollback to savepoint nowords')
  const r3 = await refused(
    `update public.integration_connections set state = 'active' where office_id = ${lit(OTHER)}::uuid`,
  )
  check('re-activating something already active is not a second one', r3 === null)
  check(
    'both offices can hold one active connection each',
    (
      await q(`select count(*)::int n from public.integration_connections where state = 'active'`)
    )[0]?.n === 2,
  )

  // REVOKE, THEN ANOTHER ACCOUNT
  await q(
    `update public.integration_connections set state = 'revoked', revoked_at = now() where office_id = ${lit(HOME)}::uuid and state = 'active'`,
  )
  check(
    'revoked: nothing is active for the office and the resolver returns nothing for it',
    (await q(`select app.active_connection_secret(${lit(HOME)}::uuid, 'google') n`))[0]?.n === null,
  )
  check(
    'revoked: the other office is untouched',
    (await q(`select app.active_connection_secret(${lit(OTHER)}::uuid, 'google') n`))[0]?.n ===
      `google.refresh_token.${OTHER}`,
  )
  await secret(`google.refresh_token.second-${run}`, `rt-second-${run}`)
  const ok = await refused(second)
  check(
    'a new connection (another account) is accepted once the old one is revoked',
    ok === null,
    ok ?? '',
  )
  check(
    "the resolver now names the new account's credential and the read returns it",
    (await q(`select app.google_vault_name(${lit(HOME)}::uuid, 'google.refresh_token') n`))[0]
      ?.n === `google.refresh_token.second-${run}` &&
      (await q(`select ${SYSTEM_READ} v`))[0]?.v === `rt-second-${run}`,
  )
  check(
    'the revoked history is kept beside it',
    (await conns(HOME)).map((r) => r.state).join() === 'revoked,active',
  )

  // RECONNECT of the original account through the real store function
  await q(
    `update public.integration_connections set state = 'revoked', revoked_at = now() where office_id = ${lit(HOME)}::uuid and state = 'active'`,
  )
  const stored = (
    await q(
      `select app.hq_store_google_refresh(${lit(HOME)}::uuid, ${lit(`rt-new-${run}`)}, 'x.one x.two') r`,
    )
  )[0]?.r as Row
  check(
    'store: reconnecting through the real function succeeds',
    stored?.stored === true,
    JSON.stringify(stored),
  )
  const after = await conns(HOME)
  check(
    'store: it reactivated its own row (no duplicate) and recorded the granted scopes',
    after.length === 2 &&
      after.filter((r) => r.state === 'active').length === 1 &&
      after.find((r) => r.state === 'active')?.account_ref === 'primary' &&
      JSON.stringify(after.find((r) => r.state === 'active')?.scopes) ===
        JSON.stringify(['x.one', 'x.two']),
  )
  check(
    'store: the credential read back is the new one, under the legacy name',
    (await q(`select ${SYSTEM_READ} v`))[0]?.v === `rt-new-${run}`,
  )
  const guard = (await q(`select app.hq_store_google_refresh(${lit(OTHER)}::uuid, 'x', 'y') r`))[0]
    ?.r as Row
  check(
    'store: the 0800 one-office guard still refuses another office',
    typeof guard?.error === 'string',
  )

  // SIGN OUT
  const begun = (await q(`select app.google_revoke_begin(${lit(HOME)}::uuid) r`))[0]?.r as Row
  check('sign-out: the revoke begins and parks the token', begun?.parked === true)
  check(
    'sign-out: the connection is revoked and nothing resolves',
    (await conns(HOME)).every((r) => r.state === 'revoked') &&
      (await q(`select ${SYSTEM_READ} v`))[0]?.v === null,
  )
  await q(`select app.google_revoke_finish(${lit(HOME)}::uuid, true, '')`)
  check(
    'sign-out: finishing is idempotent over the connection',
    (await conns(HOME)).every((r) => r.state === 'revoked'),
  )
  check(
    'sign-out: the other office was not signed out',
    (await conns(OTHER)).every((r) => r.state === 'active'),
  )
} finally {
  await q('rollback')
  const left = (
    await q(`select (select count(*) from public.integration_connections)::int c,
                                (select count(*) from vault.secrets where name like 'google%')::int s`)
  )[0]
  check(
    'rolled back: nothing from this run remains',
    left?.c === 0 && left?.s === 0,
    JSON.stringify(left),
  )
  await db.end()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
