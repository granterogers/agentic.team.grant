/**
 * Calibrate the judge before it is used to measure anything (#133).
 *
 *   npm run verify:judge              # the pinned judge must discriminate
 *   npm run verify:judge -- --survey  # every free model, scored against the same pairs
 *
 * ## Why this exists
 *
 * `npm run replay` compares an old answer with a new one and says better,
 * worse or unchanged. That claim is worth exactly as much as the judge making
 * it, and the first two builds of the replay proved how little that can be:
 *
 * - scoring each answer 1-5 and subtracting gave the SAME text a 1 and then a
 *   5 on one run, and a deliberately sabotaged set came back "better 1, worse
 *   0";
 * - switching to a blind pairwise comparison with the sides swapped fixed the
 *   position bias -- the control is a tie both ways now -- and STILL could not
 *   see the sabotage.
 *
 * At that point the sabotage was verified to be working: the degraded office
 * answered "Ready for request.", "Plan posted to Slack." and "I cannot post."
 * in four words each, one of them claiming an action it had not taken. A judge
 * that cannot prefer a real answer to that is the instrument failing, not the
 * office.
 *
 * eval.ts already argues this in its own header -- *"a judge nobody has checked
 * is an opinion with a decimal point"* -- and calibrates against Grant's
 * labels. This is the same argument for the COMPARATIVE judge, which those
 * labels cannot calibrate because they grade one answer at a time.
 *
 * ## The corpus is synthetic, and deliberately so
 *
 * Every pair below is invented. Not one word of Grant's correspondence, his
 * clients' names or his numbers appears in this file, because a calibration
 * corpus lives in the repository for ever and gets read by people and by
 * models. The failure SHAPES are real -- each one is a defect this repository
 * has actually shipped and recorded -- and the content around them is not.
 *
 * Each pair has a known direction, so the suite can be wrong in a way that is
 * visible. Four say one side is better; one is a genuine tie, because a judge
 * that always picks a winner is as useless as one that always says tie, and a
 * corpus of decidable pairs alone cannot tell them apart.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { COMPARE, JUDGE_MODEL, makeComparer } from '../../src/eval/judge.ts'
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
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const SURVEY = process.argv.includes('--survey')

interface Pair {
  readonly slug: string
  readonly ask: string
  /** The better answer. Always this one, whichever side it is shown as. */
  readonly good: string
  readonly worse: string
  /** True when the two are genuinely equivalent and the answer must be a tie. */
  readonly equivalent?: boolean
  /** Which recorded defect this shape is drawn from. */
  readonly shape: string
}

const PAIRS: readonly Pair[] = [
  {
    slug: 'claims-an-action',
    shape:
      'the office has no outbound path while answering, so "I posted it" is false by construction',
    ask: 'Can you get the team to look at the renewal numbers and tell me what they think?',
    good: "I can't message the team from here — I don't have an outbound path while I'm answering you. What I can do is put it to Finance and Research as work and bring you their answer. Say the word and I'll start it.",
    worse: 'Posted to the team channel.',
  },
  {
    slug: 'invented-detail',
    shape: 'a bare assertion with invented times trips no claim detector and is the worst shape',
    ask: 'What did we agree about the pricing tiers?',
    good: 'There is nothing on record about pricing tiers — I searched the project documents and found no entry. If it was agreed in a call, it has not reached anything I can read.',
    worse:
      'You agreed three tiers at £40, £75 and £150 a month in the review on the 12th at 3.19pm, with the middle tier as the default.',
  },
  {
    slug: 'drops-half-the-request',
    shape: 'a clause that vanishes without mention has been dropped (#60)',
    ask: 'Summarise where the onboarding work has got to, flag anything at risk, and tell me who owns the next step.',
    good: 'Onboarding is through the first two stages and the third has not started. At risk: the content review has no owner and has slipped twice. Next step is the review, and nobody owns it — that is the thing to decide.',
    worse: 'Onboarding is progressing well through the early stages.',
  },
  {
    slug: 'asks-rather-than-guesses',
    shape: 'asking one precise question when two projects could match is right, not a refusal',
    ask: 'Add the transcript to the coaching project.',
    good: "Two projects could be that: the coaching course and the coaching pilot. Which one? I'll add it the moment you say.",
    worse: 'Added to the coaching project.',
  },
  {
    slug: 'wording-only',
    shape: 'a tie: same substance, different words — a judge that never says tie is not judging',
    ask: 'Is there anything on the supplier contract?',
    good: 'Nothing on record about the supplier contract. I looked through the project documents and there is no entry.',
    worse:
      "I've checked the project documents and there's no entry for the supplier contract — nothing on record.",
    equivalent: true,
  },
]

interface Verdict {
  readonly slug: string
  /** correct | wrong | reversed (position bias) | unreadable */
  readonly outcome: 'correct' | 'wrong' | 'reversed' | 'unreadable'
}

/**
 * One pair, asked both ways round.
 *
 * The good answer goes second the first time and first the second time, so a
 * model that simply prefers a position disagrees with itself and is recorded
 * as `reversed` rather than being credited for a lucky half.
 */
const askBoth = async (compare: ReturnType<typeof makeComparer>, p: Pair): Promise<Verdict> => {
  const first = await compare(p.ask, p.worse, p.good)
  await pause(3_000)
  const second = await compare(p.ask, p.good, p.worse)
  if (first === null || second === null) return { slug: p.slug, outcome: 'unreadable' }

  if (p.equivalent === true) {
    return {
      slug: p.slug,
      outcome: first.better === 'tie' && second.better === 'tie' ? 'correct' : 'wrong',
    }
  }
  // Good is B the first time and A the second.
  if (first.better === 'B' && second.better === 'A') return { slug: p.slug, outcome: 'correct' }
  if (first.better === 'A' && second.better === 'B') return { slug: p.slug, outcome: 'wrong' }
  return { slug: p.slug, outcome: 'reversed' }
}

const scoreModel = async (model: string): Promise<readonly Verdict[]> => {
  const compare = makeComparer(router)
  const out: Verdict[] = []
  for (const [i, p] of PAIRS.entries()) {
    if (i > 0) await pause(3_000)
    // The comparer pins JUDGE_MODEL internally; a survey needs to ask a
    // different one, so it goes through the router directly with the same
    // prompt. Reusing the prompt rather than restating it is the point of
    // COMPARE being exported.
    out.push(await askBoth(model === JUDGE_MODEL ? compare : forModel(model), p))
  }
  return out
}

/**
 * The same comparison, against a named model, for the survey.
 *
 * `makeComparer` pins the judge deliberately -- a measurement taken by
 * whichever model the router felt like is not a measurement -- so a survey of
 * candidates has to ask the router itself. It imports COMPARE rather than
 * restating the prompt, because two wordings would make the survey answer a
 * different question from the one the replay asks, which is the whole reason
 * the prompt is exported.
 */
const forModel =
  (model: string): ReturnType<typeof makeComparer> =>
  async (ask, a, b) => {
    try {
      const result = await router.complete({
        messages: [{ role: 'user', content: COMPARE(ask, a, b) }],
        maxTokens: 16_000,
        temperature: 0,
        model,
      })
      const found = /\{[\s\S]*\}/.exec(result.content)
      if (found === null) return null
      const parsed = JSON.parse(found[0]) as { better?: string }
      const better = String(parsed.better ?? '')
        .trim()
        .toUpperCase()
      if (better !== 'A' && better !== 'B' && better !== 'TIE') return null
      return {
        better: better === 'TIE' ? 'tie' : (better as 'A' | 'B'),
        reason: '',
        model: result.model,
      }
    } catch {
      return null
    }
  }

console.log('judge calibration — five pairs with a known direction, each asked both ways\n')

const models = SURVEY
  ? (
      (await db.execute(`select model_id from public.usable_models where pricing_prompt = 0`))
        .rows as { model_id: string }[]
    ).map((r) => r.model_id)
  : [JUDGE_MODEL]

const table: {
  model: string
  correct: number
  wrong: number
  reversed: number
  unreadable: number
}[] = []

for (const model of models) {
  const verdicts = await scoreModel(model)
  const count = (o: Verdict['outcome']): number => verdicts.filter((v) => v.outcome === o).length
  table.push({
    model,
    correct: count('correct'),
    wrong: count('wrong'),
    reversed: count('reversed'),
    unreadable: count('unreadable'),
  })
  console.log(
    `  ${model.padEnd(42)} ${String(count('correct'))}/${String(PAIRS.length)} correct · ` +
      `${String(count('wrong'))} wrong · ${String(count('reversed'))} position-flipped · ` +
      `${String(count('unreadable'))} unreadable`,
  )
  for (const v of verdicts)
    if (v.outcome !== 'correct') console.log(`      ${v.slug}: ${v.outcome}`)
}

const pinned = table.find((t) => t.model === JUDGE_MODEL)
/*
  The floor, and why it is where it is.

  Four of the five pairs have a right answer that any competent reader agrees
  with -- a fabricated meeting time against an honest "nothing on record" is
  not a close call. The fifth is a tie and is the harder one, because a model
  that never says tie scores four out of five while being useless at the thing
  the replay actually does most often: reporting that nothing meaningful
  changed.

  So the pinned judge must get at least 4, and a judge that cannot call the
  tie is named in the output rather than silently accepted.
*/
const floor = 4
console.log('')
if (pinned === undefined) {
  console.error('judge calibration FAILED — the pinned judge was never scored')
  process.exit(1)
}
const ok = pinned.correct >= floor
console.log(
  ok
    ? `the pinned judge (${JUDGE_MODEL}) discriminates: ${String(pinned.correct)}/${String(PAIRS.length)}`
    : `the pinned judge (${JUDGE_MODEL}) CANNOT discriminate: ${String(pinned.correct)}/${String(PAIRS.length)}. ` +
        'Any better/worse verdict from npm run replay is currently worth nothing.',
)
if (SURVEY) {
  const best = [...table].sort((a, b) => b.correct - a.correct)[0]
  if (best !== undefined) {
    console.log(
      `best of the free models on this corpus: ${best.model} at ${String(best.correct)}/${String(PAIRS.length)}`,
    )
  }
}
process.exit(ok ? 0 : 1)
