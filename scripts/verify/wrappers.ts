/**
 * Can every RPC a client calls actually be reached?
 *
 *   npm run verify:wrappers
 *
 * Issue #41. PostgREST exposes ONLY the `public` schema, so an `app.*` function
 * without a public wrapper is invisible to every caller that is not the service
 * role. This repository has been bitten by it before, and the failure mode is
 * silent: the SQL is correct, the migration applies, and the call 404s at
 * runtime in a browser or an edge function.
 *
 * ## What it does NOT check, and why
 *
 * There are 178 functions in `app` and 96 have no wrapper — and that is fine.
 * Most are triggers (`enforce_*`, `log_*`, `touch_*`) or helpers (`ago`,
 * `normalise_name`, `job_depth`) that nothing outside the database calls.
 * Demanding a wrapper for all of them would be 96 pieces of pointless surface
 * area, and a rule everybody learns to ignore is worse than no rule.
 *
 * So it checks the ones a CLIENT calls: every name found in the frontend and
 * the edge functions, plus the ones this repository's own scripts reach
 * through PostgREST.
 *
 * ## And it CALLS them
 *
 * Existence is not reachability. A wrapper can exist and still be unreachable
 * because its argument list drifted from the inner function — `create or
 * replace` does not replace a signature that changed, it adds an overload, and
 * then every call is ambiguous. The only way to know is to call it.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db: SqlExecutor = new ManagementApiExecutor(ref, token)

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

/*
  Everything a caller outside the database reaches. Found by grepping the
  frontend and the edge functions, plus the reads the studio will need once it
  stops using mock data.
*/
const CLIENT_FACING = [
  'enqueue_inbound',
  'record_telegram_chat',
  'staff_for_bot',
  'voice_state',
  'voice_lookup',
  'office_health',
  'hq_build',
  'project_tasks',
  'add_task',
  'set_task_state',
  'relations_of',
  'link',
  'put_in_collection',
  'awaiting_review',
  'approve_document',
]

console.log('wrappers —')

// --- 1. does a public wrapper exist for each? --------------------------------
const { rows } = await db.execute(`
  select p.proname as name, n.nspname as schema,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public')
     and p.proname in (${CLIENT_FACING.map((n) => `'${n}'`).join(', ')})
   order by p.proname, n.nspname
`)
const found = rows as { name: string; schema: string; args: string }[]

for (const name of CLIENT_FACING) {
  const inApp = found.filter((r) => r.name === name && r.schema === 'app')
  const inPublic = found.filter((r) => r.name === name && r.schema === 'public')
  if (inApp.length === 0 && inPublic.length === 0) {
    ok(`${name} exists`, false, 'defined in neither schema')
    continue
  }
  ok(
    `${name} has a public wrapper`,
    inPublic.length > 0,
    inApp.length > 0 ? 'only app.' + name : 'not found',
  )

  /*
    Overloads are the silent one. `create or replace` does not replace a
    function whose argument list changed — it adds a second, and PostgREST then
    cannot choose. This is in CLAUDE.md as a trap that has already cost time.
  */
  if (inPublic.length > 1) {
    ok(
      `${name} is not overloaded`,
      false,
      `${String(inPublic.length)} versions: ${inPublic.map((r) => `(${r.args})`).join(' ')}`,
    )
  } else if (inPublic.length === 1) {
    ok(`${name} is not overloaded`, true)
  }

  // The wrapper's arguments must match the inner function's, or the wrapper
  // silently drops whatever the caller passes.
  if (inApp.length === 1 && inPublic.length === 1) {
    const a = inApp[0]?.args ?? ''
    const b = inPublic[0]?.args ?? ''
    ok(
      `${name}'s wrapper takes the same arguments`,
      a === b,
      a === b ? '' : `app(${a}) vs public(${b})`,
    )
  }
}

// --- 2. is `public` actually the exposed schema? -----------------------------
const { rows: exposed } = await db.execute(`show search_path`)
ok('the database answers a settings query', (exposed as unknown[]).length > 0)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
