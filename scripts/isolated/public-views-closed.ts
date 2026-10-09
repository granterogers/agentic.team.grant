/**
 * #457 (1053): a public key reaches no view in `public`, and the office's own roles still read every one of them.
 *
 *   npx tsx scripts/isolated/public-views-closed.ts <replica-db>
 *   SABOTAGE_NO_FIX=1 npx tsx scripts/isolated/public-views-closed.ts <replica-db>     # the proof must go RED
 *
 * Behavioural, with synthetic data only (no real credential, person or message). The roles are ASSUMED and the views are READ:
 *   1. reproduce what production's catalogue showed (9 Oct 2026): `anon` and `authenticated` hold SELECT on every view in `public`;
 *   2. with that grant, a public role reads other offices' synthetic decisions and lessons through the views (the exposure, shown, so
 *      the later refusal means something), while the same role is refused the tables the views read (row security holds there);
 *   3. apply migrations/1053_*.sql (skipped under SABOTAGE_NO_FIX, which is how this proof is shown able to fail);
 *   4. every public view is refused to anon, to an authenticated person of office A and to one of office B;
 *   5. positive controls: service_role, ai_team_app and postgres still read every view (a fix that revokes everything from everybody is
 *      not a fix), and the views still return the synthetic rows to them;
 *   6. a view created AFTER the fix gets no grant to a public key (the default-privilege half);
 *   7. what the views can return: no contacts, mail, messages, documents or vault VALUE is reachable through any of them, and no column is
 *      named like a credential (the two `secret_ref` columns are vault ids, not values; the proof states that).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'public_views')
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string): void => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>

/** Run `sql` as `role` (with a JWT subject when given) in a transaction that is always rolled back; the error, or the first row. */
const asRole = async (
  role: string,
  sql: string,
  sub?: string,
): Promise<{ error: string; row: Record<string, unknown> | null }> => {
  try {
    const claim =
      sub === undefined
        ? ''
        : `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub, role }))}, true);`
    await db.execute('begin')
    await db.execute(`set local role ${role}; ${claim}`)
    const { rows } = await db.execute(sql)
    return { error: '', row: (rows[0] as Record<string, unknown> | undefined) ?? null }
  } catch (e) {
    return { error: String((e as Error).message), row: null }
  } finally {
    await db.execute('rollback').catch(() => undefined)
  }
}

// ---- synthetic fixtures: two offices, each with one decision and one lesson that the other must never read --------------------
const run = Math.random().toString(36).slice(2, 8)
const mkOffice = async (tag: string): Promise<{ office: string; user: string }> => {
  const user = String(
    (
      await one(
        `insert into auth.users (id, email) values (gen_random_uuid(), ${lit(`synthetic-${tag}-${run}@invalid.example`)}) returning id`,
      )
    ).id,
  )
  const office = String(
    (
      await one(
        `insert into public.offices (kind, name, auth_user_id) values ('person', ${lit(`Synthetic ${tag} ${run}`)}, ${lit(user)}::uuid) returning office_id`,
      )
    ).office_id,
  )
  await db.execute(
    `insert into public.decisions (question, chose, ruled_out, because, decided_by, office_id)
     values (${lit(`SYNTHETIC-${tag}-${run} question`)}, 'x', '{}', ${lit(`SYNTHETIC-${tag}-${run} private reasoning`)}, ${lit(`verify:public-views-${run}`)}, ${lit(office)}::uuid)`,
  )
  await db.execute(
    `insert into public.lessons (scope, body, learned_by, office_id)
     values ('global', ${lit(`SYNTHETIC-${tag}-${run} standing rule`)}, ${lit(`verify:public-views-${run}`)}, ${lit(office)}::uuid)`,
  )
  return { office, user }
}
const A = await mkOffice('A')
const B = await mkOffice('B')

const views = (
  await db.execute(
    `select c.relname as v from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') order by 1`,
  )
).rows.map((r) => String((r as { v: string }).v))
check('the inspection saw the views at all', views.length >= 14, `${String(views.length)} view(s)`)

// ---- 1. the production state, reproduced -----------------------------------------------------------------------------------
await db.execute(
  `grant usage on schema public to anon, authenticated, service_role;
   grant select, insert, update, delete on all tables in schema public to anon, authenticated;
   grant all on all tables in schema public to service_role`,
)
/** The views a role may select, by the catalogue: the set the fix must leave exactly as it found it. */
const readableBy = async (role: string): Promise<string[]> =>
  (
    await db.execute(
      `select c.relname as v from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and has_table_privilege(${lit(role)}, c.oid, 'select')
        order by 1`,
    )
  ).rows.map((r) => String((r as { v: string }).v))
const officeRoles = ['service_role', 'ai_team_app', 'postgres']
const readableBefore = new Map<string, string[]>()
for (const role of officeRoles) readableBefore.set(role, await readableBy(role))
const reachable = async (): Promise<string[]> =>
  (
    await db.execute(
      `select c.relname as v from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
          and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
        order by 1`,
    )
  ).rows.map((r) => String((r as { v: string }).v))
const before = await reachable()
check(
  'CONTROL: with the platform default grants, a public key can SELECT every view (production catalogue, F15 to F18)',
  before.length === views.length,
  `${String(before.length)} of ${String(views.length)}`,
)

// ---- 2. the exposure, shown, and the table-level contrast --------------------------------------------------------------------
// (the candidate database already carries 1053, which found nothing to revoke before the grant above re-created production's state)
const exposedA = await asRole(
  'authenticated',
  `select count(*)::int as n from public.decisions_live where question like ${lit(`SYNTHETIC-A-${run}%`)}`,
  B.user,
)
check(
  "EXPOSURE SHOWN: an authenticated person of office B reads office A's decision through the real view decisions_live",
  exposedA.error === '' && Number(exposedA.row?.n) === 1,
  exposedA.error || `${String(exposedA.row?.n)} row(s)`,
)
const exposedAnon = await asRole(
  'anon',
  `select count(*)::int as n from public.lessons_live where body like ${lit(`SYNTHETIC-B-${run}%`)}`,
)
check(
  "EXPOSURE SHOWN: anon reads office B's standing rule through the real view lessons_live",
  exposedAnon.error === '' && Number(exposedAnon.row?.n) === 1,
  exposedAnon.error || `${String(exposedAnon.row?.n)} row(s)`,
)
const tableRead = await asRole(
  'anon',
  `select count(*)::int as n from public.decisions where question like ${lit(`SYNTHETIC-A-${run}%`)}`,
)
check(
  'CONTRAST: the same role reads none of that from the table itself (row security holds on a table)',
  tableRead.error === '' && Number(tableRead.row?.n) === 0,
  tableRead.error || `${String(tableRead.row?.n)} row(s)`,
)
// ---- 3. the fix --------------------------------------------------------------------------------------------------------------
const file = readdirSync('migrations').find((f) => f.startsWith('1053_'))
check('the migration exists and is numbered after 1052', file !== undefined, String(file))
if (process.env.SABOTAGE_NO_FIX === undefined && file !== undefined) {
  await db.execute(readFileSync(`migrations/${file}`, 'utf8'))
} else console.log('      SABOTAGE_NO_FIX: the migration is NOT applied')

// ---- 4. every view refused to a public key ------------------------------------------------------------------------------------
const left = await reachable()
check(
  'no public view is selectable by anon or authenticated (catalogue)',
  left.length === 0,
  left.length === 0 ? 'none' : left.join(', '),
)
const failures: string[] = []
for (const v of views) {
  const checks: [string, string, string | undefined][] = [
    ['anon', `select * from public.${v} limit 1`, undefined],
    ['authenticated', `select * from public.${v} limit 1`, A.user],
    ['authenticated', `select * from public.${v} limit 1`, B.user],
  ]
  for (const [role, sql, sub] of checks) {
    const r = await asRole(role, sql, sub)
    if (!/permission denied/i.test(r.error))
      failures.push(`${role}:${v}:${r.error.slice(0, 60) || 'READ'}`)
  }
}
check(
  'every view refuses anon, an office A person and an office B person with a permission error (not an empty result)',
  failures.length === 0,
  failures.length === 0
    ? `${String(views.length * 3)} attempts refused`
    : failures.slice(0, 4).join('; '),
)

// ---- 5. positive controls ---------------------------------------------------------------------------------------------------
for (const role of officeRoles) {
  const now = await readableBy(role)
  const was = readableBefore.get(role) ?? []
  check(
    `CONTROL: the fix changed nothing for ${role} (the views it may select are exactly the set it had)`,
    now.length === was.length && now.every((v, i) => v === was[i]),
    `${String(was.length)} before, ${String(now.length)} after`,
  )
}
/** The views a role can actually READ now (a view that calls a function the role may not execute is refused for a reason unrelated to this fix). */
const readNow = async (role: string): Promise<string[]> => {
  const ok: string[] = []
  for (const v of views)
    if ((await asRole(role, `select count(*) from public.${v}`)).error === '') ok.push(v)
  return ok
}
const postgresReads = await readNow('postgres')
check(
  'CONTROL: postgres (the owner) still reads every view',
  postgresReads.length === views.length,
  `${String(postgresReads.length)} of ${String(views.length)}`,
)
const serviceReads = await readNow('service_role')
check(
  'CONTROL: service_role still reads every view it could read before (the two that call app.harness_job are refused for that reason, before and after)',
  serviceReads.length >= views.length - 2 &&
    serviceReads.length === (readableBefore.get('service_role') ?? []).length - 2,
  `${String(serviceReads.length)} of ${String(views.length)} readable`,
)
const owned = await asRole(
  'service_role',
  `select count(*)::int as n from public.decisions_live where question like ${lit(`SYNTHETIC-%-${run}%`)}`,
)
check(
  "CONTROL: the office's own role still reads both synthetic decisions through the view",
  Number(owned.row?.n) === 2,
  owned.error || `${String(owned.row?.n)} row(s)`,
)

// ---- 6. a view made later is closed by default ---------------------------------------------------------------------------------
await db.execute(`create view public.zz_later_view as select 1 as x`)
const later = await asRole('anon', 'select * from public.zz_later_view')
const laterAuth = await asRole('authenticated', 'select * from public.zz_later_view', A.user)
check(
  'a view created after the fix is refused to a public key (default privileges)',
  /permission denied/i.test(later.error) && /permission denied/i.test(laterAuth.error),
  later.error || laterAuth.error || 'READABLE',
)
await db.execute('drop view public.zz_later_view')

// ---- 7. what the views can return ---------------------------------------------------------------------------------------------
const deps = (
  await db.execute(
    `select distinct c.relname as t
       from pg_class v join pg_rewrite r on r.ev_class = v.oid
       join pg_depend d on d.objid = r.oid and d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
       join pg_class c on c.oid = d.refobjid
      where v.relnamespace = 'public'::regnamespace and v.relkind in ('v', 'm') and d.refobjid <> v.oid and c.relkind in ('r', 'p', 'f')
      order by 1`,
  )
).rows.map((r) => String((r as { t: string }).t))
const personal = deps.filter((t) =>
  /^(contacts?|contact_.*|mail_.*|messages?|inbound_commands|outputs|documents|document_chunks|conversation.*|browser_.*|tasks|personal_.*)$/.test(
    t,
  ),
)
check(
  'no view reads contacts, mail, messages, documents, outputs, tasks or browser data',
  personal.length === 0,
  personal.length === 0 ? `reads: ${deps.join(', ')}` : personal.join(', '),
)
const cols = (
  await db.execute(
    `select table_name as v, column_name as c from information_schema.columns
      where table_schema = 'public' and table_name = any (select viewname from pg_views where schemaname = 'public')`,
  )
).rows as { v: string; c: string }[]
const credLike = cols.filter(
  (x) =>
    /(^|_)(token|password|passwd|api_key|apikey|secret|credential|key)$/.test(x.c) &&
    x.c !== 'secret_ref',
)
check(
  'no view column is named like a credential value (secret_ref is a vault id, not the value)',
  credLike.length === 0,
  credLike.length === 0
    ? `${String(cols.length)} columns inspected`
    : credLike.map((x) => `${x.v}.${x.c}`).join(', '),
)
const vaultValue = (
  await db.execute(
    `select count(*)::int as n from pg_views where schemaname = 'public' and definition ~* '(decrypted_secret|vault\\.decrypted_secrets)'`,
  )
).rows[0] as { n: number }
check('no view reads a decrypted vault value', Number(vaultValue.n) === 0, String(vaultValue.n))

const failed = results.filter((r) => !r.ok).length
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) failed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
