/**
 * The answer envelope against the REAL provider path, measured (#412).
 *   npm run sample:envelope-canary
 *
 * Twelve prompts of the shapes an answer takes (a sentence, a list, a table, code, a reply that sounds like working-out, a
 * reply about the tags themselves, a single word, arithmetic), each asked twice through the real ProviderRouter and the real
 * model chain: once as the office asks today, once with `answerEnvelope: true`. 24 free-tier calls, no office data, nothing
 * delivered to anybody. What is read from the DATABASE, not from the return value: how many attempts each call took and how
 * each ended (inference_usage by correlation), because "it worked" hides a model that ignored the format and was failed over.
 *
 * Reported, not gated: a free model is not deterministic and a run is one sample. The number to read is compliance (how often
 * the FIRST model followed the format) beside what the envelope cost in attempts, and whether any envelope answer looks like
 * working-out. Written to docs/testing/answer-envelope-canary.md by hand from this output, with its date and its n.
 */

import { deliberationLeak } from '../../src/agents/quality.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')

const SYSTEM =
  'You are Claire, the chief of staff for a small business. Answer the person directly and briefly, in plain prose unless they ask for a list, table or code.'
const PROMPTS: readonly [string, string][] = [
  ['sentence', 'In one sentence, what is a retainer agreement?'],
  ['list', 'List three things to check before signing a venue contract.'],
  ['table', 'Make a small table comparing monthly and annual billing.'],
  ['code', 'Write a TypeScript function that adds two numbers.'],
  ['decline', 'Explain in two sentences how to politely decline a meeting.'],
  ['sounds-like-working', 'Rephrase politely: "We need to check the policy with the accountant."'],
  ['about-tags', 'What is an <answer> tag in HTML-like markup used for? Two sentences.'],
  ['one-word', 'Reply with just the word yes.'],
  ['names', 'Give me three possible names for a tea shop.'],
  ['arithmetic', 'What is 17% of 240? Show the arithmetic briefly.'],
  [
    'summary',
    'Summarise in one line: "The venue is booked for 12 May. A deposit of 400 is due Friday."',
  ],
  ['subject-line', 'Draft an email subject line and a preview line for a spring sale.'],
]

type Row = {
  id: string
  mode: 'today' | 'envelope'
  ok: boolean
  model: string
  attempts: number
  firstTry: boolean
  ms: number
  leak: boolean
  openers: string
  err: string
}
const rows: Row[] = []
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

for (const [id, ask] of PROMPTS) {
  for (const mode of ['today', 'envelope'] as const) {
    const correlationId = crypto.randomUUID()
    const started = Date.now()
    let content = ''
    let model = ''
    let err = ''
    try {
      const r = await router.complete({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: ask },
        ],
        maxTokens: 1500,
        correlationId,
        ...(mode === 'envelope' ? { answerEnvelope: true } : {}),
      })
      content = r.content
      model = r.model
    } catch (e) {
      err = String((e as Error).message).slice(0, 120)
    }
    const used = (
      await db.execute(
        `select outcome from public.inference_usage where correlation_id = ${lit(correlationId)}::uuid order by occurred_at`,
      )
    ).rows.map((r) => String((r as { outcome: string }).outcome))
    rows.push({
      id,
      mode,
      ok: err === '',
      model,
      attempts: used.length,
      firstTry: used.length === 1 && used[0] === 'ok',
      ms: Date.now() - started,
      leak: content !== '' && deliberationLeak(content, []) !== null,
      openers: content.slice(0, 50).replace(/\s+/g, ' '),
      err,
    })
    console.log(
      `${mode.padEnd(8)} ${id.padEnd(20)} ${err === '' ? 'ok ' : 'ERR'} attempts=${String(used.length)} ${used.join('>')} ${String(Date.now() - started)}ms ${model}${err === '' ? '' : ` ${err}`}`,
    )
  }
}

const by = (mode: Row['mode']): Row[] => rows.filter((r) => r.mode === mode)
const pct = (n: number, d: number): string =>
  d === 0 ? 'n/a' : `${String(Math.round((100 * n) / d))}%`
for (const mode of ['today', 'envelope'] as const) {
  const r = by(mode)
  console.log(
    `\n${mode}: answered ${String(r.filter((x) => x.ok).length)}/${String(r.length)}; first model usable ${pct(r.filter((x) => x.firstTry).length, r.length)}; ` +
      `mean attempts ${(r.reduce((a, x) => a + x.attempts, 0) / r.length).toFixed(2)}; mean ${String(Math.round(r.reduce((a, x) => a + x.ms, 0) / r.length))}ms; ` +
      `flagged as working-out ${String(r.filter((x) => x.leak).length)}`,
  )
}
console.log(
  '\nThis is one run of 12 prompts on a non-deterministic free tier: a measurement of compliance and cost, not proof of absence.',
)
