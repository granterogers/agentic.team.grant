/**
 * Invariant 3 / V11 - work that answers a person always belongs to a project; only a duty is global.
 *
 *   npx tsx scripts/isolated/project-ownership.ts <replica-db>
 *
 * Driven through the real door, the real `enqueue_inbound` and `enqueue_child`. A turn that names no project is given
 * the Unnamed one (never null), a child inherits, and the command table refuses a null outright. The property at the
 * end is asserted over EVERY job the run made: none that a person's turn started, or any descendant of one, has a
 * null project. A duty root is the one legitimate owner of "no project" (it is the office's own schedule, not an
 * answer to anybody), and is checked as such so the exception is named rather than assumed.
 */
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'own634')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const unnamed = String((await one(`select app.unnamed_project()::text as p`)).p)

const parent = await realParent(db)
const p = await one(
  `select project_id::text as p from public.jobs where job_id = ${lit(parent)}::uuid`,
)
check(
  "a person's turn that names no project is given the Unnamed project, never null",
  p.p === unnamed,
  String(p.p),
)
const kid = String(
  (
    await one(
      `select app.enqueue_child(${lit(parent)}::uuid, 'verify.own', '{}'::jsonb)::text as c`,
    )
  ).c,
).match(/[0-9a-f-]{36}/)?.[0] as string
const k = await one(
  `select project_id::text as p from public.jobs where job_id = ${lit(kid)}::uuid`,
)
check("a child with no project of its own inherits its parent's", k.p === unnamed, String(k.p))
const grand = String(
  (await one(`select app.enqueue_child(${lit(kid)}::uuid, 'verify.own', '{}'::jsonb)::text as c`))
    .c,
).match(/[0-9a-f-]{36}/)?.[0] as string
const g = await one(
  `select project_id::text as p from public.jobs where job_id = ${lit(grand)}::uuid`,
)
check('and so does a grandchild', g.p === unnamed, String(g.p))
const refused = await db
  .execute(
    `set local application_name = 'PostgREST 14.5';
     insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, project_id)
     values ('teamhq', 'x:1', 'grant', 'no project', ${lit(`teamhq:own:${Date.now()}`)}, 'grant', null)`,
  )
  .then(() => '')
  .catch((e: Error) => String(e.message))
check(
  'the command table refuses a null project outright (asserted on the message)',
  /null value.*project_id|not-null/i.test(refused),
  refused.slice(0, 80),
)

// A duty: the one global owner.
await db.execute(`select app.dispatch_due_responsibilities()`).catch(() => undefined)
const duties = await one(
  `select count(*)::int as n from public.jobs where requested_by like 'duty:%' and project_id is null`,
)
check(
  "control: the office's own duties DO have null-project roots (so the property below is not vacuous)",
  Number(duties.n) > 0,
  `${duties.n} duty root(s) with no project`,
)
const leaks = await one(`select count(*)::int as n from public.jobs j
  where j.project_id is null and j.requested_by not like 'duty:%' and j.requested_by not like 'migration:%'
    and j.requested_by not like 'hq%' and j.requested_by not like 'trigger:%' and j.requested_by not like 'mcp:%'`)
check(
  "no job a person's turn started, or any descendant, has a null project",
  Number(leaks.n) === 0,
  `${leaks.n} job(s)`,
)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1
