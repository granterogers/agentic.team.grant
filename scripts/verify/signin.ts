/**
 * The sign-in loop, driven end to end against the deployed endpoint.
 *
 *   npm run verify:signin
 *
 * ## Why the positive leg is here and not only the refusals
 *
 * "A suite made only of refusals passes against a system that refuses
 * everything" is written in CLAUDE.md because this office has already shipped
 * one. The deploy probe checks that a stranger, a missing origin and an unknown
 * request all come back as noes; that says nothing whatever about whether
 * anybody can actually sign in. So this drives the whole thing: ask, approve
 * through the same URL Grant taps, collect, and then USE what was collected
 * against the real gateway.
 *
 * ## What it does to Grant's phone
 *
 * One silent Telegram message per run, which says in its own text that it came
 * from an automated check. There is no way to prove the ask reaches him without
 * the ask reaching him, and a verification that stops short of the only part
 * that can be broken is the kind this file exists to avoid.
 *
 * ## What it must never print
 *
 * The approve secret and the token. Both are compared, neither is shown: the
 * assertions are about shape and equality, which is all they need to be.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, supabaseToken)

// Overridable so the harness audit can point this at a deliberately broken
// copy under a throwaway slug. Proving a detector can fail must not mean
// deploying the defect over the endpoint people actually use.
const SLUG = process.env.SIGNIN_SLUG ?? 'signin'
const ENDPOINT = `https://${ref}.supabase.co/functions/v1/${SLUG}`
const GATEWAY = `https://${ref}.supabase.co/functions/v1/hq-api`
const ORIGIN = 'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app'

let bad = 0
const check = (label: string, ok: boolean, saw = ''): void => {
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${saw === '' ? '' : ` — ${saw}`}`)
}

const post = async (
  body: Record<string, unknown>,
  origin: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (origin !== null) headers.Origin = origin
  const response = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) })
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { status: response.status, body: parsed }
}

// --- the refusals ----------------------------------------------------------

const health = await fetch(`${ENDPOINT}/health`)
const healthBody = (await health.json().catch(() => ({}))) as { configured?: boolean }
check('the endpoint is up and configured', health.status === 200 && healthBody.configured === true)

const stranger = await post({ action: 'begin' }, 'https://example.invalid')
check("a stranger's page cannot ask", stranger.status === 403, `http ${String(stranger.status)}`)

const anonymous = await post({ action: 'begin' }, null)
check(
  'a request with no origin cannot ask',
  anonymous.status === 403,
  `http ${String(anonymous.status)}`,
)

const strangerCors = await fetch(ENDPOINT, {
  method: 'OPTIONS',
  headers: { Origin: 'https://example.invalid' },
})
check(
  'the preflight for a stranger does not name their origin',
  strangerCors.headers.get('access-control-allow-origin') !== 'https://example.invalid',
  String(strangerCors.headers.get('access-control-allow-origin')),
)

// --- the ask ---------------------------------------------------------------

const begun = await post(
  { action: 'begin', asked_from: 'an automated check, not a browser of yours' },
  ORIGIN,
)
check('the office takes the ask', begun.status === 200, `http ${String(begun.status)}`)
const requestId = String(begun.body.request_id ?? '')
const code = String(begun.body.code ?? '')
check('it hands back a request', /^[0-9a-f-]{36}$/i.test(requestId))
check('and a code to compare', /^[A-Z0-9]{6}$/.test(code), code)
check(
  'and NOT the thing that authorises it',
  begun.body.approve_secret === undefined && begun.body.token === undefined,
  Object.keys(begun.body).join(', '),
)

if (requestId === '') {
  console.log('\nno request to carry on with')
  process.exit(1)
}

const stored = (
  await db.execute(
    `select approve_secret, code, approved_at, claimed_at
       from public.sign_in_requests where request_id = '${requestId}'`,
  )
).rows[0] as
  | {
      approve_secret?: string
      code?: string
      approved_at?: string | null
      claimed_at?: string | null
    }
  | undefined
check('the office wrote the request down', stored !== undefined)
check('with the code it showed the screen', String(stored?.code ?? '') === code)
check('and nobody has approved it yet', stored?.approved_at === null)

// --- waiting ---------------------------------------------------------------

const early = await post({ action: 'claim', request_id: requestId }, ORIGIN)
check(
  'an unapproved request hands over nothing',
  early.body.ok === false && early.body.reason === 'waiting' && early.body.token === undefined,
  String(early.body.reason),
)

// --- the tap ---------------------------------------------------------------

const secret = String(stored?.approve_secret ?? '')
const tapped = await fetch(`${ENDPOINT}?approve=${encodeURIComponent(secret)}`)
const tappedHtml = await tapped.text()
check('the link Grant taps answers', tapped.status === 200, `http ${String(tapped.status)}`)
check('and names the code, so he can compare it', tappedHtml.includes(code))
check(
  'and does not leak the secret back into the page',
  !tappedHtml.includes(secret),
  'the approve link is not echoed',
)

const nonsense = await fetch(`${ENDPOINT}?approve=not-one-of-ours`)
check(
  'a link that is not ours is refused',
  nonsense.status === 400,
  `http ${String(nonsense.status)}`,
)

// --- the hand-off ----------------------------------------------------------

const claimed = await post({ action: 'claim', request_id: requestId }, ORIGIN)
const handed = String(claimed.body.token ?? '')
check('the waiting browser is signed in', claimed.body.ok === true)
// Not a length. The first draft asserted more than twenty characters and went
// red against a working product, because the office token is ten — a guess
// about the thing under test, which is the mistake this file's neighbours keep
// recording. What matters is that something was handed over at all, and the
// next check is the one that says WHICH something.
check('and is handed something', handed !== '', `${handed.length} characters`)

const vault = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
check('which is the office token itself, not a look-alike', handed !== '' && handed === vault)

const spent = await post({ action: 'claim', request_id: requestId }, ORIGIN)
check(
  'and the request is spent — a second browser gets nothing',
  spent.body.ok === false && spent.body.reason === 'spent' && spent.body.token === undefined,
  String(spent.body.reason),
)

// --- and it actually works -------------------------------------------------
//
// The whole point. A token handed over that the gateway then refuses would
// pass every check above.

const used = await fetch(`${GATEWAY}?section=projects`, {
  headers: { Authorization: `Bearer ${handed}` },
})
check(
  'the gateway accepts what the browser was handed',
  used.status === 200,
  `http ${String(used.status)}`,
)

const refused = await fetch(`${GATEWAY}?section=projects`, {
  headers: { Authorization: 'Bearer not-the-office-token' },
})
check(
  'and still refuses one it never issued',
  refused.status === 401,
  `http ${String(refused.status)}`,
)

// --- teardown --------------------------------------------------------------

await db.execute(`delete from public.sign_in_requests where request_id = '${requestId}'`)
const left = (
  await db.execute(
    `select count(*)::int as n from public.sign_in_requests where request_id = '${requestId}'`,
  )
).rows[0] as { n?: number } | undefined
check('teardown left nothing behind', left?.n === 0, `${String(left?.n)} row(s)`)

console.log(bad === 0 ? '\nALL GREEN' : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
