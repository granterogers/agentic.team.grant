/**
 * Team HQ, against the deployed endpoint and the deployed page.
 *
 *   npm run verify:hq
 *
 * §25's acceptance is three claims, and two of them are the kind that is easy
 * to believe without checking:
 *
 *   - mobile-first interaction with desktop information density
 *   - **no raw JSON or token/debug detail in normal workflow**
 *   - **estimated quota clearly labelled as estimated**
 *
 * The second and third are checkable and are checked here, against the real
 * responses rather than against the source. The first is a judgement about how
 * it feels in a hand and is not something a script can assert — it is listed as
 * a known limitation rather than quietly claimed.
 *
 * The security checks are the reason this suite exists at all. A dashboard is
 * the one surface where a mistake is reachable from the internet.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabaseToken,
)

const ENDPOINT = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api`
const PAGE = 'https://ai-team-hq.vercel.app'

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
if (token === '') {
  console.error('no hq.api_token in the vault — run `npm run deploy:hq` first')
  process.exit(2)
}

const get = async (
  path: string,
  auth: string | null = token,
): Promise<{ status: number; body: string }> => {
  const response = await fetch(`${ENDPOINT}${path}`, {
    headers: auth === null ? {} : { Authorization: `Bearer ${auth}` },
  })
  return { status: response.status, body: await response.text() }
}

/** The write side, which the read helper cannot reach. */
const post = async (
  action: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: string }> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  return { status: response.status, body: await response.text() }
}

// ===========================================================================
// Who can read it
// ===========================================================================

const anonymous = await get('?section=overview', null)
record(
  'an unauthenticated read is refused',
  `http ${String(anonymous.status)}`,
  anonymous.status === 401,
)

const wrongToken = await get('?section=overview', 'not-the-token')
record(
  'a wrong token is refused, and says nothing about why',
  `http ${String(wrongToken.status)} body=${wrongToken.body.slice(0, 40)}`,
  wrongToken.status === 401 && !wrongToken.body.includes('section'),
)

const authorised = await get('?section=overview')
record(
  'the real token reads the overview',
  `http ${String(authorised.status)}`,
  authorised.status === 200,
)

// ===========================================================================
// What it will and will not serve
// ===========================================================================

const invented = await get('?section=jobs')
record(
  'a section that does not exist is refused rather than guessed at',
  `http ${String(invented.status)}`,
  invented.status === 400,
)

// The check that matters most. The browser names a SECTION, never a query — so
// anything that looks like an attempt to name something else must do nothing.
const injections = [
  '?section=overview;drop table jobs',
  '?section=../staff',
  "?section=overview' or '1'='1",
  '?section=pg_catalog.pg_tables',
]
const injectionResults: string[] = []
for (const attempt of injections) {
  const r = await get(attempt)
  injectionResults.push(String(r.status))
}
record(
  'a section name that tries to be a query is just an unknown section',
  `statuses: ${injectionResults.join(', ')}`,
  injectionResults.every((s) => s === '400'),
)

// ===========================================================================
// §25: no token or debug detail
// ===========================================================================

const sections = ['overview', 'staff', 'usage', 'activity', 'series']
const bodies: Record<string, string> = {}
for (const section of sections) {
  const r = await get(`?section=${section}`)
  bodies[section] = r.body
}

// `usable_models` and `credential_health` both carry `secret_ref`, and the
// projections in 0045 list columns explicitly so it cannot travel. This is the
// check that the explicitness is still true.
const leaked = Object.entries(bodies).filter(([, body]) => body.includes('secret_ref'))
record(
  'no response carries a secret reference, though two source views have one',
  leaked.length === 0 ? 'none of the four' : `LEAKED in ${leaked.map(([s]) => s).join(', ')}`,
  leaked.length === 0,
)

const SHAPES = [
  /xox[abposr]-/,
  /sb_secret_/,
  /\bsbp_[a-f0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\./,
  /\bAIza[A-Za-z0-9_-]{30,}/,
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/,
]
const shaped = Object.entries(bodies).filter(([, body]) => SHAPES.some((p) => p.test(body)))
record(
  'and nothing token-shaped appears in any of them',
  shaped.length === 0 ? 'clean' : `SUSPECT in ${shaped.map(([s]) => s).join(', ')}`,
  shaped.length === 0,
)

const upstreamDetail = await get('?section=activity')
record(
  'CONTROL: the sections do return real data, so the checks above are not passing on empty bodies',
  `${sections.map((s) => `${s}=${String(bodies[s]?.length ?? 0)}b`).join(' ')}`,
  sections.every((s) => (bodies[s]?.length ?? 0) > 40) && upstreamDetail.status === 200,
)

// ===========================================================================
// §11 and §25: estimated is labelled as estimated
// ===========================================================================

const usage = JSON.parse(bodies.usage ?? '{}') as {
  data?: Record<string, { provenance?: string; note?: string }>
}
const notebook = usage.data?.notebook
record(
  "Notebook's figures are labelled ESTIMATED, because it publishes no counters",
  `provenance=${String(notebook?.provenance)}`,
  notebook?.provenance === 'estimated',
)
record(
  'and the label carries a reason, not just a word',
  String(notebook?.note ?? '').slice(0, 60),
  String(notebook?.note ?? '').length > 20,
)

const measured = ['inference', 'tts', 'queue'].map((k) => usage.data?.[k]?.provenance)
record(
  'CONTROL: the figures we DO measure are labelled measured, so the label discriminates',
  `inference/tts/queue = ${measured.join(', ')}`,
  measured.every((p) => p === 'measured'),
)

/*
  The served page, and the modules it is made of (#68, ADR-0019).

  Until today the root served one self-contained HTML file, so every assertion
  below could be made against `html`. The studio is a shell plus thirty modules:
  its markup is generated at runtime, so grepping the served HTML for a rendered
  badge now finds nothing and would report nine failures about a page that is
  working perfectly.

  So the source assertions read what the page is MADE of, fetched from the same
  deployment rather than off disk — a file that is in the repository and not in
  the build is exactly the gap that produced #68. What the page renders is
  `verify:ui`'s job, in a real browser, at three sizes.
*/
const page = await fetch(PAGE)
const html = await page.text()
const sourceOf = async (file: string): Promise<string> => {
  const r = await fetch(`${PAGE}/${file}`)
  return r.ok ? await r.text() : ''
}
const [appJs, usageJs, studioCss] = await Promise.all([
  sourceOf('app.js'),
  sourceOf('usage.js'),
  sourceOf('studio.css'),
])
const source = `${appJs}\n${usageJs}\n${studioCss}`
record(
  'the page serves as HTML rather than as an auth wall or a text file',
  `http ${String(page.status)} ${String(page.headers.get('content-type'))} ${String(html.length)} bytes`,
  page.status === 200 &&
    (page.headers.get('content-type') ?? '').includes('text/html') &&
    html.includes('Team HQ'),
)
record(
  'and the estimated label is carried, not dropped on the floor',
  /estimate/i.test(usageJs) ? 'the usage cards carry provenance' : 'PROVENANCE MISSING',
  /estimate/i.test(usageJs),
)
record(
  'the page ships no token of its own — it asks for one and keeps it on the device',
  SHAPES.some((p) => p.test(html) || p.test(source))
    ? 'SOMETHING TOKEN-SHAPED IS IN THE PAGE'
    : 'clean',
  // The modules too, not just the shell: a credential baked into app.js is
  // served just as publicly as one in the HTML, and this check exists because
  // a token in a page is a token in everybody's browser.
  !SHAPES.some((p) => p.test(html) || p.test(source)) && source.includes('localStorage'),
)

// ===========================================================================
// The charts
// ===========================================================================

const series = JSON.parse(bodies.series ?? '{}') as {
  data?: { timezone?: string; days?: number; jobs_completed?: [string, number][] }
}
const days = series.data?.jobs_completed ?? []
record(
  'the daily series is DENSE — a quiet day is a zero, not a missing point',
  `${String(days.length)} points for ${String(series.data?.days)} days`,
  days.length === series.data?.days,
)
record(
  "and it is counted in Grant's timezone, because a chart of days has to agree about where a day ends",
  `timezone=${String(series.data?.timezone)}`,
  series.data?.timezone === 'Europe/Athens',
)

/*
  What was here, and why most of it is not any more.

  Eight assertions used to grep the served HTML for the old page's markup: its
  sparkline's non-scaling stroke, its crosshair, its `hq.layout` key, and a rule
  that the stylesheet must contain NO max-width query because that page was
  written mobile-first with min-width additions.

  They were good checks about a page that no longer exists, and three things are
  true of them now:

  1. **The studio's markup is generated at runtime.** Grepping the served shell
     for a rendered element finds nothing whether the page works or not — a
     check that cannot fail for the right reason.
  2. **Two of them encoded the OLD page's decisions, not the product's.** The
     studio deliberately uses `@media (pointer: coarse)` and max-width blocks
     placed at the END of the stylesheet; CLAUDE.md records that as its rule,
     learned after phone overrides were silently lost to source order twice.
     Asserting the opposite would fail a correct page.
  3. **The rest is covered better elsewhere.** `verify:ui` drives a real browser
     at three sizes and enforces the 12px type floor, the 44px touch floor and
     horizontal overflow on nineteen screens — sixty assertions against what is
     actually painted. `verify:design` counts the motion, depth and transparency
     primitives in what the deployment serves.

  What survives is the part neither of those can see: that the deployment serves
  the modules at all, and that the shell declares a mobile viewport.
*/
record(
  'the modules the page is built from are actually served',
  `app.js ${String(appJs.length)}b · usage.js ${String(usageJs.length)}b · studio.css ${String(studioCss.length)}b`,
  appJs.length > 10_000 && usageJs.length > 1_000 && studioCss.length > 10_000,
)
record(
  'the usage figures carry a hedge where the number is our own count',
  /google publishes no|our own count|estimate/i.test(usageJs)
    ? 'the caveat travels with the number'
    : 'HEDGE MISSING',
  /google publishes no|our own count|estimate/i.test(usageJs),
)
record(
  'a screen a person can be on is described for a screen reader',
  /aria-label=/.test(appJs) ? 'aria-labels present' : 'NOT DESCRIBED',
  /aria-label=/.test(appJs),
)
record(
  'what a person rearranges is remembered on their own device',
  /localStorage/.test(appJs) && /studio\./.test(appJs) ? 'localStorage' : 'MISSING',
  /localStorage/.test(appJs) && /studio\./.test(appJs),
)

// ===========================================================================
// Mobile, as far as a script can tell
// ===========================================================================

record(
  'the page declares a mobile viewport and respects the notch',
  html.includes('width=device-width') && html.includes('viewport-fit=cover')
    ? 'viewport + safe-area'
    : 'MISSING',
  html.includes('width=device-width') && html.includes('viewport-fit=cover'),
)
record(
  'the touch floor is declared, not left to the default',
  /min-height:\s*44px/.test(studioCss) ? 'declared at 44px' : 'NOT DECLARED',
  /min-height:\s*44px/.test(studioCss),
)
record(
  'and the phone rules are the LAST thing in the stylesheet',
  // CLAUDE.md, twice earned: a media query adds no specificity, so a phone
  // override written above the base rule it overrides is silently lost to
  // source order. Where it sits is the whole of whether it works.
  studioCss.lastIndexOf('pointer: coarse') > studioCss.length * 0.8
    ? 'the coarse-pointer block is at the end'
    : 'PHONE RULES ARE NOT LAST',
  studioCss.lastIndexOf('pointer: coarse') > studioCss.length * 0.8,
)

// ===========================================================================
// The connections view
// ===========================================================================
//
// Grant asked for a light per service. The claim worth checking is not that the
// section returns JSON, but that the lights are HONEST: every row carries when
// it was last probed, and a row nobody probed is not green.

const connResponse = await get('?section=connections')
const connData = (JSON.parse(connResponse.body) as { data?: { rows?: Record<string, unknown>[] } })
  .data
const connRows = connData?.rows ?? []

record(
  'the connections section returns a row per service',
  `http ${String(connResponse.status)}, ${String(connRows.length)} row(s)`,
  connResponse.status === 200 && connRows.length >= 5,
)

record(
  'every row carries its age, so a light cannot silently go stale',
  connRows.every((r) => typeof r.age_minutes === 'number')
    ? 'all rows have age_minutes'
    : 'a row has no age',
  connRows.length > 0 && connRows.every((r) => typeof r.age_minutes === 'number'),
)

// The defect this check exists for: the page said "Backblaze · Working" in
// green on a status no program has ever verified. `ok` must mean a probe
// answered; anything a human merely asserted is `attested`.
const greenWithoutAProbe = connRows.filter(
  (r) => r.state === 'ok' && String(r.detail) === 'not machine-checkable',
)
record(
  'nothing claims a probed "ok" that was never probed',
  greenWithoutAProbe.length === 0
    ? 'none'
    : `GREEN WITHOUT A PROBE: ${greenWithoutAProbe.map((r) => String(r.service)).join(', ')}`,
  greenWithoutAProbe.length === 0,
)

// Problems first: a list sorted alphabetically buries the one row that matters
// between two healthy ones.
const stateOrder = ['dead', 'missing', 'unknown', 'ok', 'attested', 'parked']
const ranks = connRows.map((r) => stateOrder.indexOf(String(r.state)))
record(
  'problems are ordered first, not buried alphabetically',
  connRows
    .map((r) => String(r.state))
    .join(', ')
    .slice(0, 70),
  ranks.every((v, i) => i === 0 || (ranks[i - 1] ?? 0) <= v),
)

// §25 again, on a surface a browser reads.
const connLeaks = ['xoxb-', 'xoxe-', 'sbp_', 'ntn_', 'AIza'].filter((n) =>
  connResponse.body.includes(n),
)
record(
  'the connections payload carries no credential (§25)',
  connLeaks.length === 0 ? 'clean' : `LEAKED: ${connLeaks.join(', ')}`,
  connLeaks.length === 0,
)

// ===========================================================================
// Per-person tool grants: the global table stays the ceiling (§11)
// ===========================================================================

const teamBody = await get('?section=team')
const team = (JSON.parse(teamBody.body || '{}') as { data?: { staff?: Record<string, unknown>[] } })
  .data
const ruby = (team?.staff ?? []).find((p) => p.slug === 'growth-director') as
  | {
      tools?: { tool: string; granted: boolean; available: boolean; unavailable_because?: string }[]
      skills?: string[]
    }
  | undefined

record(
  'the team payload carries skills and tools, so the page makes one call and not nine',
  `${String(ruby?.skills?.length ?? 0)} skill(s), ${String(ruby?.tools?.length ?? 0)} tool(s)`,
  (ruby?.tools?.length ?? 0) > 0 && Array.isArray(ruby?.skills),
)

// The ungranted rows have to travel too. A permission screen that lists only
// what is granted cannot be used to grant anything.
const blocked = ruby?.tools?.find((t) => t.tool === 'gmail.send')
record(
  'a tool switched off for everyone is still listed, with the reason',
  `available=${String(blocked?.available)} reason=${String(blocked?.unavailable_because ?? '').slice(0, 30)}…`,
  blocked !== undefined &&
    blocked.available === false &&
    String(blocked.unavailable_because ?? '').length > 20,
)

// The check that matters. A per-staff grant must not be a second place that
// can say yes: `gmail.send` is disabled by policy and granting it here has to
// be REFUSED, not accepted and quietly ignored.
const widen = await post('staff_tool_set', {
  p_slug: 'growth-director',
  p_tool: 'gmail.send',
  p_granted: true,
})
const widenSaid = String(widen.body)
record(
  'granting a globally disabled tool is refused, not accepted and ignored',
  widenSaid.includes('switched off for everyone')
    ? 'refused, with the reason'
    : widenSaid.slice(0, 60),
  widenSaid.includes('switched off for everyone'),
)
const stillBlocked = String(
  (await db.execute(`select app.staff_may_use('growth-director', 'gmail.send')::text as v`)).rows[0]
    ?.v ?? 'x',
)
record(
  'and the permission function still says no afterwards',
  `staff_may_use = ${stillBlocked}`,
  stillBlocked === 'false',
)

// CONTROL: an enabled tool CAN be revoked and re-granted, so the refusal above
// is the policy working rather than the whole endpoint being broken.
await post('staff_tool_set', { p_slug: 'growth-director', p_tool: 'web.search', p_granted: false })
const revoked = String(
  (await db.execute(`select app.staff_may_use('growth-director', 'web.search')::text as v`)).rows[0]
    ?.v ?? 'x',
)
await post('staff_tool_set', { p_slug: 'growth-director', p_tool: 'web.search', p_granted: true })
const restored = String(
  (await db.execute(`select app.staff_may_use('growth-director', 'web.search')::text as v`)).rows[0]
    ?.v ?? 'x',
)
record(
  'CONTROL: an allowed tool revokes and re-grants, so the refusal above discriminates',
  `revoked=${revoked} restored=${restored}`,
  revoked === 'false' && restored === 'true',
)

// ===========================================================================
// Cost per outcome: measured and modelled must stay distinguishable (§11)
// ===========================================================================

const costResponse = await get('?section=cost')
const cost =
  (JSON.parse(costResponse.body || '{}') as { data?: Record<string, unknown> }).data ?? {}
record(
  'the cost section is served',
  `http ${String(costResponse.status)}`,
  costResponse.status === 200,
)

// The two figures are the whole point. A single "cost" number here would be
// either a measured figure inflated by prices nobody paid, or a modelled
// figure that hides real spend the day real spend starts — §11 exists to stop
// exactly that, and this is the check that the shape still honours it.
const totals = (cost.totals ?? {}) as Record<string, unknown>
record(
  'spend is reported twice: what was charged, and what it would have cost',
  `spent_usd=${String(totals.spent_usd)} modelled_usd=${String(totals.modelled_usd)}`,
  'spent_usd' in totals && 'modelled_usd' in totals,
)
record(
  'and each carries a sentence saying which it is, on the page not in a footnote',
  `${String(cost.measured_note ?? '').slice(0, 40)}…`,
  String(cost.measured_note ?? '').length > 40 && String(cost.modelled_note ?? '').length > 40,
)

// The honesty column. Until the router started writing `inference_usage.job_id`
// this read 28%, and a page that divided by the jobs it happened to know about
// would have reported a cost far too low while looking perfectly healthy.
const coverage = (cost.coverage ?? {}) as Record<string, unknown>
record(
  'the page says what share of model calls it could attribute at all',
  `${String(coverage.attributed_pct)}% of ${String(coverage.total_calls)} calls`,
  typeof coverage.attributed_pct === 'number' && typeof coverage.unattributed_calls === 'number',
)

const byKind = (cost.by_kind ?? []) as { kind?: string; modelled_usd_each?: unknown }[]
record(
  'CONTROL: there is real per-kind data behind it, so the checks above are not passing on an empty object',
  `${String(byKind.length)} kinds, e.g. ${String(byKind[0]?.kind ?? 'none')}`,
  byKind.length > 0 && byKind.every((k) => k.modelled_usd_each !== undefined),
)

// A price with no source is a number with a dollar sign in front of it.
const priceSources = String(
  (
    await db.execute(
      `select count(*) filter (where source_url is null or source_url = '')::int as bad,
              count(*)::int as total from public.model_prices`,
    )
  ).rows[0]?.bad ?? 'x',
)
record(
  'every modelled price says where it came from',
  priceSources === '0' ? 'all sourced' : `${priceSources} with no source`,
  priceSources === '0',
)

// ===========================================================================

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
console.log(
  '\nNOT checked, and not claimed: whether it actually FEELS right in a hand.\n' +
    "That is a judgement, and §13 says a judgement is Grant's to make, not a script's.",
)
if (failed.length > 0) process.exit(1)
