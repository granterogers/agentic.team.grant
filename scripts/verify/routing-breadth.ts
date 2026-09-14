/**
 * Does routing understand the CONCEPT, or has it memorised the words?
 *
 *   npm run verify:routing-breadth
 *   npm run verify:routing-breadth -- --matrix   # print the confusion matrix
 *
 * Issue #232, workstreams A–D of #231.
 *
 * `verify:roster` asks eight questions and is 7/7. That is a seed, not
 * acceptance: eight cases cannot tell a system that understands finance from
 * one that has the word "margin" in a list.
 *
 * ## Why this runs offline, and why that is not cheating
 *
 * Routing is a pure function plus one database lookup:
 *
 *     classifyIntent(text)                   pure
 *     app.who_knows_about(text, 3)           the expertise Grant edits
 *     pickRoster(classification, text, topical)   pure
 *
 * `handlers/instruction.ts:195` composes exactly those three, so this harness
 * calls the same three in the same order with the same inputs. That buys ~200
 * cases in seconds instead of ~50 minutes of real jobs, which is the difference
 * between a campaign and a gesture.
 *
 * It is only honest if the offline answer matches what the office actually
 * does, so **the last section injects a sample through the canonical
 * `inbound_commands` path and asserts the two agree**. If they ever diverge
 * this file is measuring a path the product does not take, which is CLAUDE.md's
 * most repeated trap and the reason that check exists.
 *
 * ## What is asserted, and what is only reported
 *
 * ASSERTED: every specialist is reachable by at least one natural phrasing;
 * trivial work stays with Claire; the offline harness agrees with production.
 *
 * REPORTED: per-agent accuracy and the confusion matrix. A hard threshold on
 * accuracy would be a number I invented, and #232 is explicit that overlapping
 * domains must be graded on the behavioural property rather than one rigid
 * correct answer. The matrix is for a person to read.
 */

import { classifyIntent } from '../../src/agents/intent.ts'
import { pickRoster, type RoleSlug } from '../../src/agents/router.ts'
import { nameSubjects } from '../../src/agents/subject.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
/*
  The key is resolved from the vault by the router itself, so the environment
  variable is optional here — a local run with one set keeps working and a run
  without one still reaches a model. Never printed.
*/
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}

/**
 * A case. `wants` is who should get it; `also` are answers a reasonable person
 * would accept.
 *
 * `form` records HOW it is phrased, so the report can say whether failures
 * cluster in one linguistic form — which is the difference between "routing is
 * weak" and "routing cannot handle speech".
 */
type Form =
  | 'explicit' // names the domain in its own words
  | 'synonym' // domain words, but not the ones in the expertise list
  | 'indirect' // describes the problem, never names the domain
  | 'colloquial' // how a person actually talks
  | 'vague'
  | 'command'
  | 'assignment'
  | 'long' // multi-clause
  | 'speech' // stream of consciousness, disfluencies
  | 'typo'
type Case = {
  readonly wants: RoleSlug | 'nobody'
  readonly also?: readonly RoleSlug[]
  readonly form: Form
  readonly ask: string
  /*
    A control whose subject genuinely belongs to a specialist.

    Kept in the corpus and still reported, but excluded from the
    false-positive assertion, because sending an operations question to the
    operations director is the vocabulary WORKING — it is only a control in
    the weaker sense that a timestamp lookup does not need a specialist. The
    assertion is about chatter and administrivia summoning nobody; a case that
    names a real operations noun tests the opposite thing and would make the
    guard fire on correct behaviour.
  */
  readonly defensible?: true
}

/*
  The corpus.

  Written to test CONCEPTS. The `explicit` cases exist as a control — if those
  fail, something is broken rather than merely narrow — and everything else
  deliberately avoids the obvious vocabulary. Grant's own examples are in here
  verbatim, because they are the ones he will actually ask.
*/
const CORPUS: readonly Case[] = [
  // ---------------------------------------------------------------- finance
  {
    wants: 'finance-director',
    form: 'explicit',
    ask: 'What is our gross margin on the middle tier?',
  },
  {
    wants: 'finance-director',
    form: 'explicit',
    ask: 'Can you model the revenue impact of a price change?',
  },
  {
    wants: 'finance-director',
    form: 'synonym',
    ask: 'How much money are we actually making per customer?',
  },
  {
    wants: 'finance-director',
    form: 'synonym',
    ask: 'What is the unit economics of the coaching course?',
  },
  { wants: 'finance-director', form: 'indirect', ask: 'Run the numbers if we sell it cheaper.' },
  { wants: 'finance-director', form: 'indirect', ask: 'Can we afford to discount this?' },
  {
    wants: 'finance-director',
    form: 'indirect',
    ask: 'How badly would knocking fifteen percent off hurt profitability?',
  },
  {
    wants: 'finance-director',
    form: 'colloquial',
    ask: 'Are we actually making money on this thing or not?',
  },
  {
    wants: 'finance-director',
    form: 'vague',
    ask: 'I want to understand the money side of the relaunch.',
  },
  {
    wants: 'finance-director',
    form: 'command',
    ask: 'Work out what it costs us to deliver one of these.',
  },
  {
    wants: 'finance-director',
    form: 'speech',
    ask: 'so I was thinking about the, the pricing thing, and whether we can actually afford to come down a bit, what does that do to us',
  },
  { wants: 'finance-director', form: 'typo', ask: 'whats our margin liek on the middle teir?' },
  {
    wants: 'finance-director',
    form: 'long',
    ask: 'Two things — first, what does a fifteen percent cut do to the margin, and second, how many extra sales would we need to stand still afterwards?',
  },

  // ------------------------------------------------------------- operations
  {
    wants: 'operations-director',
    form: 'explicit',
    ask: 'What is the bottleneck in our onboarding process?',
  },
  {
    wants: 'operations-director',
    form: 'explicit',
    ask: 'Can we review the capacity of the delivery schedule?',
  },
  {
    wants: 'operations-director',
    form: 'synonym',
    ask: 'Where does the workflow slow down when a client signs up?',
  },
  {
    wants: 'operations-director',
    form: 'indirect',
    ask: 'Where are things getting stuck when somebody joins?',
  },
  {
    wants: 'operations-director',
    form: 'indirect',
    ask: 'Onboarding takes eleven days and it should take three. Why?',
  },
  {
    wants: 'operations-director',
    form: 'colloquial',
    ask: 'Everything grinds to a halt once they sign. What is going on?',
  },
  {
    wants: 'operations-director',
    form: 'vague',
    ask: 'The way we run things after a sale feels clunky.',
  },
  {
    wants: 'operations-director',
    form: 'command',
    ask: 'Map out every step from signup to first session and tell me which one is slowest.',
  },
  {
    wants: 'operations-director',
    form: 'speech',
    ask: 'right so people sign up and then, and then nothing happens for like a week, and I do not know where the hold up actually is',
  },
  {
    wants: 'operations-director',
    form: 'assignment',
    ask: 'I need you to find the hold-up in how we deliver this.',
  },
  { wants: 'operations-director', form: 'typo', ask: 'wheres the bottlneck in the onbaording' },

  // ---------------------------------------------------------- quality / risk
  {
    wants: 'quality-director',
    form: 'explicit',
    ask: 'What are the risks of shipping the payment change on Friday?',
  },
  {
    wants: 'quality-director',
    form: 'explicit',
    ask: 'Can you audit this for accuracy before it goes out?',
  },
  {
    wants: 'quality-director',
    form: 'synonym',
    ask: 'What is the exposure if this goes wrong in front of a customer?',
  },
  {
    wants: 'quality-director',
    form: 'indirect',
    ask: 'What could bite us if we push this live Friday?',
  },
  {
    wants: 'quality-director',
    form: 'indirect',
    ask: 'What could go wrong if we ship this on a Friday afternoon?',
  },
  {
    wants: 'quality-director',
    form: 'indirect',
    ask: 'Is there anything in here that contradicts what we said last month?',
  },
  {
    wants: 'quality-director',
    form: 'colloquial',
    ask: 'Talk me out of doing this. What am I missing?',
  },
  {
    wants: 'quality-director',
    form: 'vague',
    ask: 'I am nervous about this one. Give it a proper look.',
  },
  { wants: 'quality-director', form: 'command', ask: 'Check this over properly before I send it.' },
  {
    wants: 'quality-director',
    form: 'speech',
    ask: 'I keep going back and forth on whether this is safe to do, like what happens if it breaks on a Friday and nobody is around',
  },
  { wants: 'quality-director', form: 'typo', ask: 'what culd go wrong if we shipp this friday' },

  // ---------------------------------------------------------------- strategy
  {
    wants: 'strategy-director',
    form: 'explicit',
    ask: 'Should we enter the enterprise market or stay with SMB?',
  },
  {
    wants: 'strategy-director',
    form: 'explicit',
    ask: 'What are our options for the direction of the business next year?',
  },
  {
    wants: 'strategy-director',
    form: 'synonym',
    ask: 'Are we better going after larger companies or staying focused on smaller customers?',
  },
  {
    wants: 'strategy-director',
    form: 'indirect',
    ask: 'Where should we be pointing this thing in twelve months?',
  },
  {
    wants: 'strategy-director',
    form: 'indirect',
    ask: 'Is it worth changing course, or do we keep doing what we are doing?',
  },
  {
    wants: 'strategy-director',
    form: 'colloquial',
    ask: 'Big picture — what should we actually be betting on?',
  },
  {
    wants: 'strategy-director',
    form: 'vague',
    ask: 'I need to make a call on where this goes next.',
  },
  {
    wants: 'strategy-director',
    form: 'command',
    ask: 'Make the case both ways and tell me which you would pick.',
  },
  {
    wants: 'strategy-director',
    form: 'speech',
    ask: 'so the question really is do we go up market or, or do we just double down where we are, and I honestly cannot decide',
  },
  { wants: 'strategy-director', form: 'typo', ask: 'shold we go enterprize or stay smb' },

  // ------------------------------------------------------------------ growth
  {
    wants: 'growth-director',
    form: 'explicit',
    ask: 'Which acquisition campaign is bringing the best audience?',
  },
  {
    wants: 'growth-director',
    form: 'explicit',
    ask: 'How should we position the brand for the relaunch?',
  },
  {
    wants: 'growth-director',
    form: 'synonym',
    ask: 'Where are our best customers actually coming from?',
  },
  {
    wants: 'growth-director',
    form: 'indirect',
    ask: 'How do we get more of the right people through the door?',
  },
  { wants: 'growth-director', form: 'indirect', ask: 'Which channel should we stop spending on?' },
  {
    wants: 'growth-director',
    form: 'colloquial',
    ask: 'Nobody knows we exist. What do we do about it?',
  },
  { wants: 'growth-director', form: 'vague', ask: 'We need more people signing up.' },
  {
    wants: 'growth-director',
    form: 'command',
    ask: 'Work out who we should be talking to and where they are.',
  },
  {
    wants: 'growth-director',
    form: 'speech',
    ask: 'I think our problem is just that not enough of the right sort of person is finding us in the first place',
  },
  { wants: 'growth-director', form: 'typo', ask: 'which aquisition chanel is working best' },

  // ---------------------------------------------------------- communications
  {
    wants: 'communications-director',
    form: 'explicit',
    ask: 'Draft the announcement email for the pricing change.',
  },
  {
    wants: 'communications-director',
    form: 'explicit',
    ask: 'Can you edit this copy so it reads better?',
  },
  {
    wants: 'communications-director',
    form: 'synonym',
    ask: 'What wording should we use when we tell people about this?',
  },
  {
    wants: 'communications-director',
    form: 'indirect',
    ask: 'How do we say this without sounding apologetic?',
  },
  {
    wants: 'communications-director',
    form: 'indirect',
    ask: 'Put something together that I can send out tomorrow.',
  },
  {
    wants: 'communications-director',
    form: 'colloquial',
    ask: 'Make this sound less like a robot wrote it.',
  },
  {
    wants: 'communications-director',
    form: 'vague',
    ask: 'I need to tell everyone about the change and I do not know how to phrase it.',
  },
  {
    wants: 'communications-director',
    form: 'command',
    ask: 'Write the short version for the phone.',
  },
  {
    wants: 'communications-director',
    form: 'speech',
    ask: 'so I need to let people know about the price thing but I do not want it to sound like we are, you know, making excuses',
  },
  {
    wants: 'communications-director',
    form: 'typo',
    ask: 'draft teh anouncement for the pricing chnage',
  },

  // ---------------------------------------------------------------- research
  {
    wants: 'research-director',
    form: 'explicit',
    ask: 'Find out what the competitors are charging.',
  },
  {
    wants: 'research-director',
    form: 'explicit',
    ask: 'Compare the three main alternatives and benchmark them.',
  },
  { wants: 'research-director', form: 'synonym', ask: 'What is the evidence for that claim?' },
  {
    wants: 'research-director',
    form: 'indirect',
    ask: 'What is everyone else in this space doing?',
  },
  {
    wants: 'research-director',
    form: 'indirect',
    ask: 'Dig into how the other lot package theirs.',
  },
  {
    wants: 'research-director',
    form: 'colloquial',
    ask: 'Go and have a proper look at what is out there.',
  },
  {
    wants: 'research-director',
    form: 'vague',
    ask: 'I want to know more about this before I decide.',
  },
  {
    wants: 'research-director',
    form: 'command',
    ask: 'Pull together everything we know about the market.',
  },
  {
    wants: 'research-director',
    form: 'speech',
    ask: 'can you go and find out what, what other people charge for this sort of thing, roughly',
  },
  { wants: 'research-director', form: 'typo', ask: 'find out what competitos are chargin' },

  // ------------------------------------------- negative controls: Claire only
  { wants: 'nobody', form: 'explicit', ask: 'What is the status of the migration?' },
  { wants: 'nobody', form: 'explicit', ask: 'What documents do we have on this project?' },
  {
    wants: 'nobody',
    form: 'explicit',
    ask: 'What time did the backup finish?',
    defensible: true,
  },
  { wants: 'nobody', form: 'colloquial', ask: 'How are we doing?' },
  { wants: 'nobody', form: 'colloquial', ask: 'Morning. Anything I should know about?' },
  { wants: 'nobody', form: 'explicit', ask: 'Is that done yet?' },
  { wants: 'nobody', form: 'vague', ask: 'Do we have anything on record about that?' },
  { wants: 'nobody', form: 'explicit', ask: 'What is on my plate this week?' },
  { wants: 'nobody', form: 'colloquial', ask: 'Thanks, that is helpful.' },
  { wants: 'nobody', form: 'explicit', ask: 'Remind me what we called that project.' },

  // -------------------------------------------------------- overlapping work
  {
    wants: 'finance-director',
    also: ['strategy-director'],
    form: 'long',
    ask: 'If we move up market, what does that do to our pricing and is it the right call?',
  },
  {
    wants: 'growth-director',
    also: ['communications-director'],
    form: 'long',
    ask: 'Who should we be targeting with the relaunch and what should the messaging say?',
  },
  {
    wants: 'operations-director',
    also: ['quality-director'],
    form: 'long',
    ask: 'Our delivery process keeps slipping and I think it is causing mistakes. Look at both.',
  },
  {
    wants: 'research-director',
    also: ['strategy-director'],
    form: 'long',
    ask: 'Find out what the competition charges and tell me whether we should match them.',
  },
  {
    wants: 'finance-director',
    also: ['growth-director'],
    form: 'long',
    ask: 'What does it cost us to acquire a customer and is that channel worth keeping?',
  },
  {
    wants: 'communications-director',
    also: ['quality-director'],
    form: 'long',
    ask: 'Draft the incident note and check it does not overstate what we know.',
  },
]

console.log(
  `\nverify:routing-breadth — ${String(CORPUS.length)} cases, ${String(new Set(CORPUS.map((c) => c.wants)).size)} targets\n`,
)

type Result = Case & {
  intent: string
  confident: boolean
  chosen: readonly string[]
  reason: string
  /** True when no word in the request matched and the meaning decided it. */
  viaSemantic: boolean
  verdict: 'correct' | 'acceptable' | 'claire-fallback' | 'wrong'
}

/*
  How many cases the semantic layer was actually asked about, and how many it
  named somebody for.

  Reported, and then asserted on. Every failure inside `nameSubjects` — no
  model, a rate limit, an empty completion — comes back as an empty array by
  design, which is correct for the product and catastrophic for a measurement:
  a run where every free model refused us would print the same 31% as a run
  where the layer works and would read as "the fix did nothing". The counters
  are what tell those two apart.
*/
let asked = 0
let named = 0

const decide = async (c: Case): Promise<Result> => {
  const classification = classifyIntent(c.ask)
  const literal = (
    (await db.execute(`select slug from app.who_knows_about(${lit(c.ask)}, 3)`)).rows as {
      slug: RoleSlug
    }[]
  ).map((r) => r.slug)

  /*
    The same else-branch handlers/instruction.ts takes (#232).

    Not a second opinion: an expertise hit is Grant's own vocabulary saying who
    this belongs to, and the model is only asked when no word in the request
    named anybody.
  */
  let topical: readonly RoleSlug[] = literal
  let viaSemantic = false
  if (literal.length === 0) {
    asked++
    topical = await nameSubjects(db, router, c.ask)
    if (topical.length > 0) {
      named++
      viaSemantic = true
    }
  }
  const { roster, reason } = pickRoster(classification, c.ask, topical)

  const verdict: Result['verdict'] =
    c.wants === 'nobody'
      ? roster.length === 0
        ? 'correct'
        : 'wrong'
      : roster.includes(c.wants)
        ? 'correct'
        : roster.some((r) => (c.also ?? []).includes(r))
          ? 'acceptable'
          : roster.length === 0
            ? 'claire-fallback'
            : 'wrong'

  return {
    ...c,
    intent: classification.intent,
    confident: classification.confident,
    chosen: roster,
    reason,
    verdict,
    viaSemantic,
  }
}

/*
  Six at a time.

  Ninety-one cases, roughly half of which now make a model call, is four
  minutes serially and forty seconds in small batches — and the office is not
  the thing under test here, so there is no reason to be gentle with it beyond
  staying well inside a free tier's rate limit. Batched rather than unbounded
  because ninety-one simultaneous requests to a free endpoint is how you get
  429s that look like the layer failing to name anybody.
*/
const results: Result[] = []
for (let i = 0; i < CORPUS.length; i += 6) {
  results.push(...(await Promise.all(CORPUS.slice(i, i + 6).map(decide))))
  process.stdout.write('.')
}
console.log('')

// ---------------------------------------------------------------------------
// The confusion matrix
// ---------------------------------------------------------------------------

const targets = [...new Set(CORPUS.map((c) => c.wants))].sort()
const chosenNames = [
  ...new Set(results.flatMap((r) => (r.chosen.length === 0 ? ['(nobody)'] : [...r.chosen]))),
].sort()

if (process.argv.includes('--matrix')) {
  console.log(
    '\n| wanted \\ chosen | ' +
      chosenNames.map((n) => n.replace('-director', '')).join(' | ') +
      ' |',
  )
  console.log(`|---|${chosenNames.map(() => '---').join('|')}|`)
  for (const t of targets) {
    const row = results.filter((r) => r.wants === t)
    const cells = chosenNames.map((name) => {
      const n = row.filter(
        (r) => (r.chosen.length === 0 ? '(nobody)' : r.chosen).includes?.(name) ?? false,
      ).length
      const m = row.filter((r) =>
        name === '(nobody)' ? r.chosen.length === 0 : r.chosen.includes(name as RoleSlug),
      ).length
      return String(Math.max(n, m) || '')
    })
    console.log(`| **${t}** | ${cells.join(' | ')} |`)
  }
}

console.log('\nper-target accuracy')
for (const t of targets) {
  const row = results.filter((r) => r.wants === t)
  const good = row.filter((r) => r.verdict === 'correct' || r.verdict === 'acceptable').length
  const pct = Math.round((good / row.length) * 100)
  console.log(
    `  ${t.padEnd(24)} ${String(good).padStart(2)}/${String(row.length).padEnd(2)} ${String(pct).padStart(3)}%  ${'█'.repeat(Math.round(pct / 5))}`,
  )
}

console.log('\naccuracy by linguistic form')
const forms = [...new Set(CORPUS.map((c) => c.form))].sort()
for (const f of forms) {
  const row = results.filter((r) => r.form === f && r.wants !== 'nobody')
  if (row.length === 0) continue
  const good = row.filter((r) => r.verdict === 'correct' || r.verdict === 'acceptable').length
  console.log(
    `  ${f.padEnd(12)} ${String(good).padStart(2)}/${String(row.length).padEnd(2)} ${String(Math.round((good / row.length) * 100)).padStart(3)}%`,
  )
}

const specialists = results.filter((r) => r.wants !== 'nobody')
const hit = specialists.filter((r) => r.verdict === 'correct' || r.verdict === 'acceptable')
const fellBack = specialists.filter((r) => r.verdict === 'claire-fallback')
const wrong = specialists.filter((r) => r.verdict === 'wrong')
const controls = results.filter((r) => r.wants === 'nobody')
const falsePositives = controls.filter(
  (r) => r.verdict === 'wrong' && CORPUS.find((c) => c.ask === r.ask)?.defensible !== true,
)
const defensible = controls.filter(
  (r) => r.verdict === 'wrong' && CORPUS.find((c) => c.ask === r.ask)?.defensible === true,
)

console.log(
  `\noverall — ${String(hit.length)}/${String(specialists.length)} specialist cases reached someone acceptable ` +
    `(${String(Math.round((hit.length / specialists.length) * 100))}%)`,
)
console.log(`  fell back to Claire   ${String(fellBack.length)}`)
console.log(`  went to the wrong specialist ${String(wrong.length)}`)
console.log(
  `  read for meaning   ${String(asked)} cases had no literal match; the semantic layer named somebody for ${String(named)}`,
)
console.log(
  `  false positives on the ${String(controls.length)} Claire-only controls: ${String(falsePositives.length)}` +
    (defensible.length === 0
      ? ''
      : ` (plus ${String(defensible.length)} defensible: ${defensible.map((r) => `"${r.ask.slice(0, 32)}" -> ${r.chosen.join(',')}`).join(', ')})`),
)

// ---------------------------------------------------------------------------
console.log('\nwhat must be true')
// ---------------------------------------------------------------------------

/*
  Reachability, which is the acceptance criterion #231 lists first. Not
  "accurate" — REACHABLE. A specialist nothing can route to is dead weight
  however good the rest of the numbers look.
*/
for (const t of targets.filter((x) => x !== 'nobody')) {
  const row = results.filter((r) => r.wants === t)
  const reached = row.filter((r) => r.chosen.includes(t as RoleSlug))
  ok(
    `${t} is reachable by at least one natural phrasing`,
    reached.length > 0,
    reached.length === 0
      ? `UNREACHABLE across ${String(row.length)} phrasings`
      : `${String(reached.length)}/${String(row.length)} phrasings`,
  )
}

/*
  The negative control, and it is not a formality. The obvious way to make the
  numbers above look good is to widen everything, which puts a model call on
  every "how are we doing?" — #230's fix was one line from doing exactly that.
*/
/*
  The semantic layer was actually reached.

  Every failure inside `nameSubjects` degrades to an empty array on purpose,
  so a run in which every free model refused us produces exactly the numbers a
  run with no semantic layer at all produces. Without this check the suite
  would report the pre-#232 accuracy and read as "the fix did nothing", which
  is the most expensive possible way to be wrong about your own measurement.

  Asserted as a PROPERTY rather than a rate: it named somebody at least once.
  A threshold here would be a second, worse copy of the accuracy figures below
  and would go red the day the literal matcher improves enough that hardly
  anything reaches this layer.
*/
ok(
  'the semantic layer was reached and answered, so these numbers describe it',
  asked === 0 || named > 0,
  asked === 0
    ? 'every case matched literally — nothing to read for meaning'
    : `${String(named)}/${String(asked)} named somebody`,
)

ok(
  'trivial work still goes to Claire alone — no false-positive specialists',
  falsePositives.length === 0,
  falsePositives.length === 0
    ? `all ${String(controls.length)} controls held`
    : falsePositives.map((r) => `"${r.ask.slice(0, 40)}" -> ${r.chosen.join(',')}`).join(' | '),
)

// ---------------------------------------------------------------------------
console.log('\nand the offline harness matches what the office actually does')
// ---------------------------------------------------------------------------

/*
  The check that makes everything above admissible.

  This file calls classifyIntent, who_knows_about and pickRoster the way
  handlers/instruction.ts does. If that ever stops being true, every number
  above describes a path the product does not take. Rather than asserting the
  composition by reading it, a sample is put through the REAL canonical path and
  the routing decision the worker recorded is compared with the offline answer.
*/
const sample = [
  /*
    One case the offline pass routes to a REAL specialist, and one it does not.

    Both halves are load-bearing. A sample of two fallback cases would agree
    with the product for the wrong reason — `roster[0] ?? 'chief-of-staff'`
    makes an empty roster and a Claire roster indistinguishable, so the check
    would pass without ever exercising the topical path it exists to validate.
    CLAUDE.md records the same mistake in a router unit test. The specialist
    case is CHOSEN FROM THIS RUN's results rather than named, so improving the
    routing cannot silently turn this half back into a fallback case.
  */
  /*
    Deliberately a case NO WORD in which names anybody.

    This is the half that proves the deployed worker is running #232's code
    rather than the repository's. A literal-match case would agree with the
    live decision even against a worker built before any of this existed —
    CLAUDE.md: a migration is not a deploy, and neither is a commit.
  */
  CORPUS.find(
    (c) => c.wants !== 'nobody' && (results.find((r) => r.ask === c.ask)?.viaSemantic ?? false),
  ),
  /* And one the literal matcher DOES claim, so the ordinary path is covered too. */
  CORPUS.find(
    (c) =>
      c.wants !== 'nobody' &&
      (results.find((r) => r.ask === c.ask)?.chosen.length ?? 0) > 0 &&
      !(results.find((r) => r.ask === c.ask)?.viaSemantic ?? false),
  ),
  CORPUS.find((c) => c.wants === 'nobody'),
].filter((c): c is Case => c !== undefined)

const run = Math.random().toString(36).slice(2, 10)
const ACTOR = `verify-breadth-${run}`
const project = (
  (
    await db.execute(`
      insert into public.projects (name, slug, status)
      values (${lit(`Fixture breadth ${run}`)}, ${lit(`fixture-breadth-${run}`)}, 'paused')
      returning project_id::text as id`)
  ).rows as { id: string }[]
)[0]?.id
const jobIds: string[] = []
for (const [i, c] of sample.entries()) {
  const key = `teamhq:breadth_probe:${run}-${String(i)}`
  const row = (
    (
      await db.execute(`
        begin;
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
        values ('teamhq', ${lit(`breadth-${run}`)}, ${lit(ACTOR)}, ${lit(c.ask)},
                ${lit(key)}, app.now_utc(), ${lit(String(project))}::uuid);
        create temp table _j as
          select (app.enqueue_inbound(
                    (select command_id from public.inbound_commands where dedupe_key = ${lit(key)})
                  ) ->> 'job_id')::uuid as id;
        update public.jobs set announce = false where job_id = (select id from _j);
        select (select id from _j)::text as id;
        commit;`)
    ).rows as { id: string }[]
  )[0]
  jobIds.push(String(row?.id))
}

const loud = (
  (
    await db.execute(
      `select count(*)::int as n from public.jobs where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}]) and announce`,
    )
  ).rows as { n: number }[]
)[0]
ok(
  'the canonical sample cannot announce to Grant',
  Number(loud?.n) === 0,
  `${String(loud?.n)} announcing`,
)

process.stdout.write('       waiting for the worker')
const deadline = Date.now() + 6 * 60 * 1000
let decisions: { job_id: string; roster: string }[] = []
while (Date.now() < deadline) {
  decisions = (
    await db.execute(`
      select job_id::text as job_id, coalesce(array_to_string(roster, ','), '') as roster
        from public.routing_decisions
       where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}])`)
  ).rows as { job_id: string; roster: string }[]
  if (decisions.length >= jobIds.length) break
  process.stdout.write('.')
  await new Promise((r) => setTimeout(r, 15_000))
}
console.log('')

/*
  An empty roster is not "nobody" — it is Claire.

  `handlers/instruction.ts` resolves the speaker as `roster[0] ?? 'chief-of-staff'`,
  so the office's answer to a request no specialist claims is the Chief of Staff,
  and `routing_decisions.roster` records her. Comparing the raw arrays reported a
  disagreement on the first run (offline=[] live=[chief-of-staff]) that was
  entirely this harness failing to speak the product's vocabulary. Normalise both
  sides through the same rule the product uses, and keep the full roster rather
  than only the speaker so a difference in BREADTH still shows up.
*/
const speaks = (roster: readonly string[]): string =>
  (roster.length === 0 ? ['chief-of-staff'] : [...roster]).sort().join(',')

let agreed = 0
for (const [i, c] of sample.entries()) {
  const offline = results.find((r) => r.ask === c.ask)
  const live = decisions.find((d) => d.job_id === jobIds[i])
  const liveRoster = speaks((live?.roster ?? '').split(',').filter(Boolean))
  const offlineRoster = speaks([...(offline?.chosen ?? [])])
  if (liveRoster === offlineRoster) agreed++
  console.log(
    `       "${c.ask.slice(0, 44)}…"  offline=[${offlineRoster || 'nobody'}] live=[${liveRoster || 'nobody'}]`,
  )
}
ok(
  'the offline harness agrees with the canonical path, so its numbers describe the real product',
  agreed === sample.length && decisions.length === jobIds.length,
  `${String(agreed)}/${String(sample.length)} agreed, ${String(decisions.length)}/${String(jobIds.length)} routed`,
)

await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:routing-breadth sample, cancelled in teardown'
   where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}])
     and state not in ('complete','cancelled','failed','committing','committed','notifying')`)
await db.execute(
  `delete from public.inbound_commands where actor = ${lit(ACTOR)} and job_id is null`,
)
await db.execute(
  `update public.projects set status = 'archived' where project_id = ${lit(String(project))}::uuid`,
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)

/*
  The misses, printed in full, because they are the deliverable. A count says
  routing is 71%; this says WHICH concepts it cannot reach, which is the only
  form the finding can be acted on in.
*/
const missed = [...fellBack, ...wrong]
if (missed.length > 0) {
  console.log(`\n${String(missed.length)} case(s) did not reach their specialist:\n`)
  for (const m of missed) {
    console.log(
      `  [${m.form}] wanted ${m.wants}, got ${m.chosen.length === 0 ? 'Claire' : m.chosen.join(',')}` +
        ` — "${m.ask.slice(0, 60)}"`,
    )
  }
}
if (fail > 0) process.exit(1)
