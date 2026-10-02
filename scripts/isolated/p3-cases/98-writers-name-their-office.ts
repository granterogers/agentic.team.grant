/**
 * What migrations 0859 and 0860 changed: six writers that leaned on the compatibility bridge now name their office, the
 * bridge is gone, and a writer that names no office is refused in every state of the world.
 */
import { type Ctx, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const W = 'p2_worker'
  const run = Math.random().toString(36).slice(2, 8)
  const nobody = c.nobody()
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const one = async (sql: string) => (await q(sql))[0] as Record<string, unknown>

  // -- the bridge is gone, and the refusal is the database's own -----------------------------------------------------
  const bridge = Number(
    (await one(`select count(*)::int as n from pg_trigger where tgname = 'a0_office_bridge'`)).n,
  )
  c.check(bridge === 0, 'no compatibility bridge trigger remains on any table', String(bridge))
  for (const role of ['service_role', W]) {
    const msg = await c.refusal(
      role,
      `insert into public.signals (source, event_type, external_ref) values ('p3', 'x', 'nobody-${run}')`,
    )
    c.check(
      msg.includes('23502') || msg.includes('null value') || msg.includes('office_id'),
      `a writer that names no office is refused for ${role}, not given to anyone`,
      msg.slice(0, 120),
    )
  }
  const old = await c.try_(W, `select app.record_signal('p3', 'x', 'old-${run}')`)
  c.check(
    !old.ok,
    'the office-less shape of record_signal no longer exists',
    old.ok ? 'ACCEPTED' : old.error.slice(0, 100),
  )

  // -- signals: the same reference in two offices is two facts, not one oracle ------------------------------------------
  const sig = (office: string) =>
    `select app.record_signal(${lit(office)}::uuid, 'p3-${run}', 'thing.happened', 'shared-ref-${run}', null, 'summary', '{}'::jsonb)`
  const sa = (await c.exec(W, sig(A))) as { duplicate?: boolean; signal?: string }
  const sb = (await c.exec(W, sig(B))) as { duplicate?: boolean; signal?: string }
  const sa2 = (await c.exec(W, sig(A))) as { duplicate?: boolean; signal?: string }
  c.check(
    sa.duplicate === false &&
      sb.duplicate === false &&
      sa2.duplicate === true &&
      sa2.signal === sa.signal &&
      sa.signal !== sb.signal,
    'record_signal: B recording the same reference as A makes its own signal (no cross-office existence signal), and A recording it twice is one',
    c.json([sa, sb, sa2]),
  )
  const owners = await q(
    `select office_id::text as o from public.signals where source = 'p3-${run}' order by office_id`,
  )
  c.check(
    owners.length === 2 && owners.some((r) => r.o === A) && owners.some((r) => r.o === B),
    'each signal is filed under the office that recorded it',
    c.json(owners),
  )

  // -- connection health: one office's probe never overwrites another's -------------------------------------------------
  const rows = (state: string) =>
    lit(
      JSON.stringify([
        {
          service: `p3-svc-${run}`,
          credential: 'token',
          state,
          detail: state,
          owner: 'x',
          action: '',
        },
      ]),
    )
  await c.exec(W, `select app.record_connection_health(${lit(A)}::uuid, ${rows('ok')}::jsonb)`)
  await c.exec(W, `select app.record_connection_health(${lit(B)}::uuid, ${rows('dead')}::jsonb)`)
  const health = await q(
    `select office_id::text as o, state from public.connection_health where service = 'p3-svc-${run}'`,
  )
  c.check(
    health.length === 1 && health[0]?.o === A && health[0]?.state === 'ok',
    "record_connection_health: B's probe of a service A already holds does not overwrite A's reading",
    c.json(health),
  )

  // -- a delivery that must not go: a foreign key and a missing one answer alike -------------------------------------------
  const key = `p3:suppress:${run}`
  const first = await c.exec(
    W,
    `select app.suppress_delivery(${lit(A)}::uuid, ${lit(key)}, 'undo arrived first', 'slack', 'T0ABCDEF1', 'C0ABCDEF1')`,
  )
  const foreign = await c.exec(
    W,
    `select app.suppress_delivery(${lit(B)}::uuid, ${lit(key)}, 'undo arrived first', 'slack', 'T0ABCDEF1', 'C0ABCDEF1')`,
  )
  const missing = await c.exec(
    W,
    `select app.suppress_delivery(${lit(B)}::uuid, ${lit(`${key}:none`)}, 'undo arrived first', 'slack', 'T0ABCDEF1', 'C0ABCDEF1')`,
  )
  const unknown = await c.exec(
    W,
    `select app.suppress_delivery(${lit(B)}::uuid, ${lit(key)}, 'undo arrived first')`,
  )
  const unknownMissing = await c.exec(
    W,
    `select app.suppress_delivery(${lit(B)}::uuid, ${lit(`${key}:none2`)}, 'undo arrived first')`,
  )
  const held = await q(
    `select office_id::text as o, state from public.deliveries where dedupe_key = ${lit(key)}`,
  )
  c.check(
    first === 'tombstoned' &&
      foreign === missing &&
      unknown === unknownMissing &&
      held.length === 1 &&
      held[0]?.o === A,
    "suppress_delivery: B asking about A's key gets the answer it would for a key nobody holds, and A's row is untouched",
    c.json([first, foreign, missing, unknown, unknownMissing, held]),
  )

  // -- withdrawing a lesson: another office's lesson is "no such lesson" -------------------------------------------------
  const made = (await c.exec(
    W,
    `select app.learn(${lit(A)}::uuid, 'global'::public.lesson_scope, ${lit(`Writers name their office (${run}), and a lesson is withdrawn in its own office only.`)}, 'verify:p3', null, null, null, null, 0.90)`,
  )) as { lesson_id?: string }
  const id = String(made.lesson_id ?? nobody)
  const reason = 'withdrawn by the attack suite because it is no longer true of anything'
  const foreignAsk = (await c.exec(
    W,
    `select app.unlearn(${lit(B)}::uuid, ${lit(id)}::uuid, 'verify:p3', ${lit(reason)})`,
  )) as { error?: string }
  const missingAsk = (await c.exec(
    W,
    `select app.unlearn(${lit(B)}::uuid, ${lit(nobody)}::uuid, 'verify:p3', ${lit(reason)})`,
  )) as { error?: string }
  const stillLive = await q(
    `select count(*)::int as n from public.lessons_live where lesson_id = ${lit(id)}::uuid`,
  )
  c.check(
    c.json(foreignAsk) === c.json(missingAsk) && Number(stillLive[0]?.n) === 1,
    "unlearn: B withdrawing A's lesson is answered exactly as for a lesson that does not exist, and A's lesson is still live",
    c.json([foreignAsk, missingAsk, stillLive]),
  )
  const own = (await c.exec(
    W,
    `select app.unlearn(${lit(A)}::uuid, ${lit(id)}::uuid, 'verify:p3', ${lit(reason)})`,
  )) as { retracted?: string }
  const retraction = await q(
    `select office_id::text as o from public.lessons where supersedes = ${lit(id)}::uuid`,
  )
  c.check(
    own.retracted === id && retraction.length === 1 && retraction[0]?.o === A,
    'unlearn: A can withdraw its own lesson, and the retraction is filed in A',
    c.json([own, retraction]),
  )

  // -- slack history: an unmapped channel is refused the same way for every office --------------------------------------
  const hist = (office: string, channel: string) =>
    `select app.record_slack_history(${lit(office)}::uuid, ${lit(channel)}, '1699999999.000100', 'U0', 'hello')`
  const ha = (await c.exec(W, hist(A, `C0NONE${run}`))) as { ok?: boolean; error?: string }
  const hb = (await c.exec(W, hist(B, `C0NONE${run}`))) as { ok?: boolean; error?: string }
  c.check(
    ha.ok === false && c.json(ha) === c.json(hb),
    'record_slack_history: a channel that maps to no project in this office is refused identically for every office',
    c.json([ha, hb]),
  )

  // -- the checks that used to be able to read a stale clean ---------------------------------------------------------------
  const meter = Number(
    (await one(`select coalesce(sum(n), 0)::int as n from public.office_bridge_use`)).n ?? 0,
  )
  c.check(
    Number.isFinite(meter),
    'the meter table is kept as evidence of what relied on the bridge',
    String(meter),
  )
}
