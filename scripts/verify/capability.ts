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
// 4b. And Grant can answer, from the page, over HTTP (#272, ADR-0018)
// ===========================================================================

/*
  The layer this section exists for.

  `public.hq_approve_tool` and `public.hq_decline_tool` were written for the
  Governance page and had no caller outside `scripts/` for weeks --
  `check:callers` put both in its baseline the day it was built. So the office
  could ask Grant for reach and Grant had nowhere to answer: every one of the
  fourteen settled requests on record was settled by a script.

  Asserting the RPCs here would pass for the wrong reason, because the RPCs
  always worked. What was missing was a `requests` key on the governance
  payload and two actions on `hq-api`, so that is what is driven: the real
  endpoint, the real bearer token, the same POST the button makes.
*/

console.log('\nand Grant can answer a request for reach, from the page')

const ENDPOINT = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api`
const apiToken = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)

const post = async (
  action: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: string }> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  return { status: response.status, body: await response.text() }
}

/*
  Its OWN fixture tool, not the one above.

  By the time this section runs, `TOOL` has been switched off AND declined by
  section 3 -- `request_tool` answers a declined tool with "not in V1, ask
  again after launch" and raises nothing, so `askFor` came back empty and the
  next line asked Postgres to cast an empty string to a uuid. The suite was
  wrong, not the product, which is the direction this repository keeps having
  to relearn.
*/
/*
  TWO fixture tools of its own, one per verdict.

  Not one, and not the `TOOL` above. Two separate reasons, both found by
  running it:

    * by the time this section runs, `TOOL` has been switched off AND declined
      by section 3, and `request_tool` answers a declined tool with "not in V1,
      ask again after launch" rather than raising anything;
    * a decline is DURABLE, which is the whole of #49 — `decline_tool` sets a
      silence until three months out, so the same tool cannot be asked for
      again inside one run. Reusing it for the Approve check meant the second
      `request_tool` raised nothing and the suite died.

  The second is the product working. A test that needed it not to would have
  been a test arguing with a safety rule.
*/
const REACH = 'verification.reach'
const GRANT = 'verification.grant'
const REACH_TOOLS = [REACH, GRANT]
const cleanReach = async (): Promise<void> => {
  for (const t of REACH_TOOLS) {
    await db.execute(`delete from public.tool_requests where tool = ${lit(t)}`)
    await db.execute(`delete from public.staff_tools where tool = ${lit(t)}`)
    await db.execute(`delete from public.tool_permissions where tool = ${lit(t)}`)
  }
}
await cleanReach()
for (const t of REACH_TOOLS) {
  await db.execute(`
    insert into public.tool_permissions (tool, level, description, enabled, verbs, delivered_by)
    values (${lit(t)}, 1,
            'A fixture tool for the Approve and Decline buttons on the Governance page.',
            true, array['answer a request for reach'],
            'scripts/verify/capability.ts')
  `)
}

const askFor = async (tool: string): Promise<string> => {
  const said = String(
    (
      await db.execute(`
        select app.request_tool(${lit(tool)}, ${lit(WHO)},
          'Driving the page''s Approve button, in verify:capability.',
          '{"times": 3}'::jsonb, null)::text as v`)
    ).rows[0]?.v ?? '{}',
  )
  const parsed = JSON.parse(said) as { request_id?: string }
  if (parsed.request_id === undefined) {
    throw new Error(`request_tool raised nothing: ${said}`)
  }
  return parsed.request_id
}

if (apiToken === '') {
  check(
    'the page can answer a request for reach',
    'no hq.api_token in the vault — run `npm run deploy:hq` first',
    false,
  )
} else {
  // The read half: the payload the page renders has to carry the row.
  const open1 = await askFor(REACH)
  const seen = (
    await db.execute(`
      select coalesce((
        select jsonb_agg(r) from jsonb_array_elements(app.hq_governance(40) -> 'requests') r
         where r ->> 'id' = ${lit(open1)}
      ), '[]'::jsonb) ->> 0 as v`)
  ).rows[0] as { v: string | null }
  const row = seen.v === null ? null : (JSON.parse(seen.v) as Record<string, unknown>)
  check(
    'the governance payload carries the open request, with who asked and why',
    row === null
      ? 'the requests key did not contain it'
      : `${String(row.who_name)} wants ${String(row.tool)}, because ${JSON.stringify(row.because)}`,
    row !== null &&
      row.state === 'open' &&
      String(row.who_name ?? '') !== '' &&
      String(row.what_for ?? '') !== '',
  )

  // Declining, over HTTP, exactly as the button does.
  /*
    With a reason. `app.decline_tool` refuses one without -- "it is what makes
    it worth revisiting in three months" -- and the first draft of both this
    check and the page's button sent none. The page asks for the sentence now;
    this sends one the same way.
  */
  const declined = await post('decline_tool', {
    p_request_id: open1,
    p_reason: 'Not while it is a fixture — verify:capability.',
  })
  const afterDecline = (
    await db.execute(
      `select state, declines from public.tool_requests where request_id = ${lit(open1)}::uuid`,
    )
  ).rows[0] as { state?: string; declines?: number } | undefined
  check(
    'Decline, over HTTP with the page bearer token, settles the request',
    `http ${String(declined.status)} — state ${String(afterDecline?.state)} — ${declined.body.slice(0, 160)}`,
    declined.status === 200 && afterDecline?.state === 'declined',
  )
  check(
    'and the tool is NOT granted by a decline',
    String(
      (
        await db.execute(
          `select count(*)::int as n from public.staff_tools
            where staff_slug = ${lit(WHO)} and tool = ${lit(REACH)}`,
        )
      ).rows[0]?.n,
    ),
    Number(
      (
        (
          await db.execute(
            `select count(*)::int as n from public.staff_tools
              where staff_slug = ${lit(WHO)} and tool = ${lit(REACH)}`,
          )
        ).rows[0] as { n: number }
      ).n,
    ) === 0,
  )

  // Approving, over HTTP. The press that actually hands out a key.
  const open2 = await askFor(GRANT)
  const approved = await post('approve_tool', { p_request_id: open2 })
  const held = Number(
    (
      (
        await db.execute(
          `select count(*)::int as n from public.staff_tools
            where staff_slug = ${lit(WHO)} and tool = ${lit(GRANT)}`,
        )
      ).rows[0] as { n: number }
    ).n,
  )
  check(
    'Approve, over HTTP, grants the tool to the person who asked',
    `http ${String(approved.status)} — ${String(held)} grant(s)`,
    approved.status === 200 && held === 1,
  )

  // And taking it back, which is the third wrapper in the same baseline.
  // REACH, not TOOL. The first draft passed TOOL here and cheerfully revoked
  // a grant on the other fixture tool while reporting this one unchanged --
  // which is why the assertion counts the grant rather than trusting http 200.
  const revoked = await post('revoke_tool', { p_slug: WHO, p_tool: GRANT })
  const stillHeld = Number(
    (
      (
        await db.execute(
          `select count(*)::int as n from public.staff_tools
            where staff_slug = ${lit(WHO)} and tool = ${lit(GRANT)}`,
        )
      ).rows[0] as { n: number }
    ).n,
  )
  check(
    'and Revoke takes it back',
    `http ${String(revoked.status)} — ${String(stillHeld)} grant(s) — ${revoked.body.slice(0, 160)}`,
    revoked.status === 200 && stillHeld === 0,
  )

  /*
    CONTROL. The three actions must be behind the token like every other write,
    and a suite that only ever sends a valid one cannot tell an endpoint that
    checks from an endpoint that does not.
  */
  const naked = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve_tool', args: { p_request_id: open2 } }),
  })
  check(
    'CONTROL: and an unauthenticated Approve is refused',
    `http ${String(naked.status)}`,
    naked.status === 401,
  )
}

// ===========================================================================
// 5. Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

let sweptSaid = ''
let sweptClean = false
try {
  await clean()
  await cleanReach()
  const left = (
    await db.execute(`
      select (select count(*) from public.tool_permissions where tool = ${lit(TOOL)})
           + (select count(*) from public.staff_tools where tool = ${lit(TOOL)})
           + (select count(*) from public.tool_requests where tool = ${lit(TOOL)})
           + (select count(*) from public.tool_permissions where tool in (${lit(REACH)}, ${lit(GRANT)}))
           + (select count(*) from public.staff_tools where tool in (${lit(REACH)}, ${lit(GRANT)}))
           + (select count(*) from public.tool_requests where tool in (${lit(REACH)}, ${lit(GRANT)})) as n
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
