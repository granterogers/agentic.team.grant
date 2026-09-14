/**
 * Does the office actually reach the REAL Google?
 *
 *   npm run verify:google-live
 *
 * Issue #224. The backend readiness report of 14 September named Gmail, Drive
 * and Calendar as reason two not to trust the backend, and said they were
 * *"blocked on a Phase 9 OAuth client in a project Grant owns"*.
 *
 * **That was wrong.** The credentials have been in the vault since 8 September
 * and they work: `googleAccess` returns a live token carrying gmail.readonly,
 * gmail.compose, drive.readonly, calendar.readonly and calendar.events. Nothing
 * was blocked. Grant was asked to spend ten minutes creating an OAuth client he
 * already had, on the strength of a claim nobody had checked — which is the
 * exact failure this whole programme exists to catch, committed by the
 * programme.
 *
 * ## Why the other suites still fake Google, and should
 *
 * `verify:mail` and `verify:calendar` fake every fetch on purpose, and their
 * headers explain it: the interesting behaviour is what the office DOES with
 * what Google returns — dedupe, project association, the disappearance sweep —
 * and none of that can be checked against a live inbox whose contents change
 * under you. A determinstic fake is the right tool for that job.
 *
 * The gap was never the fake. It was that **nothing at all** touched the real
 * thing, so "Google works" was an assumption with a fake standing behind it.
 * This suite is the missing half, and it is deliberately narrow: it asks
 * whether the credential is live, whether the scopes are the ones the office
 * believes it has, and whether each of the three APIs answers. It asserts
 * nothing about content.
 *
 * ## Read-only, and quiet about what it sees
 *
 * Every call is a read. Nothing is sent, created or modified — `gmail.compose`
 * is in the granted scopes and is deliberately not exercised, because a suite
 * that can email people is a suite one bad refactor away from emailing people.
 *
 * It prints counts and never content: no subject line, no sender, no file name,
 * no event title. Grant's inbox is his.
 *
 * ## Excluded from the batch, by name
 *
 * Like `verify:github-token`, this spends a real API quota against a real
 * account, so `scripts/e2e.ts` will not start it as one of ninety. Run it
 * deliberately.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { googleAccess } from '../../src/google/auth.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}

console.log('\nverify:google-live — the real Google, read-only\n')

const access = (await googleAccess(db)) as {
  ok?: boolean
  accessToken?: string
  scopes?: string
  reason?: string
}

ok(
  'the vault has a Google credential and it exchanges for a live access token',
  access.ok === true && typeof access.accessToken === 'string' && access.accessToken !== '',
  access.ok === true ? 'exchanged' : `unavailable: ${String(access.reason ?? 'no reason given')}`,
)
if (access.ok !== true || access.accessToken === undefined) {
  console.log('\nNothing further can be asked without a token.')
  console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
  process.exit(1)
}

const bearer = { Authorization: `Bearer ${access.accessToken}` }

/*
  What Google says the token is for, asked of Google rather than of our own
  record of what we requested. Those are different questions and only one of
  them can catch a scope that was never actually granted.
*/
const info = await fetch(
  `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(access.accessToken)}`,
)
const granted = String(((await info.json()) as { scope?: string }).scope ?? '')
  .split(' ')
  .filter(Boolean)

ok('Google recognises the token', info.status === 200, `tokeninfo http ${String(info.status)}`)
for (const s of granted) console.log(`       ${s}`)

/*
  The three the office actually depends on. Asserted individually, because "some
  Google scope exists" is not the same claim as "Drive can be read", and the
  connector sheets make the second claim.
*/
const NEEDED = [
  ['gmail.readonly', 'https://www.googleapis.com/auth/gmail.readonly'],
  ['drive.readonly', 'https://www.googleapis.com/auth/drive.readonly'],
  ['calendar.readonly', 'https://www.googleapis.com/auth/calendar.readonly'],
] as const
for (const [name, scope] of NEEDED) {
  ok(`the token carries ${name}`, granted.includes(scope))
}

/*
  And then each API is actually CALLED, because a granted scope is a permission
  and not a working connection. CLAUDE.md's rule about exercising rather than
  reading applies to Google exactly as it applies to a button: a scope list is
  the code looking right.
*/
const gmail = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
  headers: bearer,
})
const gmailBody = (await gmail.json()) as { messagesTotal?: number; error?: { message?: string } }
ok(
  'Gmail answers, and reports a mailbox',
  gmail.status === 200 && typeof gmailBody.messagesTotal === 'number',
  gmail.status === 200
    ? `${String(gmailBody.messagesTotal)} message(s) in the account`
    : `http ${String(gmail.status)} ${String(gmailBody.error?.message ?? '').slice(0, 60)}`,
)

const drive = await fetch('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)', {
  headers: bearer,
})
const driveBody = (await drive.json()) as { files?: unknown[]; error?: { message?: string } }
ok(
  'Drive answers, and can list',
  drive.status === 200 && Array.isArray(driveBody.files),
  drive.status === 200
    ? `listing works (${String(driveBody.files?.length ?? 0)} row asked for, ids not printed)`
    : `http ${String(drive.status)} ${String(driveBody.error?.message ?? '').slice(0, 60)}`,
)

const cal = await fetch(
  'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5',
  { headers: bearer },
)
const calBody = (await cal.json()) as { items?: unknown[]; error?: { message?: string } }
ok(
  'Calendar answers, and can list calendars',
  cal.status === 200 && Array.isArray(calBody.items),
  cal.status === 200
    ? `${String(calBody.items?.length ?? 0)} calendar(s) visible, names not printed`
    : `http ${String(cal.status)} ${String(calBody.error?.message ?? '').slice(0, 60)}`,
)

/*
  CONTROL: a deliberately wrong token must be refused.

  Without this, every check above would pass identically against an endpoint
  that waves anything through, and the suite would be proving that Google
  answers rather than that OUR credential is what makes it answer. Same reason
  verify:hq shows its shape list a synthetic credential.
*/
const refused = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
  headers: { Authorization: 'Bearer not-a-real-token' },
})
ok(
  'CONTROL: a wrong token is refused, so the calls above prove the credential and not the endpoint',
  refused.status === 401,
  `http ${String(refused.status)}`,
)

/*
  What the office TELLS its agents about Google has to match what Google just
  said. This is #64's shape applied to a connector.

  The FIRST draft of this check queried `connector_capabilities` for connectors
  called 'gmail', 'google_drive' and 'google_calendar'. None of those exist —
  that table is keyed to KNOWLEDGE CONNECTORS, the things a dashboard project is
  attached to, and Gmail is not one. So the query matched nothing and the check
  passed with "0 claims", which is a check passing because it asked a question
  about a table that could never answer it. Vacuously true, and green.

  `tool_permissions` is what `capabilityBrief` reads and therefore what every
  agent is actually told. Asked of that instead, the answer is reassuring and
  worth asserting: gmail.read, gmail.search, calendar.read and calendar.write
  are enabled and the credential behind them is live.
*/
const tools = (
  await db.execute(`
    select tool, enabled from public.tool_permissions
     where tool like 'gmail.%' or tool like 'calendar.%'
     order by tool`)
).rows as { tool: string; enabled: boolean }[]

ok(
  'the office actually has Google tools on its books, so this check is not vacuous',
  tools.length > 0,
  tools.map((t) => `${t.tool}${t.enabled ? '' : ' (off)'}`).join(', '),
)

const enabledReads = tools.filter((t) => t.enabled && /\.(read|search)$/.test(t.tool))
ok(
  'every ENABLED Google read tool has a live credential behind it',
  enabledReads.length > 0 && granted.length > 0,
  `${String(enabledReads.length)} enabled read tool(s), credential live`,
)

/*
  And the one that must stay off.

  `gmail.send` is DISABLED while `gmail.compose` sits in the granted scopes, and
  that gap is deliberate: the scope makes sending possible and the switch is
  what stops it. A tool flipped on by accident would let an agent email somebody
  as Grant, which is the least reversible thing in the building.
*/
const send = tools.find((t) => t.tool === 'gmail.send')
ok(
  'gmail.send is switched OFF, even though the scope to send exists',
  send !== undefined && send.enabled === false,
  send === undefined ? 'no gmail.send row at all' : `enabled=${String(send.enabled)}`,
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
