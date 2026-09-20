/**
 * Does the office understand a person talking? (#282)
 *
 * Measures `understand()` against `docs/testing/spoken-corpus.json`, whose
 * expected outcomes were written BEFORE anything ran — and against the SAME
 * corpus read by today's deterministic layer, so the number that matters is
 * the DIFFERENCE rather than either score alone.
 *
 * A single score would be a claim about a free model on one afternoon. Two
 * scores over one corpus are a claim about an architecture.
 *
 *   npm run verify:understands            the corpus
 *   npm run verify:understands -- --held  the held-out set, written after the
 *                                         fixes were frozen
 */
import { readFileSync } from 'node:fs'
import { classifyIntent } from '../../src/agents/intent.ts'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { taskRequest } from '../../src/agents/tasks.ts'
import { type ReadingKind, understand } from '../../src/agents/understand.ts'
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
  console.error('no openrouter.api_key in the vault')
  process.exit(2)
}
const router = new ProviderRouter(db, key)

const held = process.argv.includes('--held')
const file = held ? 'docs/testing/spoken-corpus-heldout.json' : 'docs/testing/spoken-corpus.json'
interface Case {
  id: string
  said: string
  surviving: ReadingKind[]
  abandoned: number
}
const corpus = JSON.parse(readFileSync(file, 'utf8')) as { cases: Case[] }

/*
  WHAT TODAY'S DETERMINISTIC LAYER MAKES OF THE SAME SENTENCE.

  Not a strawman: it is the real cascade's own order, the same three functions
  the handler consults, run on the whole message exactly as the handler runs
  them. The point is to measure the gap the architecture change is meant to
  close, and a gap measured against a worse baseline is not a measurement.
*/
const today = (said: string): ReadingKind[] => {
  const out: ReadingKind[] = []
  const c = classifyIntent(said)
  if (personalTaskRequest(said) !== null) out.push('task_create')
  else if (taskRequest(said, c) !== null) out.push('task_create')
  if (out.length === 0) out.push(c.intent === 'question' ? 'question' : 'other')
  return out
}

/*
  `other` and an empty list are THE SAME OUTCOME, and saying otherwise made
  three controls read as failures against correct behaviour.

  "Thanks, that's exactly what I needed" has no actionable intent. The
  interpreter may say so by returning nothing; the fast path says so by
  returning `other`; both end in the cascade doing nothing and Claire simply
  replying. Scoring them differently grades the spelling of a correct answer.
*/
const settled = (xs: readonly string[]): string[] => xs.filter((x) => x !== 'other').sort()
const same = (a: readonly string[], b: readonly string[]): boolean =>
  settled(a).join(',') === settled(b).join(',')

let trivial = 0
let slowest = 0
let totalMs = 0
let modelRight = 0
let todayRight = 0
let abandonedRight = 0
let fellBack = 0
const models = new Set<string>()
const started = Date.now()

console.log(
  `understanding a person talking — ${String(corpus.cases.length)} case(s) from ${file}\n`,
)

for (const c of corpus.cases) {
  const at = Date.now()
  const u = await understand(c.said, router, {})
  const took = Date.now() - at
  if (u.how === 'trivial') trivial += 1
  else {
    totalMs += took
    slowest = Math.max(slowest, took)
  }
  if (u.how === 'fallback') fellBack += 1
  if (u.model !== null) models.add(u.model)
  /*
    A TRIVIAL message is scored on what will ACTUALLY happen to it.

    `understand` short-circuits a short single-clause message rather than
    spending a model call on "thanks", so for those the shipped behaviour IS
    the deterministic cascade. Scoring them against a kind the fast path never
    produces would measure a path nobody runs. §8 asks for this comparison;
    this is where it is answered honestly rather than by preferring whichever
    number is larger.
  */
  const got = u.how === 'trivial' ? today(c.said) : u.surviving.map((r) => r.kind)
  const ok = same(got, c.surviving)
  const abOk = u.abandoned.length === c.abandoned
  if (ok) modelRight += 1
  if (abOk) abandonedRight += 1
  const was = today(c.said)
  if (same(was, c.surviving)) todayRight += 1
  console.log(
    `  ${ok ? 'ok  ' : 'MISS'} ${c.id.padEnd(22)} want [${c.surviving.join(',')}]` +
      ` got [${got.join(',')}]${abOk ? '' : ` · abandoned ${String(u.abandoned.length)} of ${String(c.abandoned)}`}` +
      `${u.how === 'trivial' ? ' · fast path' : ''}` +
      `${u.how === 'fallback' ? ` · FELL BACK: ${String(u.why)}` : ''}`,
  )
  if (!ok) console.log(`       today's layer said [${was.join(',')}]`)
}

const n = corpus.cases.length
const secs = Math.round((Date.now() - started) / 1000)
console.log(
  `\nintents:   model ${String(modelRight)}/${String(n)}` +
    `   ·   today's deterministic layer ${String(todayRight)}/${String(n)}`,
)
console.log(`abandoned: ${String(abandonedRight)}/${String(n)} cases had the right count discarded`)
console.log(
  `fell back: ${String(fellBack)}/${String(n)}   ·   fast path: ${String(trivial)}/${String(n)}` +
    `   ·   ${secs}s total`,
)
/*
  LATENCY IS PART OF THE ANSWER, not a footnote. §8 asks whether every request
  should take a semantic pass; a mean of several seconds is the argument for
  keeping a fast path for the simple ones, and it has to be measured to be
  argued.
*/
const asked = n - trivial
console.log(
  `model:     ${[...models].join(', ')} · ${String(asked)} call(s)` +
    ` · mean ${String(Math.round(totalMs / Math.max(asked, 1)))}ms · slowest ${String(slowest)}ms`,
)

/*
  The bar is the BASELINE, not a number somebody liked.

  A model layer that does not beat the regexes it replaces is not worth its
  latency, and pinning an absolute threshold would make this suite a thing to
  tune rather than a thing to learn from.
*/
if (modelRight <= todayRight) {
  console.error(
    `\nverify:understands FAILED — the semantic layer (${String(modelRight)}) did not beat ` +
      `the deterministic one (${String(todayRight)}). It is not earning its latency.`,
  )
  process.exit(1)
}
console.log('\nthe semantic layer beats the deterministic one on this corpus.')
