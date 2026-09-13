/**
 * Run every verification suite this repository has, and say honestly what
 * happened to each one.
 *
 *   npm run e2e -- --limit 8            # run the next eight not yet attempted
 *   npm run e2e -- --only ui,talk,hq    # run these, again, whatever their state
 *   npm run e2e -- --report             # write the markdown from what is recorded
 *   npm run e2e -- --reset              # forget every result and start over
 *
 * ## Why this exists
 *
 * Issue #41. Grant asked for *"a complete end to end systems test as deep and
 * as detailed as possible"* — and the repository already had seventy-nine
 * `verify:*` suites and **no way to run them all**. `verify:all` runs three.
 * So the state of the whole stack was a thing nobody could ask for: you could
 * run any one suite, and nobody had ever run every one in a single pass.
 *
 * That is the same shape as the trap in CLAUDE.md about an audit that never
 * opens a surface. A suite that exists and is never run is a suite that is
 * green by assumption.
 *
 * ## Resumable, because a full pass does not fit in one sitting
 *
 * Seventy-nine suites, several of which drive a real browser at three device
 * sizes, is well over an hour of wall clock. Results are appended to
 * `.out/e2e-results.json` as each finishes, so a pass can be built up in
 * batches and nothing is lost when one batch is interrupted.
 *
 * ## What a result means
 *
 *   pass       exit 0
 *   fail       exit non-zero — the suite ran and said no
 *   timeout    still running after its budget; recorded, never silently retried
 *   error      could not be started at all
 *
 * **"Could not be tested" is a real result**, and #41 says so explicitly: an
 * unrunnable check is exactly where the next CORS bug will live. So a timeout
 * or an error is never rounded down to a skip, and the report prints them in
 * their own section rather than folding them into the failures.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const RESULTS = '.out/e2e-results.json'

/**
 * Per-suite budget.
 *
 * Twenty-five minutes. `verify:controls:studio` presses 217 controls across
 * eight routes at two sizes since #180's resolution fix — it was pressing 97
 * before, and the first budget here was set against that. A budget calibrated
 * on a broken suite times out the fixed one, twice: nine minutes, then fifteen.
 */
const BUDGET_MS = 25 * 60 * 1000

/**
 * Suites this runner will not start, and why — stated here rather than by
 * being quietly absent from the list.
 *
 * `all` is a wrapper around three others and would double-count them.
 * `restore` restores a backup over the live database; it is run deliberately,
 * by a person, not as one of seventy-nine.
 */
const NEVER: Record<string, string> = {
  all: 'a wrapper around verify, audit:credentials and verify:db — would double-count',
  restore:
    'restores a backup over the live database. Run deliberately by a person, never as one of a batch',
  'github-token': 'spends a real GitHub API budget against a token flagged for rotation (#18)',
  db: 'a chain of 46 other suites, every one of which this runner already runs individually — and it ends in `purge:fixtures --go` and `slack:tidy --go`, which are sweeps rather than checks',
  controls:
    'the umbrella over controls:studio, controls:team and controls:settings, which are run individually — together they are ~35 minutes and running both forms doubles it',
}

type Result = {
  suite: string
  status: 'pass' | 'fail' | 'timeout' | 'error'
  code: number | null
  ms: number
  /** The suite's own tally line, when it prints one. */
  tally: string
  /** Last few lines, for a failure worth reading without re-running. */
  tail: string[]
  at: string
}

/** Strip ANSI colour so a tally lifted from output is comparable text. */
const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, '')

const suites = async (): Promise<string[]> => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  return Object.keys(pkg.scripts)
    .filter((k) => k.startsWith('verify:'))
    .map((k) => k.slice('verify:'.length))
    .filter((k) => !(k in NEVER))
    .sort()
}

const load = async (): Promise<Record<string, Result>> => {
  if (!existsSync(RESULTS)) return {}
  try {
    return JSON.parse(await readFile(RESULTS, 'utf8')) as Record<string, Result>
  } catch {
    return {}
  }
}

const save = async (all: Record<string, Result>): Promise<void> => {
  await mkdir('.out', { recursive: true })
  await writeFile(RESULTS, `${JSON.stringify(all, null, 2)}\n`)
}

/*
  A suite's own verdict, in its own words.

  Every suite in this repository ends with a line of one of two shapes — the
  table-style ones print "38/39 checks passed", the narrative ones print
  "52 states, 4 findings". Lifting it verbatim means the report says what the
  suite said, rather than this runner paraphrasing seventy-nine different
  vocabularies into a word of its own.
*/
const tallyOf = (lines: string[]): string => {
  for (const line of [...lines].reverse()) {
    const t = plain(line).trim()
    if (/\d+\s*\/\s*\d+\s+checks passed/.test(t)) return t
    if (/\d+\s+(states|findings|controls|checks|attributes)\b/.test(t) && t.length < 130) return t
    if (/^(passed|clean|no dead controls)/i.test(t)) return t
  }
  return ''
}

const run = (suite: string): Promise<Result> =>
  new Promise((resolve) => {
    const started = Date.now()
    const out: string[] = []
    /*
      Its own process group, so a timeout can kill the whole tree.

      `npm run x` spawns a shell which spawns `tsx`, and `tsx` is what binds
      the port. SIGKILL on the child killed npm and orphaned the server: the
      port stayed bound, and the next three suites in the batch died on
      EADDRINUSE within twenty seconds each and were recorded as FAILURES.

      One timeout silently corrupting every result after it is the worst thing
      a runner of seventy-nine suites can do — the report would have named
      three healthy suites as broken, which is the same class of lie as an
      audit that passes for the wrong reason.
    */
    const child = spawn('npm', ['run', `verify:${suite}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached: true,
    })
    const take = (b: Buffer): void => {
      const text = b.toString()
      process.stdout.write(text)
      for (const line of text.split('\n')) if (line.trim() !== '') out.push(line)
      // Unbounded output from a chatty suite is a memory leak in a runner that
      // holds seventy-nine of them.
      if (out.length > 400) out.splice(0, out.length - 400)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)

    let done = false
    const finish = (status: Result['status'], code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({
        suite,
        status,
        code,
        ms: Date.now() - started,
        tally: tallyOf(out),
        tail: out.slice(-14).map((l) => plain(l).trimEnd()),
        at: new Date().toISOString(),
      })
    }
    /*
      Negative pid: the group, not the process. SIGTERM first so a suite gets
      the chance to close its server and its browser, then SIGKILL for whatever
      ignored it. Playwright leaves a Chromium behind on a bare SIGKILL.
    */
    const killTree = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal)
      } catch {
        // Already gone, which is the outcome we wanted.
      }
    }
    const timer = setTimeout(() => {
      killTree('SIGTERM')
      setTimeout(() => {
        killTree('SIGKILL')
        finish('timeout', null)
      }, 4000)
    }, BUDGET_MS)

    child.on('error', () => finish('error', null))
    child.on('close', (code) => finish(code === 0 ? 'pass' : 'fail', code))
  })

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const all = await load()

if (argv.includes('--reset')) {
  await save({})
  console.log('e2e: results cleared')
  process.exit(0)
}

const everything = await suites()

if (!argv.includes('--report')) {
  const only = flag('only')
  const wanted =
    only === undefined
      ? everything.filter((s) => all[s] === undefined)
      : only.split(',').map((s) => s.trim())
  const limit = Number(flag('limit') ?? wanted.length)
  const batch = wanted.slice(0, Math.max(limit, 0))

  if (batch.length === 0) {
    console.log(
      `e2e: nothing to run — ${String(Object.keys(all).length)} of ${String(everything.length)} suites already recorded`,
    )
  }
  for (const [n, suite] of batch.entries()) {
    const bar = '='.repeat(72)
    console.log(`\n${bar}\ne2e ${String(n + 1)}/${String(batch.length)} — verify:${suite}\n${bar}`)
    const result = await run(suite)
    all[suite] = result
    await save(all)
    console.log(
      `\n  -> ${result.status.toUpperCase()} in ${String(Math.round(result.ms / 1000))}s${
        result.tally === '' ? '' : ` — ${result.tally}`
      }`,
    )
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const recorded = everything.filter((s) => all[s] !== undefined)
const by = (status: Result['status']): Result[] =>
  recorded.map((s) => all[s] as Result).filter((r) => r.status === status)

const passed = by('pass')
const failed = by('fail')
const stuck = [...by('timeout'), ...by('error')]
const notRun = everything.filter((s) => all[s] === undefined)

const seconds = (ms: number): string => `${String(Math.round(ms / 1000))}s`

const lines = [
  '# End-to-end systems test',
  '',
  'Generated by `npm run e2e`. Issue #41.',
  '',
  `- suites in the repository: **${String(everything.length + Object.keys(NEVER).length)}**`,
  `- attempted: **${String(recorded.length)}**`,
  `- passed: **${String(passed.length)}** · failed: **${String(failed.length)}** · could not be run: **${String(stuck.length)}**`,
  `- not yet attempted: **${String(notRun.length)}**`,
  `- wall clock across the pass: **${seconds(recorded.reduce((n, s) => n + (all[s] as Result).ms, 0))}**`,
  '',
  '## What a green pass here does and does not mean',
  '',
  'Every number above is a suite exiting zero. Four things it does **not** say,',
  'each of which cost real time to establish and none of which a pass/fail',
  'table can carry:',
  '',
  '1. **Three suites are order-dependent through the shared job queue.**',
  '   `verify:slack` and `verify:worker` both refuse to start while any job is',
  "   live, because dequeue is global and would hand them somebody else's job",
  '   with no handler for it. Neither cancels the jobs it creates, so in a full',
  "   pass whichever runs second fails on the first one's debris.",
  '   `verify:worker` scored 22/26, then 26/26, then 25/26 on three consecutive',
  '   runs. Green here means the queue happened to be empty. See #184.',
  '2. **`verify:controls:settings` presses 12 controls and skips 87.**',
  '   Zero findings out of twelve presses is not coverage of the settings',
  '   sheet. See #183, which is the same defect on the desktop leg of the',
  '   studio suite.',
  '3. **Sections 4, 5, 6 and 8 of #41 are only partly reached by any suite.**',
  '   Cold starts, a 100MB file, a zero-byte file, two workers leasing the same',
  '   job, a migration applied twice and clock skew have no suite at all.',
  '4. **A suite that has never been run is green by assumption.** Before this',
  '   runner existed there was no way to run all 79, and `verify:all` runs',
  '   three. Nothing here was newly written — it was newly *executed*.',
  '',
  '## Deliberately not run',
  '',
  'Listed rather than absent, because #41 is explicit that an unrunnable check',
  'is where the next defect hides.',
  '',
  '| suite | why |',
  '|---|---|',
  ...Object.entries(NEVER).map(([s, why]) => `| \`verify:${s}\` | ${why} |`),
  '',
]

if (failed.length > 0) {
  lines.push(
    '## Failed',
    '',
    '| suite | verdict | time |',
    '|---|---|---|',
    ...failed.map(
      (r) =>
        `| \`verify:${r.suite}\` | ${r.tally === '' ? `exit ${String(r.code)}` : r.tally} | ${seconds(r.ms)} |`,
    ),
    '',
  )
  for (const r of failed) {
    lines.push(`### \`verify:${r.suite}\``, '', '```', ...r.tail, '```', '')
  }
}

if (stuck.length > 0) {
  lines.push(
    '## Could not be run',
    '',
    '| suite | what happened | time |',
    '|---|---|---|',
    ...stuck.map(
      (r) =>
        `| \`verify:${r.suite}\` | ${
          r.status === 'timeout' ? `still running after ${seconds(BUDGET_MS)}` : 'failed to start'
        } | ${seconds(r.ms)} |`,
    ),
    '',
  )
  for (const r of stuck) {
    lines.push(`### \`verify:${r.suite}\``, '', '```', ...r.tail, '```', '')
  }
}

lines.push(
  '## Passed',
  '',
  '| suite | verdict | time |',
  '|---|---|---|',
  ...passed
    .sort((a, b) => b.ms - a.ms)
    .map(
      (r) =>
        `| \`verify:${r.suite}\` | ${r.tally === '' ? 'exit 0' : r.tally} | ${seconds(r.ms)} |`,
    ),
  '',
)

if (notRun.length > 0) {
  lines.push('## Not yet attempted', '', notRun.map((s) => `\`${s}\``).join(', '), '')
}

await mkdir('docs/testing', { recursive: true })
await writeFile('docs/testing/e2e-2026-09-11.md', lines.join('\n'))

console.log(
  `\ne2e — ${String(passed.length)} passed, ${String(failed.length)} failed, ${String(stuck.length)} could not run, ${String(notRun.length)} not yet attempted`,
)
for (const r of failed) console.log(`  FAIL     verify:${r.suite}  ${r.tally}`)
for (const r of stuck) console.log(`  ${r.status.toUpperCase().padEnd(8)} verify:${r.suite}`)
console.log('report: docs/testing/e2e-2026-09-11.md')
