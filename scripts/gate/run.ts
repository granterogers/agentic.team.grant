/**
 * The replica proof gate. No production contact, foreground, deterministic, one fresh clone of the candidate schema per proof.
 *
 *   npm run verify:critical                      tier (b): the security and reliability critical proofs
 *   npm run verify:extended                      tier (c): the forensic and audit proofs
 *   npm run verify:proofs                        both
 *   npm run check:proofs                         registry integrity only (no database): every proof registered once
 *   npx tsx scripts/gate/run.ts --tier critical --only job-fence,exactly-once --jobs 2 --keep
 *
 * What it does, in order, and refuses at each step rather than weakening anything:
 *   1. Registry integrity: every file in scripts/isolated/ is a registered proof or a listed helper, none twice.
 *   2. The replica: the cluster answers on the unix socket and `post` carries the replica marker, or it says how to build it
 *      (and builds it itself when run as root).
 *   3. The candidate: `post` plus the branch's newer migrations on a COPY (`<prefix>_cand`). `post` is never modified.
 *   4. Each proof on its own clone (xargs -P4 style pool), dropped afterwards, logged under .out/gate/<run>/.
 *   5. A verdict per proof from its exit code AND its output (scripts/gate/verdict.ts): red on a non-zero exit, a failed
 *      assertion, a summary that disagrees with itself, fewer assertions than its registered floor, or no assertion at all.
 *   Exit 0 only when every proof is green; 1 when any is not; 2 when the gate itself could not start.
 *
 * Tier (d) (scripts/isolated/quarantine/) is never run. Sabotage runs (the gate shown to fail): scripts/gate/sabotage.ts.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  type Candidate,
  cleanEnv,
  ensureCandidate,
  ensurePlantTemplate,
  ensureReplica,
  GateRefusal,
  newRunId,
  PORT,
  PREFIX,
  SOCK,
  sql,
  sweepRun,
  sweepStale,
  takeLock,
} from './lib.ts'
import { fileOf, ISOLATED_DIR, proofsOf, QUARANTINE, registryProblems } from './registry.ts'
import type { Proof, Tier, Verdict } from './types.ts'
import { judge } from './verdict.ts'

interface Options {
  tier: Tier | 'all'
  only: string[] | null
  jobs: number
  keep: boolean
  rebuild: boolean
  noBuild: boolean
  allowUnregistered: boolean
  candidate: string | undefined
  check: boolean
  list: boolean
  json: string | undefined
}

function parse(argv: string[]): Options {
  const o: Options = {
    tier: 'critical',
    only: null,
    jobs: Number(process.env.GATE_JOBS ?? 4),
    keep: false,
    rebuild: false,
    noBuild: false,
    allowUnregistered: false,
    candidate: undefined,
    check: false,
    list: false,
    json: undefined,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    const next = (): string => argv[++i] ?? ''
    if (a === '--tier') {
      const t = next()
      if (t !== 'critical' && t !== 'extended' && t !== 'all')
        throw new GateRefusal(
          `--tier is critical, extended or all (quarantined proofs are never run), not "${t}"`,
        )
      o.tier = t
    } else if (a === '--only') o.only = next().split(',').filter(Boolean)
    else if (a === '--jobs') o.jobs = Math.max(1, Number(next()))
    else if (a === '--keep') o.keep = true
    else if (a === '--rebuild') o.rebuild = true
    else if (a === '--no-build') o.noBuild = true
    else if (a === '--allow-unregistered') o.allowUnregistered = true
    else if (a === '--candidate') o.candidate = next()
    else if (a === '--check') o.check = true
    else if (a === '--list') o.list = true
    else if (a === '--json') o.json = next()
    else throw new GateRefusal(`unknown argument ${a}`)
  }
  return o
}

interface Result {
  readonly name: string
  readonly tier: Tier
  readonly kind: string
  readonly verdict: Verdict
  readonly rc: number | null
  readonly seconds: number
  readonly log: string
}

const RUN = newRunId()
const OUT = `.out/gate/${RUN}`
const NAME_OK = /^[a-z0-9_]+$/

/** Runs one child, returning when it exits or is killed at the timeout (the whole process group goes). */
function exec(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutS: number,
  logFile: string,
) {
  return new Promise<{ rc: number | null; timedOut: boolean; out: string }>((resolve) => {
    const child: ChildProcess = spawn(cmd, args, {
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let timedOut = false
    const take = (b: Buffer): void => {
      const s = b.toString('utf8')
      out += s
      appendFileSync(logFile, s)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }, timeoutS * 1000)
    child.on('close', (rc) => {
      clearTimeout(timer)
      resolve({ rc, timedOut, out })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ rc: 127, timedOut: false, out: `${out}\n${String(e)}` })
    })
  })
}

const TSX = 'node_modules/.bin/tsx'
/** The pre-0654 template, built ONCE before the pool starts so the two proofs that need it never race to make it. */
let plantTemplate: string | null = null

async function runProof(p: Proof, tier: Tier, idx: number, cand: Candidate): Promise<Result> {
  const started = Date.now()
  const token = `${RUN}_${String(idx)}`
  const logFile = `${OUT}/${p.name.replace(/[^a-z0-9_.-]/gi, '_')}.log`
  writeFileSync(logFile, '')
  const kind = p.kind ?? 'ts'
  const env = cleanEnv({ GATE_RUN: RUN, ISOLATED_TEMPLATE: cand.name, ...(p.env ?? {}) })
  const file = `${ISOLATED_DIR}/${fileOf(p)}`
  const timeout = p.timeoutS ?? 480
  let log = ''
  let rc: number | null = null
  let timedOut = false
  const finish = (): Result => ({
    name: p.name,
    tier,
    kind,
    verdict: judge(p, rc, log, timedOut),
    rc,
    seconds: (Date.now() - started) / 1000,
    log: logFile,
  })
  const step = async (cmd: string, args: string[], e = env): Promise<boolean> => {
    const r = await exec(cmd, args, e, timeout, logFile)
    log += r.out
    rc = r.rc
    timedOut = r.timedOut
    return r.rc === 0 && !r.timedOut
  }
  try {
    const template = p.template === 'pre' ? 'pre' : p.template === 'base' ? 'base' : cand.name
    const clone = (name: string, from = template): void => {
      if (!NAME_OK.test(name) || name.length > 60) throw new Error(`unsafe database name ${name}`)
      sql('postgres', `create database "${name}" template "${from}"`)
    }
    if (kind === 'ts') {
      const db = `${PREFIX}${token}`
      clone(db)
      await step(TSX, [file, db, ...(p.args ?? [])])
    } else if (kind === 'sql') {
      const db = `${PREFIX}${token}`
      clone(db)
      await step('psql', [
        '-h',
        SOCK,
        '-p',
        PORT,
        '-U',
        'postgres',
        '-d',
        db,
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        file,
      ])
    } else if (kind === 'p2' || kind === 'p3') {
      // The attack suites refuse any database not named p2_attack* / p3_attack*; the setup script (kept, not weakened)
      // builds that clone from the candidate it is handed.
      const db = `${kind}_attack_${PREFIX}${token}`
      const setup = await exec('bash', [`${ISOLATED_DIR}/${kind}-attack.sh`, db], env, 120, logFile)
      log += setup.out
      rc = setup.rc
      if (setup.rc !== 0) return finish()
      await step(TSX, [file, db, ...(p.args ?? [])])
    } else if (kind === 'script') {
      await step('bash', [file, ...(p.args ?? [])], {
        ...env,
        GATE_DB_PREFIX: `${PREFIX}${token}`,
        ISOLATED_POST: cand.name,
      })
    } else if (kind === 'plants') {
      const tpl = plantTemplate ?? ensurePlantTemplate()
      await step(TSX, [file], {
        ...env,
        P2_PLANT_TEMPLATE: tpl,
        P2_PLANT_DB: `${PREFIX}${token}_plant`,
      })
    } else if (kind === 'fk') {
      const tpl = plantTemplate ?? ensurePlantTemplate()
      const db = `fk_spike_${PREFIX}${token}`
      clone(db, tpl)
      await step(TSX, [file, db, ...(p.args ?? [])])
    }
  } catch (e) {
    log += `\n[gate] ${String((e as Error).message)}\n`
    appendFileSync(logFile, `\n[gate] ${String((e as Error).message)}\n`)
    rc = rc ?? 125
  }
  return finish()
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))

async function main(): Promise<number> {
  const o = parse(process.argv.slice(2))
  let problems = registryProblems()
  if (o.allowUnregistered) {
    // For a developer whose new proof is not registered YET: it is named, loudly, and still not run by any tier.
    const orphans = problems.filter((x) => x.what.includes('neither a registered proof'))
    for (const x of orphans) console.warn(`WARNING (not run by any tier): ${x.what}`)
    problems = problems.filter((x) => !orphans.includes(x))
  }
  if (problems.length > 0) {
    console.error('REGISTRY PROBLEMS (the gate will not run on a registry that is not sound):')
    for (const p of problems) console.error(`  - ${p.what}`)
    return 2
  }
  if (o.check) {
    console.log(
      'registry sound: every proof is registered once, every helper is listed, nothing is orphaned',
    )
    return 0
  }
  let proofs = proofsOf(o.tier)
  if (o.only !== null) {
    const quarantined = o.only.filter((n) =>
      QUARANTINE.some((q) => q.name === n || q.name.endsWith(`/${n}`)),
    )
    if (quarantined.length > 0)
      throw new GateRefusal(
        `${quarantined.join(', ')}: quarantined, never run (see scripts/isolated/quarantine/README.md)`,
      )
    const all = proofsOf('all')
    const unknown = o.only.filter((n) => !all.some((p) => p.name === n))
    if (unknown.length > 0) throw new GateRefusal(`not registered: ${unknown.join(', ')}`)
    proofs = all.filter((p) => o.only?.includes(p.name))
  }
  const tierOf = (p: Proof): Tier => (proofsOf('critical').includes(p) ? 'critical' : 'extended')
  if (o.list) {
    for (const p of proofs)
      console.log(`${pad(tierOf(p), 9)} ${pad(p.name, 34)} floor ${pad(String(p.min), 5)} ${p.why}`)
    console.log(`\n${String(proofs.length)} proof(s)`)
    return 0
  }
  if (!SOCK.startsWith('/'))
    throw new GateRefusal(
      `ISOLATED_PG_SOCKET must be a unix socket path, not ${SOCK}: the gate never uses TCP`,
    )

  const t0 = Date.now()
  mkdirSync(OUT, { recursive: true })
  const release = takeLock()
  try {
    console.log(
      `== gate ${RUN} · tier ${o.tier} · ${String(proofs.length)} proof(s) · ${String(o.jobs)} at a time · prefix "${PREFIX}"`,
    )
    ensureReplica({ build: !o.noBuild })
    const swept = sweepStale()
    if (swept > 0)
      console.log(`swept ${String(swept)} database(s) a crashed earlier run left behind`)
    const cand = ensureCandidate({ rebuild: o.rebuild, given: o.candidate })
    console.log(`candidate ${cand.name}: ${cand.note}`)
    if (proofs.some((x) => x.kind === 'plants' || x.kind === 'fk'))
      plantTemplate = ensurePlantTemplate()

    // Heaviest first, so the long ones start at once and the tail is short.
    const order = [...proofs].sort((a, b) => (b.timeoutS ?? 480) - (a.timeoutS ?? 480))
    const results: Result[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++
        const p = order[i]
        if (p === undefined) return
        const r = await runProof(p, tierOf(p), i, cand)
        results.push(r)
        const v = r.verdict
        const counts = `${String(v.pass)}${v.fail > 0 ? ` + ${String(v.fail)} FAILED` : ''} assertion(s)`
        console.log(
          `[${pad(String(results.length), 2)}/${String(order.length)}] ${pad(v.label, 13)} ${pad(p.name, 32)} ${pad(counts, 24)} exit ${pad(String(r.rc), 4)} ${r.seconds.toFixed(1)}s${v.ok ? '' : `  <- ${v.reason}`}`,
        )
        if (!v.ok) {
          const lines = readFileSync(r.log, 'utf8').split('\n')
          const shown = lines.filter((l) => /^\s*(FAIL|FAILED)\b|ERROR|Error:/.test(l)).slice(0, 4)
          for (const l of shown) console.log(`        ${l.slice(0, 220)}`)
          console.log(`        log: ${r.log}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(o.jobs, order.length) }, worker))

    // ---- summary
    const wall = (Date.now() - t0) / 1000
    results.sort(
      (a, b) =>
        order.findIndex((p) => p.name === a.name) - order.findIndex((p) => p.name === b.name),
    )
    const red = results.filter((r) => !r.verdict.ok)
    const passed = results.reduce((s, r) => s + r.verdict.pass, 0)
    const failed = results.reduce((s, r) => s + r.verdict.fail, 0)
    console.log('\n---- summary')
    for (const r of [...results].sort((a, b) => a.name.localeCompare(b.name)))
      console.log(
        `${r.verdict.ok ? 'green' : 'RED  '}  ${pad(r.name, 34)} ${pad(`${String(r.verdict.pass)}/${String(r.verdict.pass + r.verdict.fail)}`, 10)} exit ${pad(String(r.rc), 4)} ${pad(r.seconds.toFixed(1), 6)}s  ${r.verdict.ok ? '' : `${r.verdict.label}: ${r.verdict.reason}`}`,
      )
    console.log(
      `\n${String(results.length - red.length)} green, ${String(red.length)} red of ${String(results.length)} proof(s); ${String(passed)} assertion(s) passed, ${String(failed)} failed; wall-clock ${wall.toFixed(0)}s`,
    )
    if (red.length > 0) console.log(`RED: ${red.map((r) => r.name).join(', ')}`)
    const report = {
      run: RUN,
      tier: o.tier,
      candidate: cand,
      wallSeconds: wall,
      green: results.length - red.length,
      red: red.map((r) => ({
        name: r.name,
        label: r.verdict.label,
        reason: r.verdict.reason,
        log: r.log,
      })),
      results: results.map((r) => ({
        name: r.name,
        tier: r.tier,
        ok: r.verdict.ok,
        label: r.verdict.label,
        pass: r.verdict.pass,
        fail: r.verdict.fail,
        rc: r.rc,
        seconds: r.seconds,
      })),
    }
    writeFileSync(`${OUT}/result.json`, JSON.stringify(report, null, 2))
    writeFileSync('.out/gate/latest.json', JSON.stringify(report, null, 2))
    if (o.json !== undefined) writeFileSync(o.json, JSON.stringify(report, null, 2))
    if (!o.keep) sweepRun(RUN)
    return red.length === 0 ? 0 : 1
  } finally {
    release()
    if (!o.keep) {
      try {
        sweepRun(RUN)
      } catch {
        // swept at the next start
      }
    }
  }
}

process.on('SIGINT', () => {
  try {
    sweepRun(RUN)
  } catch {
    // nothing more to do
  }
  process.exit(130)
})

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof GateRefusal) {
      console.error(`\nREFUSED: ${e.message}`)
      process.exit(2)
    }
    console.error(e)
    process.exit(2)
  },
)
