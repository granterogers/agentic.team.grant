// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
/**
 * Deleting a project for good, on the isolated replica only (ADR-0077, migration 1111).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/project-purge.ts
 *
 * What is proved, each with a positive control beside the refusal:
 *   1. the plan counts what a purge would remove, and changes nothing;
 *   2. a purge with a wrong name removes nothing;
 *   3. a reserved project (the catch-all) cannot be purged;
 *   4. a purge with the exact name removes the project and everything stored for it, and returns its stored file paths;
 *   5. another project in the same office is untouched, rows and all;
 *   6. one activity row records the purge, with no project link;
 *   7. the append-only triggers on the ledger are switched back on afterwards;
 *   8. a second purge of the same name finds nothing.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { isolated } from './guard.ts'

const DB = process.argv[2] ?? 'post'
const main = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const q = async (db: PgExecutor, sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string): Promise<any> => (await q(main, sql))[0]
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)

// An office the clone already holds: provisioning a new login is refused on a replica, and every row this proof writes is
// held by the projects it creates, so an existing office is safe to use.
const office = String(
  (await one('select office_id::text o from public.offices order by created_at limit 1')).o,
)

const mk = async (name: string): Promise<{ id: string; slug: string }> => {
  const r = json(
    (
      await one(
        `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`purge-${run}-${name.toLowerCase().replace(/\W+/g, '-')}`)}, ${lit(name)}, true) as v`,
      )
    ).v,
  )
  return { id: String(r.project_id), slug: String(r.slug) }
}
const doomed = await mk(`Doomed ${run}`)
const keeper = await mk(`Keeper ${run}`)
const count = async (table: string, project: string): Promise<number> =>
  Number(
    (
      await one(
        `select count(*)::int c from public.${table} where project_id = ${lit(project)}::uuid`,
      )
    ).c,
  )

// What a person has stored for the doomed project: a to-do, a stored file, a job with an output. The keeper has a to-do.
await q(
  main,
  `insert into public.tasks (office_id, project_id, title, state, assigned_to_human) values (${lit(office)}::uuid, ${lit(doomed.id)}::uuid, 'Doomed to-do', 'todo', true), (${lit(office)}::uuid, ${lit(keeper.id)}::uuid, 'Keeper to-do', 'todo', true)`,
)
const storedPath = `${office}/docs/doomed-${run}.pdf`
await q(
  main,
  `insert into public.documents (office_id, project_id, title, state, storage_path, mime_type, byte_size) values (${lit(office)}::uuid, ${lit(doomed.id)}::uuid, 'Doomed file', 'approved', ${lit(storedPath)}, 'application/pdf', 1200)`,
)
const job = String((await one('select gen_random_uuid()::text j')).j)
await q(
  main,
  `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, state, recipient_agent, created_at, started_at, finished_at) values (${lit(job)}::uuid, ${lit(job)}::uuid, ${lit(`purge-key-${job}`)}, 'office.instruction', 'teamhq:purge-test', ${lit(doomed.id)}::uuid, ${lit(office)}::uuid, 'complete', 'chief-of-staff', now() - interval '10 minutes', now() - interval '9 minutes', now() - interval '8 minutes')`,
)
await q(
  main,
  `insert into public.outputs (output_id, job_id, body, confidence, evidence) values (gen_random_uuid(), ${lit(job)}::uuid, 'Doomed answer', 'high', 'verified')`,
)

const doomedTasks = await count('tasks', doomed.id)
const keeperTasks = await count('tasks', keeper.id)
check(
  'the doomed project holds a to-do, a file and a job before anything happens',
  doomedTasks === 1 &&
    (await count('documents', doomed.id)) === 1 &&
    (await count('jobs', doomed.id)) === 1,
  `tasks ${String(doomedTasks)}`,
)

// 1. the plan counts, and changes nothing
const plan = json(
  (await one(`select app.hq_project_purge_plan(${lit(office)}::uuid, ${lit(doomed.slug)}) as r`)).r,
)
check(
  '1. the plan names the project and counts its to-dos, file and job',
  plan.project === `Doomed ${run}` &&
    Number(plan.counts?.tasks) === 1 &&
    Number(plan.counts?.documents) === 1 &&
    Number(plan.counts?.jobs) === 1,
  JSON.stringify(plan.counts),
)
check(
  '1. ...and the plan changed nothing',
  (await count('tasks', doomed.id)) === 1 && (await count('documents', doomed.id)) === 1,
)

// 2. a wrong name removes nothing
const wrong = json(
  (
    await one(
      `select app.hq_project_purge(${lit(office)}::uuid, ${lit(doomed.slug)}, 'not the name') as r`,
    )
  ).r,
)
check(
  '2. a wrong name is refused with the exact name to type',
  String(wrong.error ?? '').includes(`Doomed ${run}`),
  String(wrong.error ?? ''),
)
check(
  '2. ...and nothing was removed',
  (await count('tasks', doomed.id)) === 1 && (await count('documents', doomed.id)) === 1,
)

// 3. the reserved project cannot be purged (positive control: the office has one)
const reserved = await one(
  `select slug from public.projects where office_id = ${lit(office)}::uuid and reserved_reason is not null limit 1`,
)
if (reserved?.slug !== undefined) {
  const r = json(
    (
      await one(
        `select app.hq_project_purge(${lit(office)}::uuid, ${lit(String(reserved.slug))}, 'anything') as r`,
      )
    ).r,
  )
  check(
    '3. the reserved project is refused, whatever name is typed',
    String(r.error ?? '').includes('reserved'),
    String(r.error ?? ''),
  )
} else {
  check(
    '3. the reserved project is refused (no reserved project in this clone: not proved here)',
    true,
    'skipped',
  )
}

// 4. the exact name removes the project and what is stored for it; the stored file path comes back
const done = json(
  (
    await one(
      `select app.hq_project_purge(${lit(office)}::uuid, ${lit(doomed.slug)}, ${lit(`Doomed ${run}`)}) as r`,
    )
  ).r,
)
check(
  '4. the exact name purges the project',
  done.ok === true && done.purged === `Doomed ${run}`,
  JSON.stringify(done).slice(0, 160),
)
check(
  '4. the stored file path is handed back for the gateway to remove',
  Array.isArray(done.stored_files) && done.stored_files.includes(storedPath),
)
check(
  '4. the project and its to-dos, file and job are gone',
  (await count('projects', doomed.id)) === 0 &&
    (await count('tasks', doomed.id)) === 0 &&
    (await count('documents', doomed.id)) === 0 &&
    (await count('jobs', doomed.id)) === 0,
)

// 5. another project in the same office is untouched
check(
  '5. another project in the same office keeps its project row and its to-do',
  Number(
    (
      await one(
        `select count(*)::int c from public.projects where project_id = ${lit(keeper.id)}::uuid`,
      )
    ).c,
  ) === 1 && (await count('tasks', keeper.id)) === keeperTasks,
  `${String(await count('tasks', keeper.id))} to-do(s)`,
)

// 6. one record of the purge, with no project link
const record = await one(
  `select count(*)::int c from public.events where action_type = 'project.purged' and project_id is null and rationale_summary like ${lit(`%Doomed ${run}%`)}`,
)
check(
  '6. one activity row records the purge, with no project link, naming the project',
  Number(record.c) === 1,
  `${String(record.c)} row(s)`,
)

// 7. the ledger's triggers are back on
const trig = await q(
  main,
  `select tgname, tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'events' and not t.tgisinternal and tgname like 'events_reject_%'`,
)
check(
  '7. the append-only triggers on the ledger are switched back on',
  trig.length >= 3 && trig.every((t) => String(t.tgenabled) === 'O'),
  trig.map((t) => `${String(t.tgname)}=${String(t.tgenabled)}`).join(' '),
)

// 8. a second purge of the same name finds nothing
const again = json(
  (
    await one(
      `select app.hq_project_purge(${lit(office)}::uuid, ${lit(doomed.slug)}, ${lit(`Doomed ${run}`)}) as r`,
    )
  ).r,
)
check(
  '8. a second purge of the same name finds no project',
  String(again.error ?? '').includes('no project'),
  String(again.error ?? ''),
)

const failed = results.filter((ok) => !ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} ok`)
await main.end()
process.exit(failed === 0 ? 0 : 1)
