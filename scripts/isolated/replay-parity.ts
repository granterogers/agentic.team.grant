/**
 * The migration history, replayed into an EMPTY database, builds the schema the candidate has (critical gate).
 *
 *   npx tsx scripts/isolated/replay-parity.ts <a clone of the candidate>
 *
 * The candidate the gate tests is `post` (the replica, built by scripts/isolated/replica.sh with its own tolerant
 * replay) plus the migrations this branch carries after it. Production is built a third way: `npm run migrate` applies
 * one atomic request per file. If those ever disagree, every other proof is a proof about a schema nobody runs. So this
 * replays every file in migrations/ into an empty database the way `staging:replay` does it on a fresh project
 * (scripts/isolated/fresh-replay.ts: the committed tolerances only, nothing after 0592 tolerated) and compares the
 * catalogue fingerprint (scripts/isolated/schema-fingerprint.sql: tables, columns, indexes, constraints, function bodies by
 * md5, triggers, policies, grants, extensions, enums, configuration, duties) of the two.
 *
 * `mig|` rows are left out of the comparison: the replica does not keep the ledger the runner keeps. Everything else must
 * be byte-identical.
 *
 * It proves it can fail: a table is added to the replayed database and the comparison must go red, then the table is
 * dropped and it must go green again. A comparison that cannot be shown to differ is a comparison that says nothing.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { isolated } from './guard.ts'

const target = process.argv[2] ?? ''
const SOCK = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
const PORT = process.env.ISOLATED_PG_PORT ?? '55432'
const EMPTY = `${target}_e`

let failed = 0
const check = (ok: boolean, what: string, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const psql = (db: string, args: string[]): string =>
  execFileSync('psql', ['-h', SOCK, '-p', PORT, '-U', 'postgres', '-X', '-q', '-d', db, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  })
const fingerprint = (db: string): string[] =>
  psql(db, ['-f', 'scripts/isolated/schema-fingerprint.sql'])
    .split('\n')
    // `mig|` is the runner's ledger (the replica keeps none); `pg_temp_N` / `pg_toast_temp_N` are the per-session temporary
    // schemas of whichever backend happened to run the query, which differ between any two readings of ONE database.
    .filter((l) => l !== '' && !l.startsWith('mig|') && !/^ns\|pg_(toast_)?temp_\d+\|/.test(l))
const diff = (a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } => {
  const sa = new Set(a)
  const sb = new Set(b)
  return { onlyA: a.filter((l) => !sb.has(l)), onlyB: b.filter((l) => !sa.has(l)) }
}

// The candidate must be a marked replica (the guard refuses anything else) and must not be `post` itself.
if (!/^[a-z0-9_]+$/.test(target) || target === 'post' || target === 'pre' || target === 'base') {
  console.error(`REFUSED: ${target} is not a clone of the candidate`)
  process.exit(2)
}
const cand = await isolated(target)
await cand.end()

try {
  psql('postgres', ['-c', `drop database if exists ${EMPTY}`])
  psql('postgres', ['-c', `create database ${EMPTY}`])
  psql(EMPTY, ['-c', `alter database ${EMPTY} set search_path to "$user", public, extensions`])
  psql(EMPTY, ['-v', 'ON_ERROR_STOP=1', '-f', 'scripts/isolated/platform.sql'])
  psql(EMPTY, [
    '-c',
    'create table public.isolated_replica_marker (built_at timestamptz default now())',
  ])

  const files = readdirSync('migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f))
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/isolated/fresh-replay.ts', EMPTY],
    { encoding: 'utf8', maxBuffer: 64 << 20 },
  )
  const out = `${run.stdout}${run.stderr}`
  check(
    run.status === 0,
    'the replay into an empty database completed',
    `exit ${String(run.status)}`,
  )
  const applied = Number(/applied (\d+) migration\(s\)/.exec(out)?.[1] ?? -1)
  check(
    applied === files.length,
    'every migration file was applied, none skipped',
    `${String(applied)} applied of ${String(files.length)} files`,
  )
  const tolerated = Number(/tolerated (\d+) listed error\(s\)/.exec(out)?.[1] ?? -1)
  check(
    tolerated >= 0,
    'the replay reported what it tolerated (only the committed list, only before 0592)',
    `${String(tolerated)} listed statement(s)`,
  )

  const a = fingerprint(target)
  const b = fingerprint(EMPTY)
  check(
    a.length > 1000 && b.length > 1000,
    'both fingerprints are substantial (a measure that matches nothing proves nothing)',
    `${String(a.length)} / ${String(b.length)} lines`,
  )
  const d = diff(a, b)
  check(
    d.onlyA.length === 0 && d.onlyB.length === 0,
    'the candidate and the empty-database replay have the SAME schema fingerprint',
    d.onlyA.length === 0 && d.onlyB.length === 0
      ? `${String(a.length)} lines identical`
      : `only in the candidate: ${d.onlyA.slice(0, 3).join(' ;; ').slice(0, 300)} | only in the replay: ${d.onlyB.slice(0, 3).join(' ;; ').slice(0, 300)}`,
  )

  // CONTROL: the comparison can fail.
  psql(EMPTY, ['-c', 'create table public.zz_replay_parity_probe (x int)'])
  const landed = psql(EMPTY, [
    '-tAc',
    "select to_regclass('public.zz_replay_parity_probe') is not null",
  ]).trim()
  const dd = diff(fingerprint(target), fingerprint(EMPTY))
  check(
    landed === 't' && dd.onlyB.some((l) => l.includes('zz_replay_parity_probe')),
    'CONTROL: a table added to the replay is seen as a difference',
    `sabotage landed: ${landed}; ${String(dd.onlyB.length)} differing line(s)`,
  )
  psql(EMPTY, ['-c', 'drop table public.zz_replay_parity_probe'])
  const back = diff(fingerprint(target), fingerprint(EMPTY))
  check(
    back.onlyA.length === 0 && back.onlyB.length === 0,
    'and with the probe removed the two are identical again',
    `${String(back.onlyA.length + back.onlyB.length)} differing line(s)`,
  )
} catch (e) {
  check(false, 'the replay parity proof ran to the end', String((e as Error).message).slice(0, 300))
} finally {
  try {
    psql('postgres', ['-c', `drop database if exists ${EMPTY}`])
  } catch {
    // the runner sweeps leftover clones by prefix
  }
}
console.log(`\n${String(failed === 0 ? 'all' : 'NOT all')} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
