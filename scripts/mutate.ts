/**
 * Semantic variants of a request, for the routing corpus.
 *
 *   npm run mutate -- "What does cutting price 15% do to gross margin?" --wants finance-director
 *
 * Issue #235, workstream H. Grant's requirement, and his own worked example:
 *
 *   > The objective is to test whether routing understands the **concept**
 *   > rather than **memorising wording**.
 *
 *   *"What does cutting price 15% do to gross margin?"* should generate
 *   *"If we knock fifteen percent off, what happens to margin?"*, *"Can we
 *   afford to discount this?"*, *"How badly would a price reduction hurt
 *   profitability?"*, *"Run the numbers if we sell it cheaper."*, and
 *   speech-to-text variants.
 *
 * Only the first two of those contain any word in `finance-director`'s
 * expertise. That is the whole point: a variant that shares vocabulary with the
 * original tests nothing, and the ones that share only MEANING are the test.
 *
 * ## It prints; it does not append
 *
 *   > Every genuine routing defect should produce permanent nearby regression
 *   > variants.
 *
 * Permanent means committed to `scripts/corpus/routing.ts`, and that is a
 * deliberate act. A generator that wrote straight into the corpus would be
 * asserting its own ground truth — the model that decides a variant belongs to
 * the finance director is the same kind of model the routing is being tested
 * against, and a corpus graded by the thing under test measures nothing. So
 * this prints paste-ready entries and a person or an agent decides which are
 * genuinely the same request.
 *
 * ## Read the output adversarially
 *
 * The useful variants are the ones that would fail. A generated line that
 * repeats the original's nouns can be deleted on sight.
 */

import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { ProviderRouter } from '../src/providers/router.ts'
import { CORPUS, type Form } from './corpus/routing.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? undefined : argv[i + 1]
}
const ask = argv
  .filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true)
  .join(' ')
  .trim()
const wants = flag('wants') ?? ''
if (ask === '' || wants === '') {
  console.error('usage: npm run mutate -- "<the request>" --wants <role-slug>')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')

/*
  The forms worth generating, and why these seven.

  `explicit` is excluded deliberately — a variant that names the domain is the
  original wearing different words and cannot fail for the reason this file
  exists. The seven below are the ones the #232 measurement found weakest
  before the fix: vague, colloquial, command and speech were all at 0%.
*/
const FORMS: readonly { readonly form: Form; readonly how: string }[] = [
  { form: 'synonym', how: 'uses words about the same subject, but not the obvious ones' },
  { form: 'indirect', how: 'describes the problem and never names the subject at all' },
  { form: 'colloquial', how: 'how somebody would say it out loud to a colleague' },
  { form: 'vague', how: 'gestures at what is wanted without specifics' },
  { form: 'command', how: 'an instruction, imperative, no question mark' },
  {
    form: 'speech',
    how: 'a rambling voice note with disfluencies and repeated words, no punctuation to speak of',
  },
  { form: 'typo', how: 'typed quickly on a phone with two or three misspellings' },
]

console.log(`\nmutating: ${JSON.stringify(ask)}\n  expected owner: ${wants}\n`)

const result = await router
  .complete({
    messages: [
      {
        role: 'system',
        content:
          'You rewrite one business request into variants that mean the SAME THING. ' +
          'Each variant must be something a real person would actually send to their ' +
          'assistant — short, natural, and unmistakably the same underlying request.\n\n' +
          'The point is to test whether a router understands the concept rather than ' +
          'the wording, so AVOID reusing the distinctive nouns of the original wherever ' +
          'the form allows it.\n\n' +
          `Produce exactly one variant per form, as "<form>: <variant>", nothing else:\n${FORMS.map((f) => `- ${f.form}: ${f.how}`).join('\n')}`,
      },
      { role: 'user', content: ask },
    ],
    temperature: 0,
    maxTokens: 2_000,
  })
  .catch((error: unknown) => {
    console.error(`no variants: ${(error as Error).message.slice(0, 160)}`)
    return null
  })
if (result === null) process.exit(1)

const seen = new Set(CORPUS.map((c) => c.ask.toLowerCase()))
const lines = result.content
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.includes(':'))

let printed = 0
for (const line of lines) {
  const at = line.indexOf(':')
  const form = line
    .slice(0, at)
    .replace(/[^a-z]/gi, '')
    .toLowerCase()
  const text = line
    .slice(at + 1)
    .trim()
    .replace(/^["']|["']$/g, '')
  if (!FORMS.some((f) => f.form === form) || text.length < 8) continue
  /*
    A variant already in the corpus is not a variant.

    Cheap, and it matters: run this twice on the same defect and the second run
    would otherwise offer the same seven lines, which is how a corpus grows
    without gaining coverage.
  */
  if (seen.has(text.toLowerCase())) {
    console.log(`  // already in the corpus: ${text}`)
    continue
  }
  printed++
  console.log(`  { wants: '${wants}', form: '${form}', ask: ${JSON.stringify(text)} },`)
}

console.log(
  `\n${String(printed)} variant(s). Paste into scripts/corpus/routing.ts the ones that are ` +
    'genuinely the same request — and delete any that reuse the original’s nouns, ' +
    'because those cannot fail for the reason this exists.',
)
