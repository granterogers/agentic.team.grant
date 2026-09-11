/**
 * Can the office say what it could not do, in a form something can count?
 *
 *   npm run verify:impediments
 *
 * Issue #47, and the foundation #49 is built on. Exercises 0184 and 0185 against
 * the real database.
 *
 * The check this file exists for is the fixture one. `jobs.is_fixture` exists
 * because 264 harness jobs were once reported to Grant as the office
 * collapsing; here the same mistake would manufacture PROPOSALS out of
 * verification noise — the office asking him for a LinkedIn account because a
 * test pretended it needed one. So the suite creates a fixture job, records an
 * impediment against it, and requires the tally not to see it. Everything this
 * file writes is invisible to the thing it is testing, which is the point.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const refuses = async (what: string, sql: string) => {
  try {
    await db.execute(sql)
    ok(what, false, 'it was allowed')
  } catch {
    ok(what, true)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const NEED = `verify-tool-${run}`
// Recorded exactly once, so the "one occurrence is not a pattern" check has a
// subject that cannot be confused with the recurring one.
const SOLO = `verify-solo-${run}`
const who = 'growth-director'

console.log('impediments —')

/*
  A fixture job.

  `requested_by` is what `jobs.is_fixture` is GENERATED from, so the prefix is
  not cosmetic — it is the only thing that makes this job invisible to the
  tally, which is the property under test.
*/
const job = await one(`
  insert into public.jobs
    (correlation_id, idempotency_key, kind, requested_by, recipient_agent, state, priority)
  values (extensions.gen_random_uuid(), ${lit(`imp-fixture-${run}`)}, 'research.probe',
          ${lit(`verify:impediments-${run}`)}, ${lit(who)}, 'queued', 100)
  returning job_id, is_fixture
`)
const jid = String(job.job_id)
ok('the fixture job is recognised as one', job.is_fixture === true)

// --- recording --------------------------------------------------------------

const said = await one(`
  select public.job_cannot(${lit(jid)}::uuid, 'missing_tool', ${lit(NEED)},
    ${lit(who)}, 'Asked to publish the module summary; there is no connector.',
    'Publish the Legacy module summary somewhere public') as r
`)
const rec = said.r as { impediment_id?: string; needed?: string; counted?: boolean }
ok('an agent can say what it could not do', String(rec.impediment_id ?? '') !== '')
ok(
  'and record what it believed it was asked, not only that it failed',
  (
    await all(
      `select understood_as u from public.job_impediments where impediment_id = ${lit(String(rec.impediment_id))}::uuid`,
    )
  ).some((r) => String(r.u).includes('Legacy module summary')),
)

// --- the fixture property, which is why this file exists --------------------

ok(
  'a fixture job says so at the moment it is recorded',
  rec.counted === false,
  `counted was ${String(rec.counted)}`,
)

{
  // Enough repetitions that it would certainly appear if fixtures counted.
  for (let i = 0; i < 4; i++) {
    await db.execute(`
      select public.job_cannot(${lit(jid)}::uuid, 'missing_tool', ${lit(NEED)},
        ${lit(who)}, 'Again.', 'Publish it')
    `)
  }
  const tally = await all(
    `select needed from public.impediments_tally(30, 2) where needed = ${lit(NEED)}`,
  )
  ok(
    'and five of them still do not reach the tally',
    tally.length === 0,
    'verification noise would have become a proposal to Grant',
  )
}

{
  // The caller does not get a say — 0185's trigger overrides whatever is passed.
  const forced = await one(`
    insert into public.job_impediments
      (job_id, kind, needed_raw, noticed_by, is_fixture)
    values (${lit(jid)}::uuid, 'missing_tool', ${lit(NEED)}, 'verify:impediments', false)
    returning is_fixture
  `)
  ok(
    'a caller claiming its fixture work is real is overruled',
    forced.is_fixture === true,
    'harness traffic could present itself as the office struggling',
  )
}

{
  await db.execute(`
    select public.job_cannot(${lit(jid)}::uuid, 'missing_data', ${lit(SOLO)},
      ${lit(who)}, 'Seen exactly once.')
  `)
}

// --- the countable handle ---------------------------------------------------

{
  await db.execute(`
    select public.job_cannot(${lit(jid)}::uuid, 'missing_tool', ${lit(`  ${NEED.toUpperCase()}  `)},
      ${lit(who)}, 'Same wall, different spelling.')
  `)
  const spellings = await all(`
    select distinct needed from public.job_impediments
     where job_id = ${lit(jid)}::uuid and kind = 'missing_tool'
  `)
  ok(
    'four agents hitting one wall group together, whatever they typed',
    spellings.length === 1,
    `${spellings.length} spellings of the same handle`,
  )
}

await refuses(
  'a handle too vague to group on is refused',
  `insert into public.job_impediments (job_id, kind, needed_raw, noticed_by)
   values (${lit(jid)}::uuid, 'missing_tool', 'x', 'verify:impediments')`,
)
await refuses(
  'and one long enough to be a sentence is refused',
  `insert into public.job_impediments (job_id, kind, needed_raw, noticed_by)
   values (${lit(jid)}::uuid, 'missing_tool', ${lit('a'.repeat(65))}, 'verify:impediments')`,
)
await refuses(
  'an impediment with no stated observer is refused',
  `insert into public.job_impediments (job_id, kind, needed_raw, noticed_by)
   values (${lit(jid)}::uuid, 'missing_tool', ${lit(NEED)}, '  ')`,
)
{
  const missing = await one(`
    select public.job_cannot('00000000-0000-0000-0000-000000000000'::uuid,
      'missing_tool', ${lit(NEED)}, 'verify:impediments') as r
  `)
  ok(
    'an impediment against a job that does not exist is refused',
    String((missing.r as { error?: string })?.error ?? '') !== '',
  )
}

// --- append-only ------------------------------------------------------------

await refuses(
  'an impediment cannot be edited',
  `update public.job_impediments set detail = 'never mind' where job_id = ${lit(jid)}::uuid`,
)
await refuses(
  'and a retry that succeeds cannot erase it',
  `delete from public.job_impediments where job_id = ${lit(jid)}::uuid`,
)

// --- no credential in here either -------------------------------------------
//
// Built at run time. A file holding a credential-shaped literal is a file that
// gets pasted into an issue one day, and check:secrets is right to refuse it.

{
  const shape = (...parts: string[]) => parts.join('')
  await refuses(
    'a credential cannot hide in the detail an agent writes',
    `select public.job_cannot(${lit(jid)}::uuid, 'missing_tool', ${lit(NEED)},
       'verify:impediments', ${lit(shape('It works with ', 'ghp', '_', 'abcdefghijklmnopqrstuvwxyz012345'))})`,
  )
  ok(
    'and the check is the same one lessons uses, not a second copy',
    (
      await all(`
        select pg_get_functiondef(p.oid) d from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname = 'reject_credential_text'
      `)
    ).some((r) => String(r.d).includes('reject_credential_text_on')),
    'lessons still carries its own copy of the pattern; they will drift',
  )
}

// --- the tally, exercised without leaving anything behind --------------------
//
// Using FIXTURE rows and the inner function's seam (0186). The alternative was
// real rows, and since impediments are append-only, every run of this suite
// would leave two permanent entries the office could never count away — until
// it eventually proposed that Grant buy a connector called
// `verify-tool-mtwjh76u`. A test suite manufacturing the exact failure it
// exists to prevent, one run at a time.

{
  const once = await all(
    `select times from app.impediments_tally(30, 2, true) where needed = ${lit(SOLO)}`,
  )
  ok('one occurrence is not a pattern, and does not reach the tally', once.length === 0)

  const tally = await all(`
    select times, staff_slug, for_instance, kind::text k
      from app.impediments_tally(30, 2, true) where needed = ${lit(NEED)}
  `)
  ok(
    'a limitation that keeps recurring does',
    tally.length === 1 && Number(tally[0]?.times) >= 5,
    `${tally.length} row(s), ${String(tally[0]?.times ?? 0)} times`,
  )
  ok('and the tally says whose problem it is', String(tally[0]?.staff_slug ?? '') === who)
  ok(
    'and carries a real sentence a proposal can quote',
    String(tally[0]?.for_instance ?? '').trim() !== '',
  )
  ok('and which of the six kinds it is', String(tally[0]?.k ?? '') === 'missing_tool')
}

// --- the seam is closed on every path a client can reach --------------------
//
// A seam nobody checks is a hole.

{
  const viaWrapper = await all(
    `select needed from public.impediments_tally(30, 1) where needed = ${lit(NEED)}`,
  )
  ok(
    'and none of it is visible through the public wrapper',
    viaWrapper.length === 0,
    'harness traffic reached the path a client calls',
  )

  const def = await one(`
    select pg_get_functiondef(p.oid) d from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'impediments_tally'
  `)
  ok(
    'because the wrapper hard-codes the exclusion rather than passing it through',
    String(def.d ?? '').includes('false'),
    'the public wrapper can be asked for fixtures',
  )

  const overloads = await all(`
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'impediments_tally'
  `)
  ok(
    'and there is exactly one of it, so no call is ambiguous',
    overloads.length === 1,
    `${overloads.length} overloads — create or replace does not replace a changed signature`,
  )
}

// --- wrappers ---------------------------------------------------------------

{
  const wrapped = await all(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('job_cannot', 'impediments_tally')
  `)
  ok('both RPCs have public wrappers', new Set(wrapped.map((r) => String(r.proname))).size === 2)
}

// --- tidy up ----------------------------------------------------------------
//
// Nothing to undo. Everything this suite wrote hangs off a fixture job, so it
// is invisible to `public.impediments_tally` — the only path anything in the
// product calls — and `purge:fixtures` owns the job itself. The impediments
// cannot be deleted, and should not be: they are the ledger.

{
  const leaked = await all(
    `select needed from public.impediments_tally(30, 1)
      where needed in (${lit(NEED)}, ${lit(SOLO)})`,
  )
  ok(
    'the suite leaves nothing that could ever become a proposal to Grant',
    leaked.length === 0,
    `${leaked.length} entries reachable from the product`,
  )
  await db.execute(`
    update public.jobs set state = 'cancelled', state_reason = 'verification cleanup'
     where job_id = ${lit(jid)}::uuid
  `)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
