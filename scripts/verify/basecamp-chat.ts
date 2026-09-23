/*
 * CHAT: SIGNING IN, SENDING, AND THE KEYBOARD.
 *
 * Grant, 23 September: "Currently sending messages fails with cannot reach the
 * office / unauthorized. Trace the actual authentication/API path and fix the
 * underlying problem rather than masking the error. Verify a real message can
 * be sent to the office and a real response returned. Enter should send.
 * Shift+Enter should create a newline. The Send button should continue to
 * work."
 *
 * WHAT WAS ACTUALLY WRONG, established before any of this was written: the
 * endpoint is healthy. The same request that failed in the browser answers
 * with real office state when it carries the right token - proved over the
 * network, three ways, in `verify:chat-live`. Browser storage is per ORIGIN,
 * this experiment is served from its own hostname, and there was NO WAY
 * WHATEVER to put a token into it. So every call came back 401 and the page
 * repeated the server's own word: "unauthorized".
 *
 * The office is stubbed HERE and real THERE, deliberately: sending every run
 * to the real office would put this suite's chatter in Grant's conversation.
 * What is asserted is the page's half - that it can be signed in, that a
 * refusal is honest and recoverable, and that the keyboard works.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4726
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (process.env.SUBJECT === 'source') throw new Error('asked for source')
  const { readFile } = await import('node:fs/promises')
  await readFile('.out/live/index.html')
  server = await serveLive(PORT)
  subject = 'the deployed bytes in .out/live'
} catch {
  server = await serveStudio(PORT)
}
console.log(`subject: ${subject}\n`)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

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

const GOOD = 'the-token-the-office-accepts'
const browser = await chromium.launch({ args: ['--lang=en-GB'] })

/*
  AN OFFICE THAT BEHAVES LIKE THE REAL ONE: it refuses anything but the right
  bearer, with 401 and the same body the deployed function returns.
*/
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const seen: string[] = []
  await ctx.route('**/hq-api**', async (route) => {
    const auth = route.request().headers().authorization ?? ''
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return
    }
    seen.push(`hq-api ${auth === `Bearer ${GOOD}` ? 'good' : 'bad'}`)
    if (auth !== `Bearer ${GOOD}`) {
      await route.fulfill({
        status: 401,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'unauthorized' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ data: { projects: [] } }),
    })
  })
  await ctx.route('**/voice/turn**', async (route) => {
    const auth = route.request().headers().authorization ?? ''
    seen.push(`turn ${auth === `Bearer ${GOOD}` ? 'good' : 'bad'}`)
    if (auth !== `Bearer ${GOOD}`) {
      await route.fulfill({
        status: 401,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'unauthorized' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ speak: 'Two things are late on it.', did: 'answered' }),
    })
  })
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  return { ctx, page, seen, thrown }
}

const slug = await (async (): Promise<string> => {
  const { ctx, page } = await open()
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  const s = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
  await ctx.close()
  return s
})()

/* ====================================================================== *
 * 1. A browser that has never been signed in
 * ====================================================================== */
const { ctx, page, seen, thrown } = await open()
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(700)

check(
  'a browser with no token is offered a way to sign in',
  (await page.locator('[data-bc-signinform]:not([hidden])').count()) === 1,
  'there was nowhere to enter a token, which is the whole defect',
)
const field = page.locator('#bc-token')
check(
  'and the token field is a password field, so it is not readable over a shoulder',
  (await field.getAttribute('type')) === 'password',
  (await field.getAttribute('type')) ?? '',
)
check(
  'and at least 16px, so iOS does not zoom the page on it',
  ((await page.evaluate(
    inPage(`const el = document.querySelector('#bc-token')
       return el === null ? 0 : Number.parseFloat(getComputedStyle(el).fontSize)`),
  )) as number) >= 16,
)

/* --- a token the office refuses ----------------------------------------- */
await field.fill('not-the-right-token')
await page.locator('[data-bc-signin]').click()
await page.waitForTimeout(900)
const refused = await page.locator('[data-bc-signin-said]').innerText()
check('a token the office refuses says so', /did not accept/i.test(refused), refused)
check(
  'and is not left in the browser, so the next thing does not fail the same way',
  (await page.evaluate(inPage("return localStorage.getItem('hq.token')"))) === null,
  'a refused token was kept',
)

/* --- the real one -------------------------------------------------------- *
 *
 * THE OFFICE ANSWERS WITH THE PAGE'S OWN PROJECTS.
 *
 * The first version of this stub answered every read with an empty project
 * list, which is a perfectly valid payload - so signing in succeeded and then
 * emptied the studio, and the suite reported a missing Chat button as a
 * product defect. The page exposes what it is showing; handing that straight
 * back is a realistic answer and keeps the subject of the test the same
 * project before and after signing in.
 */
const projects = (await page.evaluate(
  inPage('return JSON.stringify(window.__shots?.projects ?? [])'),
)) as string
await page.route('**/hq-api**', async (route) => {
  const auth = route.request().headers().authorization ?? ''
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    return
  }
  seen.push(`hq-api ${auth === `Bearer ${GOOD}` ? 'good' : 'bad'}`)
  if (auth !== `Bearer ${GOOD}`) {
    await route.fulfill({
      status: 401,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized' }),
    })
    return
  }
  await route.fulfill({
    status: 200,
    headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
    body: `{"data":{"projects":${projects},"crew":[]}}`,
  })
})

await field.fill(GOOD)
await page.locator('[data-bc-signin]').click()
await page.waitForTimeout(1200)
check(
  'the right token signs in',
  (await page.evaluate(inPage("return localStorage.getItem('hq.token')"))) === GOOD,
)
check(
  'and the credential does not stay in the field',
  (await page.evaluate(
    inPage(`const el = document.querySelector('#bc-token')
       return el === null ? '' : el.value`),
  )) === '',
)
check(
  'and the sign-in strip goes away once it has worked',
  (await page.locator('[data-bc-signinform]:not([hidden])').count()) === 0,
)

/* ====================================================================== *
 * 2. Sending — the button, then the keyboard
 *
 * A FRESH BROWSER THAT IS ALREADY SIGNED IN, which is the state Grant is in
 * once he has pasted the token, and the state this section is about. Section 1
 * proved signing in; this one is about whether a message goes.
 *
 * Reads are refused so the page stands on its prototype projects and says so -
 * the state every capture in this repository runs in - while the conversation
 * endpoint answers properly. That keeps the subject of the test the office's
 * REPLY rather than the shape of a payload.
 * ====================================================================== */
await ctx.close()
const {
  ctx: ctx3,
  page: chat,
  seen: chatSeen,
  thrown: chatThrew,
} = await (async () => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  await c.addInitScript(`try { localStorage.setItem('hq.token', '${GOOD}') } catch {}`)
  const heard: string[] = []
  await c.route('**/hq-api**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      : r.abort('connectionfailed'),
  )
  await c.route('**/voice/turn**', async (route) => {
    const auth = route.request().headers().authorization ?? ''
    heard.push(`turn ${auth === `Bearer ${GOOD}` ? 'good' : 'bad'}`)
    await route.fulfill({
      status: auth === `Bearer ${GOOD}` ? 200 : 401,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body:
        auth === `Bearer ${GOOD}`
          ? JSON.stringify({ speak: 'Two things are late on it.', did: 'answered' })
          : JSON.stringify({ error: 'unauthorized' }),
    })
  })
  const pg = await c.newPage()
  const threw: string[] = []
  pg.on('pageerror', (e) => {
    threw.push(e.message)
  })
  return { ctx: c, page: pg, seen: heard, thrown: threw }
})()

await chat.goto(url(slug), { waitUntil: 'domcontentloaded' })
await chat.waitForSelector('.bcmain')
await chat.waitForTimeout(700)
await chat.locator('[data-bc-dock]:visible').first().click()
await chat.waitForSelector('#dock [data-docksay]', { timeout: 10000 })
check('Chat opens the sidebar, with a composer in it', true)

const box = chat.locator('#dock [data-docksay]')
await box.fill('What is late on this project?')
await chat.locator('#dock [data-dockform] button[type="submit"]').click()
await chat
  .waitForFunction(
    "document.querySelector('#dock .thread')?.innerText?.includes('Two things are late') === true",
    undefined,
    { timeout: 15000 },
  )
  .catch(() => null)
const thread = await chat.locator('#dock .thread').innerText()
check(
  'the Send button sends, and the office answers',
  thread.includes('Two things are late'),
  thread.replace(/\n+/g, ' / ').slice(-220),
)
check('and the message went with the token', chatSeen.includes('turn good'), chatSeen.join(', '))
check(
  'nothing on screen says unauthorized',
  !/unauthori[sz]ed/i.test(await chat.locator('#dock').innerText()),
  (await chat.locator('#dock').innerText()).replace(/\n+/g, ' / ').slice(-160),
)

/* --- Enter sends --------------------------------------------------------- */
const before = await chat.locator('#dock .msg').count()
await box.fill('And what needs me?')
await box.press('Enter')
await chat.waitForTimeout(1200)
check(
  'Enter sends',
  (await chat.locator('#dock .msg').count()) > before &&
    (await chat.locator('#dock .thread').innerText()).includes('And what needs me?'),
  `${String(before)} messages before, ${String(await chat.locator('#dock .msg').count())} after`,
)
check('and clears the box', (await box.inputValue()) === '')

/* --- Shift+Enter does not ------------------------------------------------ */
const sent = await chat.locator('#dock .msg').count()
await box.fill('first line')
await box.press('Shift+Enter')
await chat.waitForTimeout(400)
const typed = await box.inputValue()
check('Shift+Enter makes a newline instead of sending', typed.includes('\n'), JSON.stringify(typed))
check(
  'and sends nothing',
  (await chat.locator('#dock .msg').count()) === sent,
  `${String(sent)} before, ${String(await chat.locator('#dock .msg').count())} after`,
)
await box.fill('')
check('nothing threw', chatThrew.length === 0, chatThrew.join(' | '))
await ctx3.close()

/* ====================================================================== *
 * 3. A token that goes stale WHILE the conversation is open
 * ====================================================================== */
{
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  await ctx2.addInitScript(`try { localStorage.setItem('hq.token', 'stale-token') } catch {}`)
  await ctx2.route('**/hq-api**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      : r.fulfill({
          status: 401,
          headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'unauthorized' }),
        }),
  )
  await ctx2.route('**/voice/turn**', (r) =>
    r.fulfill({
      status: 401,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized' }),
    }),
  )
  const p2 = await ctx2.newPage()
  await p2.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await p2.waitForSelector('.bcmain')
  await p2.waitForTimeout(600)
  await p2.locator('[data-bc-dock]:visible').first().click()
  await p2.waitForTimeout(600)
  await p2.locator('#dock [data-docksay]').fill('anyone there?')
  await p2.locator('#dock [data-dockform] button[type="submit"]').click()
  await p2.waitForTimeout(2500)
  const said = await p2.locator('#dock .thread').innerText()
  check(
    'a refused token is explained in words rather than repeated as "unauthorized"',
    /not signed in/i.test(said) && !/\bunauthori[sz]ed\b/i.test(said),
    said.replace(/\n+/g, ' / ').slice(-240),
  )
  check(
    'and the stale token is cleared, so the page can offer a way back in',
    (await p2.evaluate(inPage("return localStorage.getItem('hq.token')"))) === null,
  )
  await ctx2.close()
}

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
console.log(
  '\nTHE OFFICE IS STUBBED HERE and exercised for real in `npm run verify:chat-live`,\n' +
    'which sends a message to the deployed endpoint with the vault token and reads\n' +
    'the answer back.',
)
process.exit(fail === 0 ? 0 : 1)
