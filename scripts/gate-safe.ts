/**
 * The release gate that is safe to run (#414).
 *   npm run gate:safe [-- --skip-fingerprint]
 *
 * `npm run gate` is 37 end-to-end suites against the real office, several of which spend model calls and press on Grant's
 * own data. This is the gate that can be run any time without that: everything here is local, runs as the Sample Person, or
 * reads production cheaply, and NOTHING spends a model call. What it does NOT cover is listed by `docs/testing/gate-reach.md`,
 * which names every suite of the old gate and what it reaches, so "the gate is green" can never be read as more than it is.
 *
 * Serialised and in the foreground, by Grant's standing instruction. One platform health reading before the production
 * steps, and the gate stops if the database is slow: a degraded platform is not something to add load to.
 *
 * Grant and every other office are fingerprinted before and after (`sample:fingerprint`). The gate FAILS if either changed,
 * because the claim "this ran without touching a real office" is the whole point of it and a claim needs a check behind it.
 * The comparison's own controls are unit tests (tests/sample/plan.test.ts: it names the office and table that changed, and
 * sees one appear or vanish), and the gate FAILS CLOSED if it cannot read the result: an unparseable report is not "no change".
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

type Step = {
  readonly name: string
  readonly why: string
  readonly args?: readonly string[]
  readonly env?: Record<string, string>
}

const SKIP_FINGERPRINT = process.argv.includes('--skip-fingerprint')
// The whole gate is longer than a shell's ten-minute ceiling, and Grant's rule is to split rather than background:
//   --part=static       lint, typecheck, unit tests, check:*, and the local suites
//   --part=production   health, fingerprints, and the Sample / test-office suites
// With neither, both run in order.
const PART = /--part=(static|production)/.exec(process.argv.join(' '))?.[1] ?? 'all'
const out = '.out/gate-safe'
mkdirSync(out, { recursive: true })

const STATIC: readonly Step[] = [
  { name: 'lint', why: 'biome: lint, format, import order' },
  { name: 'typecheck', why: 'tsc' },
  { name: 'test', why: 'the unit and regression tests (vitest)' },
  { name: 'check:migrations', why: 'applied migrations are immutable and numbered' },
  { name: 'check:secrets', why: 'no secret in the repository' },
  {
    name: 'check:templates',
    why: 'every web file parses as a module; no backtick in a comment in a template',
  },
  { name: 'check:branding', why: 'the word Basecamp never reaches a person' },
  { name: 'check:suite-classes', why: 'every suite has an environment class' },
  { name: 'check:ownership', why: 'every table has an ownership class (read-only)' },
  { name: 'check:office-edges', why: 'every owned edge is enforced by the database (read-only)' },
  { name: 'check:carrier-writers', why: 'every writer names its office (read-only)' },
  {
    name: 'check:anon-exposure',
    why: 'no table or function reachable by a public key (read-only)',
  },
  { name: 'check:machine-key', why: 'the office key reaches no ambient person (read-only)' },
  { name: 'check:callers', why: 'no new capability ships with nothing that calls it (read-only)' },
  { name: 'check:consumed', why: 'no table is written and never read (read-only)' },
]
const LOCAL: readonly Step[] = [
  { name: 'verify:wired', why: 'every control the page draws is wired' },
  {
    name: 'verify:basecamp-project-turn',
    why: 'the page states its project, and the dock IS the page’s project (#416), against a fake office',
  },
]
const SAMPLE: readonly Step[] = [
  { name: 'verify:hq', why: 'the gateway, on the TEST office; no Grant write (#414)' },
  {
    name: 'verify:incidents',
    why: 'an unresolved problem is told once, including the race (#413)',
  },
  {
    name: 'verify:named-project',
    why: 'a project named in a message, and its negatives, rolled back (#416)',
  },
  {
    name: 'sample:dock',
    why: 'on the real page as the Sample, the dock is the page’s project (#416)',
  },
  {
    name: 'sample:notice-link',
    why: 'the Reconnect link opens the right place, signed in and signed out (#413)',
  },
  { name: 'sample:labels', why: 'no internal owner key reaches a screen (#418)' },
]

const results: { name: string; ok: boolean; seconds: number }[] = []
const run = (step: Step, n: number): boolean => {
  const started = Date.now()
  process.stdout.write(`\n[${String(n)}] ${step.name} — ${step.why}\n`)
  const r = spawnSync(
    'npm',
    ['run', '-s', step.name, ...(step.args === undefined ? [] : ['--', ...step.args])],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 9 * 60 * 1000,
      env: { ...process.env, ...(step.env ?? {}) },
    },
  )
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  writeFileSync(
    `${out}/${String(n).padStart(2, '0')}-${step.name.replace(/[^a-z0-9]+/gi, '-')}.txt`,
    text,
  )
  const ok = r.status === 0
  const seconds = Math.round((Date.now() - started) / 1000)
  results.push({ name: step.name, ok, seconds })
  const tail = text.trim().split('\n').slice(-3).join('\n    ')
  console.log(`    ${ok ? 'PASS' : 'FAIL'} (${String(seconds)}s)${ok ? '' : `\n    ${tail}`}`)
  return ok
}

let n = 0
if (PART !== 'production') for (const s of [...STATIC, ...LOCAL]) run(s, ++n)

// One health reading before anything touches production. Stop, rather than add load, if it is slow.
let healthy = true
if (PART !== 'static') {
  const health = spawnSync('npm', ['run', '-s', 'incident:snapshot'], {
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  })
  const dbMs = Number(/db round trip\s*:\s*(\d+)\s*ms/.exec(health.stdout ?? '')?.[1] ?? Number.NaN)
  console.log(
    `\nplatform health before production steps: db round trip ${Number.isNaN(dbMs) ? 'unknown' : `${String(dbMs)} ms`}`,
  )
  healthy = !Number.isNaN(dbMs) && dbMs < 6000
  if (!healthy)
    console.log('  NOT HEALTHY (or unreadable): the production steps are skipped, not retried.')
}

let fingerprinted = false
if (healthy && PART !== 'static') {
  if (!SKIP_FINGERPRINT)
    fingerprinted = run(
      {
        name: 'sample:fingerprint',
        args: ['take', 'gate-before'],
        why: 'fingerprint every office before',
      },
      ++n,
    )
  for (const s of SAMPLE) run(s, ++n)
  if (!SKIP_FINGERPRINT && fingerprinted) {
    run(
      {
        name: 'sample:fingerprint',
        args: ['take', 'gate-after'],
        why: 'fingerprint every office after',
      },
      ++n,
    )
    const diff = spawnSync(
      'npm',
      ['run', '-s', 'sample:fingerprint', '--', 'diff', 'gate-before', 'gate-after'],
      {
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
      },
    )
    const text = diff.stdout ?? ''
    writeFileSync(`${out}/fingerprint-diff.txt`, text)
    const grant = /^GRANT (\[.*\])$/m.exec(text)?.[1]
    const foreign = /^FOREIGN \([^)]*\) (\[.*\])$/m.exec(text)?.[1]
    const sample = /^SAMPLE (\[.*\])$/m.exec(text)?.[1]
    console.log(
      `\noffice fingerprints  GRANT ${grant ?? '?'}  FOREIGN ${foreign ?? '?'}  SAMPLE ${sample ?? '?'}`,
    )
    results.push({ name: 'Grant unchanged', ok: grant === '[]', seconds: 0 })
    results.push({ name: 'every other office unchanged', ok: foreign === '[]', seconds: 0 })
  }
}

console.log('\n=== gate:safe ===')
for (const r of results)
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.seconds > 0 ? `  ${String(r.seconds)}s` : ''}`,
  )
const failed = results.filter((r) => !r.ok).length
const skipped = healthy ? '' : ' (production steps SKIPPED: platform not healthy)'
console.log(
  `\n${String(results.length - failed)}/${String(results.length)} passed${skipped}. Full output in ${out}/`,
)
console.log(
  'Not covered by this gate: see docs/testing/gate-reach.md. Voice and the realtime call remain MANUAL.',
)
process.exitCode = failed === 0 && healthy ? 0 : 1
