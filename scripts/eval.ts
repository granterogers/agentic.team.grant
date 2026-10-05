/**
 * Is the office's answer any good?
 *
 *   npm run eval
 *
 * Issue #116. 251 jobs finished in a day and the only quality signal anywhere
 * was Grant's thumbs-down, which has fired seven times and never negatively.
 * Every other improvement on #114's list is unprovable without this.
 *
 * ## The judge is calibrated before the office is measured
 *
 * A judge nobody has checked is an opinion with a decimal point. Four of the
 * seven cases are labelled by Grant's own correction — his next message says
 * "No, that is the opposite of what I said" — so the first number this prints
 * is AGREEMENT with those labels, and a judge that cannot separate the four he
 * corrected from the three he did not is a broken instrument rather than
 * evidence of a bad office.
 *
 * That ordering is the whole design. Reporting a mean score first would invite
 * reading it as fact.
 *
 * ## Free models only
 *
 * `ProviderRouter` already refuses a priced model (§11) and fails over between
 * measured-usable free ones. If the judge needs a paid model to be useful, that
 * is a finding to report rather than a bill to incur.
 *
 * ## What it does NOT do
 *
 * It does not re-ask the office. Each case carries the answer that was actually
 * given, and this scores that. Running the request again against current code
 * and diffing is #133, and conflating them would mean never being able to tell
 * "the model changed" from "the code changed".
 */

import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { JUDGE_VERSION, makeJudge } from '../src/eval/judge.ts'
import { ProviderRouter } from '../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

interface Case {
  case_id: string
  slug: string
  ask: string
  answer: string
  expect: 'good' | 'poor'
  issue: number | null
  why: string
  /*
    Facts about this office a fair grader would need -- never the verdict.

    `telegram-buttons` is a reply claiming a capability the office HAS, and a
    grader given only the text read it as an honest statement of a limit, which
    from the text alone is a reasonable reading. Telling it the office can send
    those buttons is evidence; telling it the reply is wrong would be the
    conclusion. `why` is deliberately never passed for that reason -- a judge
    told the answer measures nothing.
  */
  context: string | null
}

const cases = ((await db.execute('select app.eval_set() as s')).rows[0] as { s: Case[] }).s
if (cases.length === 0) {
  console.error('the eval set is empty — migration 0259 seeds it')
  process.exit(2)
}

const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')

/*
  The judge moved to `src/eval/judge.ts` (#133).

  `npm run replay` grades an old answer against a new one and has to use the
  SAME instrument as this file -- two graders disagreeing would be reported as
  the office getting worse. The prompt, the pinned model, the version string
  and the parsing all live there now, verbatim; this file supplies the corpus
  and the calibration, which is what it was always for.
*/
const judge = makeJudge(router)

console.log(`Judging ${String(cases.length)} cases on the free tier…\n`)

const scored: {
  case_id: string
  score: number
  verdict: string
  reason: string
  ms: number
}[] = []
let unparseable = 0
const answered = new Set<string>()

/*
  A pause between cases.

  Free endpoints rate-limit, and being rate-limited is their NORMAL state rather
  than a fault — the router's own comment says so. Firing seven judgements as
  fast as the loop allows spent the first three and then failed the rest with
  "all 3 candidate models failed", which reads as a broken judge and is a
  broken caller.
*/
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

for (const [i, c] of cases.entries()) {
  if (i > 0) await pause(4_000)
  /*
    One retry, after a longer wait.

    A rate limit is not a judgement — it is the free tier saying "later" — and
    a case dropped for it is a hole in the number rather than a finding about
    the office. Two of seven were lost this way on the first working run.

    Once, not a loop: if a second attempt fifteen seconds later also fails, the
    tier is genuinely unavailable and hammering it is how a temporary limit
    becomes a longer one. That is the router's own rule about failover and it
    applies to the caller too.
  */
  let got = await judge(c)
  if (got === null) {
    await pause(15_000)
    got = await judge(c)
  }
  if (got === null) {
    unparseable += 1
    console.log(`  ?    ${c.slug.padEnd(18)} the judge's answer could not be read`)
    continue
  }
  answered.add(got.model)
  scored.push({
    case_id: c.case_id,
    score: got.score,
    verdict: got.verdict,
    reason: got.reason,
    ms: got.ms,
  })
  const agrees = got.verdict === c.expect
  console.log(
    `  ${agrees ? 'ok  ' : 'MISS'} ${c.slug.padEnd(18)} ${String(got.score)}/5 ${got.verdict.padEnd(4)}` +
      ` (he said ${c.expect}) — ${got.reason.slice(0, 74)}`,
  )
}

if (scored.length === 0) {
  console.error('\nnothing could be judged — the free tier answered nothing readable')
  process.exit(1)
}

/*
  Every model that answered, not one.

  The router fails over, so a run is routinely judged by two or three different
  free models — and a run recorded as though one model produced it would make
  every later comparison meaningless. Recording all of them makes the mixture
  visible, which is itself worth seeing.
*/
const model = [...answered].sort().join(' + ') || 'unknown'
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const recorded = (
  await db.execute(`
    select app.eval_run_record(${lit(model)}, ${lit(JUDGE_VERSION)},
      ${lit(JSON.stringify(scored))}::jsonb,
      ${lit(unparseable === 0 ? '' : `${String(unparseable)} case(s) unreadable`)}) as r
  `)
).rows[0] as {
  r: {
    run_id: string
    cases: number
    agreed: number
    disagreed: { slug: string; expected: string; judged: string; score: number; reason: string }[]
  }
}
const run = recorded.r

/*
  Agreement first, and the score second, because the second is only worth
  reading if the first holds.
*/
const mean = scored.reduce((a, s) => a + s.score, 0) / scored.length
console.log(`\njudge: ${model} (prompt ${JUDGE_VERSION})`)
console.log(`agreement with Grant's own corrections: ${String(run.agreed)}/${String(run.cases)}`)
/*
  The margin, printed with the number rather than buried in a comment.

  This figure MOVES BY ONE OR TWO CASES between runs of an unchanged corpus, and
  that was established rather than assumed: two consecutive runs on the same
  twenty cases, the same pinned model and `temperature: 0` gave 16/19 and 16/18,
  with one verdict flipping outright, the same case scoring 5/5 and then 3/5,
  and a different case failing to parse each time.

  The model was already pinned because three mixtures gave three answers. Pinning
  the sampling as well was the obvious next step and it is NOT SUFFICIENT on a
  free model — the provider does not give back what temperature 0 asks for.

  So the honest reading is a range, and saying so here is what stops the next
  person tuning the prompt against noise. Chasing the last two disagreements
  before this was measured would have been fitting the corpus to a coin.
*/
console.log(
  '  (this figure moves +/- 2 cases between runs on free models, even pinned and at' +
    ' temperature 0 — read it as a range, and never tune the prompt on one run)',
)
for (const d of run.disagreed) {
  console.log(
    `  disagreed on ${d.slug}: he said ${d.expected}, the judge said ${d.judged} — ${d.reason.slice(0, 80)}`,
  )
}
console.log(`mean score: ${mean.toFixed(2)}/5 across ${String(scored.length)} case(s)`)
if (unparseable > 0)
  console.log(`${String(unparseable)} case(s) the judge's answer could not be read`)

/*
  What makes this pass or fail.

  Not the office's score. The office scoring badly is INFORMATION — four of
  these seven are known-bad and are meant to score badly. What fails is the
  INSTRUMENT: a judge that cannot tell apart the cases Grant himself corrected
  from the ones he did not is not measuring anything, and a number produced by
  one would be worse than no number.

  Five of seven rather than all seven, because the three "good" cases are
  ordinary answers rather than exemplary ones and a judge is allowed to be
  harder on them than Grant was. The four he corrected are the ones that must
  land.
*/
/*
  The check on the check.

  Everything above measures the office. This measures whether the measurement
  responds to reality at all: take the best-scoring answer, degrade it in a way
  any reader would call worse, and require the judge to notice.

  Without it, a judge that returned 5/5 for everything would report perfect
  agreement on the three good cases and be caught only by the four poor ones —
  and the day all four are fixed, a broken judge would look like a fixed office.
  `npm run eval --strict` is where that day is caught in advance.
*/
if (process.argv.includes('--strict')) {
  const best = cases.find((c) => c.slug === 'ux-plan')
  if (best !== undefined) {
    await pause(4_000)
    const degraded = await judge({
      ...best,
      answer: 'Sure, I will look into some of that when I get a chance.',
    })
    const noticed = degraded !== null && degraded.verdict === 'poor'
    console.log(
      `\ncontrol: the same request answered with a brush-off scored ` +
        `${degraded === null ? 'unreadably' : `${String(degraded.score)}/5 ${degraded.verdict}`}` +
        ` — ${noticed ? 'the judge responds to quality' : 'THE JUDGE IS NOT READING THE ANSWER'}`,
    )
    if (!noticed) process.exit(1)
  }
}

const poorAgreed = run.disagreed.filter((d) => d.expected === 'poor').length
console.log(
  poorAgreed === 0
    ? '\nThe judge caught every answer Grant corrected. The instrument works.'
    : `\n${String(poorAgreed)} answer(s) Grant corrected were graded good. The instrument does not work yet.`,
)
process.exit(poorAgreed === 0 && run.agreed >= Math.ceil(run.cases * 0.7) ? 0 : 1)
