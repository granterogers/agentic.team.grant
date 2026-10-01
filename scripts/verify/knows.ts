/**
 * An agent knows what it can do, and cannot deny a capability it has.
 *
 *   npm run verify:knows
 *
 * Issue #64. Claire, on Telegram, to Grant:
 *
 *   > *"I cannot add interactive Telegram buttons; I only generate plain text.
 *   > My replies stay limited to text…"*
 *
 * False when she said it. §12's six buttons had been built for months and the
 * pager was rendering them; since #59 every Telegram message carries 👍/👎 by
 * default. He was told no about something the office does automatically, and
 * reasonably went and asked for a feature he already had.
 *
 * ## Why it happened, which decides what to check
 *
 * The model was asked about ITSELF and answered from what a language model is
 * — a text generator. Right about the model, wrong about the system it is part
 * of. Nothing put the office's own facts in front of it, and nothing stopped
 * the answer going out.
 *
 * So there are two mechanisms and both need a check:
 *
 *   1. `capabilityBrief` — the truth, in the prompt, derived rather than
 *      hand-written, because a hand-written list is wrong within a month.
 *   2. `contradictsReality` — the net under it, because a prompt is a request
 *      and not a guarantee, and a free model on a bad day will still deny
 *      something it can do.
 *
 * The second is what this suite spends most of its checks on. It is asserted
 * against **the exact sentence Grant was given**, and against the shapes it
 * must NOT fire on — a net that catches everything is a net that gets removed.
 */

import {
  type Capability,
  capabilityBrief,
  capabilityNow,
  contradictsReality,
} from '../../src/agents/capability.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { personOffice } from '../test-office.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

console.log('\nverify:knows\n')

// ===========================================================================
console.log('the sentence Grant was actually given')

/*
  Verbatim from the Issue. If only one assertion in this file survives, this is
  the one: it is the failure, in his words, and it must never pass again.
*/
const HERS =
  'I cannot add interactive Telegram buttons; I only generate plain text. ' +
  'My replies stay limited to text…'

check(
  "Claire's own sentence is caught",
  contradictsReality(HERS, []) ?? 'NOT CAUGHT',
  contradictsReality(HERS, []) === 'Telegram buttons',
)

/*
  And the ways of saying the same thing that a model reaches for on a different
  day. A guard tuned to one string is a guard that works once.
*/
for (const wording of [
  'Sorry, I cannot send buttons.',
  "I'm unable to add inline buttons to my messages.",
  'I only produce plain text, so no buttons.',
  'My replies are limited to text.',
  'I can not attach interactive buttons here.',
  "I don't send buttons — just text.",
]) {
  check(
    `and the same claim worded differently: "${wording.slice(0, 44)}"`,
    contradictsReality(wording, []) ?? 'NOT CAUGHT',
    contradictsReality(wording, []) === 'Telegram buttons',
  )
}

// ===========================================================================
console.log('\nand it does not fire on true sentences')

/*
  The half that decides whether this guard survives contact.

  A net that also catches honest sentences makes every reply suspect, somebody
  loosens it, and the original bug comes back. Each of these is a thing an
  agent SHOULD be able to say.
*/
for (const fine of [
  'I could not find anything about that in Notion.',
  'The buttons below will let you approve or decline.',
  'I have sent that with Go ahead and Not now buttons.',
  'That will take some text from the transcript.',
  'I cannot do that until you approve the spend.',
  'There is no text in that document yet.',
]) {
  check(
    `a true sentence passes: "${fine.slice(0, 46)}"`,
    contradictsReality(fine, []) ?? 'passed',
    contradictsReality(fine, []) === null,
  )
}

// ===========================================================================
console.log('\ndenying a service that is actually reachable')

const person = await personOffice(db)
const cap: Capability = await capabilityNow(db, person, 'chief-of-staff')
const reachable = cap.reach.filter((r) => r.reachable)
check(
  'CONTROL: something is actually reachable, so the checks below are not vacuous',
  reachable.map((r) => r.service).join(', ') || 'nothing is reachable',
  reachable.length > 0,
)

const service = reachable[0]?.service ?? ''
if (service !== '') {
  check(
    `denying a reachable service is caught: ${service}`,
    contradictsReality(`I do not have access to ${service}, sorry.`, cap.reach) ?? 'NOT CAUGHT',
    contradictsReality(`I do not have access to ${service}, sorry.`, cap.reach) === service,
  )
  /*
    And the sentence one word away from it, which is TRUE and common: a search
    that found nothing is not a claim about access. Getting this wrong is how
    the guard starts rewriting honest answers.
  */
  check(
    'but "I searched it and found nothing" is not a denial',
    contradictsReality(`I looked in ${service} and could not find anything.`, cap.reach) ??
      'passed',
    contradictsReality(`I looked in ${service} and could not find anything.`, cap.reach) === null,
  )
}

// ===========================================================================
console.log('\nthe sheet in the prompt is derived, and says the true thing')

const brief = capabilityBrief(cap)
check('the brief is generated, not empty', `${String(brief.length)} characters`, brief.length > 80)
check(
  'and it states the button fact that was denied',
  /button/i.test(brief) ? 'buttons are named' : 'BUTTONS ARE NOT MENTIONED',
  /button/i.test(brief),
)
check(
  'and tells the agent never to claim it is text-only',
  /plain text/i.test(brief) ? 'the denial is pre-empted' : 'not pre-empted',
  /plain text/i.test(brief),
)

// ===========================================================================
console.log('\nand every agent gets one, not just Claire')

const roster = (
  await db.execute(`select slug from public.staff where active and permanent order by slug`)
).rows.map((r) => String(r.slug))

let thin = 0
for (const slug of roster) {
  const theirs = capabilityBrief(await capabilityNow(db, person, slug))
  if (!/button/i.test(theirs)) thin += 1
}
check(
  'every permanent agent is told about the buttons',
  `${String(roster.length - thin)} of ${String(roster.length)}: ${roster.join(', ')}`,
  thin === 0,
)

// ===========================================================================
console.log('\nwhat the office says NotebookLM can do')

/*
  #64's third box. `notebook_capability` reported `list_notebooks,
  account_limits, list_sources` while `scripts/notebook/act.py` creates
  notebooks, adds sources and generates artifacts — so an agent consulting it
  would tell Grant it cannot create a notebook, which is what happened in the
  same conversation as the buttons.
*/
const probe = (await db.execute('select capabilities, probed_at from public.notebook_capability'))
  .rows[0] as { capabilities?: string[]; probed_at?: string } | undefined
const caps = probe?.capabilities ?? []
const writes = caps.filter((c) => c.startsWith('offers_'))
check(
  'the capability list names the writes, not only the reads',
  caps.join(', ') || 'no probe on record',
  writes.length > 0,
)
if (writes.length === 0) {
  console.log(
    '        the probe has not re-run since the change — run `npm run notebook:probe`.\n' +
      `        last probed ${String(probe?.probed_at ?? 'never')}.`,
  )
}

// ===========================================================================
console.log('\nand a tool the office cannot perform is not offered')

/*
  #50 and #51, found while closing #64 and the same bug one layer down.

  `tool_permissions` listed `web.search`, level 0, ENABLED — and nothing in the
  repository implements it. `capabilityBrief` builds every agent's sheet from
  this table, so all eight were being told in their prompts that they could
  search the web. Asked to research something, the honest answer is "I can look
  through what we hold" and the answer they would give is "I'll search".

  That is #64 with the sign reversed, and reversed is worse: being told NO
  about something possible costs a feature request, being told YES about
  something impossible costs the work, silently.

  0298 added `delivered_by` so the claim is checkable rather than assertable,
  with a constraint behind it. This asserts the property the constraint
  protects, because a constraint can be dropped by the next migration that
  finds it inconvenient.
*/
const claimed = (
  await db.execute(`
    select tool, enabled, delivered_by, coalesce(disabled_reason, '') as why
      from public.tool_permissions order by tool
  `)
).rows as { tool: string; enabled: boolean; delivered_by: string; why: string }[]

const hollow = claimed.filter((t) => t.enabled && t.delivered_by.trim() === '')
check(
  'every enabled tool names what actually performs it',
  hollow.length === 0
    ? `${String(claimed.filter((t) => t.enabled).length)} enabled, all delivered`
    : `CLAIMED WITHOUT AN IMPLEMENTATION: ${hollow.map((t) => t.tool).join(', ')}`,
  hollow.length === 0,
)

/*
  And the specific one, by name. A general invariant passes the day somebody
  writes `delivered_by = 'the office'` on a row that does nothing, so the case
  that was actually wrong is pinned separately.
*/
const web = claimed.find((t) => t.tool === 'web.search')
check(
  'web.search is off, and says why rather than vanishing',
  web === undefined
    ? 'the row is gone'
    : `enabled=${String(web.enabled)} — ${web.why.slice(0, 70)}`,
  web !== undefined && !web.enabled && web.why.length > 20,
)

/*
  It moves from CAN to CANNOT — it does not disappear.

  The first version of this check asserted the string `web.search` never
  appears in the sheet at all, and failed against correct code. Being told
  "you cannot search the web, and here is why" is exactly what #64 asks for:
  the rule is that an agent must not claim it CAN do something it cannot, and
  a stated limitation with a reason is the honest opposite of that. A sheet
  that simply omitted the tool would leave the agent guessing again.

  Disabled and not deleted for the same reason one level up: a listed gap can
  become a proposal (#49), a deleted one cannot.
*/
const emma = await capabilityNow(db, person, 'research-director')
check(
  'no agent is told it CAN search the web',
  emma.can.some((c) => c.tool === 'web.search') ? 'IT IS IN THE CAN LIST' : 'not in can',
  !emma.can.some((c) => c.tool === 'web.search'),
)
check(
  'and it is told it cannot, with the reason, rather than left to guess',
  emma.cannot.find((c) => c.tool === 'web.search')?.why.slice(0, 60) ?? 'NOT MENTIONED AT ALL',
  emma.cannot.some((c) => c.tool === 'web.search' && c.why.length > 20),
)

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
