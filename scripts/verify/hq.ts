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

const sections = ['overview', 'staff', 'usage', 'activity']
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

// The page has to render the label, not merely receive it.
const page = await fetch(PAGE)
const html = await page.text()
record(
  'the page serves as HTML rather than as an auth wall or a text file',
  `http ${String(page.status)} ${String(page.headers.get('content-type'))} ${String(html.length)} bytes`,
  page.status === 200 &&
    (page.headers.get('content-type') ?? '').includes('text/html') &&
    html.includes('Team HQ'),
)
record(
  'and it renders the ESTIMATED badge rather than dropping the label on the floor',
  html.includes('ESTIMATED') ? 'badge present' : 'BADGE MISSING',
  html.includes('ESTIMATED'),
)
record(
  'the page ships no token of its own — it asks for one and keeps it on the device',
  SHAPES.some((p) => p.test(html)) ? 'SOMETHING TOKEN-SHAPED IS IN THE PAGE' : 'clean',
  !SHAPES.some((p) => p.test(html)) && html.includes('localStorage'),
)

// ===========================================================================
// Mobile-first, as far as a script can tell
// ===========================================================================

record(
  'the page declares a mobile viewport and respects the notch',
  html.includes('width=device-width') && html.includes('viewport-fit=cover')
    ? 'viewport + safe-area'
    : 'MISSING',
  html.includes('width=device-width') && html.includes('viewport-fit=cover'),
)
record(
  'touch targets are specified at 38px or more, which a phone needs and a mouse does not',
  /min-height:\s*(3[89]|[4-9]\d)px/.test(html) ? 'declared' : 'NOT DECLARED',
  /min-height:\s*(3[89]|[4-9]\d)px/.test(html),
)
const mobileFirst =
  html.includes('@media (min-width: 760px)') && !html.includes('@media (max-width')
record(
  'it is mobile-FIRST: the desktop rules are the additions, inside a min-width query',
  mobileFirst
    ? 'no max-width queries; desktop is the min-width block'
    : 'MAX-WIDTH QUERIES PRESENT',
  mobileFirst,
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
