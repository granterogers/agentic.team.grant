/**
 * The office knows what it can do, and says so per person.
 *
 *   npm run verify:capability
 *
 * Issue #148, the first slice of #170. Migrations 0277-0279.
 *
 * ## The sentence this exists because of
 *
 * #64. Claire, in Slack, while posting to Slack:
 *
 *   > *"I can't post to Slack or pull data from your Notion teamspace. I don't
 *   > have integration access and I can't see the notebook you mention."*
 *
 * Three claims, all false. `src/agents/capability.ts` was written for that and
 * it worked — but `verbsNow()` was a hand-written list in TypeScript covering
 * **three of the twenty-one tools**, so eighteen of them had no verb at all and
 * an agent asked about one answered from what a language model is rather than
 * from what this office is.
 *
 * ## What is worth asserting
 *
 *   1. **It is generated, not stored.** A capability index that can be stale is
 *      one that is believed while wrong, which is worse than none. Proved by
 *      changing the world and asking again in the same run.
 *   2. **It is per person.** `app.staff_may_use` has been per-staff since 0119.
 *      Telling an agent it can do something it may not is a promise the boundary
 *      will refuse.
 *   3. **Four answers, not one.** `can` / `must_ask` / `cannot` / `declined`
 *      need different replies: "I may not" and "nobody may" and "we already
 *      asked and were told no" are three different sentences.
 *   4. **Every tool has verbs.** The defect this whole slice is about.
 *   5. **The brief still catches #64.** The regression that matters most.
 *
 * ## Subjects
 *
 * A fixture tool of its own, so nothing here touches a real grant. Torn down,
 * and the teardown asserted — a teardown that matches nothing looks exactly
 * like one that worked.
 */

import { capabilityBrief, capabilityNow, contradictsReality } from '../../src/agents/capability.ts'
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

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const TOOL = 'verification.capability'
const WHO = 'growth-director'

const clean = async (): Promise<void> => {
  await db.execute(`delete from public.tool_requests where tool = ${lit(TOOL)}`)
  await db.execute(`delete from public.staff_tools where tool = ${lit(TOOL)}`)
  await db.execute(`delete from public.tool_permissions where tool = ${lit(TOOL)}`)
}
await clean()

// ===========================================================================
// 1. The real index, as it actually stands
// ===========================================================================

console.log('\nwhat the office can do, right now')

const office = await capabilityNow(db)
check(
  'the office reports what it can reach',
  office.reach.map((r) => `${r.service}${r.reachable ? '' : ' (no)'}`).join(', '),
  office.reach.length >= 4,
)

/*
  Once each.

  `connection_health` holds more than one row for Slack and for Telegram, and
  the surfaces branch never deduped — so **every capability brief the office has
  ever put in front of a model said "Slack, Slack, Telegram, Telegram"**. It was
  invisible because that paragraph goes straight into a prompt and nothing ever
  rendered it where a person would read it. 0279.
*/
const services = office.reach.map((r) => r.service)
const twice = services.filter((s, i) => services.indexOf(s) !== i)
check(
  'and names each service exactly once',
  twice.length === 0
    ? `${String(services.length)} services, no repeats`
    : `REPEATED: ${twice.join(', ')}`,
  twice.length === 0,
)

/*
  The defect this slice is about, asserted against the REAL rows rather than a
  fixture: a tool with no verbs cannot be described to an agent, cannot be
  proposed to Grant (#49), and is the reason #64's answer came from what a
  language model is.
*/
const verbless = (
  await db.execute(`
    select tool from public.tool_permissions
     where verbs is null or cardinality(verbs) = 0
     order by tool
  `)
).rows as { tool: string }[]
check(
  'every tool in the registry says what it can be made to do',
  verbless.length === 0
    ? `all ${String(office.can.length + office.cannot.length)} have verbs`
    : `NO VERBS: ${verbless.map((v) => v.tool).join(', ')}`,
  verbless.length === 0,
)

check(
  'and the disabled ones have verbs too, so a proposal can be specific',
  office.cannot.map((c) => c.tool).join(', '),
  office.cannot.length > 0 && office.cannot.every((c) => c.verbs.length > 0),
)

// ===========================================================================
// 2. Generated, not stored
// ===========================================================================

console.log('\nand it is worked out fresh, not remembered')

/*
  `delivered_by` is not decoration: 0298 added
  `tool_enabled_means_delivered`, which refuses an ENABLED row that names
  nothing to perform it. It exists because `web.search` sat in this table
  enabled with no implementation anywhere, and `capabilityBrief` builds every
  agent's prompt from these rows — so all eight were told they could search the
  web (#50). A fixture tool that claims to be enabled has to answer the same
  question every real one does, and the honest answer is the suite itself.
*/
await db.execute(`
  insert into public.tool_permissions (tool, level, description, enabled, verbs, delivered_by)
  values (${lit(TOOL)}, 1,
          'A fixture tool created by verify:capability, and removed by it.',
          true, array['do the fixture thing', 'and the other fixture thing'],
          'scripts/verify/capability.ts')
`)

const appeared = await capabilityNow(db)
check(
  'a tool added a moment ago is in the index already',
  appeared.can.some((a) => a.tool === TOOL) ? 'it is there' : 'IT IS NOT THERE',
  appeared.can.some((a) => a.tool === TOOL),
)

// ===========================================================================
// 3. Four answers, not one
// ===========================================================================

console.log('\nand it answers per person, four different ways')

/*
  0119 granted every agent every enabled tool, so a fixture tool nobody has been
  granted is the only way to observe `must_ask` at all. That is worth knowing:
  the distinction is real in the schema and currently empty in production.
*/
const ungranted = await capabilityNow(db, WHO)
check(
  'a tool the office holds and this person does not is MUST ASK, not CAN',
  ungranted.mustAsk.some((a) => a.tool === TOOL)
    ? 'it says to ask'
    : `it is in can=${String(ungranted.can.some((a) => a.tool === TOOL))}`,
  ungranted.mustAsk.some((a) => a.tool === TOOL) && !ungranted.can.some((a) => a.tool === TOOL),
)
check(
  'and the brief tells them to ask rather than to say it is impossible',
  capabilityBrief(ungranted).includes('ask for one rather than saying it is impossible')
    ? 'it does'
    : 'IT DOES NOT',
  capabilityBrief(ungranted).includes('ask for one rather than saying it is impossible'),
)

await db.execute(`
  insert into public.staff_tools (staff_slug, tool, granted_by, note)
  values (${lit(WHO)}, ${lit(TOOL)}, 'verify:capability', 'fixture grant')
`)
const granted = await capabilityNow(db, WHO)
check(
  'granting it moves it from must-ask to can, with its verbs',
  granted.can.find((a) => a.tool === TOOL)?.verbs.join(', ') ?? 'NOT IN CAN',
  granted.can.find((a) => a.tool === TOOL)?.verbs.includes('do the fixture thing') === true,
)
check(
  'and the brief now says the verb rather than only the tool name',
  capabilityBrief(granted).includes('do the fixture thing') ? 'it does' : 'IT DOES NOT',
  capabilityBrief(granted).includes('do the fixture thing'),
)

await db.execute(`
  update public.tool_permissions
     set enabled = false, disabled_reason = 'switched off by verify:capability'
   where tool = ${lit(TOOL)}
`)
const off = await capabilityNow(db, WHO)
check(
  'switching it off for everyone moves it to CANNOT, with the reason',
  off.cannot.find((a) => a.tool === TOOL)?.why ?? 'NOT IN CANNOT',
  off.cannot.find((a) => a.tool === TOOL)?.why === 'switched off by verify:capability',
)
check(
  'and it is no longer in can, even though the grant still exists',
  off.can.some((a) => a.tool === TOOL) ? 'STILL IN CAN' : 'gone from can',
  !off.can.some((a) => a.tool === TOOL),
)

/*
  A declined request. ADR-0018 makes a decline durable and specific, and an
  agent that cannot see one asks again next week — which is how a boundary turns
  into a nag.
*/
await db.execute(`
  insert into public.tool_requests
    (tool, asked_by, what_for, because, state, settled_at, decided_by, decline_reason)
  -- what_for has a 20-character floor: ADR-0018 refuses a request nobody
  -- could evaluate, and "a fixture purpose" is exactly that.
  values (${lit(TOOL)}, ${lit(WHO)}, 'a fixture purpose, long enough for the schema to accept it',
          -- The because column is jsonb, not text: ADR-0018 wanted the reasons
          -- a request was made to be structured rather than a paragraph, so a
          -- decline can answer a specific one. (Plain words, no backticks:
          -- inside a template literal one of those ends the string.)
          '{"why": "a fixture reason"}'::jsonb,
          'declined', app.now_utc(), 'grant', 'not in V1, ask again after launch')
`)
const refused = await capabilityNow(db, WHO)
check(
  'a refused request is remembered, with the reason',
  refused.declined.find((d) => d.tool === TOOL)?.why ?? 'NOT REMEMBERED',
  refused.declined.find((d) => d.tool === TOOL)?.why === 'not in V1, ask again after launch',
)
check(
  'and the brief says not to ask again',
  capabilityBrief(refused).includes('do not ask again') ? 'it does' : 'IT DOES NOT',
  capabilityBrief(refused).includes('do not ask again'),
)

// ===========================================================================
// 4. The regression that matters most
// ===========================================================================

console.log('\nand #64 still cannot happen')

const brief = capabilityBrief(office)
/*
  Every clause of Claire's sentence, checked against the paragraph she would be
  given today. Not "the brief is non-empty" — the specific services she denied.
*/
const SAID = [
  ['Slack', 'I can’t post to Slack'],
  ['Notion', 'pull data from your Notion teamspace'],
  ['Google NotebookLM', 'I can’t see the notebook you mention'],
] as const
const missing = SAID.filter(([service]) => !brief.includes(service))
check(
  'the brief names every service #64 denied',
  missing.length === 0
    ? SAID.map(([s]) => s).join(', ')
    : `NOT NAMED: ${missing.map(([s]) => s).join(', ')}`,
  missing.length === 0,
)
check(
  'and forbids the claim she made, by name',
  brief.includes('never say') && brief.includes('lack access') ? 'forbidden' : 'NOT FORBIDDEN',
  brief.includes('never say') && brief.includes('lack access'),
)
check(
  'and the guard still catches her exact words if it is said anyway',
  String(
    contradictsReality(
      "I can't post to Slack or pull data from your Notion teamspace. " +
        "I don't have integration access and I can't see the notebook you mention.",
      office.reach,
    ),
  ),
  contradictsReality(
    "I can't post to Slack or pull data from your Notion teamspace. " +
      "I don't have integration access and I can't see the notebook you mention.",
    office.reach,
  ) !== null,
)
/*
  And the one that names no service, so the scan above can never see it. It is
  the sentence that cost Grant a request for a feature he already had.
*/
check(
  'and the Telegram-buttons claim, which names no service at all',
  String(
    contradictsReality(
      'I cannot add interactive Telegram buttons; I only generate plain text.',
      office.reach,
    ),
  ),
  contradictsReality(
    'I cannot add interactive Telegram buttons; I only generate plain text.',
    office.reach,
  ) === 'Telegram buttons',
)

/*
  CONTROL. A guard that fires on everything is a guard people route around, and
  the honest sentence is the one this whole file exists to keep legal: our
  records holding nothing is hers to report; the wiring is not.
*/
check(
  'CONTROL: and it still allows the true sentence about an empty search',
  String(contradictsReality('I could not find anything about that in Notion.', office.reach)),
  contradictsReality('I could not find anything about that in Notion.', office.reach) === null,
)

// The brief has to fit in a prompt. It is prepended to every answer.
check(
  'and the whole brief is short enough to sit in front of every answer',
  `${String(brief.length)} characters`,
  brief.length > 400 && brief.length < 4_000,
)

// ===========================================================================
// 5. Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

let sweptSaid = ''
let sweptClean = false
try {
  await clean()
  const left = (
    await db.execute(`
      select (select count(*) from public.tool_permissions where tool = ${lit(TOOL)})
           + (select count(*) from public.staff_tools where tool = ${lit(TOOL)})
           + (select count(*) from public.tool_requests where tool = ${lit(TOOL)}) as n
    `)
  ).rows[0] as { n: number }
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} fixture row(s) left behind`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
check('the fixture tool and its grant are gone', sweptSaid, sweptClean)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
