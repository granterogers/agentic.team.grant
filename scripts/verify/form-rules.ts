/**
 * Does the office apologise for rules it kept? (#277)
 *
 *   npm run verify:form-rules              measure the SHIPPED clause
 *   npm run verify:form-rules -- --both    baseline against candidate
 *
 * ## The defect
 *
 * Grant caught an answer opening *"I'm setting aside the bullet-point rule so
 * I can keep this answer as a single short paragraph as required"* — on an
 * answer that broke no rule at all. It is not a lie about the world, so no
 * coherence gate can see it; it is a lie about the ANSWER, and it turns a
 * standing preference into a running negotiation.
 *
 * ## Why this is measured rather than argued
 *
 * The obvious fix is to tell the model not to narrate. This repository has
 * already recorded what that costs: a comparable negative-imperative prompt
 * edit made **two of three** evaluated answers worse, and the only reason
 * anybody knew was that somebody measured afterwards. Grant's mandate says it
 * outright — do not retain a prompt change because it sounds nicer.
 *
 * ## The two numbers, which pull in opposite directions
 *
 *   **spurious**  the office apologises for a rule it KEPT      (#277)
 *   **silent**    the office drops a rule and says nothing      (#231)
 *
 * Either alone is trivially optimisable and optimising either alone is a
 * regression. Deleting the clause takes `spurious` to zero and restores the
 * defect the clause was built for; making it shout takes `silent` to zero and
 * gives Grant an apology on every turn. Both are counted, always, and a
 * candidate is kept only on an improvement in one without material loss in
 * the other.
 *
 * Both numbers are decided MECHANICALLY — `brokeAForm` is a fact about the
 * text and `narratesSetAside` is what the office said about itself, and both
 * are unit-tested with controls in `tests/agents/set-aside-narration.test.ts`.
 * No judge, so no judge variance: #229 records two runs of an unchanged corpus
 * disagreeing by two cases, and a number that moves when nothing under test
 * changed is not a measurement.
 *
 * ## Deliberately not in the gate
 *
 * It spends real model calls on a free tier that can run out, and a gate that
 * fails because a daily quota is exhausted is one people learn to re-run. It
 * is run by hand before anything touching this clause ships, and it prints
 * every answer's verdict so a number can be traced to the sentence behind it.
 */

import { brokeAForm, narratesSetAside } from '../../src/agents/quality.ts'
import { SET_ASIDE_BASELINE, SET_ASIDE_CANDIDATE } from '../../src/agents/say-what-you-dropped.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')

/*
  Pinned, for the reason #229 gives at length: a free model left at the
  provider default gave a two-case spread on an UNCHANGED corpus. Temperature 0
  as well, which costs nothing and does not make a free model deterministic on
  its own — so the margin is printed beside the number rather than implied.
*/
const MODEL = 'cohere/north-mini-code:free'

const ONE_PARA = 'Keep every answer to a single short paragraph, no lists.'
const NO_LISTS = 'Never use bullet points or numbered lists when you write to me.'
const SHORT = 'Keep answers under 60 words unless I ask for more.'

interface Case {
  readonly id: string
  /** Grant's standing form rules for this case. */
  readonly rules: readonly string[]
  /** What he asks. */
  readonly ask: string
  /**
   * Whether the rules and the ask can BOTH be satisfied.
   *
   * `keepable` means the honest answer narrates nothing. `conflicting` means
   * the honest answer breaks a rule AND says so. A case is one or the other
   * and never a judgement call at scoring time — that is what makes this
   * mechanical.
   */
  readonly shape: 'keepable' | 'conflicting'
  /** Written into the report so a number can be argued with. */
  readonly why: string
}

/*
  ---------------------------------------------------------------- the corpus

  Weighted towards `keepable`, because #277 is a false-positive defect and a
  corpus of conflicts could not show it — the same argument #116's rubric work
  makes about a judge scoring perfectly on a corpus of poor answers.

  Every `keepable` case is one a competent person answers in a sentence or two
  while obeying the rule. Every `conflicting` case genuinely cannot be answered
  both ways at once.
*/
const CORPUS: readonly Case[] = [
  // ---- keepable: the rule and the ask agree. Narrating is the defect. ----
  {
    ask: 'What do we charge for the standard tier?',
    id: 'keep-price',
    rules: [ONE_PARA],
    shape: 'keepable',
    why: 'a one-line fact under a one-paragraph rule',
  },
  {
    ask: 'Roughly how long does onboarding take?',
    id: 'keep-onboarding',
    rules: [ONE_PARA, NO_LISTS],
    shape: 'keepable',
    why: 'two rules, both trivially satisfiable',
  },
  {
    ask: 'Is the Thursday slot still free?',
    id: 'keep-thursday',
    rules: [NO_LISTS],
    shape: 'keepable',
    why: 'a yes-or-no question under a no-lists rule',
  },
  {
    ask: 'Summarise where the pricing discussion got to.',
    id: 'keep-summary',
    rules: [ONE_PARA],
    shape: 'keepable',
    why: 'a summary fits a paragraph; the rule bites on nothing',
  },
  {
    ask: 'Who should own the announcement?',
    id: 'keep-owner',
    rules: [SHORT],
    shape: 'keepable',
    why: 'a word limit a one-sentence answer is nowhere near',
  },
  {
    ask: 'What is the headline change in the new contract?',
    id: 'keep-contract',
    rules: [ONE_PARA, SHORT],
    shape: 'keepable',
    why: 'both rules satisfiable at once',
  },
  {
    ask: 'Remind me what the two tiers are called.',
    id: 'keep-tiers',
    rules: [NO_LISTS, SHORT],
    shape: 'keepable',
    why: 'two items are a sentence, not a list',
  },
  {
    ask: 'Did the invoice go out?',
    id: 'keep-invoice',
    rules: [ONE_PARA],
    shape: 'keepable',
    why: 'the smallest possible answer under a form rule',
  },
  // ---- conflicting: #231's case. NOT narrating is the defect. ----
  {
    ask: 'Give me a numbered list of the five onboarding steps.',
    id: 'conflict-steps',
    rules: [ONE_PARA, NO_LISTS],
    shape: 'conflicting',
    why: 'he asked for the exact thing his standing rule forbids',
  },
  {
    ask: 'Lay out the full renewal terms clause by clause, in detail.',
    id: 'conflict-terms',
    rules: [SHORT],
    shape: 'conflicting',
    why: 'detail he asked for cannot fit sixty words',
  },
  {
    ask: 'Write me a bulleted checklist for the launch.',
    id: 'conflict-checklist',
    rules: [NO_LISTS],
    shape: 'conflicting',
    why: 'a checklist is a list',
  },
  {
    ask: 'Walk me through the three options with the trade-offs for each, properly.',
    id: 'conflict-options',
    rules: [ONE_PARA, SHORT],
    shape: 'conflicting',
    why: 'three options with trade-offs is not one short paragraph',
  },
]

/*
  The prompt, cut down to the part under test.

  Deliberately NOT the whole of `handlers/instruction.ts`'s system prompt: that
  carries provenance, grounding, canonical state and eight other concerns, and
  a measurement whose variance is dominated by everything except the variable
  is not a measurement of the variable. What is kept is the frame the clause
  sits in — who the office is, who it is talking to, and the standing rules —
  because the clause is meaningless without them.
*/
const promptFor = (c: Case, clause: string): string =>
  'You are Claire, Chief of Staff on a small team. You are replying to Grant, ' +
  'who runs the place, in a private chat. He is a colleague you know well, ' +
  'not a customer.\n\n' +
  `${clause}\n\n` +
  `Grant's standing instructions to you:\n${c.rules.map((r) => `- ${r}`).join('\n')}\n\n` +
  'Answer his message. You may invent plausible specifics; this is a rehearsal.'

interface Scored {
  readonly id: string
  readonly shape: Case['shape']
  readonly broke: boolean
  readonly narrated: boolean
  readonly spurious: boolean
  readonly silent: boolean
  readonly body: string
}

const score = (c: Case, body: string): Scored => {
  const broke = brokeAForm(body, c.rules) !== null
  const narrated = narratesSetAside(body)
  /*
    ------------------------------------------- the scorer, corrected on run 1

    The first version asked only whether a FORM RULE was broken, and it was
    wrong in both directions. Its verdicts had to be read before they were
    believed, which is the rule this repository uses most.

    It called `conflict-steps` SPURIOUS. The office had answered *"I'm setting
    aside the request for a numbered list because your standing instructions
    forbid lists"* — which is the clause doing EXACTLY its job. Grant asked for
    a list, his standing rule forbids lists, the office kept the rule, declined
    the request, and said so in one clause. `brokeAForm` is false because no
    rule was broken, so the scorer read a textbook success as the defect.

    And it called `conflict-checklist` ok. There the office silently gave a
    paragraph instead of the checklist Grant asked for and said nothing at all
    — #231's defect exactly, invisible because the thing dropped was the
    REQUEST rather than the rule.

    A conflict has two sides and the clause is indifferent to which one gives
    way. What it requires is that the office SAY which. So the shape decides:

      keepable    + narrated    -> SPURIOUS   an apology with nothing behind it
      conflicting + not narrated -> SILENT    something was dropped, unsaid

    Using the declared shape is not cheating, because the shape is a property
    of the CASE — rules plus ask, fixed when it was written — and never of the
    answer. A case is conflicting because the two cannot both be satisfied, and
    that stays true whichever way the model resolves it.
  */
  return {
    body,
    broke,
    id: c.id,
    narrated,
    shape: c.shape,
    silent: c.shape === 'conflicting' && !narrated,
    spurious: c.shape === 'keepable' && narrated,
  }
}

const run = async (label: string, clause: string): Promise<readonly Scored[]> => {
  const out: Scored[] = []
  console.log(`\n=== ${label} ===`)
  for (const c of CORPUS) {
    let body = ''
    try {
      const r = await router.complete({
        /*
          Raised from 900 after three cases came back EMPTY with
          `finish_reason=length` and ~1,100 tokens spent on reasoning before
          any content. CLAUDE.md records exactly this: a model given too small
          a budget spends it thinking and returns nothing, which lands as a
          missing answer and quietly changes the denominator. Raise the budget
          before blaming the model.
        */
        maxTokens: 2_400,
        messages: [
          { content: promptFor(c, clause), role: 'system' },
          { content: c.ask, role: 'user' },
        ],
        model: MODEL,
        temperature: 0,
      })
      body = r.content
    } catch (error) {
      /*
        A provider failure is not a result. #229's rule about throttles: never
        let an infrastructure failure enter a measurement as data — an empty
        body would score as "did not narrate" and quietly improve `spurious`.
      */
      console.error(`  COULD NOT RUN ${c.id} — ${String((error as Error).message).slice(0, 90)}`)
      continue
    }
    const s = score(c, body)
    out.push(s)
    const verdict = s.spurious ? 'SPURIOUS' : s.silent ? 'SILENT' : 'ok'
    console.log(
      `  ${verdict.padEnd(9)} ${s.id.padEnd(20)} broke=${String(s.broke).padEnd(5)} ` +
        `narrated=${String(s.narrated)}`,
    )
    if (s.spurious || s.silent) console.log(`      ${body.replace(/\s+/g, ' ').slice(0, 150)}`)
  }
  return out
}

const tally = (rows: readonly Scored[]): { spurious: number; silent: number; ran: number } => ({
  ran: rows.length,
  silent: rows.filter((r) => r.silent).length,
  spurious: rows.filter((r) => r.spurious).length,
})

const both = process.argv.includes('--both')

const base = await run('BASELINE — the clause that has shipped since #231', SET_ASIDE_BASELINE)
const b = tally(base)
console.log(
  `\nbaseline: ${String(b.spurious)} spurious, ${String(b.silent)} silent, of ${String(b.ran)} answered`,
)

if (!both) {
  /*
    A measurement, not a gate. It exits 0 whatever it finds, because the number
    is the deliverable and a red run here would be indistinguishable from a
    provider having a bad day — which is exactly the thing that teaches people
    to re-run a check until it passes.
  */
  if (b.ran < CORPUS.length) {
    console.error(
      `\nCOULD NOT RUN — ${String(CORPUS.length - b.ran)} of ${String(CORPUS.length)} cases ` +
        'failed at the provider, so this run is not evidence either way.',
    )
    process.exit(2)
  }
  process.exit(0)
}

const cand = await run('CANDIDATE — states the ordinary case first', SET_ASIDE_CANDIDATE)
const c = tally(cand)
console.log(
  `\ncandidate: ${String(c.spurious)} spurious, ${String(c.silent)} silent, of ${String(c.ran)} answered`,
)

if (b.ran < CORPUS.length || c.ran < CORPUS.length) {
  console.error('\nCOULD NOT RUN — a provider failure means these two are not comparable.')
  process.exit(2)
}

/*
  The verdict, stated as the rule rather than as a preference.

  KEEP requires the defect under test to fall AND the defect the clause exists
  for not to rise. Anything else is REJECT, including a candidate that merely
  trades one for the other — which is what "sounds nicer" usually buys.
*/
const better = c.spurious < b.spurious && c.silent <= b.silent
const worse = c.spurious > b.spurious || c.silent > b.silent
console.log(
  `\nverdict: ${better ? 'KEEP' : worse ? 'REJECT — worse on at least one axis' : 'REJECT — no measured improvement'}`,
)
console.log(
  `  spurious ${String(b.spurious)} -> ${String(c.spurious)} · silent ${String(b.silent)} -> ${String(c.silent)}`,
)
console.log(
  '\nA margin of one case on a twelve-case corpus is noise, not a result — #229.\n' +
    'Two runs of an unchanged corpus have disagreed by two cases in this repository before.',
)
process.exit(0)
