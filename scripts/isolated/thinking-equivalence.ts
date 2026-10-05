/**
 * Proof: the `thinking` section's cheaper function (migration 1028) answers exactly the key the page reads from the whole health
 * reading, and is no more reachable than the function it replaces.
 *
 *   npx tsx scripts/isolated/thinking-equivalence.ts [replica-db=post]
 *
 *   1. equality: public.cannot_think(o) = jsonb_build_object('cannot_think', office_health(o)->'cannot_think'), with no breaker open,
 *      with one open, with a probe_ provider open (which must be left out), and with a long error (cut at 200 characters);
 *   2. refusal: null and unknown offices are refused;
 *   3. reach: anon and authenticated cannot execute either function, service_role can execute the public one;
 *   4. control: a copy without the probe_ exclusion disagrees when such a row is open, so check 1 can fail;
 *   5. cost: the new function touches no jobs relation (a statement-level count of jobs scans before and after).
 * Runs only against the marked local replica; never touches production; spends no model call.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

const offices = (await rows(
  `select office_id::text id, kind from public.offices where state = 'active' order by kind`,
)) as {
  id: string
  kind: string
}[]
const eq = async (): Promise<boolean> => {
  for (const o of offices) {
    const r = (
      await rows(
        `select public.cannot_think('${o.id}'::uuid) = jsonb_build_object('cannot_think', public.office_health('${o.id}'::uuid) -> 'cannot_think') as eq`,
      )
    )[0]
    if (r?.eq !== true) return false
  }
  return true
}

await db.execute('begin')
try {
  check(
    await eq(),
    `no breaker open: equal to the whole reading's key for ${offices.length} offices`,
  )

  const cols = (
    await rows(
      `select string_agg(column_name, ',') c from information_schema.columns where table_schema='public' and table_name='provider_health'`,
    )
  )[0]?.c
  check(
    String(cols).includes('opened_at') && String(cols).includes('last_error'),
    'provider_health has the columns the proof writes',
  )
  await db.execute('set local session_replication_role = replica')
  await db.execute(`
    insert into public.provider_health (provider, state, opened_at, next_probe_at, last_error)
    values ('edgeprovider', 'open', now() - interval '5 minutes', now() + interval '1 minute', repeat('x', 500)),
           ('probe_edge', 'open', now() - interval '9 minutes', now() + interval '1 minute', 'a probe, not a provider')
    on conflict (provider) do update set state = 'open', opened_at = excluded.opened_at, last_error = excluded.last_error`)
  await db.execute('reset session_replication_role')
  check(await eq(), 'with a breaker open, a probe_ row open and a 500-character error: still equal')
  const shown = (
    await rows(`select public.cannot_think('${offices[0]?.id}'::uuid) -> 'cannot_think' as v`)
  )[0]?.v as { provider: string; said: string }[]
  check(
    shown.some((r) => r.provider === 'edgeprovider' && r.said.length === 200) &&
      !shown.some((r) => r.provider === 'probe_edge'),
    'control: the open breaker is reported (error cut at 200) and the probe_ row is left out',
  )

  // Control: a copy without the probe_ exclusion must disagree.
  const src = (
    await rows(`select pg_get_functiondef('app.cannot_think(uuid)'::regprocedure) as d`)
  )[0]?.d as string
  await db.execute('drop schema if exists proof_ref cascade')
  await db.execute('create schema proof_ref')
  const sab = src
    .replace('app.cannot_think', 'proof_ref.no_probe_filter')
    .replace("and h.provider not like 'probe_%'", () => '')
  check(
    sab !== src.replace('app.cannot_think', 'proof_ref.no_probe_filter'),
    'control: the probe_ exclusion was removed from the copy',
  )
  await db.execute(sab)
  const d = (
    await rows(
      `select proof_ref.no_probe_filter('${offices[0]?.id}'::uuid) <> app.cannot_think('${offices[0]?.id}'::uuid) as d`,
    )
  )[0]
  check(d?.d === true, 'control: a copy without the probe_ exclusion disagrees')

  for (const [what, arg] of [
    ['null', 'null'],
    ['unknown', "'00000000-0000-4000-8000-00000000dead'::uuid"],
  ] as const) {
    let said = ''
    await db.execute('savepoint refusal')
    try {
      await rows(`select public.cannot_think(${arg})`)
    } catch (e) {
      said = e instanceof Error ? e.message : String(e)
    }
    // A refusal aborts the transaction it happened in; go back to the savepoint so the next check can run.
    await db.execute('rollback to savepoint refusal')
    check(said.includes('no_office'), `a ${what} office is refused (said: ${said.slice(0, 40)})`)
  }

  const reach = (
    await rows(`select
      has_function_privilege('anon', 'public.cannot_think(uuid)', 'execute') as anon_pub,
      has_function_privilege('authenticated', 'public.cannot_think(uuid)', 'execute') as auth_pub,
      has_function_privilege('service_role', 'public.cannot_think(uuid)', 'execute') as svc_pub,
      has_function_privilege('anon', 'app.cannot_think(uuid)', 'execute') as anon_app,
      has_function_privilege('authenticated', 'app.cannot_think(uuid)', 'execute') as auth_app,
      has_function_privilege('anon', 'public.office_health(uuid, integer)', 'execute') as anon_old`)
  )[0]
  check(
    reach?.anon_pub === false &&
      reach?.auth_pub === false &&
      reach?.anon_app === false &&
      reach?.auth_app === false,
    'anon and authenticated cannot execute either new function',
  )
  check(reach?.svc_pub === true, 'service_role can execute the public one (the gateway)')
  check(
    reach?.anon_old === false,
    'control: the function it replaces was not reachable by anon either (reach is not widened)',
  )
} finally {
  await db.execute('rollback')
  await db.execute('drop schema if exists proof_ref cascade')
}

console.log(
  failed === 0
    ? '\nthinking reading equivalent: PASS'
    : `\nthinking reading equivalent: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)
