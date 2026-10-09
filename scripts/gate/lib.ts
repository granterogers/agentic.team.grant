/**
 * Everything the gate does to the local replica cluster that is not running a proof: reaching it, checking it, building
 * the candidate template, naming and dropping clones. `post` is only ever a TEMPLATE here: nothing in this file connects
 * to it to write, and the candidate is a separate database so a proof (or a sabotage) can never alter the replica.
 *
 * No production contact: the cluster is a unix socket, and the child environments have every production credential
 * removed (see cleanEnv).
 */
// The gate runs only against a local unix socket and removes every production credential from what it starts, so it can
// reach nothing remote. It still arms the production fetch guard (CLAUDE.md: a script that names the production credentials
// carries a gate module, and tests/safety/production-gate-coverage.test.ts holds every such script to it).
import '../../src/safety/arm.ts'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

export const SOCK = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
export const PORT = process.env.ISOLATED_PG_PORT ?? '55432'
export const DATA = process.env.ISOLATED_PG_DATA ?? '/var/tmp/pgl/data'
export const PGBIN = process.env.PGBIN ?? '/usr/lib/postgresql/16/bin'
/** Databases under this prefix are this gate's. Two people can gate at once by giving different prefixes. */
export const PREFIX = (process.env.GATE_PREFIX ?? 'gate').toLowerCase().replace(/[^a-z0-9]/g, '')
/** The highest migration the replica `post` holds when it carries no list of its own (an older build of it). */
export const LEGACY_POST_THROUGH = 1026

const SCRUB = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'ALLOW_PRODUCTION_CHECKS',
  'ALLOW_PRODUCTION_WRITES',
  'ALLOW_UNPROVENANCED_DEPLOY',
]

/** The environment every child gets: no production credential and no production switch, whatever the shell held. */
export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of SCRUB) delete env[k]
  return { ...env, ISOLATED_PG_SOCKET: SOCK, ISOLATED_PG_PORT: PORT, ...extra }
}

export class GateRefusal extends Error {}

/** One SQL statement against a database of the local cluster; returns the unaligned, tuples-only text. */
export function sql(db: string, statement: string): string {
  return execFileSync(
    'psql',
    [
      '-h',
      SOCK,
      '-p',
      PORT,
      '-U',
      'postgres',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      db,
      '-c',
      statement,
    ],
    { encoding: 'utf8', env: cleanEnv(), maxBuffer: 64 << 20 },
  ).trim()
}

/** A whole file, as `npm run migrate` would apply it: one transaction, stopping at the first error. */
export function applyFile(db: string, file: string): { ok: boolean; out: string } {
  const r = spawnSync(
    'psql',
    [
      '-h',
      SOCK,
      '-p',
      PORT,
      '-U',
      'postgres',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-1',
      '-d',
      db,
      '-f',
      file,
    ],
    { encoding: 'utf8', env: cleanEnv(), maxBuffer: 64 << 20 },
  )
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }
}

export const reachable = (): boolean => {
  try {
    sql('postgres', 'select 1')
    return true
  } catch {
    return false
  }
}

export const dbExists = (db: string): boolean =>
  sql('postgres', `select 1 from pg_database where datname = '${db.replace(/'/g, "''")}'`) === '1'

/** The marker every replica carries (guard.ts refuses a database without it). */
export const marked = (db: string): boolean => {
  try {
    return sql(db, `select to_regclass('public.isolated_replica_marker') is not null`) === 't'
  } catch {
    return false
  }
}

export const dropDb = (db: string): void => {
  try {
    sql('postgres', `drop database if exists "${db}" with (force)`)
  } catch {
    // a leftover is swept by prefix at the next start
  }
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/**
 * Makes the cluster and `post` exist, or says exactly how. Returns normally only when `post` is a marked replica.
 * Building needs root (the cluster runs as the postgres user); anyone else is told the one command to run.
 */
export function ensureReplica(opts: { build: boolean }): void {
  const how = `Build it with:  sudo bash scripts/isolated/replica.sh   (a few minutes; it replays every migration into the databases base, pre and post)`
  if (!reachable()) {
    if (existsSync(DATA) && process.getuid?.() === 0) {
      console.log(`the replica cluster is not running; starting it (${DATA})`)
      mkdirSync(SOCK, { recursive: true })
      spawnSync('chown', ['postgres', SOCK])
      spawnSync(
        'su',
        [
          'postgres',
          '-s',
          '/bin/bash',
          '-c',
          `${PGBIN}/pg_ctl -D ${DATA} -o "-p ${PORT} -k ${SOCK} -c listen_addresses=''" -l ${DATA}/../log start`,
        ],
        { stdio: 'inherit' },
      )
      for (let i = 0; i < 20 && !reachable(); i++) spawnSync('sleep', ['1'])
    }
    if (!reachable() && !existsSync(DATA) && opts.build && process.getuid?.() === 0) {
      // No cluster at all: replica.sh makes one (initdb), starts it and builds base, pre and post.
      console.log(
        `there is no replica cluster at ${DATA}; building one with scripts/isolated/replica.sh (a few minutes)`,
      )
      const r = spawnSync('bash', ['scripts/isolated/replica.sh'], {
        stdio: 'inherit',
        env: cleanEnv(),
      })
      if (r.status !== 0)
        throw new GateRefusal('scripts/isolated/replica.sh failed; read its output above')
    }
    if (!reachable())
      throw new GateRefusal(
        `No replica cluster answers on ${SOCK} port ${PORT}.\n${how}\nIf it is built but stopped:  sudo su postgres -c "${PGBIN}/pg_ctl -D ${DATA} -o \\"-p ${PORT} -k ${SOCK} -c listen_addresses=''\\" start"`,
      )
  }
  if (!dbExists('post') || !marked('post')) {
    if (opts.build && process.getuid?.() === 0) {
      console.log(
        'the replica database `post` is missing or unmarked; building it with scripts/isolated/replica.sh',
      )
      const r = spawnSync('bash', ['scripts/isolated/replica.sh'], {
        stdio: 'inherit',
        env: cleanEnv(),
      })
      if (r.status !== 0)
        throw new GateRefusal('scripts/isolated/replica.sh failed; read its output above')
    }
    if (!dbExists('post') || !marked('post'))
      throw new GateRefusal(
        `The replica database \`post\` is missing, or lacks the replica marker (public.isolated_replica_marker), so the gate refuses to clone it.\n${how}`,
      )
  }
}

/** The migrations on disk, sorted. */
export const migrationFiles = (): string[] =>
  readdirSync('migrations')
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()

/** Which migration files `post` already holds: its own list when it keeps one, else everything up to LEGACY_POST_THROUGH. */
export function pendingForCandidate(): { pending: string[]; basis: string } {
  const all = migrationFiles()
  // replica.sh records the list as the comment on the marker table: "migrations: 0001_a.sql 0002_b.sql ..."
  const recorded = sql(
    'post',
    `select coalesce(obj_description('public.isolated_replica_marker'::regclass, 'pg_class'), '')`,
  )
  if (recorded.startsWith('migrations: ')) {
    const have = new Set(recorded.slice('migrations: '.length).split(/\s+/).filter(Boolean))
    return {
      pending: all.filter((f) => !have.has(f)),
      basis: 'post records the migrations it holds',
    }
  }
  return {
    pending: all.filter((f) => Number(f.slice(0, 4)) > LEGACY_POST_THROUGH),
    basis: `post carries no recorded list (an older build), so every migration above ${String(LEGACY_POST_THROUGH)} is taken to be pending`,
  }
}

const LOCK = `/tmp/${PREFIX}-gate.lock`

/** One gate per prefix at a time: the candidate and the sweep are shared by name. A dead holder's lock is taken over. */
export function takeLock(): () => void {
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(`${LOCK}/pid`, 'utf8').trim())
    let alive = false
    try {
      process.kill(pid, 0)
      alive = true
    } catch {
      alive = false
    }
    if (alive && pid !== process.pid)
      throw new GateRefusal(
        `Another gate run (pid ${String(pid)}) holds prefix "${PREFIX}". Wait for it, or run with a different GATE_PREFIX=<letters> so the two never share database names.`,
      )
    rmSync(LOCK, { recursive: true, force: true })
  }
  mkdirSync(LOCK)
  writeFileSync(`${LOCK}/pid`, String(process.pid))
  return () => rmSync(LOCK, { recursive: true, force: true })
}

export interface Candidate {
  readonly name: string
  readonly note: string
}

/**
 * The candidate schema every proof clones: `post` plus the migrations this branch carries that `post` lacks, applied to a
 * COPY. Rebuilt only when `post` or those files change (the signature is stored as the database comment). `--candidate`
 * names an existing marked database instead (the sabotage runs use this to put a deliberately broken one under the gate).
 */
export function ensureCandidate(opts: { rebuild: boolean; given?: string | undefined }): Candidate {
  if (opts.given !== undefined) {
    if (['post', 'pre', 'base', 'postgres', 'template0', 'template1'].includes(opts.given))
      throw new GateRefusal(
        `--candidate ${opts.given} is a replica generation; the gate never uses one as its candidate. Name a clone.`,
      )
    if (!dbExists(opts.given) || !marked(opts.given))
      throw new GateRefusal(`--candidate ${opts.given} does not exist or lacks the replica marker`)
    return { name: opts.given, note: 'given with --candidate' }
  }
  const name = `${PREFIX}_cand`
  const { pending, basis } = pendingForCandidate()
  const builtAt = sql('post', 'select built_at::text from public.isolated_replica_marker limit 1')
  /*
    What `post` HOLDS, not only when it was built (#454). A proof run directly against `post` can commit rows into it (two person
    offices and their logins did, in the integration run), and a candidate cloned before that and stamped with the same build time
    was reused as "current" while `post` itself had moved on, so a false red looked like a defect in the code under test. The count
    of logins, offices and functions in `post` changes with any such write or with a rebuild, so the stamp changes and the candidate
    is rebuilt.
  */
  const held = sql(
    'post',
    `select (select count(*) from auth.users)::text || '/' || (select count(*) from public.offices)::text || '/' || (select count(*) from pg_proc)::text`,
  )
  const signature = sha(
    `${builtAt}\n${held}\n${pending.map((f) => `${f}:${sha(readFileSync(`migrations/${f}`, 'utf8'))}`).join('\n')}`,
  ).slice(0, 16)
  const stamp = `gate:${signature}`
  if (!opts.rebuild && dbExists(name) && marked(name)) {
    const have = sql(
      'postgres',
      `select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = '${name}'`,
    )
    if (have === stamp)
      return {
        name,
        note: `reused (post + ${String(pending.length)} newer migration(s); ${basis})`,
      }
  }
  dropDb(name)
  sql('postgres', `create database "${name}" template post`)
  for (const f of pending) {
    const r = applyFile(name, `migrations/${f}`)
    if (!r.ok) {
      dropDb(name)
      const head = r.out
        .split('\n')
        .filter((l) => l.trim() !== '')
        .slice(0, 6)
        .join('\n')
      throw new GateRefusal(
        `The candidate schema could not be built: migration ${f} failed on a copy of \`post\`.\n${head}\nThat migration (or one it needs before it) is not yet sound, so no proof can say anything about the branch.`,
      )
    }
  }
  sql('postgres', `comment on database "${name}" is '${stamp}'`)
  return {
    name,
    note: `built: post + ${String(pending.length)} newer migration(s) (${pending.map((f) => f.slice(0, 4)).join(', ') || 'none'}); ${basis}`,
  }
}

/**
 * The exact source a gate run tested (#454): the commit, whether the tree was clean, and a digest of everything that differs from
 * the commit (tracked changes and untracked files, by content), so an evidence file names what was run and a dirty tree cannot pass
 * for its commit. No network, no database: it only runs git.
 */
export function sourceIdentity(cwd?: string): {
  head: string
  branch: string
  clean: boolean
  dirtyDigest: string | null
} {
  const git = (...args: string[]): string => {
    try {
      return execFileSync('git', args, {
        encoding: 'utf8',
        ...(cwd === undefined ? {} : { cwd }),
      }).trim()
    } catch {
      return ''
    }
  }
  const head = git('rev-parse', 'HEAD')
  const status = git('status', '--porcelain', '--untracked-files=all')
  if (status === '')
    return {
      head,
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      clean: true,
      dirtyDigest: null,
    }
  const h = createHash('sha256')
  h.update(git('diff', 'HEAD'))
  for (const line of status.split('\n')) {
    if (!line.startsWith('??')) continue
    const f = line.slice(3)
    try {
      h.update(`\n${f}\n`)
      h.update(readFileSync(cwd === undefined ? f : `${cwd}/${f}`))
    } catch {
      // an unreadable path is named by its status line below
    }
  }
  h.update(status)
  return {
    head,
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    clean: false,
    dirtyDigest: h.digest('hex').slice(0, 16),
  }
}

/** A short unique token for this run's database names. */
export const newRunId = (): string => randomBytes(3).toString('hex')

/** The schema BEFORE the offices existed (migrations 0599..0653 on `pre`): what the backfill plants and the FK spike need. */
export function ensurePlantTemplate(): string {
  const name = `${PREFIX}_plant_template`
  if (dbExists(name) && marked(name)) return name
  dropDb(name)
  sql('postgres', `create database "${name}" template pre`)
  for (const f of migrationFiles().filter(
    (x) => x.slice(0, 4) > '0598' && x.slice(0, 4) < '0654',
  )) {
    const r = applyFile(name, `migrations/${f}`)
    if (!r.ok) {
      dropDb(name)
      throw new GateRefusal(`building ${name}: ${f}: ${r.out.slice(0, 300)}`)
    }
  }
  return name
}

/** Drops every database this run created (by its run token), in every naming family the proofs demand. */
export function sweepRun(run: string): number {
  const like = [
    `${PREFIX}${run}_%`,
    `p2_attack_${PREFIX}${run}_%`,
    `p3_attack_${PREFIX}${run}_%`,
    `fk_spike_${PREFIX}${run}_%`,
  ]
  const names = sql(
    'postgres',
    `select datname from pg_database where ${like.map((l) => `datname like '${l}'`).join(' or ')}`,
  )
    .split('\n')
    .filter((x) => x !== '')
  for (const n of names) dropDb(n)
  return names.length
}

/** Databases a CRASHED earlier run of this prefix left behind (never the candidate or the plant template). */
export function sweepStale(): number {
  const names = sql(
    'postgres',
    `select datname from pg_database where datname ~ '^(${PREFIX}[0-9a-f]{6}_|p2_attack_${PREFIX}[0-9a-f]{6}_|p3_attack_${PREFIX}[0-9a-f]{6}_|fk_spike_${PREFIX}[0-9a-f]{6}_)'`,
  )
    .split('\n')
    .filter((x) => x !== '')
  for (const n of names) dropDb(n)
  return names.length
}
