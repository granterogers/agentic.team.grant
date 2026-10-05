/**
 * P4 step 10: break the isolation on purpose, watch the detector go RED, restore, watch it go GREEN.
 *   npx tsx scripts/p4/sabotage.ts
 *
 * Nothing here is ever committed to production. Each database sabotage runs INSIDE one statement that ends in a
 * deliberate exception, so the defect exists only for the length of that statement and for nobody else: the same
 * statement measures the green state, applies the defect, prints something that proves it LANDED, measures the red
 * state, and raises (rolling everything back) with the three numbers. A sabotage that did not apply is not a passing
 * control, so each one asserts its own landing before its red is believed. After each, the live definition is compared
 * to what it was and the detector is run again outside the statement: green.
 */
import { createHash } from 'node:crypto'
import { insertsWithoutOffice } from '../p3/check-carrier-writers.ts'
import { check, db, results, SECOND_OFFICE } from './lib.ts'

const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const md5 = async (sig: string): Promise<string> =>
  String((await rows(`select md5(pg_get_functiondef('${sig}'::regprocedure)) v`))[0]?.v)

/** Run a do-block that ends in `raise exception 'P4SAB %', <json>` and hand the json back. */
const sab = async (body: string): Promise<Record<string, unknown>> => {
  try {
    await db.execute(`do $sab$ ${body} $sab$`)
  } catch (e) {
    const m = /P4SAB (\{.*\})/s.exec(String((e as Error).message))
    if (m?.[1] !== undefined) return JSON.parse(m[1]) as Record<string, unknown>
    throw e
  }
  throw new Error('the sabotage block did not raise, so it would have been COMMITTED')
}

const grantNames = `(select coalesce(array_agg(distinct name), '{}') from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 5)`

// ---- S1: remove the office filter from a read
{
  const sig = 'public.hq_projects(uuid)'
  const before = await md5(sig)
  const r = await sab(`
    declare g text[] := ${grantNames}; green int; red int; landed boolean; v_before text;
    begin
      select count(*) into green from jsonb_array_elements(public.hq_projects('${SECOND_OFFICE}'::uuid)) e where e->>'name' = any(g);
      create or replace function public.hq_projects(p_office uuid) returns jsonb language sql security definer set search_path = 'public' as
        $f$ select coalesce(jsonb_agg(jsonb_build_object('name', name, 'slug', slug)), '[]'::jsonb) from public.projects $f$;
      landed := pg_get_functiondef('${sig}'::regprocedure) !~ 'office_id';
      select count(*) into red from jsonb_array_elements(public.hq_projects('${SECOND_OFFICE}'::uuid)) e where e->>'name' = any(g);
      raise exception 'P4SAB %', json_build_object('green', green, 'red', red, 'landed', landed);
    end`)
  check('S1 remove the office filter from a read: the sabotage LANDED', r.landed === true)
  check(
    "S1 ...and the detector (Grant's names in the second office's read) is GREEN before and RED during",
    r.green === 0 && Number(r.red) > 0,
    JSON.stringify(r),
  )
  check(
    'S1 restore: the live definition is byte-identical to what it was',
    (await md5(sig)) === before,
  )
  const after = await rows(
    `select count(*)::int n from jsonb_array_elements(public.hq_projects('${SECOND_OFFICE}'::uuid)) e where e->>'name' = any(${grantNames}::text[])`,
  )
  check('S1 green again after restore', Number(after[0]?.n) === 0)
}

// ---- S2: a login that resolves to no office falls back to Grant (the person fallback, restored)
{
  const sig = 'public.resolve_office(uuid)'
  const before = await md5(sig)
  const r = await sab(`
    declare green jsonb; red jsonb; landed boolean; nobody uuid := gen_random_uuid();
    begin
      green := public.resolve_office(nobody);
      create or replace function public.resolve_office(p_auth_user_id uuid) returns jsonb language sql security definer set search_path = 'public' as
        $f$ select jsonb_build_object('ok', true, 'office_id', app.operator_office()) $f$;
      landed := pg_get_functiondef('${sig}'::regprocedure) ~ 'operator_office';
      red := public.resolve_office(nobody);
      raise exception 'P4SAB %', json_build_object('green', green, 'red', red, 'landed', landed);
    end`)
  const g = r.green as { ok?: boolean }
  const rd = r.red as { ok?: boolean; office_id?: string }
  check('S2 restore a Grant fallback for an unknown login: the sabotage LANDED', r.landed === true)
  check(
    'S2 ...an unknown login is refused (green) and, with the fallback, becomes Grant (red)',
    g.ok !== true && rd.ok === true && typeof rd.office_id === 'string',
    JSON.stringify(r),
  )
  check('S2 restore: byte-identical', (await md5(sig)) === before)
  const after = await rows(`select (public.resolve_office(gen_random_uuid()) ->> 'ok') v`)
  check(
    'S2 green again after restore: an unknown login resolves to nothing',
    after[0]?.v !== 'true',
    String(after[0]?.v),
  )
}

// ---- S3: the sole-person shortcut comes back (it must be NULL while two people exist)
{
  const sig = 'app.sole_person_office()'
  const before = await md5(sig)
  const r = await sab(`
    declare green uuid; red uuid; landed boolean;
    begin
      green := app.sole_person_office();
      create or replace function app.sole_person_office() returns uuid language sql stable as $f$ select app.operator_office() $f$;
      landed := pg_get_functiondef('${sig}'::regprocedure) ~ 'operator_office';
      red := app.sole_person_office();
      raise exception 'P4SAB %', json_build_object('green', green, 'red', red, 'landed', landed);
    end`)
  check('S3 bring back the sole-person shortcut: the sabotage LANDED', r.landed === true)
  check(
    'S3 ...fails closed (null) with two people, and names Grant when broken',
    r.green === null && typeof r.red === 'string',
    JSON.stringify(r),
  )
  check(
    'S3 restore: byte-identical, and still null',
    (await md5(sig)) === before && (await rows(`select app.sole_person_office() v`))[0]?.v === null,
  )
}

// ---- S4: a writer may omit its office (the check that reads every function body)
{
  const tables = (
    (await rows(
      `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'office_id' and not a.attisdropped where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'offices'`,
    )) as { t: string }[]
  ).map((r) => r.t)
  const fn = (
    await rows(
      `select pg_get_functiondef('public.my_task_add(uuid,text,text,date,timestamptz,integer,text,text[],text)'::regprocedure) d, prosrc from pg_proc where oid = 'public.my_task_add(uuid,text,text,date,timestamptz,integer,text,text[],text)'::regprocedure`,
    )
  )[0] as { prosrc: string }
  const body = fn.prosrc
  // the writer this body calls is the one that inserts; inspect the app function it delegates to as well
  const inner = String(
    (
      await rows(
        `select string_agg(p.prosrc, E'\\n') v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('my_task_add', 'task_add')`,
      )
    )[0]?.v,
  )
  const source = `${body}\n${inner}`
  const clean = insertsWithoutOffice(source, tables)
  const broken = insertsWithoutOffice(
    source.replace(
      /insert\s+into\s+(?:public\.)?tasks\s*\(\s*office_id\s*,/gi,
      'insert into public.tasks (',
    ),
    tables,
  )
  check(
    'S4 control: the live writer names its office (green)',
    clean.length === 0,
    JSON.stringify(clean),
  )
  const hadInsert = /insert\s+into\s+(?:public\.)?tasks\s*\(\s*office_id\s*,/i.test(source)
  check(
    'S4 the sabotage could be applied to the real source (it contains the insert it removes office_id from)',
    hadInsert,
  )
  check(
    'S4 ...and the detector goes RED on the sabotaged source',
    broken.length > 0,
    JSON.stringify(broken),
  )
  check(
    'S4 restore (the original text is untouched): green again',
    insertsWithoutOffice(source, tables).length === 0,
  )
}

// ---- nothing above survived: no definition changed, no row appeared
const sha = createHash('sha256')
  .update(
    String(
      (
        await rows(
          `select string_agg(md5(pg_get_functiondef(p.oid)), '' order by p.oid) v from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','public') and p.proname in ('hq_projects','resolve_office','sole_person_office')`,
        )
      )[0]?.v,
    ),
  )
  .digest('hex')
console.log(`   definitions fingerprint after all sabotage: ${sha.slice(0, 12)}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
