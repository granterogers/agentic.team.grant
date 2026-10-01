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
  ['deployment_credential', `select public.deployment_credential('google.client_secret', 'grant')`],
  ['hq_google_connect_start', `select public.hq_google_connect_start('grant')`],
  ['google_oauth_state_consume', `select public.google_oauth_state_consume('x')`],
  ['vault_inventory', `select * from public.vault_inventory()`],
  ['callback_ack', `select public.callback_ack('1', 'approve')`],
  ['hq_disconnect', `select public.hq_disconnect('notion')`],
  ['hq_revoke_tool', `select public.hq_revoke_tool('chief-of-staff', 'db.read')`],
  [
    'append_event',
    `select public.append_event(gen_random_uuid(), 'agent', 'forged', 'probe', 'probe.forged', false)`,
  ],
] as const) {
  for (const role of ['anon', 'authenticated']) {
    const said = await asRole(role, call)
    check(
      `${role} calling ${fn} is refused as a permission failure`,
      /permission denied for function/i.test(said),
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
const ai =
  await one(`select count(*) filter (where has_function_privilege('ai_team_app', p.oid, 'execute'))::int as n,
                             count(*)::int as t
                        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')`)
check(
  'the office role keeps what it had (it reaches every public function it did before)',
  // 197+, not 201: 0614 and 0615 recreated wrappers that only the gateway (service_role) calls.
  Number(ai.n) >= 190,
  `${String(ai.n)} of ${String(ai.t)}`,
)
const asOffice = await asRole('ai_team_app', `select app.now_utc()`)
check('the office role can still call an app function', asOffice === '', asOffice.slice(0, 90))
const asOfficePublic = await asRole('ai_team_app', `select public.free_tier_headroom()`)
check(
  'the office role can still call a public wrapper',
  asOfficePublic === '',
  asOfficePublic.slice(0, 90),
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
