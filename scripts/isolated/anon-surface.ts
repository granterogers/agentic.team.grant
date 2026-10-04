/**
 * #384 (0613): a public key reaches no function, and the office still works.
 *
 *   npx tsx scripts/isolated/anon-surface.ts <replica-db>
 *
 * Behavioural, not a reading of the migration: the roles are ASSUMED and the
 * functions are CALLED. Against production's own schema (pre-0613) the first
 * group must go red; that is what makes it evidence.
 */
import { EXPOSURE_SQL, reachableByAPublicKey, readReach } from '../check-anon-exposure.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'anon613')
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

/** Run `sql` as `role` in a transaction that is always rolled back; report the error, if any. */
const asRole = async (role: string, sql: string): Promise<string> => {
  try {
    await db.execute(`begin; set local role ${role}; ${sql}`)
    return ''
  } catch (e) {
    return String((e as Error).message)
  } finally {
    await db.execute('rollback').catch(() => undefined)
  }
}

const fns = readReach((await db.execute(EXPOSURE_SQL)).rows)
check(
  'the inspection saw functions at all',
  fns.length > 200,
  `${String(fns.length)} public functions`,
)

// ---- what a public key can NOT do now -----------------------------------------
const open = fns.filter(reachableByAPublicKey)
check(
  'no public function is reachable by anon, authenticated or PUBLIC',
  open.length === 0,
  open.length === 0
    ? 'none'
    : `${String(open.length)}: ${open
        .slice(0, 4)
        .map((f) => f.name)
        .join(', ')}`,
)
for (const [fn, call] of [
  [
    'deployment_credential',
    `select public.deployment_credential(null::uuid, 'google.client_secret', 'grant')`,
  ],
  ['hq_google_connect_start', `select public.hq_google_connect_start('grant')`],
  ['google_oauth_state_consume', `select public.google_oauth_state_consume('x')`],
  ['vault_inventory', `select * from public.vault_inventory()`],
  ['callback_ack', `select public.callback_ack('1', 'approve')`],
  ['hq_disconnect', `select public.hq_disconnect(app.owner_office('grant'), 'notion')`],
  [
    'hq_revoke_tool',
    `select public.hq_revoke_tool(app.owner_office('grant'), 'chief-of-staff', 'db.read')`,
  ],
  [
    'append_event',
    `select app.append_event(app.test_office(), gen_random_uuid(), 'agent', 'forged', 'probe', 'probe.forged', false)`,
  ],
] as const) {
  for (const role of ['anon', 'authenticated']) {
    const said = await asRole(role, call)
    check(
      `${role} calling ${fn} is refused as a permission failure`,
      // Since 0841 the browser roles have no usage on schema app either, which refuses earlier and harder.
      /permission denied for (function|schema app)/i.test(said),
      said === '' ? 'IT RAN' : said.slice(0, 90),
    )
  }
}

// ---- and what still works -------------------------------------------------------
check(
  'service_role can execute every public function',
  fns.every((f) => f.service),
  `${String(fns.filter((f) => !f.service).length)} it cannot`,
)
/*
  The contract for ai_team_app, from the architecture as it runs (docs/multi-user/ARCHITECTURE.md, decision 6): it is a
  NOLOGIN role with no password that nothing connects as, kept so a row policy has a name and a suite can prove what a
  non-bypass role is refused. The gateway and the worker are service_role and postgres. So it reaches NO public
  function (0895); it was not an old count to preserve, it was 37 grants nobody used, writers of a secret, a setting,
  the roster and a deletion among them. When it becomes a real login its grants are an allow-list with reasons.
*/
const reach = `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and has_function_privilege('ai_team_app', p.oid, 'execute')`
const aiReach = Number((await one(reach)).n)
check('the server role reaches no public function', aiReach === 0, `${String(aiReach)} reachable`)
const aiRole = await one(
  `select r.rolcanlogin as login, r.rolbypassrls as bypass, a.rolpassword is not null as pw from pg_roles r join pg_authid a on a.oid = r.oid where r.rolname = 'ai_team_app'`,
)
check(
  'and it is NOLOGIN, passwordless and does not bypass row security (nothing connects as it)',
  aiRole.login === false && aiRole.bypass === false && aiRole.pw === false,
  JSON.stringify(aiRole),
)
{
  // The detector can fail: grant one door, watch it count, take it back.
  await db.execute(`grant execute on function public.free_tier_headroom() to ai_team_app`)
  const seen = Number((await one(reach)).n)
  await db.execute(`revoke all on function public.free_tier_headroom() from ai_team_app`)
  const back = Number((await one(reach)).n)
  check(
    'SABOTAGE: one grant to the role is counted, and counted out again once revoked',
    seen === 1 && back === 0,
    `granted ${String(seen)}, revoked ${String(back)}`,
  )
}
const asOffice = await asRole('ai_team_app', `select app.now_utc()`)
check('the server role can still call an app function', asOffice === '', asOffice.slice(0, 90))
const asOfficePublic = await asRole('ai_team_app', `select public.free_tier_headroom()`)
check(
  'but a public wrapper is refused to it, for the right reason',
  /permission denied for function/i.test(asOfficePublic),
  asOfficePublic === '' ? 'IT RAN' : asOfficePublic.slice(0, 90),
)
const asService = await asRole('service_role', `select public.free_tier_headroom()`)
check('the service role can call a public wrapper', asService === '', asService.slice(0, 90))

// ---- a function created LATER is born closed, and the control can fail ---------
const trigger = await one(
  `select count(*)::int as n from pg_event_trigger where evtname = 'close_new_public_function'`,
)
const born = async (name: string) => {
  await db.execute(`create function public.${name}() returns int language sql as $$ select 1 $$`)
  const reach = readReach((await db.execute(EXPOSURE_SQL)).rows).find((f) => f.name.includes(name))
  await db.execute(`drop function public.${name}()`)
  return reach
}
const closed = await born('zz_anon_probe_a')
check(
  'a NEW public function is born closed to every public key and open to service_role',
  closed !== undefined && !reachableByAPublicKey(closed) && closed.service,
  closed === undefined ? 'probe not seen' : JSON.stringify(closed),
)
if (Number(trigger.n) === 1) {
  // SABOTAGE, and proof it landed: with the trigger off the same probe must be reported exposed.
  await db.execute(`alter event trigger close_new_public_function disable`)
  const off = await one(
    `select evtenabled::text as e from pg_event_trigger where evtname = 'close_new_public_function'`,
  )
  const exposed = await born('zz_anon_probe_b')
  check(
    'SABOTAGE landed (trigger disabled) and the exposure check goes RED on a new function',
    off.e === 'D' && exposed !== undefined && reachableByAPublicKey(exposed),
    `evtenabled ${String(off.e)}; ${JSON.stringify(exposed)}`,
  )
  await db.execute(`alter event trigger close_new_public_function enable`)
} else {
  check(
    'the event trigger exists (pre-0613 it must not, and this line is red there)',
    false,
    'no trigger',
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
