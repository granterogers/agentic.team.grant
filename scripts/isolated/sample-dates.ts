/**
 * Migration 0902: a sample office keeps its dates believable.
 *
 *   npx tsx scripts/isolated/sample-dates.ts <replica-db>
 *
 * One transaction, rolled back. The function moves `due_on` and `starts_on` of every task in an ACTIVE SAMPLE office forward by
 * the days that have passed since the day it last moved them, and nothing else:
 *
 *   1. a sample task's dates move by exactly the elapsed days, and a task with no date stays without one;
 *   2. nothing else on the task moves: title, state, detail, created_at, done_at;
 *   3. a PERSON's office is untouched (the control that the rule is scoped, not global);
 *   4. a second run on the same day moves nothing (it is a daily tick, not an accumulator);
 *   5. the shift is capped, so a clock gone wrong cannot throw the story away;
 *   6. with no anchor yet it starts from the day the first task was made, and the anchor is remembered;
 *   7. SABOTAGE: take away the scoping predicate in a savepoint and the person's task must move (so check 3 can fail).
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string) => (await rows(sql))[0] ?? {}
const run = Date.now().toString(36)
const day = (n: number) => `(app.now_utc()::date + ${String(n)})`

try {
  await db.execute('begin')
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  const email = `sample-${run}@example.invalid`
  await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
  const made = (
    await one(
      `select app.provision_sample_office('Sample Office', ${lit(email)}, 'sample-${run}') as r`,
    )
  ).r
  const S = String(
    (typeof made === 'string' ? JSON.parse(made) : (made as { office_id?: string })).office_id ??
      '',
  )
  const project = async (office: string, slug: string) =>
    String(
      (
        await one(
          `insert into public.projects (slug, name, status, office_id) values ('${slug}-${run}', 'P', 'active', ${lit(office)}::uuid) returning project_id::text as id`,
        )
      ).id,
    )
  const SP = await project(S, 'sd-s')
  const OP = await project(op, 'sd-o')
  const task = async (
    office: string,
    proj: string,
    title: string,
    due: string,
    starts: string,
    state = 'todo',
  ) =>
    String(
      (
        await one(
          `insert into public.tasks (office_id, project_id, title, state, due_on, starts_on, done_at) values (${lit(office)}::uuid, ${lit(proj)}::uuid, ${lit(title)}, ${lit(state)}, ${due}, ${starts}, ${state === 'done' ? 'app.now_utc()' : 'null'}) returning task_id::text as id`,
        )
      ).id,
    )
  const t1 = await task(S, SP, 'dated', day(5), day(2))
  const t2 = await task(S, SP, 'undated', 'null', 'null')
  const t3 = await task(S, SP, 'finished', day(-1), 'null', 'done')
  const po = await task(op, OP, "a person's task", day(5), day(2))
  const get = async (id: string) =>
    (await one(
      `select due_on::text d, starts_on::text s, title, state::text st, created_at::text c, done_at::text dn from public.tasks where task_id = ${lit(id)}::uuid`,
    )) as {
      d: string | null
      s: string | null
      title: string
      st: string
      c: string
      dn: string | null
    }
  const before1 = await get(t1)
  const beforeDone = await get(t3)
  const beforePerson = await get(po)

  // The anchor three days ago: the Sample was last moved to then.
  await db.execute(
    `insert into public.system_config (key, value, description, updated_by) values ('sample.dates_anchor', to_jsonb((app.now_utc()::date - 3)::text), 'proof', 'proof') on conflict (key) do update set value = excluded.value`,
  )
  const r1 = (await one(`select app.sample_refresh_dates() as r`)).r as unknown
  const r = (typeof r1 === 'string' ? JSON.parse(r1) : r1) as {
    moved?: number
    shift_days?: number
  }
  check(
    'three days gone by: the function says it moved dates by 3',
    r.shift_days === 3 && (r.moved ?? 0) >= 2,
    JSON.stringify(r),
  )
  const a1 = await get(t1)
  const plus = async (iso: string | null, n: number) =>
    iso === null
      ? null
      : String((await one(`select (${lit(iso)}::date + ${String(n)})::text as d`)).d)
  check(
    'a dated task moved by exactly 3 days (due and start)',
    a1.d === (await plus(before1.d, 3)) && a1.s === (await plus(before1.s, 3)),
    `${String(before1.d)} -> ${String(a1.d)}`,
  )
  check(
    'an undated task stays undated',
    (await get(t2)).d === null && (await get(t2)).s === null,
    'null, null',
  )
  check(
    'nothing else on the task moved: title, state, creation and completion times',
    a1.title === before1.title &&
      a1.st === before1.st &&
      a1.c === before1.c &&
      (await get(t3)).dn === beforeDone.dn &&
      (await get(t3)).c === beforeDone.c,
    'unchanged',
  )
  check(
    "CONTROL: a person's office task did not move",
    (await get(po)).d === beforePerson.d && (await get(po)).s === beforePerson.s,
    String(beforePerson.d),
  )
  const anchor = String(
    (
      await one(
        `select value #>> '{}' as v from public.system_config where key = 'sample.dates_anchor'`,
      )
    ).v,
  )
  check(
    'the anchor is today now',
    anchor === String((await one(`select app.now_utc()::date::text as d`)).d),
    anchor,
  )

  // A second run the same day moves nothing.
  const r2raw = (await one(`select app.sample_refresh_dates() as r`)).r as unknown
  const r2 = (typeof r2raw === 'string' ? JSON.parse(r2raw) : r2raw) as {
    moved?: number
    shift_days?: number
  }
  check(
    'a second run the same day moves nothing',
    r2.moved === 0 && (await get(t1)).d === a1.d,
    JSON.stringify(r2),
  )

  // The cap: an anchor two years ago moves by 365, not 730.
  await db.execute(
    `update public.system_config set value = to_jsonb((app.now_utc()::date - 800)::text) where key = 'sample.dates_anchor'`,
  )
  const r3raw = (await one(`select app.sample_refresh_dates() as r`)).r as unknown
  const r3 = (typeof r3raw === 'string' ? JSON.parse(r3raw) : r3raw) as { shift_days?: number }
  check('the shift is capped at a year', r3.shift_days === 365, JSON.stringify(r3))

  // With no anchor: from the day the first task was made (today here), so nothing moves and the anchor is remembered.
  await db.execute(`delete from public.system_config where key = 'sample.dates_anchor'`)
  const r4raw = (await one(`select app.sample_refresh_dates() as r`)).r as unknown
  const r4 = (typeof r4raw === 'string' ? JSON.parse(r4raw) : r4raw) as { moved?: number }
  check(
    "with no anchor it starts from the first task's day and remembers it",
    r4.moved === 0 &&
      (await rows(`select 1 from public.system_config where key = 'sample.dates_anchor'`))
        .length === 1,
    JSON.stringify(r4),
  )

  // SABOTAGE: scope removed, the person's task must move.
  await db.execute('savepoint sab')
  await db.execute(
    `insert into public.system_config (key, value, description, updated_by) values ('sample.dates_anchor', to_jsonb((app.now_utc()::date - 2)::text), 'proof', 'proof') on conflict (key) do update set value = excluded.value`,
  )
  await db.execute(`alter function app.sample_refresh_dates() rename to sample_refresh_dates_real`)
  await db.execute(
    `create function app.sample_refresh_dates() returns jsonb language sql as $$ update public.tasks set due_on = due_on + 2 where due_on is not null returning jsonb_build_object('ok', true) $$`,
  )
  await db.execute(`select app.sample_refresh_dates()`)
  check(
    'SABOTAGE: without the scope the person task moves (so the control above can fail)',
    (await get(po)).d !== beforePerson.d,
    `${String(beforePerson.d)} -> ${String((await get(po)).d)}`,
  )
  await db.execute('rollback to savepoint sab')
  check(
    "restored: the person's task is where it was",
    (await get(po)).d === beforePerson.d,
    String((await get(po)).d),
  )
} finally {
  await db.execute('rollback').catch(() => undefined)
}
const passed = results.filter(Boolean).length
console.log(`\n${String(passed)}/${String(results.length)} passed`)
process.exit(passed === results.length ? 0 : 1)
