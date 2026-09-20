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
import { classifyIntent } from '../../src/agents/intent.ts'
import { linkRequest } from '../../src/agents/links.ts'
import { personalTaskChange, personalTaskRequest } from '../../src/agents/mine.ts'
import { readPlan } from '../../src/agents/plan.ts'
import { taskRequest } from '../../src/agents/tasks.ts'
import { readTeaching } from '../../src/agents/teaching.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
const catalogue = new Map(
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

const rows: {
  id: string
  met: string[]
  missed: string[]
  banned: string[]
  enough: boolean
}[] = []

console.log(`goal planning — ${String(corpus.cases.length)} case(s) from ${file}\n`)
console.log(
  `catalogue: ${String([...catalogue.values()].filter((c) => c.enabled).length)} enabled of ${String(catalogue.size)}\n`,
)

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
  rows.push({ id: c.id, met, missed, banned, enough })
  console.log(
    `  ${enough ? 'ok  ' : 'MISS'} ${c.id.padEnd(30)} wanted [${c.needs.join(',') || '—'}]` +
      ` got [${got.caps.join(',') || 'nothing — prose only'}]` +
      `${got.plan ? ' · multi-step plan' : ''}` +
      `${banned.length > 0 ? ` · FORBIDDEN: ${banned.join(',')}` : ''}`,
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

/*
  No threshold and no exit code on the baseline: this run is a MEASUREMENT of
  the architecture as it stands, and a baseline that can fail is a baseline
  somebody tunes. The candidate, when it exists, is what has to beat it.
*/
console.log(
  '\nThis is the baseline. It asserts nothing — the candidate planner is what\n' +
    'has to beat it, over this same corpus, with the held-out set frozen first.',
)
