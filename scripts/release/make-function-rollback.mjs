/**
 * Builds the DATABASE-FUNCTION rollback for the V1 reliability migrations (1042 to 1052; authored 1023 to 1035) from a snapshot
 * of the schema as it stood BEFORE them. Local replicas only: it reads two replica databases over the isolated socket and
 * writes one SQL file. It contacts nothing else and touches no production database.
 *
 *   node scripts/release/make-function-rollback.mjs <defs-snapshot.sql> <before-db> <after-db> <out.sql>
 *
 * <defs-snapshot.sql> is what `scripts/p3/snapshot-defs.ts` writes for the before schema (for the real release, the snapshot
 * taken of PRODUCTION before the migrations run, which is what makes this a rollback of what was live and not of a replica).
 * The generated file drops the replacement overloads, restores the removed signatures (app before public, because a
 * SQL-language wrapper binds its callee when it is created), and restores every rewritten definition, in ONE transaction.
 * Tables, columns, triggers and the added functions are left in place on purpose: they are additive and harmless to old code.
 *
 * Rehearsed on 9 October 2026 against a replica shaped like production (through 1041): applying the generated file after the
 * eleven migrations restored all 1,100 definitions byte-for-byte (0 differ, 0 missing) and left 34 additive functions.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [snap, oldDb, newDb, out] = process.argv.slice(2)
if (snap === undefined || oldDb === undefined || newDb === undefined || out === undefined) {
  console.error(
    'usage: node make-function-rollback.mjs <defs-snapshot.sql> <before-db> <after-db> <out.sql>',
  )
  process.exit(2)
}
const psql = (db, sql) =>
  execFileSync(
    'psql',
    ['-h', '/tmp/pgs', '-p', '55432', '-U', 'postgres', '-At', '-d', db, '-c', sql],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  )
const ident = `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as id, p.oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public') and p.prokind in ('f','p')`
const keyed = (db, expr) =>
  new Map(
    psql(db, `select id||'|'||${expr} from (${ident}) t`)
      .trim()
      .split('\n')
      .map((l) => {
        const i = l.lastIndexOf('|')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
const oldRows = keyed(oldDb, 'oid::bigint')
const newRows = keyed(newDb, 'oid::bigint')
const oldMd5 = keyed(oldDb, 'md5(pg_get_functiondef(oid))')
const newMd5 = keyed(newDb, 'md5(pg_get_functiondef(oid))')
const changed = [...oldMd5.keys()].filter((k) => newMd5.has(k) && newMd5.get(k) !== oldMd5.get(k))
const removed = [...oldRows.keys()].filter((k) => !newRows.has(k))
const added = [...newRows.keys()].filter((k) => !oldRows.has(k))
// An added signature that shares a name with a removed one is a REPLACEMENT overload and must be dropped first, or a call
// that names fewer arguments is ambiguous between the two.
const nameOf = (id) => id.slice(0, id.indexOf('('))
const removedNames = new Set(removed.map(nameOf))
const replacements = added.filter((a) => removedNames.has(nameOf(a)))

const snapshot = readFileSync(snap, 'utf8')
const blocks = snapshot.split(/\n\n(?=CREATE OR REPLACE FUNCTION )/)
const firstLine = (db, oid) =>
  psql(db, `select split_part(pg_get_functiondef(${oid}), E'\\n', 1)`).trim()
const blockFor = (id) => {
  const head = firstLine(oldDb, oldRows.get(id))
  const b = blocks.find((x) => x.startsWith(head))
  if (b === undefined) throw new Error(`no snapshot block for ${id}: ${head}`)
  return b.trim()
}
const sql = []
sql.push(
  '-- Rollback of the DATABASE FUNCTIONS changed by migrations 1042 to 1052, from a snapshot of the schema before them.',
)
sql.push(
  `-- ${changed.length} rewritten, ${removed.length} signatures restored, ${replacements.length} replacement overloads dropped first.`,
)
sql.push(
  '-- Tables, columns, triggers and the added functions are deliberately left in place (additive, harmless to old code).',
)
sql.push('begin;')
for (const r of replacements) sql.push(`drop function ${r};`)
for (const id of [...removed].sort(
  (a, b) => Number(a.startsWith('public.')) - Number(b.startsWith('public.')),
))
  sql.push(blockFor(id))
for (const id of changed) sql.push(blockFor(id))
sql.push('commit;')
writeFileSync(out, `${sql.join('\n\n')}\n`)
console.log(JSON.stringify({ changed: changed.length, removed, replacements, out }))
