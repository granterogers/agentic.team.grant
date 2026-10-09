/**
 * Set ONLY the sign-in origin allow-list, and prove the refusals still hold.
 *
 *   npm run deploy:signin-origin -- --print      # say what would be set, touch nothing (still needs the guard flags)
 *   npm run deploy:signin-origin                 # set SIGNIN_ALLOWED_ORIGIN to the list in lib/signin-origins.ts
 *   npm run deploy:signin-origin -- --rollback   # set it back to the list as it was before the review origin
 *
 * Why this exists beside `deploy:signin`: that script also re-sets `HQ_API_TOKEN` and redeploys the function's
 * code, and adding one origin needs neither. This writes a single function secret by name (the Management API's
 * secrets endpoint upserts by name and leaves every other secret alone) and does not touch the function's code,
 * its JWT setting, any other function, the database, or the vault. Nothing is read back from the secrets API but
 * its NAMES, so no secret value is ever printed.
 *
 * The allow-list is a security boundary (`signin` hands out sessions to the pages on it), so the verification below
 * is the refusals, not the happy path: a stranger's origin and a missing origin are still 403, no wildcard answers,
 * the origins that were allowed still are, the new one is, and a bogus refresh token from the new origin is an
 * ordinary no. It never sends `begin` (that would ring a phone).
 */
import '../../src/safety/require-production-writes.ts'
import { SIGNIN_PAGE_ORIGINS, SIGNIN_PAGE_ORIGINS_BEFORE } from './lib/signin-origins.ts'

const rollback = process.argv.includes('--rollback')
const printOnly = process.argv.includes('--print')
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`
const endpoint = `https://${ref}.supabase.co/functions/v1/signin`
const list = rollback ? SIGNIN_PAGE_ORIGINS_BEFORE : SIGNIN_PAGE_ORIGINS

for (const o of list) {
  if (!/^https:\/\/[a-z0-9.-]+$/.test(o) || o.includes('*')) {
    console.error(`refusing an origin that is not a plain https origin: ${o}`)
    process.exit(2)
  }
}
console.log(`SIGNIN_ALLOWED_ORIGIN will be: ${list.join(',')}`)

// The rollback artifact: which secret NAMES exist and when they last changed (never a value).
const before = await fetch(`${api}/secrets`, { headers: { Authorization: `Bearer ${token}` } })
const names = before.ok
  ? ((await before.json()) as { name: string; updated_at?: string }[])
      .filter((s) => /^(SIGNIN_ALLOWED_ORIGIN|HQ_API_TOKEN|VOICE_ALLOWED_ORIGIN)$/.test(s.name))
      .map((s) => `${s.name}@${s.updated_at ?? '?'}`)
  : [`secrets listing: http ${String(before.status)}`]
console.log(`before: ${names.join(', ')}`)
if (printOnly) process.exit(0)

const set = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: 'SIGNIN_ALLOWED_ORIGIN', value: list.join(',') }]),
})
console.log(`secret set: http ${String(set.status)}`)
if (!set.ok) process.exit(1)

const ask = async (init: RequestInit): Promise<Response> => fetch(endpoint, init)
const preflightOrigin = async (o: string): Promise<string> =>
  (
    await ask({
      method: 'OPTIONS',
      headers: { Origin: o, 'Access-Control-Request-Method': 'POST' },
    })
  ).headers.get('access-control-allow-origin') ?? ''

// A new secret value is read when the function next boots; allow a little time, then check.
let settled = false
for (let i = 0; i < 12 && !settled; i += 1) {
  const o = list[list.length - 1] ?? ''
  settled = (await preflightOrigin(o)) === o
  if (!settled) await new Promise((r) => setTimeout(r, 5000))
}
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok, detail })
}
for (const o of list)
  check(`${o} is allowed`, (await preflightOrigin(o)) === o, await preflightOrigin(o))
const stranger = await ask({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' },
  body: JSON.stringify({ action: 'refresh', refresh_token: 'x' }),
})
check('a stranger origin is refused (403)', stranger.status === 403, String(stranger.status))
const none = await ask({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'refresh', refresh_token: 'x' }),
})
check('no origin is refused (403)', none.status === 403, String(none.status))
const star = await preflightOrigin('https://example.invalid')
check('no wildcard answers', star !== '*' && star !== 'https://example.invalid', star)
if (!rollback) {
  const dud = await ask({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: SIGNIN_PAGE_ORIGINS[SIGNIN_PAGE_ORIGINS.length - 1] ?? '',
    },
    body: JSON.stringify({ action: 'refresh', refresh_token: 'not-a-refresh-token' }),
  })
  const body = (await dud.json().catch(() => ({}))) as { ok?: boolean; access_token?: string }
  check(
    'a bogus refresh token from the new origin is an ordinary no, never a session',
    body.ok !== true && body.access_token === undefined,
    `http ${String(dud.status)} ok=${String(body.ok)}`,
  )
}
let bad = 0
for (const r of results) {
  if (!r.ok) bad += 1
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail === '' ? '' : ` - ${r.detail}`}`)
}
console.log(`\n${String(results.length - bad)}/${String(results.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
