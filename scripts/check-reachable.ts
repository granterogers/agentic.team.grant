/**
 * Every job kind has something that can START it (#72, one layer further out).
 *
 *   npm run check:reachable
 *
 * `check:callers` asks whether anything CALLS a database function.
 * `check:pressable` asks whether anything PRESSES a gateway action.
 * This asks the question neither can: whether anything ever ENQUEUES a job
 * kind — which is how a whole feature comes to exist, pass its own tests, and
 * be unreachable from anything a person could do.
 *
 * ## The defect this is built from
 *
 * CLAUDE.md records it in the browser tier's own words: *"A job kind nobody
 * enqueues is invisible to `check:callers`. The whole browser tier — adapter,
 * ledger, tab, sessions, budget, Stop — was unreachable from any sentence
 * Grant could say, because nothing ever created a `browser.gather`. The check
 * walks DATABASE functions and a job kind is not one. When a capability ends
 * in a job kind, grep for the `enqueue_child` that starts it, and ask 'how
 * would he begin this' rather than 'does this work'."*
 *
 * That was found by hand, fixed for that one kind, and never asked about the
 * other thirty-five. This asks about all of them, every run.
 *
 * ## What counts as a starter
 *
 * Not "is the name mentioned somewhere" — the registering handler mentions its
 * own kind, and so does every migration that ever touched it. The question is
 * whether a PERSON has a path to it, so a starter is one of:
 *
 *   - **a duty** — a `responsibilities` row carrying that `job_kind`, so the
 *     clock starts it;
 *   - **the instruction handler** — the office decides to enqueue it from
 *     something Grant said;
 *   - **another handler** — a parent enqueues it as a child;
 *   - **the page or the gateway** — a control or an action;
 *   - **the MCP server** — an agent holding the bearer token (#13: what the UI
 *     can do, an agent should be able to do);
 *   - **an npm script Grant runs** — `check:callers` already draws this
 *     distinction and derives it from `package.json` so it cannot drift.
 *
 * A `verify:` suite is NOT a starter, for the reason `check:callers` gives: a
 * capability reachable only from a harness is a capability Grant does not
 * have. That is the whole point of the check, and the browser tier passed
 * every suite it had while being unreachable.
 *
 * ## A baseline that may only shrink
 *
 * Same contract as its two siblings: this fails on a kind that is NOT in the
 * baseline, and it fails when a baselined kind BECOMES reachable and has not
 * been removed. A baseline that cannot go stale is the difference between a
 * baseline and an allowlist.
 *
 * Every entry carries a reason, because CLAUDE.md records what a reason-free
 * entry costs: *"A BASELINED REASON IS A CLAIM ABOUT THE PRODUCT"*, and two of
 * them were false within two days. A documented excuse is worse than a bare
 * gap, because it stops the next person looking.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Kinds that legitimately have no starter, and why.
 *
 * Empty today, deliberately: every registered kind currently has a path. The
 * constant exists so that the first genuinely-unreachable kind has somewhere
 * honest to go other than deleting the check.
 */
const BASELINE: Readonly<Record<string, string>> = {
  'ci.dispatch':
    'Deliberately dormant, and giving it a starter would REVERSE a standing ' +
    'instruction rather than close a gap. Grant turned GitHub Actions off ' +
    'completely on 2026-09-08 after 1,800 of 2,000 free minutes went to one ' +
    'cron — "stop using github actions completely please, find another way to ' +
    'do thing... for any process" — and ADR-0033 records that checks run in ' +
    'the authoring session instead. `workflow_dispatch` survives, which is why ' +
    "the handler is kept rather than deleted: CLAUDE.md's rule for a " +
    'capability that is switched off is to disable it, never to remove it, ' +
    'because a listed gap can become a proposal and a deleted one cannot. ' +
    'Wiring a control to this needs his word, not a tidy-up.',
}

/** Read a set of files as one string, or '' when the glob matches nothing. */
const slurp = (find: string): string => {
  try {
    return execSync(`${find} -print0 | xargs -0 cat`, { maxBuffer: 128 * 1024 * 1024 }).toString()
  } catch {
    return ''
  }
}

const handlerFiles = execSync("find src/handlers -name '*.ts'").toString().trim().split('\n')

/** kind -> the file that REGISTERS it, which may not count as its own starter. */
const registrar = new Map<string, string>()
for (const file of handlerFiles) {
  const body = readFileSync(file, 'utf8')
  /*
    `kind:` alone is not a handler registration.

    The first draft matched any object literal with a `kind` field and
    collected `heading`, `paragraph`, `quote`, `table`, `task` and
    `use_project` — report blocks and plan steps in `artifact.ts`,
    `report.ts` and `plan.ts`. Six phantom kinds, every one of which would
    have been reported as an unreachable capability.

    What distinguishes a real registration is the shape the worker consumes:
    a `kind` immediately followed by the `handle` that runs it. Anchored
    across the intervening whitespace only, so a `kind` field somewhere else
    in a large object cannot reach a `handle` further down.
  */
  for (const m of body.matchAll(/kind: '([a-z_]+(?:\.[a-z_]+)?)',\s*handle:/g)) {
    const kind = m[1]
    if (kind !== undefined && !registrar.has(kind)) registrar.set(kind, file)
  }
}

if (registrar.size === 0) {
  console.error('check:reachable — found no registered job kinds at all, which cannot be right.')
  console.error('  The registration shape in src/handlers/*.ts has probably changed.')
  process.exit(1)
}

/*
  The npm scripts Grant actually runs.

  Derived rather than listed, the way `check:callers` derives it, so it cannot
  drift: a script is a capability he has unless it is a verify suite, a proof
  of concept, or the gate that runs them.
*/
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
const hisScripts = Object.entries(scripts)
  .filter(([name]) => !/^(verify:|poc:|gate$|e2e$)/.test(name))
  .map(([, body]) => body)
  .join('\n')

const reachedFrom = (kind: string): string | null => {
  const quoted = `'${kind}'`
  const reg = registrar.get(kind)

  /*
    Two starters live in SQL, and they are different claims.

    A DUTY is a `responsibilities` row, so the clock starts it. A DATABASE
    FUNCTION is something like `app.google_revoke_begin` or `app.mcp_enqueue`,
    which a person reaches by disconnecting Google or by adding a connector —
    both real paths, and both invisible to a check that only looks for the
    duty table. Leaving that category out reported `google.revoke` and
    `mcp.discover` as unreachable on the first run, and a live query had
    already proved otherwise.

    Matched per STATEMENT rather than across the whole corpus, because the
    migration that created a handler's own plumbing also names its kind, and
    counting that would make every kind trivially reachable.
  */
  for (const stmt of migrations.split(';')) {
    if (stmt.includes(quoted) && /responsibilities/i.test(stmt)) return 'a duty'
  }
  /*
    A plpgsql body is full of semicolons, so a statement split fragments a
    function and separates its name from the line that names the kind. That
    is why `mcp.discover` read as unreachable on the second run while
    `app.mcp_enqueue` had been enqueueing it all along. Split on function
    boundaries instead, so a chunk is one whole definition.
  */
  for (const fn of migrations.split(/create\s+(?:or\s+replace\s+)?function/i)) {
    if (!fn.includes(quoted)) continue
    if (/enqueue|insert\s+into\s+public\.jobs/i.test(fn)) return 'a database function'
  }
  /*
    Skip the REGISTRATION, not the file.

    `notebook.ts` registers four kinds and one of them enqueues another, so
    skipping the whole registrar file reported `notebook.collect` as
    unreachable while an `enqueue_child` for it sat three hundred lines above
    the registration in that same file. Blanking just the matched
    `kind: '…', handle:` leaves every other mention of the name visible,
    which is what the question actually asks.
  */
  const registration = new RegExp(`kind: '${kind.replace(/[.]/g, '\\.')}',\\s*handle:`)
  for (const file of handlerFiles) {
    const body = readFileSync(file, 'utf8')
    const rest = file === reg ? body.replace(registration, '') : body
    if (rest.includes(quoted)) {
      return file.endsWith('instruction.ts') ? 'something Grant said' : `a parent job (${file})`
    }
  }
  if (srcElsewhere(kind, reg)) return 'the office code'
  if (page.includes(quoted)) return 'the page'
  if (gateway.includes(quoted)) return 'a gateway action'
  if (mcp.includes(quoted)) return 'the MCP server'
  if (hisScripts.includes(kind)) return 'an npm script'
  return null
}

const srcElsewhere = (kind: string, reg: string | undefined): boolean => {
  const files = execSync("find src -name '*.ts' -not -path 'src/handlers/*'")
    .toString()
    .trim()
    .split('\n')
  /*
    The containment registry NAMES every kind to say how far it reaches (src/jobs/containment.ts: `reach: 'external'`).
    That is a description of the kind, not something that starts it, and counting it made every kind trivially
    reachable - ci.dispatch was reported as started by "the office code" on the strength of its registry row (#395).
  */
  return files.some(
    (f) =>
      f !== reg &&
      f !== '' &&
      f !== 'src/jobs/containment.ts' &&
      readFileSync(f, 'utf8').includes(`'${kind}'`),
  )
}

const migrations = slurp("find migrations -name '*.sql'")
const page = slurp("find web -type f \\( -name '*.js' -o -name '*.html' \\)")
const gateway = slurp("find supabase/functions/hq-api -name '*.ts'")
const mcp = slurp("find supabase/functions/mcp -name '*.ts'")

const unreachable: string[] = []
const staleBaseline: string[] = []
const how = new Map<string, string>()

for (const kind of [...registrar.keys()].sort()) {
  const by = reachedFrom(kind)
  if (by === null) {
    if (!(kind in BASELINE)) unreachable.push(kind)
  } else {
    how.set(kind, by)
    if (kind in BASELINE) staleBaseline.push(kind)
  }
}

console.log(`check:reachable — ${registrar.size} registered job kind(s)`)
for (const [kind, by] of [...how.entries()].sort()) {
  console.log(`  ${kind.padEnd(30)} started by ${by}`)
}

let bad = false
if (unreachable.length > 0) {
  bad = true
  console.error(`\n${unreachable.length} job kind(s) that NOTHING can start:`)
  for (const k of unreachable) {
    console.error(`  ${k}  — registered in ${registrar.get(k)}, and unreachable from any`)
    console.error('     duty, sentence, parent job, control, gateway action, agent or script.')
  }
  console.error('\n  A capability that cannot be started is a capability nobody has.')
  console.error('  Either give it a starter, or baseline it WITH A REASON in this file.')
}
if (staleBaseline.length > 0) {
  bad = true
  console.error(`\n${staleBaseline.length} baseline entr(y/ies) that are now reachable:`)
  for (const k of staleBaseline)
    console.error(`  ${k} — started by ${how.get(k)}; remove it from BASELINE.`)
  console.error('\n  A baseline that cannot go stale is the difference between a baseline')
  console.error('  and an allowlist.')
}

if (bad) process.exit(1)
console.log(
  `\nevery registered kind has a path a person can reach` +
    (Object.keys(BASELINE).length > 0
      ? ` (${Object.keys(BASELINE).length} baselined, each with a reason)`
      : ''),
)
