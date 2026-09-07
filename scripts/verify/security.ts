/**
 * The public surface, probed as an attacker would (Phase 10).
 *
 *   npm run verify:security
 *
 * ## Why probe rather than read
 *
 * Four Edge Functions are on the open internet with `verify_jwt: false`,
 * because none of their callers can present a Supabase JWT — Slack signs
 * requests, Telegram sends a shared secret, the dashboard sends a bearer token.
 * Each therefore carries the whole of its own authentication, and reading the
 * source proves what the repository says rather than what is deployed.
 *
 * The gap between those two is not theoretical. A deploy can lag a commit, an
 * environment variable can be absent, and an absent secret is the shape of
 * every accidentally-public endpoint: the code that says `if (SECRET === '')
 * return unauthorized()` is exactly the code that is easy to leave out.
 *
 * So every check here is an unauthenticated HTTP request to the live URL, and
 * what it asserts is a refusal.
 *
 * ## The CONTROL problem, stated
 *
 * A suite of "this request was refused" passes perfectly against a URL that
 * does not exist. Every endpoint is therefore first proven to be THERE — its
 * health probe answers — before anything is asserted about what it rejects.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { computeSignature } from '../../src/slack/signature.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, supabase)
const base = `https://${ref}.supabase.co/functions/v1`

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const REFUSED = new Set([401, 403])

// ---------------------------------------------------------------------------
// 0. The endpoints exist. Without this every refusal below is vacuous.
// ---------------------------------------------------------------------------

// hq-api puts its liveness probe on `/health` rather than the root, because
// the root is the API and an unauthenticated GET there should be a 401.
for (const fn of ['slack-events', 'telegram-webhook', 'hq-api/health']) {
  const r = await fetch(`${base}/${fn}`, { method: 'GET' })
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
  record(
    `CONTROL: ${fn} is deployed and answering`,
    `http ${String(r.status)} ${JSON.stringify(body).slice(0, 80)}`,
    r.status === 200 && body.ok === true,
  )
}

// And each one says its own secret is configured. An endpoint that fails closed
// because it has no secret would pass every refusal check below while being
// completely broken — the two are indistinguishable from outside without this.
{
  const slack = (await (await fetch(`${base}/slack-events`)).json()) as {
    signing_secret_configured?: boolean
  }
  const telegram = (await (await fetch(`${base}/telegram-webhook`)).json()) as {
    secret_configured?: boolean
  }
  const hq = (await (await fetch(`${base}/hq-api/health`)).json()) as { token_configured?: boolean }
  record(
    'CONTROL: each endpoint has its secret, so a refusal means "wrong" and not "unconfigured"',
    `slack=${String(slack.signing_secret_configured)} telegram=${String(telegram.secret_configured)} hq=${String(hq.token_configured)}`,
    slack.signing_secret_configured === true &&
      telegram.secret_configured === true &&
      hq.token_configured === true,
  )
}

// ---------------------------------------------------------------------------
// 1. Slack: the signature is the whole of the authentication
// ---------------------------------------------------------------------------

const slackPost = async (
  headers: Record<string, string>,
  body = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'probe' } }),
): Promise<number> =>
  (
    await fetch(`${base}/slack-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
  ).status

record(
  'Slack: an unsigned POST is refused',
  `http ${String(await slackPost({}))}`,
  REFUSED.has(await slackPost({})),
)

const now = Math.floor(Date.now() / 1000)
record(
  'Slack: a forged signature is refused',
  `http ${String(
    await slackPost({
      'X-Slack-Signature': `v0=${'0'.repeat(64)}`,
      'X-Slack-Request-Timestamp': String(now),
    }),
  )}`,
  REFUSED.has(
    await slackPost({
      'X-Slack-Signature': `v0=${'0'.repeat(64)}`,
      'X-Slack-Request-Timestamp': String(now),
    }),
  ),
)

// A replay: a signature that WAS valid, six minutes ago. Signed with the real
// secret, so this is not "a wrong signature is refused" a second time — it is
// the skew window doing its job, and it is the only check here that needs the
// secret.
{
  const secret = String(
    (
      await db.execute(
        `select app.resolve_secret(signing_secret_ref) as s
           from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
      )
    ).rows[0]?.s ?? '',
  )
  if (secret === '') {
    record(
      'Slack: a genuinely-signed but stale request is refused',
      'SKIPPED: no signing secret',
      false,
    )
  } else {
    const stale = String(now - 6 * 60)
    const body = JSON.stringify({
      type: 'event_callback',
      event: { type: 'message', text: 'replay' },
    })
    const signature = await computeSignature(secret, stale, body)
    const status = (
      await fetch(`${base}/slack-events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Slack-Signature': signature,
          'X-Slack-Request-Timestamp': stale,
        },
        body,
      })
    ).status
    record(
      'Slack: a CORRECTLY signed request from six minutes ago is refused (replay window)',
      `http ${String(status)}`,
      REFUSED.has(status),
    )
  }
}

// ---------------------------------------------------------------------------
// 2. Telegram: the shared secret is the whole of the authentication
// ---------------------------------------------------------------------------

const telegramPost = async (headers: Record<string, string>): Promise<number> =>
  (
    await fetch(`${base}/telegram-webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: 1, date: now, chat: { id: 1, type: 'private' }, text: 'probe' },
      }),
    })
  ).status

record(
  'Telegram: a POST with no secret header is refused',
  `http ${String(await telegramPost({}))}`,
  REFUSED.has(await telegramPost({})),
)
record(
  'Telegram: a POST with the wrong secret is refused',
  `http ${String(await telegramPost({ 'X-Telegram-Bot-Api-Secret-Token': 'not-the-secret' }))}`,
  REFUSED.has(await telegramPost({ 'X-Telegram-Bot-Api-Secret-Token': 'not-the-secret' })),
)

// ---------------------------------------------------------------------------
// 3. Team HQ: the bearer token is a capability, and it is the only one
// ---------------------------------------------------------------------------

const hqGet = async (query: string, token?: string): Promise<Response> =>
  fetch(`${base}/hq-api?${query}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })

record(
  'Team HQ: no token is refused',
  `http ${String((await hqGet('section=overview')).status)}`,
  (await hqGet('section=overview')).status === 401,
)
record(
  'Team HQ: a wrong token is refused',
  `http ${String((await hqGet('section=overview', 'not-the-token')).status)}`,
  (await hqGet('section=overview', 'not-the-token')).status === 401,
)

{
  const token = String(
    (
      await db.execute(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    ).rows[0]?.v ?? '',
  )
  if (token === '') {
    record('Team HQ: the real token reads exactly the named sections', 'SKIPPED: no token', false)
  } else {
    const ok = await hqGet('section=overview', token)
    record(
      'CONTROL: the REAL token is accepted, so the refusals above are about the token',
      `http ${String(ok.status)}`,
      ok.status === 200,
    )

    // The fixed list, tested with the names that are not in it but are on every
    // object. `SECTIONS['constructor']` is truthy through the prototype chain,
    // and a bare `!== undefined` guard let three inherited names through to a
    // fetch of `/rpc/undefined` with the service key. Nothing leaked; the
    // endpoint's own comment was nonetheless untrue.
    for (const name of ['constructor', '__proto__', 'toString', 'no_such_section']) {
      const r = await hqGet(`section=${encodeURIComponent(name)}`, token)
      // 400 is our endpoint saying "not a section". 403 is Supabase's own WAF
      // refusing the request before it reaches any function at all — measured,
      // not assumed: a URL containing `__proto__` gets 403 from a function
      // slug that does not exist either. Both are refusals and the platform's
      // is the stronger one, so the check accepts either and says which.
      const who = r.status === 400 ? 'our endpoint' : 'the platform, before our code'
      record(
        `Team HQ: section "${name}" is not a section`,
        `http ${String(r.status)} (${who})`,
        r.status === 400 || r.status === 403,
      )
    }

    // §25: no token, no secret ref, no raw debug detail in a browser response.
    const body = await (await hqGet('section=overview', token)).text()
    const leaks = ['xox', 'sbp_', 'ntn_', 'secret_ref', 'service_role', 'eyJ'].filter((needle) =>
      body.includes(needle),
    )
    record(
      'Team HQ: the response carries no credential, secret reference or JWT (§25)',
      leaks.length === 0 ? 'clean' : `LEAKED: ${leaks.join(', ')}`,
      leaks.length === 0,
    )
  }
}

// ---------------------------------------------------------------------------
// 4. The database is not reachable from a browser
// ---------------------------------------------------------------------------

// The anon key exists and PostgREST is on. What must be true is that it can
// read nothing: the RLS in this database is written for `ai_team_app`, a server
// role, and every table is FORCE-enabled. An anonymous select returning rows
// would mean a table was created without a policy.
{
  // The anon key is fetched from the Management API rather than read from the
  // environment. It was skipped for want of an env var, and a skipped check is
  // a check that proves nothing — this one is the difference between "RLS is
  // written" and "RLS holds against the key any visitor to the dashboard could
  // extract from the page".
  const keys = (await (
    await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
      headers: { Authorization: `Bearer ${String(supabase)}` },
    })
  ).json()) as { name?: string; api_key?: string }[]
  const anon = keys.find((k) => k.name === 'anon')?.api_key ?? ''

  if (anon === '') {
    record(
      'PostgREST: an anonymous caller reads no rows',
      'FAILED: could not obtain the anon key',
      false,
    )
  } else {
    const readable: string[] = []
    const probed = [
      'jobs',
      'outputs',
      'documents',
      'staff',
      'projects',
      'slack_app_credentials',
      'telegram_bots',
      'subject_identities',
      'inbound_commands',
      'deliveries',
      'knowledge_connectors',
    ]
    for (const table of probed) {
      const r = await fetch(`https://${ref}.supabase.co/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      })
      const rows = (await r.json().catch(() => [])) as unknown
      if (r.ok && Array.isArray(rows) && rows.length > 0) readable.push(table)
    }
    record(
      `PostgREST: the anon key reads no rows from any of ${String(probed.length)} tables`,
      readable.length === 0 ? 'nothing readable' : `READABLE: ${readable.join(', ')}`,
      readable.length === 0,
    )

    // The CONTROL for that: the same request with the service key DOES return
    // rows. Without it, "nothing readable" would pass equally against a wrong
    // hostname, a typo in every table name, or PostgREST being switched off.
    const service = keys.find((k) => k.name === 'service_role')?.api_key ?? ''
    const withService = await fetch(
      `https://${ref}.supabase.co/rest/v1/staff?select=slug&limit=1`,
      {
        headers: { apikey: service, Authorization: `Bearer ${service}` },
      },
    )
    const serviceRows = (await withService.json().catch(() => [])) as unknown[]
    record(
      'CONTROL: the same request with the service key DOES return rows',
      `http ${String(withService.status)}, ${String(Array.isArray(serviceRows) ? serviceRows.length : 0)} row(s)`,
      withService.ok && Array.isArray(serviceRows) && serviceRows.length === 1,
    )

    // And the anon key cannot write, which is a different question from reading.
    const wrote = await fetch(`https://${ref}.supabase.co/rest/v1/projects`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ slug: `anon-probe-${Date.now().toString(36)}`, name: 'anon probe' }),
    })
    record(
      'PostgREST: the anon key cannot insert either',
      `http ${String(wrote.status)}`,
      !wrote.ok,
    )
  }
}

// ---------------------------------------------------------------------------

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
if (failed.length > 0) process.exit(1)
