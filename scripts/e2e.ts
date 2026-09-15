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
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'

const RESULTS = '.out/e2e-results.json'

/**
 * Every result ever recorded, one JSON object per line, never overwritten.
 *
 * Issue #226. `RESULTS` above holds ONE result per suite and the next run
 * replaces it, which is fine for "what is the state now" and useless for the
 * question that actually caught a defect on 14 September: *has this suite ever
 * disagreed with itself?*
 *
 * `verify:agents` reported 56/56 on 11 September and 55/56 on 14 September
 * against identical code, because a tiebreak was a random uuid (0361). It had
 * been flaky for at least three days, and the only reason anyone found out is
 * that the same suite happened to run twice against the same commit and
 * somebody happened to compare. Nothing in the repository was keeping the
 * evidence.
 *
 * CLAUDE.md already says a suite that has never been run is not evidence. This
 * is the next sentence: a suite that has been run ONCE is barely more.
 *
 * Keyed by COMMIT, which is the whole design. Two different verdicts against
 * the same commit is a flake. Two different verdicts across a change is just a
 * change, and treating those alike would report every fix as flakiness and
 * every regression as flakiness too.
 */
const HISTORY = '.out/e2e-history.jsonl'

/** The commit under test. Unknown rather than guessed when git cannot say. */
const commit = await new Promise<string>((resolve) => {
  const child = spawn('git', ['rev-parse', '--short', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let out = ''
  child.stdout.on('data', (b: Buffer) => {
    out += b.toString()
  })
  child.on('close', () => resolve(out.trim() === '' ? 'unknown' : out.trim()))
  child.on('error', () => resolve('unknown'))
})

type Seen = { suite: string; status: string; tally: string; ms: number; at: string; commit: string }

const remember = async (r: Result): Promise<void> => {
  await mkdir('.out', { recursive: true })
  const line: Seen = {
    suite: r.suite,
    status: r.status,
    tally: r.tally,
    ms: r.ms,
    at: r.at,
    commit,
  }
  await appendFile(HISTORY, `${JSON.stringify(line)}\n`)
}

/**
 * Suites that have given more than one verdict for the same commit.
 *
 * Not "more than one verdict ever" — that is a fix, or a regression, and both
 * are supposed to happen.
 */
const flaky = async (): Promise<
  Array<{ suite: string; commit: string; verdicts: string[]; runs: number }>
> => {
  if (!existsSync(HISTORY)) return []
  const seen = new Map<string, { statuses: Map<string, number>; suite: string; commit: string }>()
  for (const raw of (await readFile(HISTORY, 'utf8')).split('\n')) {
    if (raw.trim() === '') continue
    let row: Seen
    try {
      row = JSON.parse(raw) as Seen
    } catch {
      continue
    }
    if (row.commit === 'unknown') continue
    const key = `${row.suite}@${row.commit}`
    const at = seen.get(key) ?? { statuses: new Map(), suite: row.suite, commit: row.commit }
    at.statuses.set(row.status, (at.statuses.get(row.status) ?? 0) + 1)
    seen.set(key, at)
  }
  return [...seen.values()]
    .filter((v) => v.statuses.size > 1)
    .map((v) => ({
      suite: v.suite,
      commit: v.commit,
      verdicts: [...v.statuses.entries()].map(([k, n]) => `${k} x${String(n)}`),
      runs: [...v.statuses.values()].reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.suite.localeCompare(b.suite))
}

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
  'google-live':
    "spends a real Google API quota against Grant's own account. Read-only, but run deliberately rather than as one of ninety",
  db: 'a chain of 46 other suites, every one of which this runner already runs individually — and it ends in `purge:fixtures --go` and `slack:tidy --go`, which are sweeps rather than checks',
  controls:
    'the umbrella over controls:studio, controls:team and controls:settings, which are run individually — together they are ~35 minutes and running both forms doubles it',
}

/**
 * THE FAST READINESS GATE.
 *
 * Grant's backend acceptance specification (2026-09-14) asks for two levels,
 * and only one of them existed. `npm run e2e` is the DEEP ACCEPTANCE SWEEP:
 * ninety-odd suites, ninety-plus minutes, run deliberately. There was nothing
 * short enough to run routinely.
 *
 * `verify:all` looks like the missing thing and is not. It is
 * `verify` + `audit:credentials` + `verify:db`, and `verify:db` is a
 * FORTY-SEVEN command chain that ends in `purge:fixtures --go` and
 * `slack:tidy --go` — destructive sweeps, not checks. Nobody runs that
 * routinely and nobody should.
 *
 * So this is the curated list, and every entry is here for a stated reason.
 * The specification names what a fast gate must cover: highest-value backend
 * paths, severe regressions, persistence, isolation, routing and delegation,
 * capability honesty, task and project operations, critical cheap
 * integrations, and fixture cleanup. One or two suites per area, chosen for
 * the ratio of what they would catch to what they cost.
 *
 * NOT in it, deliberately: anything driving a browser (that is the UX QA
 * standard's job, and `verify:controls:studio` alone is sixteen minutes),
 * anything spending a real external budget, and anything whose failure would
 * be a known-open Issue rather than a new regression.
 *
 * Keep it under about six minutes. A gate that takes fifteen is a gate that
 * gets skipped, and a skipped gate is worse than no gate because the
 * repository still believes it has one.
 */
const GATE: ReadonlyArray<readonly [script: string, why: string]> = [
  // Persistence and the shapes a client actually reaches.
  ['verify:schema', "the schema's own dangling references"],
  [
    'verify:wrappers',
    'every RPC a client calls is reachable — PostgREST exposes only `public`, and a missing wrapper is invisible until called',
  ],
  [
    'verify:transitions',
    'the job state machine in the database and the one in the code still agree',
  ],
  // Capability honesty. The invariant the whole specification is built around.
  ['verify:attests', 'an agent may not say it looked when it did not (#185)'],
  ['verify:knows', 'a false "I can\'t" and a false "I can" are both failures (#64)'],
  // Routing and delegation, which output attribution cannot prove.
  /*
    First of the routing checks deliberately, because it is the only one that
    can run when the model provider cannot (#239) and it takes three seconds.

    It settles the question a confident misroute makes invisible: the ceiling
    was ordering the intersection, so "draft the announcement copy" went to
    growth and "audit the refund policy for compliance risk" went to research
    — plausible specialists, answering confidently, from the wrong desk.
    `verify:routing-breadth` measures how OFTEN the right person is reached
    across phrasings and scored both of those as hits.
  */
  [
    'verify:reach',
    'the vocabulary and the intent ceiling agree on who answers — deterministic, no model (#231)',
  ],
  [
    'verify:routing-breadth',
    'every specialist is reachable by how Grant actually talks, and nothing trivial convenes one (#232)',
  ],
  ['verify:delegation', 'the work is actually delegated, not eight voices and one worker (#65)'],
  [
    'verify:collaborates',
    'a two-subject request reaches a second specialist as real work, and the chain stays bounded (#233)',
  ],
  ['verify:handoff', 'delegation that leaves a trace'],
  /*
    What the office does when things go wrong, at the level of the JOB rather
    than the integration. `verify:chaos` proves the rest of the system stays up
    and `verify:failures` proves a failure is classified; neither asserts that
    the person waiting gets a truthful answer.

    Needs no model, which is not a compromise: a recovery property must hold
    for ANY handler outcome, so a stub that fails on demand is a better
    instrument than a real one that fails when the weather does — and this runs
    when the provider is out, which is exactly when somebody wants to know.
  */
  [
    'verify:recovers',
    'no fabricated success, no duplicate action, no lost mutation, no stranded work (#231)',
  ],
  [
    'verify:cross-interface',
    'the same instruction through any surface uses the same canonical layer (§22 B)',
  ],
  // Project and task operations — what Grant touches most.
  ['verify:identity', 'a name finds the right project, and an ambiguous one finds nobody'],
  ['verify:tasks', 'the task system, driven rather than described'],
  // Isolation. One project cannot see another.
  ['verify:history', "one conversation, both sides, and nothing from anybody else's project"],
  // Transport honesty — a message Grant sent must not vanish.
  ['verify:transport', 'a message does not disappear because a provider was down'],
  // Permissions and the public surface.
  ['verify:security', 'the public surface, probed as an attacker would'],
  ['verify:dryrun', 'a dry run that writes anything is not a dry run'],
  // Fixture hygiene is part of the test, not a chore after it.
  [
    'verify:drains',
    'the queue is actually moving — a dead worker once left Grant waiting fifteen hours while the heartbeat logged 1,440 successes',
  ],
  ['check:leaks', "no suite left a project, job or channel in Grant's real views"],
]

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

/**
 * Strip ANSI colour so a tally lifted from output is comparable text.
 *
 * Built with `RegExp` rather than written as a literal. Biome's
 * `noControlCharactersInRegex` refuses an escape too — not only a typed
 * control character — and it is right to: a literal ESC in a source file is
 * invisible in a diff. Naming it once is clearer than either.
 */
const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (s: string): string => s.replace(ANSI, '')

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

const run = (suite: string, script = `verify:${suite}`): Promise<Result> =>
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
    const child = spawn('npm', ['run', script], {
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

if (argv.includes('--gate')) {
  /*
    The gate always runs fresh. Resuming is right for a ninety-minute sweep
    and wrong for a gate: "already recorded" from an hour ago is not an answer
    to "is it safe to push now". So no load, no resume, no --limit.
  */
  const results: Result[] = []
  console.log(`\nreadiness gate — ${String(GATE.length)} checks\n`)
  for (const [n, [script, why]] of GATE.entries()) {
    const bar = '='.repeat(72)
    console.log(
      `\n${bar}\ngate ${String(n + 1)}/${String(GATE.length)} — ${script}\n  ${why}\n${bar}`,
    )
    const r = await run(script.replace(/^verify:/, ''), script)
    results.push(r)
    await remember(r)
    console.log(
      `\n  -> ${r.status.toUpperCase()} in ${String(Math.round(r.ms / 1000))}s${r.tally === '' ? '' : ` — ${r.tally}`}`,
    )
  }

  const bad = results.filter((r) => r.status !== 'pass')
  const total = results.reduce((a, r) => a + r.ms, 0)
  const stamp = new Date().toISOString().slice(0, 10)

  const rows = results.map((r, i) => {
    const why = GATE[i]?.[1] ?? ''
    const mark = r.status === 'pass' ? 'green' : r.status === 'fail' ? 'RED' : 'COULD NOT RUN'
    return `| \`${GATE[i]?.[0] ?? r.suite}\` | ${mark} | ${r.tally === '' ? '—' : r.tally} | ${String(Math.round(r.ms / 1000))}s | ${why} |`
  })

  const doc = [
    '# Fast readiness gate',
    '',
    `Generated by \`npm run gate\` on ${stamp}. Issue #224.`,
    '',
    `**${bad.length === 0 ? 'GREEN' : 'RED'}** — ${String(results.length - bad.length)} of ${String(results.length)} passed in ${String(Math.round(total / 1000))}s.`,
    '',
    'This is the SHORT gate. It is not the deep acceptance sweep, and passing it',
    'is not a claim about the whole backend — `npm run e2e` is that claim. What a',
    'green gate says is narrower and still worth having: no severe regression in',
    'persistence, isolation, routing, delegation, capability honesty, project and',
    'task operations, the public surface, or fixture hygiene.',
    '',
    '| check | verdict | tally | time | why it is in the gate |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ]
  for (const r of bad) {
    doc.push(
      `## \`${GATE[results.indexOf(r)]?.[0] ?? r.suite}\` — ${r.status}`,
      '',
      '```',
      ...r.tail,
      '```',
      '',
    )
  }
  await mkdir('docs/testing', { recursive: true })
  await writeFile('docs/testing/readiness-gate.md', doc.join('\n'))

  console.log(
    `\ngate — ${String(results.length - bad.length)}/${String(results.length)} passed in ${String(Math.round(total / 1000))}s`,
  )
  for (const [i, r] of results.entries())
    if (r.status !== 'pass')
      console.log(`  ${r.status.toUpperCase().padEnd(8)} ${GATE[i]?.[0] ?? r.suite}  ${r.tally}`)
  console.log('report: docs/testing/readiness-gate.md')
  process.exit(bad.length === 0 ? 0 : 1)
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
    await remember(result)
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

const wobbly = await flaky()
if (wobbly.length > 0) {
  /*
    Its own section, above Passed, because a flaky suite reads as a passing one
    on the run you happen to look at. #226.
  */
  lines.push(
    '## Flaky — more than one verdict for the SAME commit',
    '',
    'A suite here has disagreed with itself against unchanged code. That is not',
    'a fix and not a regression; it is a result that cannot be trusted in either',
    'direction. `verify:agents` was in exactly this state for three days and',
    'nobody knew, because nothing kept the evidence.',
    '',
    '| suite | commit | verdicts |',
    '|---|---|---|',
    ...wobbly.map((w) => `| \`verify:${w.suite}\` | \`${w.commit}\` | ${w.verdicts.join(', ')} |`),
    '',
  )
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
/*
  The report used to be written to `e2e-2026-09-11.md` — a date baked into the
  filename, so every run after the eleventh overwrote a file whose own name
  said it was from a day it was not. Dated at generation now.
*/
const REPORT = `docs/testing/e2e-${new Date().toISOString().slice(0, 10)}.md`
await writeFile(REPORT, lines.join('\n'))

console.log(
  `\ne2e — ${String(passed.length)} passed, ${String(failed.length)} failed, ${String(stuck.length)} could not run, ${String(notRun.length)} not yet attempted`,
)
for (const w of wobbly)
  console.log(`  FLAKY    verify:${w.suite} @ ${w.commit}  ${w.verdicts.join(', ')}`)
for (const r of failed) console.log(`  FAIL     verify:${r.suite}  ${r.tally}`)
for (const r of stuck) console.log(`  ${r.status.toUpperCase().padEnd(8)} verify:${r.suite}`)
console.log(`report: ${REPORT}`)

/*
  A runner that always exits 0 cannot gate anything, and a caller that trusts
  it is being told a sweep with twelve failures succeeded. `stuck` counts too:
  the specification is explicit that "could not be tested" is never a pass.
*/
process.exit(failed.length + stuck.length === 0 ? 0 : 1)
