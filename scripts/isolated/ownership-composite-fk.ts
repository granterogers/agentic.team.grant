/**
 * Multi-user P0: does the proposed composite ownership structure hold under a role that BYPASSES
 * row-level security?
 *
 *   psql -h /tmp/pgs -p 55432 -U postgres -c "drop database if exists fk_spike"
 *   psql -h /tmp/pgs -p 55432 -U postgres -c "create database fk_spike template post"
 *   npx tsx scripts/isolated/ownership-composite-fk.ts fk_spike
 *
 * It applies the structure docs/multi-user/ARCHITECTURE.md proposes to the REAL tables of the
 * replica (a throwaway `offices` table, `office_id` on the carriers, composite unique keys, composite
 * foreign keys added NOT VALID then VALIDATEd after a backfill, a write-once trigger) and then
 * attacks it from `service_role` (BYPASSRLS) and from a non-superuser BYPASSRLS stand-in for the
 * `postgres` role Supabase gives the worker. It changes nothing outside the replica: `guard.ts`
 * refuses any database that is not a marked local socket replica.
 *
 * ## What it must show
 *
 *   1. A job with NO project (7,243 real ones) is accepted: MATCH SIMPLE skips a composite key
 *      with a null column, while `office_id` stays NOT NULL.
 *   2. A cross-office link is refused for every difficult edge: project, parent, root, secondary
 *      job edges, a self-referencing task, a caller-named project.
 *   3. The refusal holds when the writer bypasses RLS.
 *   4. A table that DERIVES its owner from a caller-named parent accepts the attack silently (the
 *      review's F4) while the same table CARRYING the owner refuses it.
 *   5. Where a foreign key cannot reach (a polymorphic edge) the gap is real, and a trigger closes
 *      it for the same bypass roles.
 *   6. `NOT VALID` then `VALIDATE` refuses to bless a backfill with a planted inconsistency.
 *   7. The write-once trigger refuses a change of owner.
 *
 * Every refusal is asserted by the CONSTRAINT NAME it raised, never by "something threw": a refusal
 * for the wrong reason looks exactly like the rule working.
 */
import { isolated } from './guard.ts'

/*
  THIS PROOF ALTERS THE TABLES IT RUNS ON (it adds office_id columns and composite keys). It was once pointed at the
  shared replica `post` by passing that name, which left nine tables changed and every other isolated suite running
  against a schema production does not have; the replica had to be rebuilt. It now refuses any database that is not
  a clone made for it.
*/
const target = process.argv[2] ?? 'fk_spike'
if (!/^fk_spike/.test(target)) {
  console.error(
    `REFUSED: ${target} is not a throwaway clone. Run: create database fk_spike template post`,
  )
  process.exit(2)
}
const db = await isolated(target)
let failed = 0
const check = (ok: boolean, what: string, detail: string) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ---------------------------------------------------------------------------------------------
// 1. Apply the structure to the real tables.
// ---------------------------------------------------------------------------------------------
await db.execute(`
  do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'ownership_spike_worker') then
      create role ownership_spike_worker nologin bypassrls;
    end if;
  end $r$;
  grant all on all tables in schema public to ownership_spike_worker, service_role;
  grant usage on schema public, app to service_role;
  grant execute on all functions in schema app to service_role;
  grant execute on all functions in schema public to service_role;
  grant usage on schema public, app to ownership_spike_worker;
  grant execute on all functions in schema app to ownership_spike_worker;
  grant execute on all functions in schema public to ownership_spike_worker;
  create table if not exists public.spike_offices (office_id uuid primary key, name text not null);
  insert into public.spike_offices values ('${A}', 'office A'), ('${B}', 'office B') on conflict do nothing;
`)

const carriers = [
  'projects',
  'jobs',
  'tasks',
  'documents',
  'blockers',
  'inbound_commands',
  'relations',
]
for (const t of carriers) {
  await db.execute(
    `alter table public.${t} add column if not exists office_id uuid references public.spike_offices(office_id)`,
  )
}
// Backfill what the replica already holds (one office, as production is today), THEN make it NOT NULL.
for (const t of carriers) {
  await db.execute(`update public.${t} set office_id = '${A}' where office_id is null`)
  await db.execute(`alter table public.${t} alter column office_id set not null`)
}

const uniq = [
  ['projects', 'project_id'],
  ['jobs', 'job_id'],
  ['tasks', 'task_id'],
  ['documents', 'document_id'],
  ['blockers', 'blocker_id'],
  ['inbound_commands', 'command_id'],
] as const
for (const [t, pk] of uniq) {
  await db.execute(
    `alter table public.${t} add constraint ${t}_${pk}_office unique (${pk}, office_id)`,
  )
}

type Edge = readonly [child: string, col: string, parent: string, parentKey: string, name: string]
const edges: readonly Edge[] = [
  ['jobs', 'project_id', 'projects', 'project_id', 'jobs_project_same_office'],
  ['jobs', 'parent_job_id', 'jobs', 'job_id', 'jobs_parent_same_office'],
  ['jobs', 'root_job_id', 'jobs', 'job_id', 'jobs_root_same_office'],
  ['tasks', 'project_id', 'projects', 'project_id', 'tasks_project_same_office'],
  ['tasks', 'parent_task_id', 'tasks', 'task_id', 'tasks_parent_same_office'],
  ['tasks', 'job_id', 'jobs', 'job_id', 'tasks_job_same_office'],
  ['documents', 'project_id', 'projects', 'project_id', 'documents_project_same_office'],
  ['documents', 'produced_by_job', 'jobs', 'job_id', 'documents_job_same_office'],
  ['blockers', 'job_id', 'jobs', 'job_id', 'blockers_job_same_office'],
  ['blockers', 'project_id', 'projects', 'project_id', 'blockers_project_same_office'],
  ['inbound_commands', 'project_id', 'projects', 'project_id', 'commands_project_same_office'],
  ['inbound_commands', 'job_id', 'jobs', 'job_id', 'commands_job_same_office'],
]
// SPIKE_SABOTAGE=<constraint name> leaves one key out, to prove the matching attack goes red (the proof's own control).
const sabotaged = process.env.SPIKE_SABOTAGE ?? ''
if (sabotaged !== '') console.log(`SABOTAGE: composite key ${sabotaged} is NOT created in this run`)
for (const [child, col, parent, key, name] of edges) {
  if (name === sabotaged) continue
  // NOT VALID first (no long lock), VALIDATE second - the order MIGRATION-PLAN M3 specifies.
  await db.execute(
    `alter table public.${child} add constraint ${name} foreign key (${col}, office_id)
       references public.${parent} (${key}, office_id) not valid`,
  )
  await db.execute(`alter table public.${child} validate constraint ${name}`)
}
await db.execute(`
  create or replace function public.spike_office_is_write_once() returns trigger
  language plpgsql as $f$ begin
    if new.office_id is distinct from old.office_id then
      raise exception 'office_id is write-once on %', tg_table_name using errcode = '23514';
    end if;
    return new;
  end $f$;
`)
for (const t of carriers) {
  await db.execute(
    `create trigger ${t}_office_write_once before update of office_id on public.${t}
       for each row execute function public.spike_office_is_write_once()`,
  )
}
console.log(
  `structure applied: ${String(carriers.length)} carriers, ${String(uniq.length)} composite unique keys, ${String(edges.length)} composite foreign keys, write-once triggers`,
)

// ---------------------------------------------------------------------------------------------
// 2. The harness: every case runs in a transaction that is always rolled back.
// ---------------------------------------------------------------------------------------------
const seed = `
  insert into public.projects (project_id, slug, name, office_id) values
    ('${id(1)}', 'spike-a', 'spike A', '${A}'), ('${id(2)}', 'spike-b', 'spike B', '${B}');
  insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, office_id) values
    ('${id(11)}', '${id(11)}', 'spike-ja', 'probe', 'verify:spike', '${A}'),
    ('${id(12)}', '${id(12)}', 'spike-jb', 'probe', 'verify:spike', '${B}');
  insert into public.tasks (task_id, title, office_id, seq) values
    ('${id(21)}', 'task A', '${A}', 9001), ('${id(22)}', 'task B', '${B}', 9002);
`
const run = async (role: string, sql: string): Promise<string> => {
  try {
    await db.execute(`begin; set local role ${role}; ${seed} ${sql}`)
    return ''
  } catch (e) {
    return String((e as Error).message)
  } finally {
    await db.execute('rollback').catch(() => undefined)
  }
}

const roles = ['service_role', 'ownership_spike_worker'] as const
const bypass = (
  await db.execute(
    `select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('service_role','ownership_spike_worker') order by 1`,
  )
).rows as { rolname: string; rolbypassrls: boolean; rolsuper: boolean }[]
check(
  bypass.length === 2 && bypass.every((r) => r.rolbypassrls && !r.rolsuper),
  'the attacking roles BYPASS row-level security and are not superusers',
  bypass
    .map((r) => `${r.rolname}: bypassrls=${String(r.rolbypassrls)} super=${String(r.rolsuper)}`)
    .join('; '),
)

const refused = async (what: string, sql: string, constraint: string) => {
  for (const role of roles) {
    const msg = await run(role, sql)
    check(
      msg.includes('23503') && msg.includes(`"${constraint}"`),
      `${what} [${role}]`,
      msg === '' ? 'ACCEPTED (the defect)' : msg.slice(0, 110),
    )
  }
}
const accepted = async (what: string, sql: string) => {
  const msg = await run('service_role', sql)
  check(msg === '', what, msg === '' ? 'accepted' : msg.slice(0, 140))
}

// ---- positive controls first: a validator that refuses everything proves nothing -------------
await accepted(
  'a job with NO project is accepted (MATCH SIMPLE skips the null column; office_id still NOT NULL)',
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, office_id)
     values ('${id(30)}', '${id(30)}', 'spike-noproj', 'probe', 'duty:spike', '${A}')`,
)
await accepted(
  'a job in A on a project in A is accepted',
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id)
     values ('${id(31)}', '${id(31)}', 'spike-ok', 'probe', 'verify:spike', '${id(1)}', '${A}')`,
)
await accepted(
  'a child job in A under a parent in A is accepted, root included',
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, parent_job_id, root_job_id, office_id)
     values ('${id(32)}', '${id(32)}', 'spike-child', 'probe', 'verify:spike', '${id(11)}', '${id(11)}', '${A}')`,
)
await accepted(
  'a task with no project and a task under a parent task in the same office are accepted',
  `insert into public.tasks (task_id, title, office_id, seq, parent_task_id) values ('${id(33)}', 'sub', '${A}', 9003, '${id(21)}')`,
)

// ---- the attacks ----------------------------------------------------------------------------
await refused(
  "A's job on B's project",
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id)
     values ('${id(40)}', '${id(40)}', 'spike-x1', 'probe', 'verify:spike', '${id(2)}', '${A}')`,
  'jobs_project_same_office',
)
await refused(
  "A's child under B's parent",
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, parent_job_id, office_id)
     values ('${id(41)}', '${id(41)}', 'spike-x2', 'probe', 'verify:spike', '${id(12)}', '${A}')`,
  'jobs_parent_same_office',
)
{
  // 0619 stamps root_job_id at insert (itself for a root, the parent's root for a child), so a caller cannot
  // choose it. The composite key on root is the belt for a trigger that is ever wrong.
  const msg = await run(
    'service_role',
    `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, root_job_id, office_id)
       values ('${id(42)}', '${id(42)}', 'spike-x3', 'probe', 'verify:spike', '${id(12)}', '${A}');
     select 1 / (case when (select root_job_id from public.jobs where job_id = '${id(42)}') = '${id(42)}' then 1 else 0 end)`,
  )
  check(
    msg === '',
    'a caller-supplied foreign root_job_id is overwritten by the 0619 stamp, so it cannot be chosen',
    msg === '' ? 'root_job_id came back as the job itself' : msg.slice(0, 110),
  )
}
await refused(
  "a projectless parent in A cannot launder a child onto B's project",
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, parent_job_id, project_id, office_id)
     values ('${id(43)}', '${id(43)}', 'spike-x4', 'probe', 'verify:spike', '${id(11)}', '${id(2)}', '${A}')`,
  'jobs_project_same_office',
)
await refused(
  "A's task on B's project",
  `insert into public.tasks (task_id, title, office_id, seq, project_id) values ('${id(44)}', 'x', '${A}', 9010, '${id(2)}')`,
  'tasks_project_same_office',
)
await refused(
  "A's task under B's task (a self-referencing edge)",
  `insert into public.tasks (task_id, title, office_id, seq, parent_task_id) values ('${id(45)}', 'x', '${A}', 9011, '${id(22)}')`,
  'tasks_parent_same_office',
)
await refused(
  "A's task produced by B's job (a secondary job edge)",
  `insert into public.tasks (task_id, title, office_id, seq, job_id) values ('${id(46)}', 'x', '${A}', 9012, '${id(12)}')`,
  'tasks_job_same_office',
)
await refused(
  "A's document on B's project",
  `insert into public.documents (document_id, project_id, title, office_id) values ('${id(47)}', '${id(2)}', 'x', '${A}')`,
  'documents_project_same_office',
)
await refused(
  "A's document produced_by_job B's job (the edge that drives document_origin trust)",
  `insert into public.documents (document_id, project_id, produced_by_job, title, office_id) values ('${id(48)}', '${id(1)}', '${id(12)}', 'x', '${A}')`,
  'documents_job_same_office',
)
await refused(
  "A's question about B's job",
  `insert into public.blockers (blocker_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id)
     values ('${id(49)}', '${id(12)}', 'Approve the spike action please', 'The spike needs an answer to continue', 'later', array['yes'], 'spike', false, '${A}')`,
  'blockers_job_same_office',
)
await refused(
  "A's inbound command naming B's project (the page's claim, CHECKED)",
  `insert into public.inbound_commands (command_id, origin_channel, origin_ref, actor, instruction, dedupe_key, project_id, office_id)
     values ('${id(50)}', 'teamhq', 'c:1', 'x', 'x', 'teamhq:spike_a:one', '${id(2)}', '${A}')`,
  'commands_project_same_office',
)
await refused(
  "A's inbound command linked to B's job",
  `insert into public.inbound_commands (command_id, origin_channel, origin_ref, actor, instruction, dedupe_key, job_id, office_id)
     values ('${id(51)}', 'teamhq', 'c:2', 'x', 'x', 'teamhq:spike_b:two', '${id(12)}', '${A}')`,
  'commands_job_same_office',
)

// ---- write-once ------------------------------------------------------------------------------
for (const role of roles) {
  const msg = await run(
    role,
    `update public.jobs set office_id = '${B}' where job_id = '${id(11)}'`,
  )
  check(
    msg.includes('office_id is write-once'),
    `moving a job to another office is refused [${role}]`,
    msg === '' ? 'ACCEPTED (the defect)' : msg.slice(0, 110),
  )
}

// ---- F4: derive-from-a-named-parent is a tautology ---------------------------------------------
await db.execute(`
  create table public.spike_derived_docs (
    doc_id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(project_id)
  );
  create table public.spike_carried_docs (
    doc_id uuid primary key default gen_random_uuid(),
    project_id uuid not null,
    office_id uuid not null,
    foreign key (project_id, office_id) references public.projects (project_id, office_id)
  );
  grant all on public.spike_derived_docs, public.spike_carried_docs to service_role, ownership_spike_worker;
`)
const callerIsA = `'${A}'`
const derivedMsg = await run(
  'service_role',
  `insert into public.spike_derived_docs (project_id) values ('${id(2)}')`,
)
check(
  derivedMsg === '',
  "DERIVED from a caller-named parent: A naming B's project is accepted silently",
  derivedMsg === ''
    ? 'accepted - the row now belongs to office B (the finding is real)'
    : derivedMsg.slice(0, 100),
)
const carriedMsg = await run(
  'service_role',
  `insert into public.spike_carried_docs (project_id, office_id) values ('${id(2)}', ${callerIsA})`,
)
check(
  carriedMsg.includes('23503'),
  'CARRIED owner (the verified caller office): the same attack is refused',
  carriedMsg.slice(0, 110),
)

// ---- polymorphic edge: a foreign key cannot reach, a trigger can -------------------------------
await db.execute(`
  insert into public.documents (document_id, project_id, title, office_id) values
    ('${id(61)}', null, 'doc A', '${A}'), ('${id(62)}', null, 'doc B', '${B}')
    on conflict do nothing;
`)
const rel = `insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, office_id)
               values ('${id(1)}', 'document', '${id(61)}', 'mentions', 'document', '${id(62)}', '${A}')`
const gap = await run('service_role', rel.replace('insert into', `insert into`))
check(
  gap === '',
  "POLYMORPHIC edge: with no trigger a relation from A's document to B's document is accepted (a foreign key cannot cover from_id/to_id)",
  gap === '' ? 'accepted - the gap is real' : gap.slice(0, 110),
)
await db.execute(`
  create or replace function public.spike_relation_same_office() returns trigger language plpgsql as $f$
  declare o_from uuid; o_to uuid;
  begin
    select office_id into o_from from public.documents where document_id = new.from_id and new.from_kind = 'document';
    select office_id into o_to   from public.documents where document_id = new.to_id   and new.to_kind   = 'document';
    if (new.from_kind = 'document' and o_from is distinct from new.office_id)
       or (new.to_kind = 'document' and o_to is distinct from new.office_id) then
      raise exception 'relation endpoint is not in this office' using errcode = '23503';
    end if;
    return new;
  end $f$;
  create trigger relations_same_office before insert or update on public.relations
    for each row execute function public.spike_relation_same_office();
`)
for (const role of roles) {
  const closed = await run(role, rel)
  check(
    closed.includes('relation endpoint is not in this office'),
    `POLYMORPHIC edge with the trigger: the same relation is refused [${role}]`,
    closed === '' ? 'ACCEPTED (the defect)' : closed.slice(0, 110),
  )
}
await accepted(
  'POLYMORPHIC edge with the trigger: a relation inside one office is still accepted (positive control)',
  `insert into public.documents (document_id, title, office_id) values ('${id(63)}', 'doc A2', '${A}');
   insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, office_id)
     values ('${id(1)}', 'document', '${id(61)}', 'mentions', 'document', '${id(63)}', '${A}')`,
)

// ---- a role cannot switch the keys off ---------------------------------------------------------
for (const role of roles) {
  const msg = await run(role, `set local session_replication_role = replica`)
  check(
    msg.includes('42501') || msg.includes('permission denied'),
    `a bypass-RLS role cannot disable foreign-key enforcement with session_replication_role [${role}]`,
    msg === '' ? 'ACCEPTED (the defect)' : msg.slice(0, 100),
  )
}

// ---- NOT VALID then VALIDATE refuses to bless a bad backfill -----------------------------------
// Plant an inconsistent row WITHOUT the constraint blocking it (it is NOT VALID, so new rows are checked;
// disable the one real key for the plant, as a bad backfill would have left it).
// The real projects_need_an_attachment trigger is deferred to commit; this clone is throwaway, so switch it off
// for the planted rows rather than fabricate attachments.
await db.execute(`alter table public.projects disable trigger projects_need_an_attachment`)
await db.execute(`
  insert into public.projects (project_id, slug, name, office_id) values
    ('${id(81)}', 'spike-keep-a', 'keep A', '${A}'), ('${id(82)}', 'spike-keep-b', 'keep B', '${B}')`)
await db.execute(`
  alter table public.jobs drop constraint jobs_project_same_office;
  insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id)
    values ('${id(70)}', '${id(70)}', 'spike-planted', 'probe', 'verify:spike', '${id(82)}', '${A}');
`)
// ...then add the key NOT VALID (new rows are checked, the planted one is not) and ask it to VALIDATE.
await db.execute(`
  alter table public.jobs add constraint spike_probe_same_office foreign key (project_id, office_id)
    references public.projects (project_id, office_id) not valid;
`)
let validateMsg = ''
try {
  await db.execute(`alter table public.jobs validate constraint spike_probe_same_office`)
} catch (e) {
  validateMsg = String((e as Error).message)
}
check(
  validateMsg.includes('23503') && validateMsg.includes('spike_probe_same_office'),
  'VALIDATE refuses a backfill that left a cross-office row',
  validateMsg === '' ? 'ACCEPTED (the defect)' : validateMsg.slice(0, 120),
)

await db.end()
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
