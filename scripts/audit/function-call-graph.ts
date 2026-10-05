/**
 * Who calls whom among the database functions (multi-user P0 inventory, #400).
 *
 *   npx tsx scripts/audit/function-call-graph.ts            # writes docs/multi-user/function-call-graph.tsv
 *
 * The ownership phase converts functions to take `(p_office, ...)`. A converted function that ignores its office is
 * invisible to a signature check, so the conversion set has to be derived, and the order matters: callers and
 * callees change together. This reads production's catalogue (read-only) and writes one row per distinct
 * caller -> callee pair among functions in `app` and `public`, found by matching a qualified call in the body.
 *
 * It is a regex over source, so it OVER-reports (a name inside a string) and can miss a call built by `execute
 * format(...)`; the second is why the phase's per-function attack tests exist. Over-reporting is the safe side
 * of an inventory.
 */
import { writeFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

export const CALL_GRAPH_SQL = `
  with f as (
    select n.nspname, p.proname, p.prosrc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public') and p.prokind = 'f'
       and p.prolang in (select oid from pg_language where lanname in ('plpgsql', 'sql'))),
  names as (select distinct nspname, proname from f)
  select distinct f.nspname || '.' || f.proname as caller, m[1] || '.' || m[2] as callee
    from f, lateral regexp_matches(f.prosrc, '\\y(app|public)\\.([a-z_][a-z0-9_]*)\\s*\\(', 'g') m
   where exists (select 1 from names n where n.nspname = m[1] and n.proname = m[2])
     and f.nspname || '.' || f.proname <> m[1] || '.' || m[2]
   order by 1, 2`

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is required')
    process.exit(2)
  }
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    token,
  )
  const rows = (await db.execute(CALL_GRAPH_SQL)).rows as { caller: string; callee: string }[]
  if (rows.length < 100) {
    console.error(`only ${String(rows.length)} call pair(s): the scan looked at too little`)
    process.exit(1)
  }
  writeFileSync(
    'docs/multi-user/function-call-graph.tsv',
    `caller\tcallee\n${rows.map((r) => `${r.caller}\t${r.callee}`).join('\n')}\n`,
  )
  console.log(
    `${String(rows.length)} caller -> callee pair(s) written to docs/multi-user/function-call-graph.tsv`,
  )
}
