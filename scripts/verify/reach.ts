/**
 * Can a sentence Grant would type reach the person whose job it is — without
 * a model, and in three seconds?
 *
 *   npm run verify:reach
 *
 * ## Why this exists beside `verify:roster`
 *
 * They answer different questions and the difference is the point.
 *
 * `verify:roster` (#230) injects eight instructions through `inbound_commands`
 * and waits for the deployed worker. That is the real thing and it is the only
 * proof that the whole path works — and it costs a model call per case, takes
 * minutes, and cannot run at all while the provider is out.
 *
 * This walks the same three calls `handlers/instruction.ts` makes — intent,
 * clauses, `who_knows_about`, `pickRoster` — and stops before the model. Every
 * case here is one the LITERAL matcher can settle, so the result is
 * deterministic: the same answer every run, no sampling, no tokens.
 *
 * ## The defect it was written for
 *
 * #231, on held-out acceptance traffic. *"Draft the announcement copy for the
 * tier change"* is ranked communications, growth by `who_knows_about` —
 * correctly, from Grant's own expertise columns — and went to the GROWTH
 * director, because `pickRoster` took the intersection in the order of the
 * hardcoded intent ceiling rather than in order of fit. *"Audit the refund
 * policy for compliance risk"* ranked quality first and went to research the
 * same way.
 *
 * Two misroutes in nine turns, and both were invisible to every existing
 * routing check, because `verify:routing-breadth` measures how often the RIGHT
 * person is reached across phrasings and these cases reach a plausible
 * specialist confidently. A confident wrong specialist is worse than Claire:
 * Grant gets an answer and no signal that it came from the wrong desk.
 *
 * ## The controls are half of it
 *
 * Two cases must reach NOBODY. A roster that reaches everybody for everything
 * is not routing, and #232's corpus already found the failure mode where a
 * greeting convenes a specialist. They are listed with the rest rather than in
 * a separate pass, so a change that makes the office keener cannot pass by
 * moving them.
 *
 * ## What it deliberately does not do
 *
 * It does not touch the semantic layer, so it says nothing about the phrasings
 * `who_knows_about` cannot see — that is `verify:routing-heldout`'s job and it
 * needs a model. A green run here means the vocabulary and the ceiling agree,
 * not that routing is good.
 */

import { clauses } from '../../src/agents/clauses.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import { withoutNegated } from '../../src/agents/negation.ts'
import { pickRoster, type RoleSlug } from '../../src/agents/router.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

interface Case {
  readonly say: string
  readonly wants: string
  readonly why: string
}

const CASES: readonly Case[] = [
  {
    say: 'What is our gross margin trending like on the middle tier?',
    wants: 'finance-director',
    why: 'finance',
  },
  {
    say: 'Which acquisition channel is actually bringing us leads?',
    wants: 'growth-director',
    why: 'growth',
  },
  {
    say: 'Draft the announcement copy for the tier change.',
    wants: 'communications-director',
    why: 'communications — the ceiling used to send this to growth',
  },
  {
    say: 'Where is the delivery process losing us capacity?',
    wants: 'operations-director',
    why: 'operations',
  },
  {
    say: 'Audit the refund policy for compliance risk before we publish it.',
    wants: 'quality-director',
    why: 'quality — the ceiling used to send this to research',
  },
  {
    say: 'Benchmark us against the three main competitors on packaging.',
    wants: 'research-director',
    why: 'research',
  },
  {
    say: 'What are the trade-offs on the roadmap direction for next quarter?',
    wants: 'strategy-director',
    why: 'strategy',
  },
  {
    say: 'Thanks, that is helpful.',
    wants: 'chief-of-staff',
    why: 'CONTROL: a pleasantry convenes nobody',
  },
  {
    say: 'What projects do we have open at the moment?',
    wants: 'chief-of-staff',
    why: 'CONTROL: retrieval about the office itself is not a specialist',
  },
]

/** The literal half of what `handlers/instruction.ts` does, and nothing after it. */
const reaches = async (say: string): Promise<{ who: string; roster: readonly string[] }> => {
  const classified = classifyIntent(say)
  const asks = clauses(withoutNegated(say))
  const perAsk = asks.length === 1 ? 3 : 1
  const rows =
    asks.length === 0
      ? []
      : ((
          await db.execute(`
            with ask(i, t) as (values ${asks.map((t, i) => `(${String(i)}, ${lit(t)})`).join(', ')})
            select ask.i as i, w.slug as slug
              from ask cross join lateral app.who_knows_about(ask.t, ${String(perAsk)}) w
             order by ask.i`)
        ).rows as { slug: string }[])
  const literal = [...new Set(rows.map((r) => String(r.slug)))]
  const { roster } = pickRoster(classified, say, literal as readonly RoleSlug[], undefined)
  return { who: roster[0] ?? 'chief-of-staff', roster }
}

let pass = 0
const failures: string[] = []
console.log('\nverify:reach — the literal routing path, no model call\n')

for (const c of CASES) {
  const { who, roster } = await reaches(c.say)
  const good = who === c.wants
  if (good) pass += 1
  else failures.push(`wanted ${c.wants}, got ${who} — ${JSON.stringify(c.say)}`)
  console.log(
    `  ${good ? 'ok  ' : 'FAIL'} ${c.wants.padEnd(24)} ${roster.length === 0 ? '(nobody)' : roster.join(', ')}`,
  )
  console.log(`       ${c.why}`)
}

/*
  The specialists this proves reachable, named rather than counted.

  CLAUDE.md, four times over: a count-based assertion goes red the day the
  thing under test gets better, and green while the wrong people answer. Seven
  named desks and two controls is the claim; "9/9" is not.
*/
const reached = new Set<string>()
for (const c of CASES) if (c.wants !== 'chief-of-staff') reached.add(c.wants)

console.log(`\n${String(pass)}/${String(CASES.length)} — ${String(reached.size)} specialists named`)
if (failures.length > 0) {
  console.log('\nnot reached:')
  for (const f of failures) console.log(`  ${f}`)
  console.log(
    '\nA confident wrong specialist is worse than the Chief of Staff: Grant gets an\n' +
      'answer and no signal that it came from the wrong desk.',
  )
  process.exit(1)
}
console.log('every specialist is reachable by the vocabulary alone, and neither control moved')
