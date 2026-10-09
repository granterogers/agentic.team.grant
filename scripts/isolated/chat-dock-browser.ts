/**
 * Team Chat in the REAL Team HQ page, through the REAL voice edge code, on the isolated replica (H1 and the replay rule,
 * rewritten onto main's compact chat dock of 9 October). Local and isolated: no production, no network, no worker (so
 * nothing answers; what is proved is what the office RECORDS for a message a person types).
 *
 *   npx tsx scripts/isolated/chat-dock-browser.ts <replica-db> [--sabotage-retry]
 *
 * What is proved, each beside a control:
 *   1. a message typed in the dock reaches the office as ONE command for the right project, from the signed-in person's
 *      office, on the dashboard channel, carrying a message name and a visit id the page minted;
 *   2. a LOST RESPONSE (the office recorded it, the page was told 504) is retried with the SAME message name and the office
 *      files it ONCE (a replay is the same message), while the same words typed again afterwards are a NEW message;
 *   3. a second visit (a fresh page, as a second tab or device would be) lands in the SAME conversation as the first: the
 *      conversation is derived by the office from the verified person and project, not named by the page;
 *   4. no page error.
 * SABOTAGE (`--sabotage-retry`): the page's retry is made to mint a fresh message name; check 2 must go red, proving the
 * proof reads the database rather than the page's own "sent" state.
 */
import { chromium, type Page } from 'playwright'
import { serveStudio } from '../verify/serve-studio.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'bq'
const SABOTAGE = process.argv.includes('--sabotage-retry')
const db = await isolated(dbName)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const run = Date.now().toString(36)

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const EMAIL = `dock-${run}@example.invalid`
const SESSION = `aaa.bbb.${'d'.repeat(70)}`
const PORT = 4658
const env = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: `http://127.0.0.1:${String(PORT)}`,
}
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(EMAIL)})`)
const OFFICE = String(
  json(
    (
      await one(
        `select app.provision_person_office('Dock Person', ${lit(EMAIL)}, ${lit(`dock-${run}`)}) as r`,
      )
    ).r,
  ).office_id,
)
const made = json(
  (
    await one(
      `select app.hq_create_project(${lit(OFFICE)}::uuid, ${lit(`Dock project ${run}`)}, 'upload', ${lit(`dock-${run}`)}, ${lit(`Dock project ${run}`)}, true) as v`,
    )
  ).v,
)
const PROJECT_ID = String(made.project_id)
const SLUG = String(
  (await one(`select slug from public.projects where project_id = ${lit(PROJECT_ID)}::uuid`)).slug,
)

const authUsers: Record<string, string> = { [SESSION]: EMAIL }
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })
const signin = await startEdge({
  db,
  edgeFile: 'supabase/functions/signin/index.ts',
  env,
  authUsers,
})
const voice = await startEdge({
  db,
  edgeFile: 'supabase/functions/voice/index.ts',
  env,
  authUsers,
})
const GW = 'https://gw.invalid/functions/v1'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}
const server = await serveStudio(PORT)
const APP = `http://127.0.0.1:${String(PORT)}`
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })

type Turn = { message: string; session: string; said: string; status: number }
type Seen = { pageErrors: string[]; turns: Turn[]; loseNext: boolean }

const openPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const seen: Seen = { pageErrors: [], turns: [], loseNext: false }
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const isTurn = url.pathname.endsWith('/voice/turn')
    const parts = url.pathname.split('/')
    const fn = isTurn ? 'voice' : (parts.pop() ?? '')
    const edge = fn === 'signin' ? signin : fn === 'hq-api' ? gw : fn === 'voice' ? voice : null
    if (edge === null)
      return route.fulfill({ status: 404, headers: CORS, body: '{"error":"not served here"}' })
    const body = req.postData() ?? undefined
    let turn: Turn | null = null
    if (isTurn && body !== undefined) {
      const b = JSON.parse(body) as Record<string, unknown>
      turn = {
        message: String(b.message ?? ''),
        session: String(b.session ?? ''),
        said: String(b.said ?? ''),
        status: 0,
      }
    }
    const res = await edge.call(
      new Request(req.url(), {
        method: req.method(),
        headers: req.headers(),
        ...(body === undefined ? {} : { body }),
      }),
    )
    const text = await res.text()
    if (turn !== null) {
      turn.status = res.status
      seen.turns.push(turn)
      if (seen.loseNext) {
        // The office recorded it; the connection drops before the page hears (a lost response).
        seen.loseNext = false
        return route.abort('connectionreset')
      }
    }
    return route.fulfill({
      status: res.status,
      headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' },
      body: text,
    })
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid)/, (route) => route.abort())
  await ctx.addInitScript(
    `window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin'; window.HQ_VOICE = '${GW}/voice';`,
  )
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${SESSION}', refresh_token: 'r', expires_at: Date.now() + 36e5 })) } catch {}`,
  )
  if (SABOTAGE) {
    // A retry that mints a new message name every time: the replay then looks like a new message to the office.
    await ctx.route('**/chat.js', async (route) => {
      const res = await route.fetch()
      const text = (await res.text()).replace(
        "typeof waitingRow?.messageId === 'string' && waitingRow.messageId !== ''",
        'false',
      )
      await route.fulfill({ response: res, body: text })
    })
  }
  const page = await ctx.newPage()
  page.on('pageerror', (e) => seen.pageErrors.push(e.message.slice(0, 200)))
  return { page, seen, close: () => ctx.close() }
}

const say = async (page: Page, text: string): Promise<void> => {
  if ((await page.locator('.dock [data-docksay]').count()) === 0)
    await page.locator('[data-bc-dock]').first().click({ force: true })
  await page.waitForSelector('.dock [data-docksay]', { timeout: 10000 })
  await page.fill('.dock [data-docksay]', text)
  await page.locator('.dock [type=submit]').click({ force: true })
}

const commandsFor = async (text: string): Promise<Record<string, unknown>[]> =>
  rows(
    `select command_id::text as id, origin_channel, origin_ref, office_id::text as office, project_id::text as project, instruction, dedupe_key
       from public.inbound_commands where instruction = ${lit(text)} order by received_at`,
  )

try {
  const FIRST = `[dock proof ${run}] what is the venue deposit?`
  const { page, seen, close } = await openPage()
  try {
    await page.goto(`${APP}/p/${SLUG}/overview`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bctop', { timeout: 20000 })
    await page.waitForSelector('[data-bc-dock]', { timeout: 20000 })
    await page.waitForTimeout(800)

    // 1. one message, one command, the right place
    await say(page, FIRST)
    await page.waitForTimeout(2500)
    const c1 = await commandsFor(FIRST)
    check(
      'one message typed in the dock is ONE command in the office',
      c1.length === 1,
      String(c1.length),
    )
    check(
      'it is for this person and this project, through the voice door the dock uses',
      c1[0]?.office === OFFICE &&
        c1[0]?.project === PROJECT_ID &&
        c1[0]?.origin_channel === 'voice',
      JSON.stringify({ office: c1[0]?.office, project: c1[0]?.project, ch: c1[0]?.origin_channel }),
    )
    const t1 = seen.turns.find((t) => t.said === FIRST)
    check(
      'the page named the message and the visit',
      t1 !== undefined &&
        /^m[a-z0-9]{8,63}$/.test(t1.message) &&
        /^s[a-z0-9]{1,10}$/.test(t1.session),
      JSON.stringify(t1),
    )
    check('control: the office accepted it', t1?.status === 200, String(t1?.status))

    // 2. a lost response is a replay, not a second message
    const LOST = `[dock proof ${run}] and when is it due?`
    seen.loseNext = true
    await say(page, LOST)
    await page.waitForTimeout(2500)
    const retry = page.locator('[data-chat-retry]').first()
    const offered = await retry
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    check(
      'a message whose response was lost offers Try again',
      offered,
      offered
        ? ''
        : `the dock says: ${(await page.locator('.dock').first().innerText()).replace(/\s+/g, ' ').slice(-260)}`,
    )
    if (offered) {
      await retry.click({ force: true })
      await page.waitForTimeout(3000)
    }
    const sentLost = seen.turns.filter((t) => t.said === LOST)
    const c2 = await commandsFor(LOST)
    check(
      'the retry carried the SAME message name as the first attempt',
      sentLost.length >= 2 && sentLost.every((t) => t.message === sentLost[0]?.message),
      JSON.stringify(sentLost.map((t) => `${t.message.slice(0, 10)}:${String(t.status)}`)),
    )
    check(
      'the office filed the replayed message ONCE',
      c2.length === 1,
      `${String(c2.length)} command(s) for ${String(sentLost.length)} attempt(s)`,
    )
    check(
      'control: the same words typed again later are a NEW message',
      await (async () => {
        await say(page, LOST)
        await page.waitForTimeout(2500)
        return (await commandsFor(LOST)).length === 2
      })(),
    )
    check('no page error', seen.pageErrors.length === 0, seen.pageErrors.join(' | '))
  } finally {
    await close()
  }

  // 3. a second visit is the same conversation
  const second = await openPage()
  try {
    await second.page.goto(`${APP}/p/${SLUG}/overview`, { waitUntil: 'domcontentloaded' })
    await second.page.waitForSelector('.bctop', { timeout: 20000 })
    await second.page.waitForSelector('[data-bc-dock]', { timeout: 20000 })
    await second.page.waitForTimeout(800)
    const FOLLOW = `[dock proof ${run}] and the catering?`
    await say(second.page, FOLLOW)
    await second.page.waitForTimeout(2500)
    const a = (await commandsFor(FIRST))[0]
    const b = (await commandsFor(FOLLOW))[0]
    const head = (r: Record<string, unknown> | undefined): string =>
      String(r?.origin_ref ?? '').split(':')[0] ?? ''
    check(
      'a second visit lands in the SAME conversation as the first (the office derives it, the page does not name it)',
      a !== undefined && b !== undefined && head(a) !== '' && head(a) === head(b),
      JSON.stringify({ first: head(a), second: head(b) }),
    )
    check(
      'control: and they are different messages from different visits',
      a?.id !== b?.id && a?.dedupe_key !== b?.dedupe_key,
    )
    check('no page error on the second visit', second.seen.pageErrors.length === 0)
  } finally {
    await second.close()
  }
} finally {
  await browser.close()
  server.close()
  await db.end()
}

console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
