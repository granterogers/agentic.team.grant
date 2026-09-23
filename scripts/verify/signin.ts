/**
 * The sign-in endpoint, over the network, including what it refuses.
 *
 *   npm run verify:signin
 *
 * The browser half is `verify:basecamp-signin`, which drives a clean browser
 * through the real journey. This is the half a browser cannot see: that the
 * endpoint refuses a stranger's origin, refuses to mint a link without the
 * office key, refuses to mint one for somebody the office does not work for,
 * and never says whether an address is known here.
 *
 * WHY BOTH HALVES. "A suite made only of refusals passes against a system that
 * refuses everything" — so the positive leg is here too: a link IS produced for
 * a member, it points at the office's own verify endpoint, and completing it
 * yields a session the gateway accepts. Nothing is emailed to anybody.
 *
 * SECRETS. The office key is read from the vault, used, never printed. The
 * action link contains a one-time token and is never printed either.
 */

import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

/*
  The endpoint's own source, which is what is deployed: `deploy:signin` uploads
  this exact file. Reading it is how a property about a branch that must NOT do
  something can be checked at all — there is no request that demonstrates an
  absence.
*/
const Deno_readSource = async (): Promise<string> =>
  await readFile('supabase/functions/signin/index.ts', 'utf8')

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, accessToken)

const ENDPOINT = `https://${ref}.supabase.co/functions/v1/signin`
const GATEWAY = `https://${ref}.supabase.co/functions/v1/hq-api-basecamp`
const ORIGIN = 'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app'

let bad = 0
const check = (label: string, ok: boolean, saw = ''): void => {
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${saw === '' ? '' : ` — ${saw}`}`)
}

const post = async (
  body: Record<string, unknown>,
  { origin, auth }: { origin?: string | null; auth?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (origin !== null) headers.Origin = origin ?? ORIGIN
  if (auth !== undefined) headers.authorization = `Bearer ${auth}`
  const response = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) })
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  }
}

const key = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
check('the office key is in the vault', key !== '')

const member = String(
  (await db.execute(`select email from public.office_members order by added_at, email limit 1`))
    .rows[0]?.email ?? '',
)
check('the office knows somebody it works for', member !== '', member)

// --- what it refuses -------------------------------------------------------

const health = await fetch(`${ENDPOINT}/health`)
const healthBody = (await health.json().catch(() => ({}))) as { configured?: boolean }
check('the endpoint is up and configured', health.status === 200 && healthBody.configured === true)

const stranger = await post(
  { action: 'link', email: member },
  { origin: 'https://example.invalid' },
)
check(
  "a stranger's page cannot ask for anything",
  stranger.status === 403,
  `http ${String(stranger.status)}`,
)

const nowhere = await post({ action: 'link', email: member }, { origin: null })
check('nor can a request with no origin', nowhere.status === 403, `http ${String(nowhere.status)}`)

const unkeyed = await post({ action: 'link_for_operator', email: member })
check(
  'a link cannot be minted without the office key',
  unkeyed.status === 401,
  `http ${String(unkeyed.status)}`,
)

const outsider = await post(
  { action: 'link_for_operator', email: 'nobody@example.com' },
  { auth: key },
)
check(
  'and not even with it, for somebody the office does not work for',
  outsider.status === 403,
  `http ${String(outsider.status)}`,
)

const dud = await post({ action: 'refresh', refresh_token: 'not-a-refresh-token' })
check(
  'a refresh token nothing issued yields no session',
  dud.body.ok === false && dud.body.access_token === undefined,
  String(dud.body.reason),
)

const nobody = await post({ action: 'whoami' })
check('and whoami with nothing presented says nothing', nobody.body.ok === false)

/*
  THE ADDRESS ORACLE, which is the one thing this endpoint must never be.

  The first version of this check asked for a link for a MEMBER and for a
  stranger and compared the two answers. It passed — and it sent real mail to
  Grant's real inbox on every run, and ate his two-per-hour allowance doing it.
  A verification that spams the person it is protecting is not one to keep.

  So the property is asserted where it is decided. The `link` branch never
  consults the allowlist at all: it hands the address to Supabase and reports
  what Supabase said, so it CANNOT distinguish a member from anybody else.
  Read out of the deployed source rather than assumed, and proved able to fail
  by the control below it.

  One live call remains, to an address that is nobody here, so the endpoint is
  still shown to answer.
*/
const source = await (await fetch(`${ENDPOINT}/health`)).text().catch(() => '')
check('the endpoint answers', source !== '')

const fnSource = await Deno_readSource()
const linkBranch = fnSource.slice(
  fnSource.indexOf("if (action === 'link')"),
  fnSource.indexOf("if (action === 'link_for_operator')"),
)
check(
  'the sign-in branch exists to read',
  linkBranch.length > 200,
  `${String(linkBranch.length)} characters`,
)
check(
  'and it never asks whether the address is a member',
  !/office_member/.test(linkBranch),
  linkBranch.includes('office_member') ? 'it consults the allowlist' : 'it does not',
)
check(
  'while the operator branch, which may refuse, does ask',
  /office_member/.test(
    fnSource.slice(
      fnSource.indexOf("if (action === 'link_for_operator')"),
      fnSource.indexOf("if (action === 'refresh')"),
    ),
  ),
)

const anybody = await post({ action: 'link', email: 'nobody-at-all@example.com' })
check(
  'and asking about a stranger is answered without a fuss',
  anybody.status === 200,
  JSON.stringify(anybody.body).slice(0, 80),
)

// --- and what it does ------------------------------------------------------

const made = await post(
  { action: 'link_for_operator', email: member, back: `${ORIGIN}/basecamp` },
  { auth: key },
)
const link = String(made.body.action_link ?? '')
check('a link is produced for a member', made.body.ok === true && link !== '')
if (link !== '') {
  const u = new URL(link)
  check(
    'it points at the office own verify endpoint',
    u.pathname.endsWith('/auth/v1/verify'),
    u.pathname,
  )
  check(
    'and it comes back to the page that asked',
    (u.searchParams.get('redirect_to') ?? '').startsWith(ORIGIN),
    String(u.searchParams.get('redirect_to')),
  )

  /*
    Completing it. `redirect: 'manual'` so the session can be read out of the
    Location header rather than followed into a page — this is the backend
    suite, and the page's half is proved next door.
  */
  const followed = await fetch(link, { redirect: 'manual' })
  const to = followed.headers.get('location') ?? ''
  const hash = to.includes('#') ? new URLSearchParams(to.split('#')[1]) : new URLSearchParams()
  const access = hash.get('access_token') ?? ''
  check('completing it yields a session', access !== '', `${access.length} characters`)
  check(
    'and it is handed back in the fragment, which never reaches a server',
    to.includes('#access_token='),
    to.split('#')[0] ?? '',
  )

  if (access !== '') {
    const used = await fetch(`${GATEWAY}?section=projects`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    check('the gateway accepts that session', used.status === 200, `http ${String(used.status)}`)

    const asked = await post({ action: 'whoami' }, { auth: access })
    check('and the office knows whose it is', asked.body.email === member, String(asked.body.email))
  }
}

/*
  THE CONTROL FOR THE GATEWAY, because every check above would pass against a
  gateway that accepted anything shaped like a JWT.
*/
const forged = await fetch(`${GATEWAY}?section=projects`, {
  headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.forged.forged' },
})
check('a forged session is refused', forged.status === 401, `http ${String(forged.status)}`)

const stillMachines = await fetch(`${GATEWAY}?section=projects`, {
  headers: { Authorization: `Bearer ${key}` },
})
check('and the office key still works, because machines use it', stillMachines.status === 200)

console.log(bad === 0 ? '\nALL GREEN' : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
