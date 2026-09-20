/**
 * CAN THE OFFICE WORK OUT WHAT A GOAL REQUIRES? (#283)
 *
 *   npm run verify:plans            the development corpus
 *   npm run verify:plans -- --held  the held-out set
 *
 * The previous run moved the boundary one level up: arbitrary human language is
 * now read by a model before any regex sees it. This asks whether the same
 * inversion survives one level DOWN — whether the office, having understood the
 * sentence, can work out what SEQUENCE of work satisfies it.
 *
 * ## What is measured, and against what
 *
 * Every case names the capabilities a competent plan must include, by their
 * canonical `tool_permissions.tool` name, and the ones it must not. The
 * catalogue is read from the database rather than listed here, because #7 of
 * the brief is explicit: the registry is the source of truth and a second copy
 * in TypeScript is a second thing to rot.
 *
 * Two architectures are scored over one corpus:
 *
 *   TODAY     `readPlan` plus the nine single-shot recognisers the handler
 *             consults, run exactly as the handler runs them.
 *   CANDIDATE the structured planner, when one exists.
 *
 * A single score would be a claim about a model on one afternoon. Two scores
 * over one corpus are a claim about an architecture — the same argument
 * `verify:understands` makes, one layer down.
 *
 * ## Why this is offline
 *
 * It scores what the office would DECIDE to do, not what happens when it does
 * it. Deciding is the thing under test; executing is covered by
 * `verify:anchors` and the handler suites, and running 23 real jobs to measure
 * a planner would cost an hour and confound the measurement with retrieval
 * quality, model variance and provider weather.
 */
import { readFileSync } from 'node:fs'
import {
  artifactListing,
  artifactRequest,
  notebookRequest,
  pageRequest,
} from '../../src/agents/actions.ts'
import { extractionRequest } from '../../src/agents/extract.ts'
import { type Capability, planFor, planningCatalogue } from '../../src/agents/goal.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import { linkRequest } from '../../src/agents/links.ts'
import { personalTaskChange, personalTaskRequest } from '../../src/agents/mine.ts'
import { readPlan } from '../../src/agents/plan.ts'
import { taskRequest } from '../../src/agents/tasks.ts'
import { readTeaching } from '../../src/agents/teaching.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const held = process.argv.includes('--held')
const file = held ? 'docs/testing/goal-corpus-heldout.json' : 'docs/testing/goal-corpus.json'
interface Case {
  id: string
  said: string
  goal: string
  needs: string[]
  forbidden: string[]
  shape: 'single' | 'sequence' | 'parallel'
  min_steps: number
  requires_approval?: boolean
  impediment?: string
}
const corpus = JSON.parse(readFileSync(file, 'utf8')) as { cases: Case[] }

/*
  THE CATALOGUE, FROM THE DATABASE.

  Not a list in this file. The registry owns permission truth, and #7 of the
  brief forbids a second copy — a corpus scored against a stale catalogue would
  report a capability as unavailable long after Grant granted it.
*/
const registry = new Map(
  (
    await db.execute(
      `select tool, level, enabled, in_reply from public.tool_permissions order by tool`,
    )
  ).rows.map((r) => {
    const row = r as { tool: string; level: number; enabled: boolean; in_reply: boolean }
    return [
      String(row.tool),
      { level: Number(row.level), enabled: row.enabled === true, inReply: row.in_reply === true },
    ]
  }),
)

/*
  WHAT TODAY'S ARCHITECTURE WOULD DO, mapped onto capability names.

  The same nine recognisers `handlers/instruction.ts` consults, in its order,
  plus `readPlan`. Each produces at most one action; none of them sequences.
  Mapping their results onto `tool_permissions.tool` is what makes the two
  architectures comparable at all — a count of regex hits is not a measurement
  of whether a goal was met.
*/
const today = (said: string): { caps: string[]; steps: number; plan: boolean } => {
  const caps = new Set<string>()
  const c = classifyIntent(said)
  const plan = readPlan(said)
  if (plan !== null) {
    for (const step of plan.steps) {
      if (step.kind === 'add_source' || step.kind === 'attach' || step.kind === 'generate') {
        caps.add('notebook.write')
      }
      if (step.kind === 'ask') caps.add('notebook.read')
    }
  }
  if (readTeaching(said) !== null) caps.add('preference.update')
  if (linkRequest(said) !== null) caps.add('notebook.write')
  if (notebookRequest(said) !== null) caps.add('notebook.write')
  if (artifactListing(said) !== null) caps.add('notebook.read')
  if (artifactRequest(said) !== null) caps.add('draft.create')
  if (pageRequest(said) !== null) caps.add('db.read')
  if (extractionRequest(said) !== null) caps.add('task.extract')
  if (personalTaskRequest(said) !== null) caps.add('task.create')
  if (taskRequest(said, c) !== null) caps.add('task.create')
  if (personalTaskChange(said) !== null) caps.add('task.create')
  /*
    EVERY TURN READS, so today's architecture gets `db.read` for free.

    The handler supplies the project spine unconditionally and runs retrieval
    whenever the turn is answering, so withholding this credit would flatter
    the CANDIDATE — the direction a measurement must never lean. The first
    baseline scored 4/23 with `db.read` credited only through `pageRequest`,
    which was wrong about the product.
  */
  caps.add('db.read')
  const steps = plan === null ? caps.size : Math.max(plan.steps.length, caps.size)
  return { caps: [...caps], steps, plan: plan !== null }
}

/*
  THE CANDIDATE, and the switch that keeps the baseline honest. Skipped with
  --baseline-only, and said out loud rather than quietly printing the baseline
  twice — a run that measured one architecture and reported two numbers would
  be the worst possible outcome here.
*/
const runCandidate = !process.argv.includes('--baseline-only')
const key = String(
  (
    (
      await db.execute(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'openrouter.api_key'`,
      )
    ).rows[0] as { v?: string } | undefined
  )?.v ?? '',
)
const router = key === '' ? undefined : new ProviderRouter(db, key)
const catalogue: readonly Capability[] = await planningCatalogue(db)
const roster = (
  await db.execute(
    `select slug, coalesce(title, '') as title from public.staff where active order by slug`,
  )
).rows.map((r) => {
  const row = r as { slug: string; title: string }
  return { slug: String(row.slug), title: String(row.title) }
})

const rows: {
  id: string
  met: string[]
  missed: string[]
  banned: string[]
  enough: boolean
  candidateEnough: boolean
  candidateBanned: string[]
  invented: boolean
}[] = []

console.log(`goal planning — ${String(corpus.cases.length)} case(s) from ${file}\n`)
console.log(
  `catalogue: ${String([...registry.values()].filter((c) => c.enabled).length)} enabled of ${String(registry.size)}\n`,
)

let totalMs = 0
let slowest = 0
let fellBack = 0
const models = new Set<string>()

for (const c of corpus.cases) {
  const got = today(c.said)
  const met = c.needs.filter((n) => got.caps.includes(n))
  const missed = c.needs.filter((n) => !got.caps.includes(n))
  const banned = c.forbidden.filter((f) => got.caps.includes(f))
  /*
    "ENOUGH" NEEDS THE SEQUENCING, NOT JUST THE CAPABILITIES.

    Capability presence alone is a crude proxy and it flatters both sides:
    "review the project and put review tasks on my list" credits `task.create`
    today, and what today actually does is file ONE task titled with a
    fragment of the sentence. The goal is not met by touching the right table.

    So a case whose shape is a SEQUENCE or a fan-out of two or more pieces of
    work additionally requires an explicit ordered plan. That is precisely the
    architectural claim under test — today's cascade has no representation of
    "step B consumes step A", and `readPlan` produces one only for
    notebook-shaped work — and it is fair to both sides, because the candidate
    must produce a real plan to earn the same credit.
  */
  const needsAPlan = c.min_steps >= 2 && (c.shape === 'sequence' || c.shape === 'parallel')
  const enough =
    missed.length === 0 &&
    banned.length === 0 &&
    got.steps >= c.min_steps &&
    (!needsAPlan || got.plan)
  /*
    THE CANDIDATE, over the same case and scored by the SAME rule. A different
    rule for each architecture would be two measurements rather than a
    comparison.
  */
  let candidateEnough = false
  let candidateBanned: string[] = []
  let invented = false
  let line = ''
  if (runCandidate) {
    const at = Date.now()
    const plan = await planFor(c.said, catalogue, roster, router)
    const took = Date.now() - at
    totalMs += took
    slowest = Math.max(slowest, took)
    if (plan.how === 'fallback') fellBack += 1
    if (plan.model !== null) models.add(plan.model)
    const caps = plan.steps.map((st) => st.capability)
    /*
      `db.read` is free to the candidate for the same reason it is free to
      today's architecture — the answering path reads the project spine on
      every turn whatever the plan says. Withholding it from one side only
      would be the asymmetry the baseline was corrected for, pointing the
      other way.
    */
    const withRead = [...new Set([...caps, 'db.read'])]
    const cMissed = c.needs.filter((need) => !withRead.includes(need))
    candidateBanned = c.forbidden.filter((f) => caps.includes(f))
    /*
      A refusal naming a capability is the planner having TRIED to invent one.
      Counted apart from a merely unmet goal, because inventing is the failure
      that would make this architecture unsafe rather than simply weak.
    */
    invented = plan.refused.some((r) => r.includes('is not a capability'))
    const wantsShape = c.min_steps >= 2 && (c.shape === 'sequence' || c.shape === 'parallel')
    const hasShape =
      !wantsShape ||
      (plan.steps.length >= c.min_steps &&
        (c.shape !== 'sequence' || plan.steps.some((st) => st.needs.length > 0)))
    /*
      A DELIBERATE FALLBACK IS THE CASCADE, AND THE CASCADE IS WHAT SHIPS.

      The candidate ARCHITECTURE is "planner, else today's recognisers", so
      scoring a fast-path case as a candidate failure measures a system nobody
      would run. The first version did exactly that and reported two controls
      as regressions while the shipped behaviour was unchanged and correct.

      Only a DELIBERATE fallback earns this. A fallback caused by bad JSON or a
      dead provider is also the cascade, and that is the point of the design —
      so it is scored the same way and counted separately in `fellBack`, where
      it is visible rather than flattering.
    */
    candidateEnough =
      plan.how === 'fallback'
        ? enough
        : cMissed.length === 0 && candidateBanned.length === 0 && hasShape
    line =
      `\n       candidate ${candidateEnough ? 'ok  ' : 'MISS'} [${caps.join(' → ') || 'no steps'}]` +
      `${plan.how === 'fallback' ? ` · FELL BACK: ${String(plan.why)}` : ''}` +
      `${candidateBanned.length > 0 ? ` · FORBIDDEN: ${candidateBanned.join(',')}` : ''}` +
      `${invented ? ' · INVENTED A CAPABILITY' : ''}` +
      `${plan.unreachable.length > 0 ? ` · unreachable: ${String(plan.unreachable.length)}` : ''}`
  }

  rows.push({ id: c.id, met, missed, banned, enough, candidateEnough, candidateBanned, invented })
  console.log(
    `  today ${enough ? 'ok  ' : 'MISS'} ${c.id.padEnd(30)} wanted [${c.needs.join(',') || '—'}]` +
      ` got [${got.caps.join(',') || 'nothing — prose only'}]` +
      `${got.plan ? ' · multi-step plan' : ''}` +
      `${banned.length > 0 ? ` · FORBIDDEN: ${banned.join(',')}` : ''}` +
      line,
  )
}

const n = corpus.cases.length
const enough = rows.filter((r) => r.enough).length
const unsafe = rows.filter((r) => r.banned.length > 0).length
const silent = rows.filter((r) => r.missed.length > 0 && r.met.length === 0).length
console.log(
  `\ntoday's architecture: ${String(enough)}/${String(n)} goals reachable` +
    `   ·   ${String(silent)} produce NO required capability at all` +
    `   ·   ${String(unsafe)} propose something forbidden`,
)

if (runCandidate) {
  const cEnough = rows.filter((r) => r.candidateEnough).length
  const cUnsafe = rows.filter((r) => r.candidateBanned.length > 0).length
  const cInvented = rows.filter((r) => r.invented).length
  const multi = corpus.cases.filter((c) => c.min_steps >= 2)
  const multiToday = rows.filter(
    (r, i) => (corpus.cases[i]?.min_steps ?? 0) >= 2 && r.enough,
  ).length
  const multiCandidate = rows.filter(
    (r, i) => (corpus.cases[i]?.min_steps ?? 0) >= 2 && r.candidateEnough,
  ).length
  console.log(
    `candidate planner:    ${String(cEnough)}/${String(n)} goals reachable` +
      `   ·   ${String(cUnsafe)} propose something forbidden` +
      `   ·   ${String(cInvented)} tried to invent a capability`,
  )
  console.log(
    `multi-step only:      today ${String(multiToday)}/${String(multi.length)}` +
      `   ·   candidate ${String(multiCandidate)}/${String(multi.length)}`,
  )
  console.log(
    `fell back: ${String(fellBack)}/${String(n)}   ·   mean ${String(
      Math.round(totalMs / Math.max(n, 1)),
    )}ms   ·   slowest ${String(slowest)}ms   ·   ${[...models].join(', ') || 'no model'}`,
  )
  /*
    THE BAR IS THE BASELINE, AND THE SAFETY COLUMN IS ABSOLUTE.

    A candidate that reaches more goals by proposing something forbidden has
    not improved the office; it has traded away the one property today's
    architecture has. `verify:understands` makes the same argument about
    latency: a layer that does not beat what it stands in front of is not
    earning its cost.
  */
  if (cUnsafe > unsafe) {
    console.error(
      `\nverify:plans FAILED — the candidate proposes ${String(cUnsafe)} forbidden ` +
        `capabilities against today's ${String(unsafe)}. Reach is not worth that.`,
    )
    process.exit(1)
  }
  if (cInvented > 0) {
    console.error(
      `\nverify:plans FAILED — the candidate invented ${String(cInvented)} capability name(s). ` +
        'The catalogue is meant to be closed.',
    )
    process.exit(1)
  }
  if (cEnough <= enough) {
    console.error(
      `\nverify:plans FAILED — the candidate (${String(cEnough)}) did not beat today's ` +
        `architecture (${String(enough)}). It is not earning its latency.`,
    )
    process.exit(1)
  }
  console.log("\nthe candidate planner beats today's architecture on this corpus.")
} else {
  console.log(
    '\nBaseline only. It asserts nothing — a baseline that can fail is a baseline\n' +
      'somebody tunes.',
  )
}
