/**
 * HOW OFTEN DOES THE SAME REQUEST GET THE SAME PLAN? (#283)
 *
 *   npm run verify:plan-stability
 *
 * ## The question this exists to answer, and why an anecdote could not
 *
 * `verify:composes` asserts that a composed request reaches the planner and is
 * composed on the FIRST attempt. It went red once in roughly nine end-to-end
 * runs — and one red run is not a rate. It is not even evidence of which of
 * two very different things is happening:
 *
 *   - the planner sometimes returns FEWER steps for the same words, which
 *     makes the office behave differently on identical input; or
 *   - it returns a different but equally good plan, which is a model being a
 *     model and costs nothing.
 *
 * A number that does not separate those is worse than no number. So this runs
 * the corpus TWICE and reports both: how often the step COUNT crosses the
 * composed/not-composed line, and how often the capabilities differ at all.
 *
 * ## It reports; it does not gate
 *
 * The threshold at which this becomes worth acting on is a judgement about
 * Grant's office, not an engineering constant, and CLAUDE.md is explicit that
 * a check failing on a decision nobody has made is one somebody switches off.
 * The exit code is non-zero only for the thing that is unambiguously broken:
 * a planner that composes NOTHING on a corpus written for composing.
 *
 * ## Why the corpus rather than one sentence
 *
 * Twelve direct calls on the one sentence `verify:composes` uses composed
 * 12/12, which says that sentence is stable and nothing about the space of
 * things Grant says. #229's rule: print the margin, and never tune a prompt
 * against a coin you have flipped once.
 */

import { readFileSync } from 'node:fs'
import { type Capability, planFor, planningCatalogue } from '../../src/agents/goal.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

interface Case {
  readonly id: string
  readonly said: string
  readonly min_steps: number
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const key = String(
  (
    (
      await db.execute(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'openrouter.api_key'`,
      )
    ).rows[0] as { v?: string } | undefined
  )?.v ?? '',
)
if (key === '') {
  console.error('no provider key in the vault — this measures a model and cannot run without one')
  process.exit(2)
}
const router = new ProviderRouter(db, key)
const catalogue: readonly Capability[] = (await planningCatalogue(db)).map((c) => ({ ...c }))
const roster = (
  await db.execute(
    `select slug, coalesce(title, '') as title from public.staff where active order by slug`,
  )
).rows.map((r) => {
  const row = r as { slug: string; title: string }
  return { slug: String(row.slug), title: String(row.title) }
})

const file = 'docs/testing/goal-corpus.json'
const corpus = JSON.parse(readFileSync(file, 'utf8')) as { cases: Case[] }
/*
  Only the cases that are SUPPOSED to compose. A control written to need one
  step is not unstable for returning one step twice, and averaging it in would
  dilute the number towards looking fine.
*/
const composable = corpus.cases.filter((c) => c.min_steps >= 2)

console.log(
  `planner stability — ${String(composable.length)} composable case(s) from ${file}, twice\n`,
)

/*
  ZERO STEPS IS TWO DIFFERENT ANSWERS, AND THE FIRST VERSION OF THIS FILE
  COULD NOT TELL THEM APART.

  A plan with no steps and a populated `unreachable` is the planner DECLINING
  honestly — the work needs `web.search`, which 0298 disabled, or a capability
  marked NOT YET BUILT. That is the office being truthful about what it cannot
  do, and counting it as a coverage gap would read a feature as a failure.

  A plan with no steps and nothing in `unreachable` is a planner that did not
  understand, which is the gap. The same distinction as every reader in this
  repository: an empty result and a failed look are different things.
*/
interface Attempt {
  readonly caps: string[]
  readonly declined: boolean
}
const plan = async (said: string): Promise<Attempt> => {
  const p = await planFor(said, catalogue, roster, router)
  return {
    caps: p.steps.map((s) => s.capability),
    declined: p.steps.length === 0 && p.unreachable.length > 0,
  }
}

let crossedTheLine = 0
let differedAtAll = 0
let composedBoth = 0
let declinedBoth = 0
let neitherNorDeclined = 0

for (const c of composable) {
  const [first, second] = [await plan(c.said), await plan(c.said)]
  const a = first.caps.length >= 2
  const b = second.caps.length >= 2
  if (first.caps.join(',') !== second.caps.join(',')) differedAtAll += 1
  let verdict: string
  if (a !== b) {
    crossedTheLine += 1
    verdict = 'CROSSED'
  } else if (a) {
    composedBoth += 1
    verdict = 'both   '
  } else if (first.declined && second.declined) {
    declinedBoth += 1
    verdict = 'refused'
  } else {
    neitherNorDeclined += 1
    verdict = 'NEITHER'
  }
  console.log(
    `  ${verdict}  ${c.id.padEnd(30)} ` +
      `[${first.caps.join(' → ') || (first.declined ? 'declined as unreachable' : 'none')}]` +
      `  vs  [${second.caps.join(' → ') || (second.declined ? 'declined as unreachable' : 'none')}]`,
  )
}

const n = composable.length
console.log(
  `\n  composed both times: ${String(composedBoth)}/${String(n)} · ` +
    `crossed the line: ${String(crossedTheLine)}/${String(n)} · ` +
    `declined as unreachable both times: ${String(declinedBoth)}/${String(n)} · ` +
    `understood neither time: ${String(neitherNorDeclined)}/${String(n)}`,
)
console.log(
  '  A refusal is the office being truthful about what it cannot do — ' +
    'web.search is disabled and some capabilities have no executor yet. ' +
    'Only the last column is a gap.',
)
console.log(
  `  the exact capabilities differed on ${String(differedAtAll)}/${String(n)} — ` +
    'which is a model being a model, and costs nothing unless it crosses the line.',
)
/*
  The only unambiguous failure. Everything else is a rate for a person to read:
  a planner that composes nothing at all on a corpus written for composing is
  broken however stable it is about it.
*/
if (composedBoth === 0) {
  console.error('\n  the planner composed NOTHING on either pass — that is not instability')
  process.exit(1)
}
process.exit(0)
