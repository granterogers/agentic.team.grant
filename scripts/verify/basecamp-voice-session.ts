/*
 * THE SESSION THE BASECAMP PAGE MINTS IS ONE THE BACKEND CALLS HIS.
 *
 *   sudo scripts/isolated/replica.sh   # once
 *   npm run verify:basecamp-voice-session
 *
 * Integration pass, 28 September 2026 — the check neither remediation branch
 * could run, because each held only one half of it.
 *
 * The backend branch's 0598 makes every `/voice/turn` turn whose session is not
 * shaped `s` + base36 (1–10) HARNESS, so its answer is never delivered. That is
 * deny-by-default on a production door, and its premise is that only the page
 * talks to that door and the page always mints that shape; `check:voice-
 * sessions` pins the premise by reading the source. The UX branch then added
 * two new ways to reach the door from the Basecamp experience — the dock's
 * composer and a voice note on both the Chat page and the dock — all through
 * `chat.js`. If any of them sent a different session, 0598 would silence
 * Grant's own messages and nothing on either branch would notice: a static
 * check reads a literal, not what a browser actually sends.
 *
 * So this presses the real controls in a real browser against a fake door,
 * collects every session actually sent, composes the dedupe key the voice
 * function composes (`voice:turn:<session>.<n>`), and asks the REAL predicate
 * — `app.harness_job`'s voice half from the repository's own migrations —
 * on the isolated replica. Nothing leaves the sandbox: the door is intercepted
 * and the database is a marked local socket (guard.ts refuses anything else).
 */
import { chromium } from 'playwright'
import { isolated } from '../isolated/guard.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4698
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
const db = await isolated(process.env.ISOLATED_DB ?? 'post')

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const harness = async (key: string): Promise<boolean> => {
  const { rows } = await db.execute(
    `select app.harness_voice_session('${key.replace(/'/g, "''")}') as h`,
  )
  return (rows[0] as { h: boolean }).h
}

/* THE CONTROL FIRST: the predicate can tell the two apart on this replica. */
check(
  'CONTROL: the replica predicate calls a scripted session harness',
  (await harness('voice:turn:verify-x.1')) && (await harness('voice:turn:deploy1790157906882.1')),
)
check('CONTROL: and a page-shaped one real', !(await harness('voice:turn:s9czo3u0fw.1')))

const browser = await chromium.launch()

type Sent = { where: string; session: string; said: string }
const visit = async (): Promise<Sent[]> => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
  )
  const sent: Sent[] = []
  let where = ''
  await ctx.route('**/turn**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      session?: string
      said?: string
    }
    sent.push({ where, session: String(body.session ?? ''), said: String(body.said ?? '') })
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ reply: 'Noted.', said: 'Noted.' }),
    })
  })
  await ctx.route('**/hq-api**', (r) => r.abort('connectionfailed'))
  const page = await ctx.newPage()
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  const slug = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string

  where = 'dock'
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('[data-bc-dock]:visible').first().click()
  await page.waitForTimeout(700)
  await page.locator('#dock [data-docksay]').fill('From the dock.')
  await page.locator('#dock [data-dockform] button[type="submit"]').click()
  await page.waitForTimeout(1500)

  /* IN-APP navigation, not goto: a reload is a new visit and rightly a new
     session, which would make the one-conversation check below meaningless. */
  where = 'chat page'
  await page.evaluate(
    inPage(`history.pushState({}, '', ${JSON.stringify(`${slug}/chat`)})
       dispatchEvent(new PopStateEvent('popstate'))`),
  )
  await page.waitForSelector('[data-bc-sayform]', { timeout: 10000 })
  await page.waitForTimeout(700)
  await page.fill('#bc-say', 'From the Chat page.')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  await ctx.close()
  return sent
}

/* Several visits, because the session is random and one sample is one draw. */
const all: Sent[] = []
for (let i = 0; i < 6; i += 1) all.push(...(await visit()))

check(
  'both composers reached the door on every visit',
  all.filter((s) => s.where === 'chat page').length === 6 &&
    all.filter((s) => s.where === 'dock').length === 6,
  all.map((s) => s.where).join(', '),
)
let real = 0
const bad: string[] = []
for (const s of all) {
  if (await harness(`voice:turn:${s.session}.1`)) bad.push(`${s.where}: ${s.session}`)
  else real += 1
}
check(
  'every session the Basecamp page actually sent is REAL to 0598',
  bad.length === 0 && real === all.length,
  bad.join('; '),
)
/* One visit, one conversation: the dock and the Chat page are the same thread. */
const byVisit: string[][] = []
for (let i = 0; i < all.length; i += 2)
  byVisit.push([all[i]?.session ?? '', all[i + 1]?.session ?? ''])
check(
  'within one visit the Chat page and the dock send ONE session',
  byVisit.every(([a, b]) => a !== '' && a === b),
  JSON.stringify(byVisit),
)
check(
  'and different visits are different conversations',
  new Set(byVisit.map(([a]) => a)).size === byVisit.length,
)

await browser.close()
await server.close()
await db.end()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exitCode = fail === 0 ? 0 : 1
