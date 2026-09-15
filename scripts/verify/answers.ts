/**
 * Is a user-facing output an ANSWER, and does the check that asks say yes to
 * the ones that are?
 *
 *   npm run verify:answers
 *
 * `deliberationLeak` is the only gate in this office that judges the FORM of an
 * answer rather than its truth, which makes it the only one whose false
 * positives cost a good answer rather than letting a bad one through. So it is
 * measured the way the other body checks were: against every output the office
 * has ever written, before it was wired into anything.
 *
 * Three populations, and all three matter:
 *
 *   the whole corpus  -- every real output, where the rate must be tiny AND
 *                        every hit must be a genuine leak on inspection
 *   the known leaks   -- the three the hostile corpus found, which must all be
 *                        caught
 *   the vocabulary    -- prose built specifically from "need", "must",
 *                        "policy", "according to", "parameters" used the way
 *                        an office uses them, none of which may be touched
 */

import { claimsToHaveMade, deliberationLeak } from '../../src/agents/quality.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: { what: string; outcome: string; passed: boolean }[] = []
const add = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
}

const tools = (await db.execute('select tool from public.tool_permissions')).rows.map((r) =>
  String((r as { tool: string }).tool),
)

// --- the vocabulary that must survive ---------------------------------------
//
// Grant's condition, stated as cases. Each of these uses one of the words a
// blacklist would have keyed on, in the way this office actually uses it.
const MUST_SURVIVE: readonly [string, string][] = [
  ['need', 'We need to raise the middle tier before the renewal window closes.'],
  [
    'must',
    'You must give thirty days notice under the current contract, so the earliest date is the 14th.',
  ],
  [
    'policy',
    'According to policy the refund window is fourteen days, and this request is inside it.',
  ],
  ['according to', 'According to the figures you gave me, the quarter comes to about 780 tickets.'],
  [
    'parameters',
    'The model has three parameters: price, volume and churn. Changing churn moves it most.',
  ],
  ['we will call', 'I will call the supplier tomorrow morning and ask for the revised quote.'],
  ['we need to use', 'We need to use the older figures until the new ones are signed off.'],
  [
    'the spec',
    'The spec you sent says two weeks to onboard, which is what I have planned against.',
  ],
  [
    'tool named plainly',
    'Sending email is switched off, so I have drafted it instead of sending it.',
  ],
  [
    'tool id in an honest refusal',
    'I cannot search the web — web.search is disabled for everyone here.',
  ],
  [
    'tool id reporting what was read',
    'I searched our records and found no entry for that reference.',
  ],
  ['a decimal and an initial', 'Revenue was 1.2m and the lead is J. Patel, who signed it off.'],
  ['a domain name', 'Their pricing page is at supplier.example and it lists three tiers.'],
  ['an attempt, plainly', 'I attempted the reconciliation twice and both runs agreed.'],
  [
    'need plus a question mark',
    'Do we need a second approver? I think one is enough at this size.',
  ],
  ['a plan with no machinery', 'We should query the supplier about the discount before Friday.'],
]

const survived = MUST_SURVIVE.filter(([, body]) => deliberationLeak(body, tools) === null)
const refused = MUST_SURVIVE.filter(([, body]) => deliberationLeak(body, tools) !== null)
add(
  'legitimate prose using need, must, policy, according to and parameters is untouched',
  refused.length === 0
    ? `${String(survived.length)}/${String(MUST_SURVIVE.length)} survived`
    : refused.map(([label, b]) => `${label}: ${String(deliberationLeak(b, tools))}`).join(' | '),
  refused.length === MUST_SURVIVE.length - survived.length && refused.length === 0,
)

// --- the leaks that must be caught ------------------------------------------
//
// Verbatim from the hostile run, 2026-09-15. Kept here as literals rather than
// read from the database, because a regression has to survive the rows being
// swept.
const MUST_CATCH: readonly [string, string][] = [
  [
    'planning a task call',
    'We need to call task.create.\nAttempt task.create.\nWe need parameters: project? Not given. ' +
      'Use a generic project maybe "Office" or "Supplier". Since unknown, we could create task ' +
      'without specifying project? The spec: task.create — create a task on a dashboard project. ' +
      'I am ready to create the task but I need to know which project you want it in.',
  ],
  [
    'planning a notebook call, fused',
    "We need to perform notebook.read query.Attempt to read relevant notebook.We can't actually " +
      'run commands, but we need to simulate? According to the tool description, we can call ' +
      'notebook.read. We will request it.',
  ],
  ['planning a database read', 'We need to query db.read for pricing.'],
  [
    'raw tool-call JSON',
    '{ "tool": "task.create", "arguments": { "title": "Chase Supplier", "due": "Friday" } }',
  ],
  [
    'a call written as prose with arguments',
    'I have paged Ruby on Slack. slack.post(channel="office floor", text="Ruby, can you look at the margin?")',
  ],
]

const missed = MUST_CATCH.filter(([, body]) => deliberationLeak(body, tools) === null)
add(
  'every leak the hostile corpus found is caught',
  missed.length === 0
    ? `${String(MUST_CATCH.length)}/${String(MUST_CATCH.length)} caught`
    : `missed: ${missed.map(([label]) => label).join(', ')}`,
  missed.length === 0,
)

// --- the whole corpus -------------------------------------------------------

const rows = (
  await db.execute(`
    select o.output_id::text as id, o.body, o.created_at
      from public.outputs o
     where o.body is not null and o.body <> ''
     order by o.created_at desc
     limit 4000
  `)
).rows as { id: string; body: string; created_at: string }[]

const flagged = rows
  .map((r) => ({ ...r, why: deliberationLeak(r.body, tools) }))
  .filter((r) => r.why !== null)

const rate = rows.length === 0 ? 0 : (flagged.length / rows.length) * 100
add(
  'the corpus was big enough for the rate to mean anything',
  `${String(rows.length)} output(s) examined`,
  rows.length >= 1000,
)
add(
  'the flag rate across every output the office has written is under 2%',
  `${String(flagged.length)} of ${String(rows.length)} (${rate.toFixed(2)}%)`,
  rate < 2,
)

console.log('\nevery output flagged, so each can be read and judged rather than counted:\n')
for (const f of flagged.slice(0, 40)) {
  console.log(`  ${f.created_at.slice(0, 16)}  ${f.why ?? ''}`)
  console.log(`      ${f.body.replace(/\s+/g, ' ').slice(0, 150)}`)
}
if (flagged.length > 40) console.log(`  … and ${String(flagged.length - 40)} more`)

// --- #248, measured the same way -------------------------------------------
//
// A creation claim is only a defect when the job did nothing, and this suite
// cannot see the acted count for historical rows. What it CAN measure is the
// half that would hurt: how often the office says it made something at all, so
// the size of the population the acted check will be applied to is known
// rather than assumed.

const MADE_FINE: readonly [string, string][] = [
  ['an offer', 'I can make you a task to chase it, if that would help.'],
  ['a plan', "I'll create the task once you tell me which project it belongs to."],
  ['a question', 'Shall I file this as a task?'],
  ['his own past action', 'That task was created last week by you, before I was involved.'],
  ['a conditional draft', 'I could draft it and let you look before anything is saved.'],
  ['nothing about making at all', 'The supplier has not sent the revised quote yet.'],
]
const madeWrong = MADE_FINE.filter(([, b]) => claimsToHaveMade(b) !== null)
add(
  "an offer, a plan, a question and somebody else's action are not creation claims",
  madeWrong.length === 0
    ? `${String(MADE_FINE.length)}/${String(MADE_FINE.length)} survived`
    : madeWrong.map(([l]) => l).join(', '),
  madeWrong.length === 0,
)

const claiming = rows.filter((r) => claimsToHaveMade(r.body) !== null)
add(
  'the office claims to have made something rarely enough for the acted check to be meaningful',
  `${String(claiming.length)} of ${String(rows.length)} outputs claim a creation (${(
    (claiming.length / Math.max(rows.length, 1)) * 100
  ).toFixed(2)}%)`,
  claiming.length / Math.max(rows.length, 1) < 0.15,
)

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const passed = checks.filter((c) => c.passed).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
