/**
 * The fixed set of READ-ONLY production queries the stabilisation rollout needs, by name. Nothing else can be asked with it.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q1     which of 0892-0905 and 1023-1029 are applied
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q2     heap, index and TOAST bytes per relation, largest 30
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q3     live and dead rows, bytes per live row, HOT percentage
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q4     the 20 largest indexes and whether they are used
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts defs   the live definitions of the nine functions the four steps touch
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts attrs  security definer, volatility, search_path, grants and owner of them
 *
 * Q1 to Q4 are docs/performance/db-growth-readonly-query-set.md, unchanged: catalog and statistics only, no table rows are read.
 * `defs` writes the exact live text to .out/rollout/ (outside git) so a rollback can be byte-exact, and compares each function with
 * the fingerprint the step was written against (scripts/rollout/stabilisation/manifest.json): a difference means production is not
 * what the replica was, and the step must not be applied until that is understood.
 *
 * It sends nothing that writes. The production guard is imported first, so without ALLOW_PRODUCTION_CHECKS=1 nothing is sent.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { SqlExecutor } from '../../src/db/executor.ts'

// `--replica=<db>` runs the same queries against a marked local replica (rehearsal). Production is reached only through the guard,
// which is imported before anything is sent.
const replica = process.argv.find((a) => a.startsWith('--replica='))?.slice('--replica='.length)

const QUERIES: Record<string, string> = {
  q1: `select name from app.schema_migrations where name ~ '^(089[2-9]|09[0-9][0-9]|10[0-9][0-9])_' order by name`,
  q2: `select n.nspname, c.relname,
       pg_relation_size(c.oid)                          as heap_bytes,
       pg_indexes_size(c.oid)                           as index_bytes,
       coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast_bytes,
       pg_total_relation_size(c.oid)                    as total_bytes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r' and n.nspname in ('public', 'storage', 'auth', 'cron', 'net', 'realtime', 'vault')
 order by pg_total_relation_size(c.oid) desc
 limit 30`,
  q3: `select s.relname, s.n_live_tup, s.n_dead_tup,
       round(pg_relation_size(s.relid)::numeric / nullif(s.n_live_tup, 0)) as heap_bytes_per_live_row,
       s.n_tup_ins, s.n_tup_upd, s.n_tup_hot_upd,
       round(100.0 * s.n_tup_hot_upd / nullif(s.n_tup_upd, 0), 1) as hot_pct,
       s.last_autovacuum, s.last_autoanalyze, s.autovacuum_count
  from pg_stat_user_tables s
 where s.schemaname = 'public'
 order by pg_total_relation_size(s.relid) desc
 limit 30`,
  q4: `select i.relname as table_name, i.indexrelname as index_name, pg_relation_size(i.indexrelid) as bytes, i.idx_scan
  from pg_stat_user_indexes i
 where i.schemaname = 'public'
 order by pg_relation_size(i.indexrelid) desc
 limit 20`,
}

const manifest = JSON.parse(
  readFileSync(new URL('./stabilisation/manifest.json', import.meta.url), 'utf8'),
) as { steps: Record<string, { objects: { sig: string; pre: string | null }[] }> }
const objects = Object.entries(manifest.steps).flatMap(([id, s]) =>
  s.objects.map((o) => ({ id, ...o })),
)
const SIGS = [...new Set(objects.map((o) => o.sig))]
const list = SIGS.map((s) => `'${s}'`).join(', ')
const NORMALISED =
  "md5(regexp_replace(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '(?s)/\\*.*?\\*/', '', 'g'), '--[^\\n]*', '', 'g'), '\\s+', ' ', 'g'))"
QUERIES.defs = `select s.sig, p.oid is not null as present, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as exact_md5, ${NORMALISED} as fp
  from unnest(array[${list}]) s(sig) left join pg_proc p on p.oid = to_regprocedure(s.sig) order by s.sig`
QUERIES.attrs = `select s.sig, p.oid is not null as present, p.prosecdef as security_definer, p.provolatile as volatility, p.proconfig::text as config,
       coalesce(p.proacl::text, '') as acl, pg_get_userbyid(p.proowner) as owner
  from unnest(array[${list}]) s(sig) left join pg_proc p on p.oid = to_regprocedure(s.sig) order by s.sig`

const name = process.argv[2] ?? ''
const sql = QUERIES[name]
if (sql === undefined) {
  console.error(
    `usage: read.ts <${Object.keys(QUERIES).join('|')}>   (a fixed set; nothing else can be asked)`,
  )
  process.exit(2)
}
let db: SqlExecutor
if (replica !== undefined) {
  const { isolated } = await import('../isolated/guard.ts')
  db = await isolated(replica)
} else {
  await import('../../src/safety/require-production-checks.ts')
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is not set: nothing was asked')
    process.exit(2)
  }
  const { ManagementApiExecutor } = await import('../../src/db/executor.ts')
  db = new ManagementApiExecutor(process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg', token)
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const { rows } = await db.execute(sql)
mkdirSync('.out/rollout', { recursive: true })
writeFileSync(`.out/rollout/${name}-${stamp}.json`, JSON.stringify(rows, null, 2))
console.log(
  `${name} at ${new Date().toISOString()}: ${rows.length} row(s); saved to .out/rollout/${name}-${stamp}.json`,
)

if (name === 'defs') {
  // The exact live text, in the shape the rollback files use, for byte-exact restoration.
  const out = (rows as { sig: string; present: boolean; def: string | null }[])
    .filter((r) => r.present && r.def !== null)
    .map((r) => `${r.def};\n`)
    .join('\n')
  writeFileSync(`.out/rollout/defs-${stamp}.sql`, `begin;\n\n${out}\ncommit;\n`)
  console.log(`exact live definitions written to .out/rollout/defs-${stamp}.sql`)
  let bad = 0
  for (const o of objects) {
    const r = (rows as { sig: string; present: boolean; fp: string | null }[]).find(
      (x) => x.sig === o.sig,
    )
    const live = r?.present ? r.fp : null
    const ok = live === o.pre
    if (!ok) bad += 1
    console.log(
      `  ${ok ? 'ok  ' : 'DIFF'} step ${o.id} ${o.sig}: live ${live ?? '(absent)'}, step expects ${o.pre ?? '(absent)'}`,
    )
  }
  console.log(
    bad === 0
      ? 'every function a step touches is the predecessor the step expects'
      : `${bad} DIFFERENCE(S): do not apply a step until each is understood`,
  )
  process.exit(bad === 0 ? 0 : 1)
}
console.table(rows)
// Explicit exit: a replica connection held open would otherwise keep the process alive behind a pipe.
process.exit(0)
