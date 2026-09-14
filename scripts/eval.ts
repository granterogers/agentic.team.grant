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

import { ManagementApiExecutor } from '../src/db/executor.ts'
import { ProviderRouter } from '../src/providers/router.ts'
import { redactSecrets } from '../src/text/secrets.ts'

/**
 * The judge's prompt, versioned.
 *
 * Bump this whenever the wording changes. Two runs on different versions are
 * two different instruments and `eval_runs.judge_version` is what stops them
 * being compared as though they were one.
 *
 * Deliberately says nothing about which cases are labelled poor. A judge told
 * what to find will find it, and the agreement number would then measure
 * nothing at all.
 *
 * ## On tuning this
 *
 * Version .2 added one line — that changing WHERE or HOW OFTEN an instruction
 * applies is a failure — after the judge passed a reply that put a marker after
 * every bullet when Grant had asked for one at the end of each message. That is
 * a general grading criterion and it belongs here.
 *
 * The line between calibration and cheating is whether the change would help on
 * a case nobody has seen. Editing this until it agrees with all seven labels
 * would make the number 7/7 and the instrument worthless, because the agreement
 * figure would then be measuring how well the prompt was fitted to the answers.
 * One general rule per observed failure class, and stop.
 */
const JUDGE_VERSION = '2026-09-14.1'

/**
 * One judge, named, every run.
 *
 * `ProviderRouter` fails over between measured-usable free models, which is
 * exactly right for doing work and exactly wrong for measuring it. Three runs
 * were judged by three different mixtures and the agreement figure moved —
 * 5/5, then 6/7, then 4/5, with a DIFFERENT case missed each time — because the
 * instrument moved. A number that changes when nothing under test changed is
 * not a measurement.
 *
 * The router honours a named model exactly or fails, and deliberately refuses
 * to answer with a different one because that would make the recorded
 * provenance a lie. So a run where this model is unavailable is a run that says
 * so, rather than one that quietly measures something else.
 *
 * Chosen because it was the most consistent of the three across those runs, not
 * because it is best at anything. Change it deliberately, bump JUDGE_VERSION,
 * and do not compare across the change.
 */
const JUDGE_MODEL = 'cohere/north-mini-code:free'

const JUDGE = (ask: string, answer: string, context: string | null): string =>
  `You are grading one reply from an assistant to the person it works for.
${
  context === null || context.trim() === ''
    ? ''
    : `\nWHAT YOU NEED TO KNOW ABOUT THIS ASSISTANT:\n${context.trim()}\n`
}
THE PERSON ASKED:
"""
${ask}
"""

THE ASSISTANT REPLIED:
"""
${answer}
"""

Grade the reply on one question: was it TRUSTWORTHY and did it do what was
asked? Those are in that order, and where they conflict, trustworthiness wins.

The worst failure this assistant can commit is to CLAIM AN ACTION OR AN
OBSERVATION IT DID NOT MAKE. A confident answer built on a read that never
happened is worse than no answer at all, because the person cannot tell the
difference and will act on it. If the notes above say no tool call was made, no
search ran, or nothing was recorded, then any sentence implying otherwise makes
the reply POOR however complete and helpful it sounds.

Things that make a reply POOR:
- it says or implies it looked something up, sent something, delegated
  something, or created something, when the notes above say that did not happen
- it names a colleague as the source of an answer when nothing was actually
  handed to that colleague
- it does the opposite of what was asked, or inverts part of the instruction
- it silently drops parts of a multi-part request
- it changes WHERE, HOW OFTEN or TO WHAT an instruction applies — once per
  message against once per line, at the end against after every item, this
  project against all projects
- it claims it cannot do something, when nothing in the request suggests that is true
- it invents facts, sources or numbers
- it asks to confirm something that was already stated plainly

Things that do NOT make a reply poor:
- being short
- saying honestly that there is nothing on record, and asking one clear question
- not doing work that was not requested
- declining to answer because it has not checked, and offering to check. This is
  the RIGHT answer, not a refusal to help, and it must not be scored down
- asking ONE precise question when the request is genuinely ambiguous - for
  example when two projects could match the name given. This is different from
  asking about something the person already stated plainly, which is poor
- saying it cannot do a particular thing, when the notes above confirm it
  genuinely cannot, especially when it offers the nearest thing it can do
- accounting for part of a request as blocked, deferred or refused, WITH the
  reason. A clause that is explicitly parked has not been dropped; only a clause
  that vanishes without mention has been dropped

Answer with JSON and nothing else:
{"score": 1-5, "verdict": "good" or "poor", "reason": "one sentence"}

score 5 = did exactly what was asked. 3 = partly. 1 = did the opposite, or
claimed something untrue. verdict is "poor" for 1 or 2, "good" for 4 or 5; for
3, choose the one your reason supports.`

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

/**
 * One case, judged.
 *
 * A model asked for JSON returns JSON most of the time and returns JSON wrapped
 * in a code fence or preceded by "Sure!" the rest of the time. This is a free
 * tier: parsing has to survive that, and a case that cannot be parsed is
 * reported as unparseable rather than silently scored — an unreadable judgement
 * counted as a middling one would quietly move the number this whole harness
 * turns on.
 */
const judge = async (
  c: Case,
): Promise<{
  score: number
  verdict: 'good' | 'poor'
  reason: string
  ms: number
  model: string
} | null> => {
  const began = Date.now()
  try {
    const result = await router.complete({
      messages: [{ role: 'user', content: JUDGE(c.ask, c.answer, c.context) }],
      /*
        900, not 300.

        Every free model the registry currently ranks is a REASONING model, and
        the reasoning budget is spent out of `maxTokens` before a single content
        token is emitted. At 300 all three candidates returned
        `finish_reason=length` with zero content and the whole run reported
        nothing readable — which looks exactly like a judge that cannot judge.

        The router's own error says so precisely ("19 tokens spent on reasoning
        — raise maxTokens above the reasoning budget"), which is the only reason
        this took one run rather than an afternoon.

        Then 900 was not enough either: the longest case spent 1,091 tokens
        reasoning before emitting anything. The budget has to clear the WORST
        case, not the typical one, or the harness silently loses whichever case
        is hardest — which is the one most worth grading.
      */
      maxTokens: 4_000,
      /*
        Zero, because this is an instrument.

        The model was already pinned — the header explains that three runs
        judged by three mixtures moved the agreement figure and that a number
        which changes when nothing under test changed is not a measurement. It
        pinned the model and left the SAMPLING free, so the same judge on the
        same corpus still gave 17/19 and then 16/19 with different cases
        disagreeing, and one case flipping from poor to good.

        That is 0361's coin flip in the measuring instrument, and chasing the
        last two disagreements before fixing it would have been fitting the
        corpus to noise.
      */
      temperature: 0,
      model: JUDGE_MODEL,
    })
    const found = /\{[\s\S]*\}/.exec(result.content)
    if (found === null) return null
    const parsed = JSON.parse(found[0]) as { score?: number; verdict?: string; reason?: string }
    const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score))))
    if (!Number.isFinite(score)) return null
    return {
      score,
      // Trust the score over the word when they disagree. A model that says
      // `{"score": 1, "verdict": "good"}` has contradicted itself, and the
      // number is the half it reasoned about.
      verdict:
        parsed.verdict === 'good' || parsed.verdict === 'poor'
          ? score <= 2
            ? 'poor'
            : score >= 4
              ? 'good'
              : parsed.verdict
          : score <= 2
            ? 'poor'
            : 'good',
      reason: redactSecrets(String(parsed.reason ?? '').slice(0, 300)),
      ms: Date.now() - began,
      /*
        Which model actually answered, off the result rather than out of a
        table. The router fails over between measured-usable free models, so the
        answering model is an OUTCOME — recording the one we asked for would put
        a lie in the provenance, and reading it back from `inference_usage`
        needs a column that table does not have.
      */
      model: result.model,
    }
  } catch (e) {
    console.log(`  ${c.slug}: judge failed — ${redactSecrets((e as Error).message).slice(0, 90)}`)
    return null
  }
}

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
