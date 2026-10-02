/**
 * What migration 0841 changed after the five clusters were merged: request_tool takes the office, the open-request key leads
 * with the office, the events nobody authored are filed in the system office, and no function keeps an office-less overload
 * beside its office-first one.
 */
import { type Ctx, lit } from '../p3-app-lib.ts'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const norm = (s: string): string => s.replace(UUID, '<id>')

export async function cases(c: Ctx): Promise<void> {
  const { A, B, SYS } = c
  const W = 'p2_worker'
  const run = Math.random().toString(36).slice(2, 8)
  const nobody = c.nobody()
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const one = async (sql: string) => (await q(sql))[0] as Record<string, unknown>
  const bridge = async () =>
    Number((await one(`select coalesce(sum(n), 0)::int as n from public.office_bridge_use`)).n ?? 0)
  const bridgeBefore = await bridge()

  // a tool that exists and that neither office's specialist holds (a new office holds none)
  const tool = String(
    (
      await one(
        `select tp.tool from public.tool_permissions tp
          where tp.enabled and tp.tool ~ '^[a-z0-9]+(\\.[a-z0-9_]+)+$'
            and not exists (select 1 from public.staff_tools st where st.tool = tp.tool and st.office_id in ('${A}', '${B}'))
          order by tp.tool limit 1`,
      )
    ).tool,
  )
  const who = 'research-director'
  const ask = (office: string, from: string | null = null) =>
    `select app.request_tool(${lit(office)}::uuid, ${lit(tool)}, ${lit(who)}, ${lit(`merge ${run}: needed for the write-up`)}, '{}'::jsonb, ${from === null ? 'null' : `${lit(from)}::uuid`})`

  const gotA = (await c.exec(W, ask(A))) as { request_id?: string }
  const gotB = (await c.exec(W, ask(B))) as { request_id?: string }
  c.check(
    typeof gotA.request_id === 'string' &&
      typeof gotB.request_id === 'string' &&
      gotA.request_id !== gotB.request_id,
    'request_tool: two offices asking for the same tool for the same person each get their own open request (the key leads with the office)',
    c.json([gotA, gotB]),
  )
  const owners = await q(
    `select office_id::text as o from public.tool_requests where request_id in ('${String(gotA.request_id)}', '${String(gotB.request_id)}') order by office_id`,
  )
  c.check(
    owners.length === 2 && owners.some((r) => r.o === A) && owners.some((r) => r.o === B),
    "each request is filed under the office that asked, and B's call did not hand back A's request",
    c.json(owners),
  )
  const snapB = await c.snapshot(B, ['tool_requests', 'events'])
  const again = (await c.exec(W, ask(A))) as { request_id?: string; already_asked?: boolean }
  c.check(
    again.already_asked === true &&
      again.request_id === gotA.request_id &&
      (await c.snapshot(B, ['tool_requests', 'events'])) === snapB,
    "asking again in A answers with A's own open request, and nothing of B's moved",
    c.json(again),
  )
  const ev = await q(
    `select office_id::text as o from public.events where action_type = 'tool.requested' and after_state ->> 'request_id' in ('${String(gotA.request_id)}', '${String(gotB.request_id)}') order by office_id`,
  )
  c.check(
    ev.length === 2 && ev.some((r) => r.o === A) && ev.some((r) => r.o === B),
    'the ledger entry for each request is filed in the office that asked, explicitly',
    c.json(ev),
  )

  // a job of another office reads as no job
  const jobB = String(
    (
      await one(
        `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, office_id)
         values (gen_random_uuid(), 'm98-${run}-b', 'probe', 'verify:m98', '${B}') returning job_id`,
      )
    ).job_id,
  )
  const foreign = norm(c.json(await c.try_(W, ask(A, jobB))))
  const missing = norm(c.json(await c.try_(W, ask(A, nobody))))
  c.check(
    foreign === missing && foreign.includes('no such job'),
    "request_tool: B's job and a job that does not exist give A the same refusal",
    `${foreign} | ${missing}`,
  )
  c.check(
    (await c.refusal(W, ask(nobody))).includes('no_office') &&
      (await c.refusal(W, ask('00000000-0000-0000-0000-000000000000'))).includes('no_office'),
    'request_tool: a nonexistent office is no_office',
    '',
  )
  const sealed = await one(
    `select has_function_privilege('anon', 'app.request_tool(uuid,text,text,text,jsonb,uuid)', 'execute') as a,
            has_function_privilege('authenticated', 'app.request_tool(uuid,text,text,text,jsonb,uuid)', 'execute') as u,
            to_regprocedure('app.request_tool(text,text,text,jsonb,uuid)') is null as old_gone`,
  )
  c.check(
    sealed.a === false && sealed.u === false && sealed.old_gone === true,
    'request_tool: no browser role can execute it, and the office-less form is gone',
    c.json(sealed),
  )

  // events nobody authored are the system office's
  const sys = String((await one(`select app.system_office()::text as o`)).o)
  const rehearsal = String(
    await c.exec(W, `select app.record_rehearsal('passed', '{"run":"${run}"}'::jsonb)`),
  )
  const filed = await one(
    `select office_id::text as o from public.events where event_id = '${rehearsal}'`,
  )
  c.check(
    sys === SYS && filed.o === SYS && filed.o !== A && filed.o !== B,
    "a restore rehearsal is the deployment's own event: filed in the system office, never in a person's",
    c.json([sys, filed]),
  )

  // no function keeps an office-less overload beside its office-first one
  const both = await q(
    `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'public') and p.prokind = 'f'
        and pg_get_function_identity_arguments(p.oid) not like 'p_office uuid%'
        and exists (select 1 from pg_proc q where q.pronamespace = p.pronamespace and q.proname = p.proname
                       and q.oid <> p.oid and pg_get_function_identity_arguments(q.oid) like 'p_office uuid%')
      order by 1`,
  )
  c.check(
    both.length === 0,
    'no function keeps an office-less overload beside its office-first one (the old overload is a door that answers without an office)',
    c.json(both.map((r) => String(r.fn).slice(0, 60))),
  )
  c.check(
    (await bridge()) === bridgeBefore,
    'none of this relied on the compatibility bridge: the meter did not move',
    `${String(bridgeBefore)} -> ${String(await bridge())}`,
  )
}
