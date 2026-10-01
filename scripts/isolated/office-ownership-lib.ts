/**
 * The ownership attack suite (multi-user P2). Library half: `office-ownership.ts` runs it once and
 * `office-ownership-sabotage.ts` runs it against a database it has deliberately broken.
 *
 * It needs a clone made for it (guard.ts refuses anything else) because it creates offices, and an office is never
 * deleted:
 *
 *   scripts/isolated/p2-attack.sh        # drops/creates p2_attack from the replica and applies 0654..0663
 *   npx tsx scripts/isolated/office-ownership.ts p2_attack
 *
 * Person A and Person B are ordinary person offices with their own login; Sample is a sample office; the Test and
 * System offices are the ones the migration bound (an office of each of those kinds is unique by design, so the suite
 * attacks from them rather than creating more). Every attack runs as the two roles that BYPASS row security - the
 * Supabase service role and a non-superuser worker stand-in - because a tripwire that stops only ordinary roles is
 * not the property being claimed. Every refusal is asserted by the message it carried, never by "something threw".
 */
import type { isolated } from './guard.ts'

export type Result = { ok: boolean; what: string; detail: string }
export type Db = Awaited<ReturnType<typeof isolated>>

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const AUTH_A = 'a1111111-1111-4111-8111-111111111111'
export const AUTH_B = 'b2222222-2222-4222-8222-222222222222'
export const AUTH_S = 'c3333333-3333-4333-8333-333333333333'
/** A login that belongs to no office, so a refusal of it can only be for the reason being tested. */
export const AUTH_X = 'd4444444-4444-4444-8444-444444444444'

export async function prepare(
  db: Db,
): Promise<{ A: string; B: string; S: string; G: string; T: string; SYS: string }> {
  await db.execute(`
    do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'p2_worker') then create role p2_worker nologin bypassrls; end if;
    end $r$;
    -- service_role is given what Supabase gives it - the public tables - and NOTHING in schema app. An earlier version of
    -- this setup also granted it usage on app and execute on every app function; that hid, for a whole afternoon, the
    -- fact that the ownership guards called a function service_role cannot reach, and the live Telegram webhook (which
    -- writes through PostgREST as service_role) answered 503 to every update.
    grant all on all tables in schema public to p2_worker, service_role;
    grant usage on schema public to p2_worker, service_role;
    grant usage on all sequences in schema public to p2_worker, service_role;
    -- p2_worker stands in for the postgres role the worker connects as: it can use schema app and everything in it.
    grant usage on schema app to p2_worker;
    grant execute on all functions in schema app to p2_worker;
    grant execute on all functions in schema public to p2_worker;`)
  for (const [auth, mail] of [
    [AUTH_A, 'person.a@example.invalid'],
    [AUTH_B, 'person.b@example.invalid'],
    [AUTH_S, 'sample@example.invalid'],
    [AUTH_X, 'nobody@example.invalid'],
  ] as const)
    await db.execute(
      `insert into auth.users (id, email) values ('${auth}', '${mail}') on conflict (id) do nothing`,
    )
  const mk = async (auth: string, kind: string, name: string) => {
    await db.execute(
      `insert into public.offices (auth_user_id, kind, name) values ('${auth}', '${kind}', '${name}') on conflict (auth_user_id) do nothing`,
    )
    return (
      (await db.execute(`select office_id from public.offices where auth_user_id = '${auth}'`))
        .rows[0] as {
        office_id: string
      }
    ).office_id
  }
  const A = await mk(AUTH_A, 'person', 'Person A')
  const B = await mk(AUTH_B, 'person', 'Person B')
  const S = await mk(AUTH_S, 'sample', 'Sample')
  const one = async (sql: string) => ((await db.execute(sql)).rows[0] as { o: string }).o
  const G = await one(
    `select office_id as o from public.offices where kind = 'person' and name = 'Grant'`,
  )
  const T = await one(`select office_id as o from public.offices where kind = 'test'`)
  const SYS = await one(`select office_id as o from public.offices where kind = 'system'`)
  return { A, B, S, G, T, SYS }
}

export async function suite(db: Db): Promise<Result[]> {
  const out: Result[] = []
  const check = (ok: boolean, what: string, detail: string) => out.push({ ok, what, detail })
  const { A, B, S, G, T, SYS } = await prepare(db)

  // ---- Grant's data must come through untouched: a snapshot now, a comparison at the end ---------------------------
  const carriers = (
    (
      await db.execute(`select c.relname from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attname = 'office_id' and c.relname <> 'offices'
         and not a.attisdropped order by 1`)
    ).rows as { relname: string }[]
  ).map((r) => r.relname)
  const grantCounts = async (): Promise<string> => {
    const parts: string[] = []
    for (const t of carriers) {
      const n = (
        (await db.execute(`select count(*)::int as n from public.${t} where office_id = '${G}'`))
          .rows[0] as { n: number }
      ).n
      parts.push(`${t}=${n}`)
    }
    return parts.join(',')
  }
  const before = await grantCounts()

  // ---- seed: one of everything in A and in B (committed; the database is a throwaway) ------------------------------
  const seed = `
    insert into public.projects (project_id, slug, name, status, office_id) values
      ('${id(1)}', 'atk-a', 'atk A', 'paused', '${A}'), ('${id(2)}', 'atk-b', 'atk B', 'paused', '${B}') on conflict do nothing;
    insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id) values
      ('${id(11)}', '${id(11)}', 'atk-key-ja', 'probe', 'verify:atk', '${id(1)}', '${A}'),
      ('${id(12)}', '${id(12)}', 'atk-key-jb', 'probe', 'verify:atk', '${id(2)}', '${B}') on conflict do nothing;
    insert into public.tasks (task_id, title, office_id, project_id) values
      ('${id(21)}', 'task A', '${A}', '${id(1)}'), ('${id(22)}', 'task B', '${B}', '${id(2)}') on conflict do nothing;
    insert into public.blockers (blocker_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, project_id, job_id) values
      ('${id(31)}', 'aaa', 'aaa', 'aaa', '{aaa}', 'x', true, '${A}', '${id(1)}', '${id(11)}'),
      ('${id(32)}', 'bbb', 'bbb', 'bbb', '{bbb}', 'x', true, '${B}', '${id(2)}', '${id(12)}') on conflict do nothing;
    insert into public.documents (document_id, office_id, project_id) values
      ('${id(41)}', '${A}', '${id(1)}'), ('${id(42)}', '${B}', '${id(2)}') on conflict do nothing;
    insert into public.inbound_commands (command_id, origin_channel, origin_ref, actor, instruction, dedupe_key, office_id, project_id, job_id) values
      ('${id(51)}', 'teamhq', 'atk:1', 'atk', 'a', 'verify:atk_a:one', '${A}', '${id(1)}', '${id(11)}'),
      ('${id(52)}', 'teamhq', 'atk:2', 'atk', 'b', 'verify:atk_b:two', '${B}', '${id(2)}', '${id(12)}') on conflict do nothing;
    insert into public.dashboard_layouts (project_id, panels) values ('${id(1)}', '["a"]'), ('${id(2)}', '["a"]') on conflict do nothing;`
  try {
    await db.execute(seed)
  } catch (e) {
    check(
      false,
      'the seed for A and B could be written',
      String((e as Error).message).slice(0, 200),
    )
    return out
  }

  /** Run `sql` as `role` inside a transaction that is always rolled back; '' means it was accepted. */
  const run = async (role: string, sql: string): Promise<string> => {
    try {
      await db.execute(`begin; set local role ${role}; ${sql}`)
      return ''
    } catch (e) {
      return String((e as Error).message)
    } finally {
      await db.execute('rollback').catch(() => undefined)
    }
  }
  const roles = ['service_role', 'p2_worker'] as const
  const refusedAs = async (
    as: readonly string[],
    what: string,
    sql: string,
    ...needles: string[]
  ) => {
    for (const role of as) {
      const msg = await run(role, sql)
      const ok = msg !== '' && needles.every((n) => msg.includes(n))
      check(
        ok,
        `${what} [${role}]`,
        msg === ''
          ? 'ACCEPTED (the defect)'
          : ok
            ? msg.slice(0, 100)
            : `refused for another reason: ${msg.slice(0, 140)}`,
      )
    }
  }
  const refused = (what: string, sql: string, ...needles: string[]) =>
    refusedAs(roles, what, sql, ...needles)
  /*
    Some tables are not writable by service_role in production at all - deliveries and outputs carry older triggers that
    call app.now_utc() as the invoker, so only the worker (the postgres role) ever writes them. An attack on one of those
    is run as the worker alone; running it as service_role would test a privilege failure that predates this work.
  */
  const workerOnly = ['p2_worker'] as const
  const accepted = async (what: string, sql: string, role = 'service_role') => {
    const msg = await run(role, sql)
    check(msg === '', what, msg === '' ? 'accepted' : msg.slice(0, 160))
  }
  const bypass = (
    await db.execute(
      `select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('service_role','p2_worker') order by 1`,
    )
  ).rows as {
    rolname: string
    rolbypassrls: boolean
    rolsuper: boolean
  }[]
  check(
    bypass.length === 2 && bypass.every((r) => r.rolbypassrls && !r.rolsuper),
    'the attacking roles BYPASS row security and are not superusers',
    bypass.map((r) => `${r.rolname}: bypassrls=${String(r.rolbypassrls)}`).join('; '),
  )

  {
    const reach = await run('service_role', `select app.sole_person_office()`)
    check(
      reach.includes('42501'),
      'the attacking service role really cannot reach schema app (so a guard that depended on it would fail here as it did live)',
      reach === ''
        ? 'it CAN reach app: this suite is not modelling production'
        : reach.slice(0, 90),
    )
  }

  const job = (n: number, extra = '', val = '', office = A) =>
    `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, office_id${extra}) values ('${id(n)}', '${id(n)}', 'atk-key-${n}', 'probe', 'verify:atk', '${office}'${val})`

  // ---- positive controls: a guard that refuses everything proves nothing ----------------------------------------
  await accepted('A: a job on its own project', job(100, ', project_id', `, '${id(1)}'`))
  await accepted(
    'A: a job with no project at all (a null secondary parent does not erase ownership)',
    job(101),
  )
  await accepted('A: a child job under its own job', job(102, ', parent_job_id', `, '${id(11)}'`))
  await accepted(
    'A: a task under its own parent task',
    `insert into public.tasks (task_id, title, office_id, parent_task_id, project_id) values ('${id(103)}', 's', '${A}', '${id(21)}', '${id(1)}')`,
  )
  await accepted(
    'A: a relation between its own task and its own document',
    `insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by) values ('${id(1)}', 'task', '${id(21)}', 'about', 'document', '${id(41)}', 'atk')`,
  )
  await accepted(
    'B: the same relation shape in B',
    `insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by) values ('${id(2)}', 'task', '${id(22)}', 'about', 'document', '${id(42)}', 'atk')`,
  )

  // ---- 1. A cannot link to B ---------------------------------------------------------------------------------------
  await refused(
    "A's job on B's project",
    job(110, ', project_id', `, '${id(2)}'`),
    '23503',
    'jobs_project_same_office',
  )
  await refused(
    "A's child job under B's job",
    job(111, ', parent_job_id', `, '${id(12)}'`),
    '23503',
    'jobs_parent_same_office',
  )
  await refused(
    "A's task on B's project",
    `insert into public.tasks (task_id, title, office_id, project_id) values ('${id(112)}', 'x', '${A}', '${id(2)}')`,
    '23503',
    'same_office',
  )
  await refused(
    "A's task under B's task",
    `insert into public.tasks (task_id, title, office_id, parent_task_id) values ('${id(113)}', 'x', '${A}', '${id(22)}')`,
    '23503',
    'tasks_parent_task_id_same_office',
  )
  await refused(
    "A's task produced by B's job",
    `insert into public.tasks (task_id, title, office_id, job_id) values ('${id(114)}', 'x', '${A}', '${id(12)}')`,
    '23503',
    'tasks_job_id_same_office',
  )
  await refused(
    "A's document on B's project",
    `insert into public.documents (document_id, office_id, project_id) values ('${id(115)}', '${A}', '${id(2)}')`,
    '23503',
    'documents_project_id_same_office',
  )
  await refused(
    "A's document produced by B's job",
    `insert into public.documents (document_id, office_id, produced_by_job) values ('${id(116)}', '${A}', '${id(12)}')`,
    '23503',
    'documents_produced_by_job_same_office',
  )
  await refused(
    "A's document mirroring B's document",
    `insert into public.documents (document_id, office_id, mirrors_document_id) values ('${id(117)}', '${A}', '${id(42)}')`,
    '23503',
    'documents_mirrors_document_id_same_office',
  )
  await refused(
    "A's blocker on B's job",
    `insert into public.blockers (requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, job_id) values ('aaa','aaa','aaa','{aaa}','x',true,'${A}','${id(12)}')`,
    '23503',
    'blockers_job_id_same_office',
  )
  await refused(
    "A's command on B's job",
    `insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, office_id, project_id, job_id) values ('teamhq','atk:x','atk','a','verify:atk_x:one','${A}','${id(1)}','${id(12)}')`,
    '23503',
    'inbound_commands_job_id_same_office',
  )
  await refused(
    "A's command paired with B's command",
    `insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, office_id, project_id, paired_with) values ('teamhq','atk:y','atk','a','verify:atk_y:one','${A}','${id(1)}','${id(52)}')`,
    '23503',
    'inbound_commands_paired_with_same_office',
  )
  await refusedAs(
    workerOnly,
    "A's delivery for B's job",
    `insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, lease_expires_at, office_id, job_id) values ('slack','atk:d:one','a','CATK0001','notice', now(), '${A}', '${id(12)}')`,
    '23503',
    'deliveries_job_id_same_office',
  )
  await refused(
    "A's decision superseding B's decision",
    `with b as (insert into public.decisions (decision_id, question, chose, ruled_out, because, decided_by, office_id) values ('${id(120)}','q','c','{}','b','x','${B}') returning 1) insert into public.decisions (question, chose, ruled_out, because, decided_by, office_id, supersedes) values ('q','c','{}','b','x','${A}','${id(120)}')`,
    '23503',
    'decisions_supersedes_same_office',
  )
  await refused(
    "A's event compensating B's event",
    `with b as (insert into public.events (event_id, correlation_id, actor_kind, actor, trigger, action_type, reversible, office_id) values ('${id(121)}','${id(121)}','system','x','t','a.b',false,'${B}') returning 1) insert into public.events (correlation_id, actor_kind, actor, trigger, action_type, reversible, office_id, compensates_event_id) values ('${id(122)}','system','x','t','a.b',false,'${A}','${id(121)}')`,
    '23503',
    'events_compensates_event_id_same_office',
  )
  // changing an existing row is the same attack
  await refused(
    "moving A's task onto B's project",
    `update public.tasks set project_id = '${id(2)}' where task_id = '${id(21)}'`,
    '23503',
    'same_office',
  )
  await refused(
    "pointing A's job at B's project",
    `update public.jobs set project_id = '${id(2)}' where job_id = '${id(11)}'`,
    '23503',
    'jobs_project_same_office',
  )

  // ---- 2. ownership cannot move after insert -----------------------------------------------------------------------
  await refused(
    "moving A's job to B",
    `update public.jobs set office_id = '${B}' where job_id = '${id(11)}'`,
    '23514',
    'write-once',
  )
  await refused(
    "moving A's project to B",
    `update public.projects set office_id = '${B}' where project_id = '${id(1)}'`,
    '23514',
    'write-once',
  )
  await refused(
    "moving A's task to B",
    `update public.tasks set office_id = '${B}' where task_id = '${id(21)}'`,
    '23514',
    'write-once',
  )
  await refused(
    "erasing the owner of A's document",
    `update public.documents set office_id = null where document_id = '${id(41)}'`,
    '23514',
    'write-once',
  )
  await refused(
    'a project with no office, written by a bypass role while two real offices exist (the bridge fails closed)',
    `insert into public.projects (slug, name) values ('atk-nobody', 'nobody')`,
    '23502',
    'office_id',
  )
  await refused(
    "moving a derived row to the other office (dashboard layout of A's project onto B's)",
    `update public.dashboard_layouts set project_id = '${id(2)}' where project_id = '${id(1)}'`,
    '23514',
    'cannot move',
  )

  // ---- 3. derived tables: a second edge in another office, and a null path -----------------------------------------
  const imp = (job: string, project: string) =>
    `insert into public.job_impediments (job_id, kind, needed_raw, noticed_by, project_id) values ('${job}', (select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'impediment_kind' order by e.enumsortorder limit 1)::public.impediment_kind, 'a need that is spelled out', 'verify:atk', '${project}')`
  await accepted("a derived impediment on A's job naming A's project", imp(id(11), id(1)))
  await refused(
    "a derived impediment on A's job naming B's project",
    imp(id(11), id(2)),
    '23514',
    'another office',
  )
  await refused(
    'a derived layout with no project (its path is NOT NULL)',
    `insert into public.dashboard_layouts (project_id, panels) values (null, '["a"]')`,
    '23502',
    'project_id',
  )
  await refusedAs(
    workerOnly,
    'a derived output with no job (its path is NOT NULL)',
    `insert into public.outputs (job_id, body, confidence, evidence) values (null, 'x', (select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'confidence_level' order by e.enumsortorder limit 1)::public.confidence_level, (select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'evidence_type' order by e.enumsortorder limit 1)::public.evidence_type)`,
    '23502',
    'job_id',
  )
  await refused(
    "a branch group on A's job whose synthesis job is B's",
    `insert into public.branch_groups (parent_job_id, objective, synthesis_job_id) values ('${id(11)}', 'x', '${id(12)}')`,
    '23514',
    'another office',
  )

  // ---- 4. polymorphic relations ------------------------------------------------------------------------------------
  await refused(
    "a relation in A pointing at B's task",
    `insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by) values ('${id(1)}', 'task', '${id(21)}', 'about', 'task', '${id(22)}', 'atk')`,
    '23514',
    'to endpoint',
  )
  await refused(
    "a relation in A starting from B's document",
    `insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by) values ('${id(1)}', 'document', '${id(42)}', 'about', 'task', '${id(21)}', 'atk')`,
    '23514',
    'from endpoint',
  )
  await refused(
    'a relation to an endpoint that does not exist',
    `insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by) values ('${id(1)}', 'task', '${id(21)}', 'about', 'job', '${id(999)}', 'atk')`,
    '23514',
    'to endpoint',
  )
  await refused(
    "moving A's relation to B's project",
    `insert into public.relations (relation_id, project_id, from_kind, from_id, verb, to_kind, to_id, made_by) values ('${id(130)}', '${id(1)}', 'task', '${id(21)}', 'about', 'document', '${id(41)}', 'atk'); update public.relations set project_id = '${id(2)}' where relation_id = '${id(130)}'`,
    '23514',
  )

  // ---- 5. private names are per office; the refusal is about your own office only ----------------------------------
  const name2 = async (
    what: string,
    table: string,
    cols: string,
    valsA: string,
    valsB: string,
    dup: string,
  ) => {
    await accepted(
      `two offices use the same ${what}`,
      `insert into public.${table} (${cols}, office_id) values (${valsA}, '${A}'); insert into public.${table} (${cols}, office_id) values (${valsB}, '${B}')`,
    )
    const msg = await run(
      'service_role',
      `insert into public.${table} (${cols}, office_id) values (${valsA}, '${A}'); insert into public.${table} (${cols}, office_id) values (${valsA}, '${A}')`,
    )
    check(
      msg.includes('23505') && msg.includes(dup),
      `a duplicate ${what} inside one office is refused by the per-office key`,
      msg === '' ? 'ACCEPTED' : msg.slice(0, 110),
    )
  }
  await name2(
    'project slug',
    'projects',
    'slug, name',
    `'same-private', 'n'`,
    `'same-private', 'n'`,
    'projects_office_slug_key',
  )
  const staff = (
    (await db.execute(`select staff_id from public.staff limit 1`)).rows[0] as { staff_id: string }
  ).staff_id
  await name2(
    'duty slug',
    'responsibilities',
    'slug, staff_id, description, job_kind, period_minutes',
    `'same-duty', '${staff}', 'a description that is long enough', 'office.sync', 60`,
    `'same-duty', '${staff}', 'a description that is long enough', 'office.sync', 60`,
    'responsibilities_office_slug_key',
  )
  await name2(
    'trigger name',
    'event_triggers',
    'name, source, event_type, job_kind',
    `'same-trigger','s','e','office.sync'`,
    `'same-trigger','s','e','office.sync'`,
    'event_triggers_office_name_key',
  )
  await name2(
    'MCP provider name',
    'mcp_providers',
    'name, endpoint',
    `'same-provider','https://example.invalid/a'`,
    `'same-provider','https://example.invalid/a'`,
    'mcp_providers_office_name_key',
  )
  await name2(
    'contact label',
    'contact_labels',
    'name',
    `'Same Label'`,
    `'Same Label'`,
    'contact_labels_one_per_name',
  )
  // existence oracle: B's attempt must never name or depend on A's rows
  {
    await db.execute(
      `insert into public.projects (project_id, slug, name, status, office_id) values ('${id(140)}', 'oracle-probe', 'o', 'paused', '${A}') on conflict do nothing`,
    )
    const msg = await run(
      'service_role',
      `insert into public.projects (slug, name, office_id) values ('oracle-probe', 'o', '${B}')`,
    )
    check(
      msg === '',
      "B can take a slug A already holds: nothing about A's slug is revealed",
      msg === '' ? 'accepted' : `B was told: ${msg.slice(0, 100)}`,
    )
  }

  // ---- 6. the bridge: single person works, a second real office makes it fail closed ------------------------------
  {
    // disable A, B and the sample for one transaction so Grant is the only real office, as production is today
    const single = `update public.offices set state = 'disabled', disabled_at = now() where office_id in ('${A}', '${B}', '${S}');`
    const msg = await run(
      'service_role',
      `${single} insert into public.projects (project_id, slug, name) values ('${id(150)}', 'bridge-single', 'b'); select 1 / (case when (select office_id from public.projects where project_id = '${id(150)}') = '${G}' then 1 else 0 end)`,
    )
    check(
      msg === '',
      'while Grant is the only real office a legacy writer with no office is bound to Grant',
      msg === '' ? 'bound to Grant' : msg.slice(0, 120),
    )
    const harness = await run(
      'service_role',
      `${single} insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by) values ('${id(151)}', '${id(151)}', 'atk-key-151', 'probe', 'verify:bridge'); select 1 / (case when (select office_id from public.jobs where job_id = '${id(151)}') = '${T}' then 1 else 0 end)`,
    )
    check(
      harness === '',
      "a harness-named writer with no office lands in the TEST office, never in Grant's",
      harness === '' ? 'bound to the test office' : harness.slice(0, 120),
    )
    const chat = await run(
      'service_role',
      `${single} insert into public.telegram_chats (chat_id, chat_type, bot_id, deliverable, undeliverable_reason, undeliverable_at) values ('9990001', 'private', '9990002', false, 'a declared test origin (#381)', now()); select 1 / (case when (select office_id from public.telegram_chats where chat_id = '9990001') = '${T}' then 1 else 0 end)`,
    )
    check(
      chat === '',
      "a chat the harness declared a test origin is the TEST office's, never bound to the one person",
      chat === '' ? 'bound to the test office' : chat.slice(0, 140),
    )
    const two = await run(
      'service_role',
      `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by) values ('${id(152)}', '${id(152)}', 'atk-key-152', 'probe', 'telegram:5551234')`,
    )
    check(
      two.includes('23502') && two.includes('office_id'),
      'with Person A and B active the same unscoped real-looking writer is refused, not given to anyone',
      two === '' ? "ACCEPTED (silently someone's)" : two.slice(0, 120),
    )
    const sample = await run(
      'service_role',
      `update public.offices set state = 'disabled', disabled_at = now() where office_id in ('${A}', '${B}'); insert into public.projects (slug, name) values ('bridge-sample', 'b')`,
    )
    check(
      sample.includes('23502'),
      'a sample office alone with Grant also makes the bridge ambiguous',
      sample === '' ? 'ACCEPTED' : sample.slice(0, 120),
    )
  }

  // ---- 7. what a human session can reach ---------------------------------------------------------------------------
  {
    const sys = (
      await db.execute(`select auth_user_id from public.offices where office_id = '${SYS}'`)
    ).rows[0] as { auth_user_id: string | null }
    check(
      sys.auth_user_id === null,
      'the system office has no login, so no session can resolve to it',
      String(sys.auth_user_id),
    )
    const viaAuth = (
      await db.execute(
        `select count(*)::int as n from public.offices where auth_user_id is not null and kind = 'system'`,
      )
    ).rows[0] as { n: number }
    check(
      viaAuth.n === 0,
      'no login is attached to a system office, so no human session can resolve to it',
      `matches=${String(viaAuth.n)}`,
    )
    const ofA = (
      await db.execute(`select office_id from public.offices where auth_user_id = '${AUTH_A}'`)
    ).rows as { office_id: string }[]
    check(
      ofA.length === 1 && ofA[0]?.office_id === A,
      "Person A's login names exactly Person A's office",
      `rows=${String(ofA.length)}`,
    )
    const giveLogin = await run(
      'service_role',
      `update public.offices set auth_user_id = '${AUTH_X}' where office_id = '${SYS}'`,
    )
    check(
      giveLogin.includes('immutable'),
      'the system office cannot be given a login afterwards',
      giveLogin === '' ? 'ACCEPTED' : giveLogin.slice(0, 100),
    )
    const withLogin = await run(
      'service_role',
      `insert into public.offices (auth_user_id, kind, name) values ('${AUTH_X}', 'system', 'a system office with a login')`,
    )
    check(
      withLogin.includes('23514') && withLogin.includes('offices_system_has_no_login'),
      'a system office with a login is refused by name, whatever else would also refuse it',
      withLogin === '' ? 'ACCEPTED' : withLogin.slice(0, 120),
    )
    const second = await run(
      'service_role',
      `insert into public.offices (kind, name) values ('system', 'a second system office')`,
    )
    check(
      second.includes('23505') && second.includes('offices_one_system'),
      'a second system office is refused',
      second === '' ? 'ACCEPTED' : second.slice(0, 110),
    )
    const change = await run(
      'service_role',
      `update public.offices set kind = 'system' where office_id = '${A}'`,
    )
    check(
      change.includes('immutable'),
      "an office's kind cannot be changed (a person cannot become the system)",
      change === '' ? 'ACCEPTED' : change.slice(0, 100),
    )
    const del = await run('service_role', `delete from public.offices where office_id = '${A}'`)
    check(
      del.includes('never deleted'),
      'an office is retired, never deleted',
      del === '' ? 'ACCEPTED' : del.slice(0, 100),
    )
    const sysRows = (
      await db.execute(
        `select count(*)::int as n from public.responsibilities where office_id = '${SYS}'`,
      )
    ).rows[0] as { n: number }
    check(
      sysRows.n > 0,
      'deployment duties are owned by the system office, not by a person',
      `system duties=${String(sysRows.n)}`,
    )
  }

  // ---- 8. harness data did not become Grant's ----------------------------------------------------------------------
  {
    const leaked = (
      await db.execute(
        `select count(*)::int as n from public.projects where office_id = '${G}' and is_fixture`,
      )
    ).rows[0] as { n: number }
    check(
      leaked.n === 0,
      "no fixture project sits in Grant's office",
      `fixture projects in Grant's office=${String(leaked.n)}`,
    )
    const report = (
      await db.execute(`select count(*)::int as n from public.office_backfill_report`)
    ).rows[0] as { n: number }
    check(
      report.n >= 0,
      'the backfill report table exists and is readable',
      `rows=${String(report.n)}`,
    )
    const upd = await run('service_role', `update public.office_backfill_report set n = 0`)
    check(
      upd.includes('append-only') || (upd === '' && report.n === 0),
      'the backfill report is append-only',
      upd === '' ? (report.n === 0 ? 'empty replica' : 'ACCEPTED') : upd.slice(0, 80),
    )
  }

  // ---- 9. Grant's data is as it was --------------------------------------------------------------------------------
  const after = await grantCounts()
  check(
    after === before,
    "Grant's rows are exactly as they were before the attacks, table by table",
    after === before
      ? `${carriers.length} carrier tables compared`
      : `before ${before}\nafter  ${after}`,
  )
  return out
}
