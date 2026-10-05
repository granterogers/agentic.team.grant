/**
 * Vikunja connection health (0981) - the SQL driven on a LOCAL replica, in one rolled-back transaction.
 *
 *   npx tsx scripts/isolated/vikunja-health.ts <replica-db>      (default: cand_svc2)
 *
 * Real: app.vikunja_health_record / _clear / vikunja_health, app.task_sync_panel (the `health` key),
 * app.chores_for_credentials (the existing chore pass that reads connection_health), app.hq_set_vikunja and
 * app.hq_forget_vikunja. Refuses any database that is not a marked replica on a Unix socket. No network.
 */
import { recordVikunjaHealth } from '../../src/tasks/health.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_svc2')
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
interface Reading {
  state?: string
  kind?: string | null
  detail?: string
  last_ok_at?: string | null
}
interface Json {
  health?: Reading | null
  configured?: boolean
  ok?: boolean
  [k: string]: unknown
}
const J = (x: unknown): Json => (typeof x === 'string' ? JSON.parse(x) : (x ?? {})) as Json

await db.execute('begin')
try {
  const O = String((await one(`select app.operator_office()::text o`)).o)
  const rec = (ok: boolean, kind: string | null, detail: string | null) =>
    recordVikunjaHealth(
      db,
      O,
      ok
        ? { ok: true }
        : { ok: false, kind: kind as 'unreachable' | 'refused' | 'failed', detail: detail ?? '' },
    )
  const panel = async () => J((await one(`select app.task_sync_panel(${lit(O)}::uuid) as p`)).p)
  const row = async () =>
    (
      await db.execute(
        `select state, detail, action, fault_kind, last_ok_at, checked_at from public.connection_health where office_id = ${lit(O)}::uuid and service = 'Vikunja' and credential = 'API token'`,
      )
    ).rows[0] as Record<string, unknown> | undefined
  const chore = async (): Promise<string | undefined> =>
    (
      (
        await db.execute(
          `select state from public.tasks where office_id = ${lit(O)}::uuid and chore_key = 'credential:vikunja:api token'`,
        )
      ).rows[0] as { state?: string } | undefined
    )?.state

  check(
    'before any round the panel has no health to report (null, not "ok")',
    (await panel()).health === null || (await panel()).health === undefined,
  )

  check(
    'a healthy round records ok',
    (await rec(true, null, null)) === null && (await row())?.state === 'ok',
  )
  const okAt = (await row())?.last_ok_at
  check('...with the time it was last in step', okAt !== null && okAt !== undefined)
  const p1 = (await panel()).health
  check(
    'the panel reports ok with that time',
    p1?.state === 'ok' && p1?.last_ok_at !== null,
    JSON.stringify(p1),
  )

  // an outage
  // a transaction freezes now(), so give the last good time a distinct past value to prove it is KEPT
  await db.execute(
    `update public.connection_health set last_ok_at = '2026-01-02T03:04:05Z' where office_id = ${lit(O)}::uuid and service = 'Vikunja'`,
  )
  check('an outage is recorded', (await rec(false, 'unreachable', 'http 503')) === null)
  const r2 = await row()
  check(
    '...as dead, kind unreachable, with the reason, NO action, and the last good time kept',
    r2?.state === 'dead' &&
      r2?.fault_kind === 'unreachable' &&
      r2?.detail === 'http 503' &&
      r2?.action === '' &&
      new Date(String(r2?.last_ok_at)).toISOString().startsWith('2026-01-02T03:04:05'),
    JSON.stringify(r2),
  )
  const p2 = (await panel()).health
  check(
    'the panel says it is down, why, and when it was last in step',
    p2?.state === 'down' &&
      p2?.kind === 'unreachable' &&
      p2?.detail === 'http 503' &&
      String(p2?.last_ok_at).startsWith('2026-01-02'),
    JSON.stringify(p2),
  )
  await db.execute(`select app.chores_for_credentials()`)
  check('an outage nobody can act on raises NO reconnect chore', (await chore()) === undefined)

  // a refused token
  await rec(false, 'refused', 'the token was refused (http 401)')
  const r3 = await row()
  check(
    'a refused token is dead/refused WITH an action saying where the new token goes',
    r3?.fault_kind === 'refused' && /new token/.test(String(r3?.action)),
    JSON.stringify(r3),
  )
  await db.execute(`select app.chores_for_credentials()`)
  check(
    '...and the existing credential pass raises the reconnect chore',
    (await chore()) === 'todo',
  )
  await db.execute(`select app.chores_for_credentials()`)
  check(
    '...once, not once a pass',
    Number(
      (
        await one(
          `select count(*)::int n from public.tasks where office_id = ${lit(O)}::uuid and chore_key = 'credential:vikunja:api token'`,
        )
      ).n,
    ) === 1,
  )

  // recovery
  await rec(true, null, null)
  const r4 = await row()
  check(
    'a healthy round after it is ok again, the fault kind cleared',
    r4?.state === 'ok' && r4?.fault_kind === null,
  )
  check(
    '...the chore is finished by the recording itself (no waiting for the next pass)',
    (await chore()) === 'done',
  )
  check('the panel is ok again', (await panel()).health?.state === 'ok')

  // a refused token followed by an outage: nothing left for a person to do
  await rec(false, 'refused', 'the token was refused (http 403)')
  await db.execute(`select app.chores_for_credentials()`)
  await rec(false, 'unreachable', 'timed out')
  check(
    'refused then unreachable: the chore is finished (the server is not answering at all)',
    (await chore()) === 'done',
  )

  // a failure that kills the round
  await rec(false, 'failed', 'Vikunja refused the round: http 404')
  check(
    'a round the server refused is dead/failed with its own action',
    (await row())?.fault_kind === 'failed' && /project number/.test(String((await row())?.action)),
  )

  // containment
  const bad = await rec(false, 'refused', `the token was refused ${'xoxb-' + '1234567890-abcdef'}`)
  check(
    'a credential-shaped sentence is never stored (withheld, not raised)',
    bad === null &&
      !/xox/.test(String((await row())?.detail)) &&
      /withheld/.test(String((await row())?.detail)),
    String((await row())?.detail),
  )
  const kind = await rec(false, 'banana', 'x')
  check(
    'an unknown kind is refused saying so, and changes nothing',
    kind !== null && /not a kind of Vikunja failure/.test(String(kind)),
    String(kind),
  )
  const longOne = await rec(false, 'unreachable', 'z'.repeat(900))
  check(
    'a very long reason is cut, not refused',
    longOne === null && String((await row())?.detail).length <= 200,
  )

  // clear on disconnect / reconnect
  await rec(false, 'refused', 'the token was refused (http 401)')
  await db.execute(`select app.chores_for_credentials()`)
  const forgot = J((await one(`select app.hq_forget_vikunja(${lit(O)}::uuid) as r`)).r)
  check('hq_forget_vikunja ran', forgot.ok === true, JSON.stringify(forgot).slice(0, 120))
  check(
    'disconnecting removes the health row and finishes the reconnect chore',
    (await row()) === undefined && (await chore()) === 'done',
  )
  await rec(false, 'refused', 'the token was refused (http 401)')
  const set = J(
    (
      await one(
        `select app.hq_set_vikunja(${lit(O)}::uuid, 'https://tasks.example.test', 7, ${lit(`tk_${'a'.repeat(32)}`)}, null) as r`,
      )
    ).r,
  )
  check('hq_set_vikunja ran', set.ok === true, JSON.stringify(set).slice(0, 160))
  check(
    'connecting anew starts from a clean reading (the stale dead row is gone)',
    (await row()) === undefined,
  )
  const p5 = await panel()
  check(
    'the panel for a fresh connection carries no health until a round has run',
    p5.configured === true && (p5.health === null || p5.health === undefined),
  )
} finally {
  await db.execute('rollback')
  await db.end()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
