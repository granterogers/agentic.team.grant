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
type Seen = {
  pageErrors: string[]
  turns: Turn[]
  loseNext: boolean
  delayNextMs: number
  delayHistoryMs: number
  historyDone: boolean
}

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const openPage = async (viewport = DESKTOP) => {
  const ctx = await browser.newContext({ viewport })
  const seen: Seen = {
    pageErrors: [],
    turns: [],
    loseNext: false,
    delayNextMs: 0,
    delayHistoryMs: 0,
    historyDone: false,
  }
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
    if (seen.delayHistoryMs > 0 && url.searchParams.get('section') === 'conversation') {
      // The office answered the history read at once (what it knew THEN); the page hears it late, after the person has sent something.
      const ms = seen.delayHistoryMs
      seen.delayHistoryMs = 0
      await new Promise((r) => setTimeout(r, ms))
      seen.historyDone = true
    }
    if (turn !== null) {
      turn.status = res.status
      seen.turns.push(turn)
      if (seen.delayNextMs > 0) {
        // The office has recorded it; the answer to the page is held back, so a person can be typing when it lands.
        const ms = seen.delayNextMs
        seen.delayNextMs = 0
        await new Promise((r) => setTimeout(r, ms))
      }
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

/** What each step of `say` saw, kept so a red can say where a message went (#458). */
const trace: string[] = []
const say = async (page: Page, text: string, how: 'atomic' | 'press' = 'atomic'): Promise<void> => {
  const t0 = Date.now()
  const note = (what: string): void => {
    trace.push(`${String(Date.now() - t0)}ms ${what}`)
  }
  const value = (): Promise<string | null> =>
    page
      .locator('.dock [data-docksay]')
      .first()
      .inputValue({ timeout: 1500 })
      .catch(() => null)
  if ((await page.locator('.dock [data-docksay]').count()) === 0) {
    note('dock was closed; opening it')
    await page.locator('[data-bc-dock]').first().click({ force: true })
  }
  await page.waitForSelector('.dock [data-docksay]', { timeout: 10000 })
  if (how === 'atomic') {
    /*
      ONE STEP IN THE PAGE. Putting the words in the live composer and submitting its form happen in a single synchronous script, so a
      redraw of the dock (an answer, a retry or a history read landing) cannot fall between the two. Driving them as separate browser
      actions let a redraw replace the composer after the words went in (the words lost) or while the button was being pressed (a click
      on a node that was thrown away): the red this proof showed under load (#458). The real Send button is pressed by `press`.
    */
    const sent = await page.evaluate(
      `((t) => { const b = document.querySelector('.dock [data-docksay]'); const f = document.querySelector('.dock [data-dockform]'); if (!b || !f) return false; b.value = t; f.requestSubmit(); return true })(${JSON.stringify(text)})`,
    )
    if (sent !== true) throw new Error('the dock has no composer to send from')
    note('submitted in one step')
    return
  }
  /*
    SYNCHRONISE ON THE THING ASSERTED. A redraw of the dock (an answer or a retry landing) replaces the composer; a fill that resolved
    its element just before that lands on the node that was thrown away, and the words are not in the box a person would see (#458,
    caught with these steps: "filled; box holds an empty string"). So the words are filled until the live box holds them, then sent.
    This is not a sleep and asserts nothing less: if the words never stick the proof fails here.
  */
  let stuck = false
  for (let attempt = 1; attempt <= 6 && !stuck; attempt += 1) {
    await page.fill('.dock [data-docksay]', text)
    stuck = (await value()) === text
    if (!stuck)
      note(`attempt ${String(attempt)}: the box did not hold the words (a redraw replaced it)`)
  }
  if (!stuck) throw new Error(`the words never stuck in the composer: ${text.slice(-30)}`)
  note(`filled; box holds ${JSON.stringify(((await value()) ?? 'NO BOX').slice(-14))}`)
  await page.locator('.dock [type=submit]').click({ force: true })
  note(`clicked; box now ${JSON.stringify(((await value()) ?? 'NO BOX').slice(-14))}`)
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
    await say(page, FIRST, 'press')
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
    await say(page, LOST)
    // wait for the thing asserted (the second command being filed), not a fixed pause: under a busy gate the filing can land late
    for (let waited = 0; waited < 15000; waited += 500) {
      if ((await commandsFor(LOST)).length >= 2) break
      await page.waitForTimeout(500)
    }
    const again = await commandsFor(LOST)
    // Diagnostics for a red: what the page was showing and what it had sent, so the next failure names its own cause (#458).
    let diag = ''
    if (again.length !== 2) {
      const dock = await page
        .evaluate(
          `(() => {
            const d = document.querySelector('.dock')
            const ta = document.querySelector('.dock [data-docksay]')
            const submit = document.querySelector('.dock [type=submit]')
            return {
              text: ((d && d.textContent) || '').replace(/\\s+/g, ' ').slice(-300),
              draft: ta ? ta.value.slice(0, 80) : null,
              submitDisabled: submit ? submit.disabled : null,
              retryButtons: document.querySelectorAll('[data-chat-retry]').length,
            }
          })()`,
        )
        .catch((e: Error) => ({ error: e.message }))
      await page.screenshot({ path: `.out/chat-dock-red-${run}.png` }).catch(() => undefined)
      diag = ` | steps: ${JSON.stringify(trace.slice(-6))} | page: ${JSON.stringify(dock)}; all sends ${JSON.stringify(seen.turns.map((t) => `${t.said.slice(-12)}:${t.message.slice(0, 10)}:${String(t.status)}`))}; screenshot .out/chat-dock-red-${run}.png`
    }
    check(
      'control: the same words typed again later are a NEW message',
      again.length === 2,
      `${String(again.length)} command(s) for those words; the page sent ${JSON.stringify(seen.turns.filter((t) => t.said === LOST).map((t) => `${t.message.slice(0, 10)}:${String(t.status)}`))}${diag}`,
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

  // 4. a person's words, focus and place survive a redraw, a resize, closing and reopening, and moving about, at both widths (#458)
  const openAt = async (viewport: { width: number; height: number }, slug = SLUG) => {
    const o = await openPage(viewport)
    await o.page.goto(`${APP}/p/${slug}/overview`, { waitUntil: 'domcontentloaded' })
    await o.page.waitForSelector('.bctop', { timeout: 20000 })
    await o.page.waitForSelector('[data-bc-dock]', { timeout: 20000 })
    await o.page.waitForTimeout(800)
    return o
  }
  const composer = (page: Page): Promise<{ value: string; focused: boolean; present: boolean }> =>
    page.evaluate(
      `(() => { const b = document.querySelector('.dock [data-docksay]'); return { present: b !== null, value: b ? b.value : '', focused: b !== null && document.activeElement === b } })()`,
    ) as Promise<{ value: string; focused: boolean; present: boolean }>
  const dockText = (page: Page): Promise<string> =>
    page.evaluate(
      `((document.querySelector('.dock') || {}).textContent || '').replace(/\\s+/g, ' ')`,
    ) as Promise<string>
  for (const [label, vp] of [
    ['desktop', DESKTOP],
    ['phone', PHONE],
  ] as const) {
    const o = await openAt(vp)
    try {
      // 4a. typing while an answer lands: every word arrives and the composer keeps the keyboard
      const HELD = `[dock proof ${run}] ${label} held question`
      o.seen.delayNextMs = 2500
      await say(o.page, HELD)
      await o.page.locator('.dock [data-docksay]').click({ force: true })
      const WORDS = `typing as the answer lands on ${label}`
      await o.page.keyboard.type(WORDS, { delay: 110 })
      const typed = await composer(o.page)
      check(
        `${label}: words typed while an answer lands all arrive (no keystroke is lost to the redraw)`,
        typed.value === WORDS,
        JSON.stringify(typed.value.slice(-40)),
      )
      check(
        `${label}: and the composer still has the keyboard after that redraw`,
        typed.focused,
        String(typed.focused),
      )
      check(
        `${label}: the held message reached the office once and the answer did land during the typing`,
        (await commandsFor(HELD)).length === 1 &&
          o.seen.turns.some((t) => t.said === HELD && t.status === 200),
      )
      // 4b. a resize (desktop to phone width and back) keeps the draft and the conversation
      const other = vp === DESKTOP ? PHONE : DESKTOP
      await o.page.setViewportSize(other)
      await o.page.waitForTimeout(400)
      await o.page.setViewportSize(vp)
      await o.page.waitForTimeout(400)
      const resized = await composer(o.page)
      check(
        `${label}: resizing the window and back keeps the draft and the conversation`,
        resized.value === WORDS && (await dockText(o.page)).includes(HELD),
        JSON.stringify({
          draft: resized.value.slice(-20),
          shows: (await dockText(o.page)).includes(HELD),
        }),
      )
      // 4c. closing and reopening the dock
      await o.page.locator('[data-dock-close]').first().click({ force: true })
      await o.page.waitForTimeout(300)
      const shut = await composer(o.page)
      await o.page.locator('[data-bc-dock]').first().click({ force: true })
      await o.page.waitForSelector('.dock [data-docksay]', { timeout: 10000 })
      const reopened = await composer(o.page)
      console.log(
        `      observed ${label}: closed -> composer present ${String(shut.present)}; reopened -> draft ${JSON.stringify(reopened.value.slice(-24))}; conversation shown ${String((await dockText(o.page)).includes(HELD))}`,
      )
      check(
        `${label}: closing and reopening the dock shows the same conversation`,
        (await dockText(o.page)).includes(HELD),
      )
      check(
        `${label}: and does not throw away what the person had typed`,
        reopened.value === WORDS,
        JSON.stringify(reopened.value.slice(-24)),
      )
      check(
        `${label}: no page error`,
        o.seen.pageErrors.length === 0,
        o.seen.pageErrors.join(' | '),
      )
    } finally {
      await o.close()
    }
  }

  // 4e. a message sent while the history read is still on its way stays on screen when that read lands (the read cannot contain it),
  // once, and is not sent a second time
  const late = await openPage(DESKTOP)
  try {
    late.seen.delayHistoryMs = 3000
    await late.page.goto(`${APP}/p/${SLUG}/overview`, { waitUntil: 'domcontentloaded' })
    await late.page.waitForSelector('.bctop', { timeout: 20000 })
    await late.page.waitForSelector('[data-bc-dock]', { timeout: 20000 })
    const EARLY = `[dock proof ${run}] sent before the history arrived`
    await say(late.page, EARLY)
    for (let waited = 0; waited < 12000 && !late.seen.historyDone; waited += 250)
      await late.page.waitForTimeout(250)
    await late.page.waitForTimeout(600)
    const shown = await dockText(late.page)
    check(
      'the held history read did land after the message was sent',
      late.seen.historyDone,
      String(late.seen.historyDone),
    )
    check(
      'a message sent while the history was still loading is still on screen once that read lands, and only once',
      shown.split(EARLY).length - 1 === 1,
      `${String(shown.split(EARLY).length - 1)} time(s) on screen`,
    )
    check(
      'and it reached the office once (nothing to type again)',
      (await commandsFor(EARLY)).length === 1,
      String((await commandsFor(EARLY)).length),
    )
    check(
      'no page error on the early send',
      late.seen.pageErrors.length === 0,
      late.seen.pageErrors.join(' | '),
    )
  } finally {
    await late.close()
  }

  // 4d. a second project: the dock follows the page, so a message sent there belongs to THAT project and the first project's
  // conversation is not on screen (no wrong-conversation send)
  const made2 = json(
    (
      await one(
        `select app.hq_create_project(${lit(OFFICE)}::uuid, ${lit(`Dock second ${run}`)}, 'upload', ${lit(`dock2-${run}`)}, ${lit(`Dock second ${run}`)}, true) as v`,
      )
    ).v,
  )
  const PROJECT2 = String(made2.project_id)
  const SLUG2 = String(
    (await one(`select slug from public.projects where project_id = ${lit(PROJECT2)}::uuid`)).slug,
  )
  const p2 = await openAt(DESKTOP, SLUG2)
  try {
    const THERE = `[dock proof ${run}] message for the second project`
    await say(p2.page, THERE)
    await p2.page.waitForTimeout(2500)
    const sent = (await commandsFor(THERE))[0]
    const header = await dockText(p2.page)
    check(
      'a message sent from the second project belongs to the second project, not the first',
      sent !== undefined && sent.project === PROJECT2 && sent.office === OFFICE,
      JSON.stringify({
        project: String(sent?.project).slice(0, 8),
        expected: PROJECT2.slice(0, 8),
      }),
    )
    check(
      "and the first project's conversation is not what the second project's dock shows",
      header.includes(`Dock second ${run}`) && !header.includes('what is the venue deposit'),
      header.slice(0, 120),
    )
    check(
      'no page error on the second project',
      p2.seen.pageErrors.length === 0,
      p2.seen.pageErrors.join(' | '),
    )
  } finally {
    await p2.close()
  }
} finally {
  await browser.close()
  server.close()
  await db.end()
}

console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
