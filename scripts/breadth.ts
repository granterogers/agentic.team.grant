/**
 * The coverage model — which of Grant's dimensions have cases, and which have none.
 *
 *   npm run breadth          # print, and write docs/testing/intelligence-breadth.md
 *
 * Issue #235, workstream G. His instruction decides the shape of this file:
 *
 *   > Do NOT reduce this to 200 random prompts.
 *   > **First build the coverage matrix and determine what dimensions are
 *   > actually represented.**
 *
 * A list of prompts cannot show a zero. A matrix can, and the zeroes are the
 * only number here worth acting on: they say which kinds of request nothing has
 * ever been asked about, which is a different and more useful thing than a pass
 * rate over the requests somebody happened to write.
 *
 * ## Where the counts come from
 *
 *   `public.breadth_dimensions`   the dimensions, as data, editable by Grant (0366)
 *   `public.eval_cases`           the judged corpus, tagged (0366)
 *   `scripts/corpus/routing.ts`   the 91 routing cases, mapped below
 *
 * Suites are deliberately NOT counted. `npm run coverage` already answers
 * "which parts of the product have a test pointed at them" and this answers
 * "which kinds of REQUEST have ever been tried" — mixing them would let a suite
 * that exists make a dimension look covered when no case has ever exercised it,
 * which is #234's rule (do not describe 1–3 as proof of 4–6) in a second place.
 *
 * ## The tiers
 *
 * Printed at the end, with what each currently contains and what it costs to
 * run. Grant's constraint is runtime, not money: free models mean £0, GitHub
 * Actions are off (#17), and nothing may be hidden in the background — so a
 * tier's honest size is however much can finish in the foreground.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { SqlExecutor } from '../src/db/executor.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { CORPUS } from './corpus/routing.ts'
import { SESSIONS } from './sessions/corpus.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

const dimensions = await all(
  'select dimension, family, note from public.breadth_dimensions order by family, dimension',
)
if (dimensions.length === 0) {
  /*
    The vacuity guard, and #234 records why it is not paranoia: a check queried
    an empty table, matched nothing, and reported "0 claims" as a PASS. A
    matrix built over no dimensions would print a clean page.
  */
  console.error('public.breadth_dimensions is empty — run npm run migrate')
  process.exit(1)
}

const evalCases = await all(
  'select slug, expect, dimensions from public.eval_cases where active order by slug',
)

/*
  What each routing case covers.

  Its `wants` is a specialist, and each specialist IS a domain dimension — that
  mapping is the one place this file has to state something the data does not,
  so it is stated once, here, rather than inferred in three places.

  Every routing case also covers `agents` (somebody has to be reachable) and
  `single-agent-work` (the roster is one person unless the subject names two),
  and the linguistic forms map onto the three language dimensions Grant named.
*/
const DOMAIN_OF: Readonly<Record<string, string>> = {
  'finance-director': 'finance',
  'growth-director': 'marketing-and-growth',
  'communications-director': 'communications',
  'operations-director': 'operations',
  'quality-director': 'quality-and-risk',
  'research-director': 'research',
  'strategy-director': 'business-strategy',
}
const FORM_OF: Readonly<Record<string, readonly string[]>> = {
  speech: ['voice-and-speech-style'],
  long: ['long-multi-clause'],
  vague: ['ambiguous-requests'],
  colloquial: ['voice-and-speech-style'],
  typo: ['malformed-inputs'],
  assignment: ['actions'],
  command: ['actions'],
}

const routingCovers = (c: (typeof CORPUS)[number]): readonly string[] => [
  'agents',
  'no-tool-reasoning',
  ...(c.wants === 'nobody' ? [] : [DOMAIN_OF[c.wants] ?? '']),
  ...((c.also ?? []).length > 0 ? ['multi-agent-work'] : ['single-agent-work']),
  ...(FORM_OF[c.form] ?? []),
]

/*
  The sessions, counted ONLY where they actually ran (#231 Campaign Three).

  This model reported `corrections`, `changed-intent`,
  `contradictory-instructions` and `cross-project-work` at ZERO on the morning
  after all four were proved against the deployed worker — because it could see
  the judged corpus and the routing corpus and not the thing that had executed.
  A coverage model blind to executed evidence misdirects every decision that
  reads it, which is the one failure it cannot survive.

  EXECUTED is the operative word: a tag on a session is a CLAIM about what it
  covers, and `.out/sessions.jsonl` is the record of which turns were really
  put through `inbound_commands` and answered. An unrun case covers nothing, so
  a session with no completed turns contributes nothing however it is tagged.
*/
const ran = new Map<string, number>()
if (existsSync('.out/sessions.jsonl')) {
  const seen = new Set<string>()
  for (const line of (await readFile('.out/sessions.jsonl', 'utf8')).split('\n')) {
    if (line.trim() === '') continue
    const r = JSON.parse(line) as { session: string; index: number; state: string }
    if (r.state !== 'complete') continue
    const key = `${r.session}|${String(r.index)}`
    if (seen.has(key)) continue
    seen.add(key)
    ran.set(r.session, (ran.get(r.session) ?? 0) + 1)
  }
}

const counts = new Map<string, { evals: number; routing: number; sessions: number }>()
for (const d of dimensions) counts.set(String(d.dimension), { evals: 0, routing: 0, sessions: 0 })
for (const s of SESSIONS) {
  const turns = ran.get(s.name) ?? 0
  if (turns === 0) continue
  for (const d of s.covers ?? []) {
    const at = counts.get(d)
    if (at !== undefined) at.sessions += turns
  }
}
for (const c of evalCases) {
  for (const d of (c.dimensions ?? []) as string[]) {
    const at = counts.get(d)
    if (at !== undefined) at.evals++
  }
}
for (const c of CORPUS) {
  for (const d of routingCovers(c)) {
    const at = counts.get(d)
    if (at !== undefined) at.routing++
  }
}

const empty = dimensions.filter((d) => {
  const n = counts.get(String(d.dimension))
  return n !== undefined && n.evals + n.routing + n.sessions === 0
})

console.log(`\nintelligence breadth — ${String(dimensions.length)} dimensions\n`)
let family = ''
for (const d of dimensions) {
  if (String(d.family) !== family) {
    family = String(d.family)
    console.log(`  ${family}`)
  }
  const n = counts.get(String(d.dimension)) ?? { evals: 0, routing: 0, sessions: 0 }
  const total = n.evals + n.routing + n.sessions
  console.log(
    `    ${String(d.dimension).padEnd(32)} ${total === 0 ? 'NO CASES' : String(total).padStart(3)}` +
      `${total === 0 ? '' : `   (${String(n.evals)} judged, ${String(n.routing)} routing, ${String(n.sessions)} executed)`}`,
  )
}

console.log(
  `\n${String(dimensions.length - empty.length)}/${String(dimensions.length)} dimensions have at least one case; ` +
    `${String(empty.length)} have none:`,
)
for (const d of empty) console.log(`  ${String(d.dimension)}`)

/*
  The tiers, stated rather than guessed.

  Tier 1 is not aspirational: it is what `npm run gate` already runs plus the
  judged corpus, and its size is the number of CASES those exercise. Tier 3 is
  specified and deliberately not runnable from here — Grant's own instruction
  is *"Do NOT run Tier 3 merely because this issue exists."*
*/
const TIERS = [
  {
    tier: '1 — permanent smoke',
    what: 'npm run tier1 — the routing corpus, the judged corpus, and the collaboration probe',
    cases: CORPUS.length + evalCases.length,
    cost: 'about 30 minutes, foreground, mostly the judge',
  },
  {
    tier: '2 — readiness',
    what: 'Tier 1 plus every verify suite: npm run gate, then npm run e2e',
    cases: CORPUS.length + evalCases.length,
    cost: 'hours; before a release or a human acceptance phase',
  },
  {
    tier: '3 — deep stress',
    what: 'systematic mutation of every Tier 1 case across all ten forms — SPECIFIED, NOT RUN',
    cases: (CORPUS.length + evalCases.length) * 10,
    cost: 'many hours, deliberately scheduled. Do not run it because it exists.',
  },
] as const

console.log('\ntiers')
for (const t of TIERS) {
  console.log(`  ${t.tier.padEnd(22)} ~${String(t.cases)} cases — ${t.cost}`)
}

const md = [
  '# Intelligence breadth — the coverage model',
  '',
  `Generated by \`npm run breadth\` — ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.`,
  '',
  'Issue #235. Grant: *"Do NOT reduce this to 200 random prompts. First build the',
  'coverage matrix and determine what dimensions are actually represented."* The',
  'zeroes are the number worth acting on.',
  '',
  'Dimensions live in `public.breadth_dimensions` and are Grant-editable (0366).',
  'Suites are deliberately not counted here — `npm run coverage` answers that, and',
  'a suite existing must never make a dimension look covered when no case has ever',
  'exercised it.',
  '',
  '| family | dimension | cases | judged | routing | executed |',
  '|---|---|---|---|---|---|',
  ...dimensions.map((d) => {
    const n = counts.get(String(d.dimension)) ?? { evals: 0, routing: 0, sessions: 0 }
    const total = n.evals + n.routing + n.sessions
    return `| ${String(d.family)} | \`${String(d.dimension)}\` | ${total === 0 ? '**0**' : String(total)} | ${String(n.evals)} | ${String(n.routing)} | ${String(n.sessions)} |`
  }),
  '',
  `## ${String(empty.length)} dimensions with no cases at all`,
  '',
  empty.length === 0 ? 'None.' : empty.map((d) => `- \`${String(d.dimension)}\``).join('\n'),
  '',
  '## Tiers',
  '',
  '| tier | contents | cases | cost |',
  '|---|---|---|---|',
  ...TIERS.map((t) => `| ${t.tier} | ${t.what} | ~${String(t.cases)} | ${t.cost} |`),
  '',
  'Runtime is the constraint, not money: free models mean £0, GitHub Actions are',
  'off (#17), and nothing may be hidden in the background.',
  '',
  '## Read as ranges',
  '',
  'The judge moves ±2 cases between runs of an unchanged corpus even pinned and at',
  '`temperature: 0` (#229), and the routing figures moved by one case in two places',
  'between two runs on 14 September. A tier read to single-case precision is',
  'reading noise.',
  '',
].join('\n')

await mkdir('docs/testing', { recursive: true })
await writeFile('docs/testing/intelligence-breadth.md', md)
console.log('\nreport: docs/testing/intelligence-breadth.md')
