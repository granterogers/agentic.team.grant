/*
 * CHAT: SIGNING IN AS A PERSON, SENDING, AND THE KEYBOARD.
 *
 * Grant, 23 September: "Currently sending messages fails with cannot reach the
 * office / unauthorized. Trace the actual authentication/API path and fix the
 * underlying problem rather than masking the error. Enter should send.
 * Shift+Enter should create a newline. The Send button should continue to
 * work."
 *
 * And then, 24 September, the correction that rewrote what this suite is
 * about: "He does not want an office-token interaction in the normal user
 * experience AT ALL. The intended experience is: OPEN AGENTIC TEAM ->
 * APPLICATION LOADS -> USER IS AUTHENTICATED -> USE APPLICATION. If an
 * internal credential/token is required for secure communication with the
 * office, that is an IMPLEMENTATION DETAIL."
 *
 * ## What this suite USED to assert, and why that was wrong
 *
 * It drove `#bc-token`: a password field, a pasted office bearer, and
 * `localStorage['hq.token']`. Every one of those is the ceremony the
 * correction removed, so the suite went on asserting the architecture that had
 * been replaced -- it timed out waiting for a field that no longer exists, and
 * a suite waiting for a control that is gone reads exactly like a product that
 * is broken.
 *
 * ## What it asserts now
 *
 *   1. signed out, an ORDINARY LOGIN is offered: an address, and nothing that
 *      mentions a token, because the word appearing at all is the defect.
 *   2. asking posts to the sign-in function, and the page repeats what the
 *      office said rather than deciding anything itself.
 *   3. coming back from the link adopts the session, TAKES IT OUT OF THE
 *      ADDRESS BAR, and the strip goes away.
 *   4. a request then carries the PERSON'S access token -- not a shared one.
 *   5. the Send button sends, Enter sends, Shift+Enter does not.
 *   6. a session that expires mid-conversation refreshes ITSELF, once, and the
 *      retry carries the new token.
 *   7. a session the office refuses is explained in words and cleared.
 *
 * ## Why the office is stubbed
 *
 * Sending every run to the real office would put this suite's chatter in
 * Grant's conversation. What is asserted here is the PAGE's half. The office's
 * half is exercised for real in `npm run verify:chat-live` and
 * `npm run verify:basecamp-signin`, which go over the network.
 *
 *   npm run verify:basecamp-chat
 *   npm run verify:basecamp-chat -- --prove-it   # sabotage, expect red, restore
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

/* ====================================================================== *
 * THE CONTROL, first, because it re-enters this file as a child process.
 *
 * A suite whose happy path is "everything passed" cannot tell a working
 * product from a suite that stopped asking. CLAUDE.md records six occasions
 * where a sabotage silently failed to apply and the resulting green was
 * written up as proof -- so this prints what it did to the file and refuses to
 * claim anything if the edit did not land.
 * ====================================================================== */
if (process.argv.includes('--prove-it')) {
  const victim = 'web/studio/session.js'
  const before = await readFile(victim, 'utf8')
  /*
    Break the ONE thing this suite exists for: adopting the session that comes
    back in the fragment. Everything downstream -- the strip going away, the
    token on the request, sending at all -- depends on it, so if the suite
    still passes it is not looking at the session architecture.
  */
  const sabotaged = before.replace(
    "  const access = q.get('access_token') ?? ''",
    "  const access = ''",
  )
  if (sabotaged === before) {
    console.error('SABOTAGE DID NOT APPLY — adopt() has been reworded in session.js.')
    console.error('A sabotage that did not land is not a passing control. Nothing was proved.')
    process.exit(2)
  }
  await writeFile(victim, sabotaged)
  const landed = (await readFile(victim, 'utf8')).includes("const access = ''")
  console.log(`sabotage landed in ${victim}: ${String(landed)}\n`)
  const { spawnSync } = await import('node:child_process')
  const red = spawnSync('npx', ['tsx', 'scripts/verify/basecamp-chat.ts'], {
    stdio: 'inherit',
    env: { ...process.env, SUBJECT: 'source' },
  })
  await writeFile(victim, before)
  const restored = (await readFile(victim, 'utf8')) === before
  console.log(`\nrestored ${victim}: ${String(restored)}`)
  const green = spawnSync('npx', ['tsx', 'scripts/verify/basecamp-chat.ts'], {
    stdio: 'inherit',
    env: { ...process.env, SUBJECT: 'source' },
  })
  console.log(`\nwith adopt() broken: exit ${String(red.status)}`)
  console.log(`with it restored:    exit ${String(green.status)}`)
  if (red.status === 0) {
    console.error('THE SUITE CANNOT FAIL. A broken adopt() was not noticed.')
    process.exit(1)
  }
  if (green.status !== 0) {
    console.error('the restore did not restore — the tree is not as it was')
    process.exit(1)
  }
  console.log('CONTROL PASSED: red on a broken session, green again once restored.')
  process.exit(0)
}

const PORT = 4726
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (process.env.SUBJECT === 'source') throw new Error('asked for source')
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

/*
  A PERSON'S TOKEN, not the office's. Short-lived, theirs alone, and the office
  is the only thing that can say whether it is good -- which is exactly what
  the stub below models.
*/
const ACCESS = 'access-token-for-one-person'
const FRESH = 'a-refreshed-access-token'
const REFRESH = 'refresh-token-single-use'
const hour = (n: number): number => Date.now() + n * 3_600_000

const browser = await chromium.launch({ args: ['--lang=en-GB'] })

type Office = {
  readonly accept: readonly string[]
  readonly onLink?: (email: string) => { status: number; body: unknown }
  /*
    WHAT THE OFFICE HOLDS: nothing, always.

    That is not laziness. An office with no projects is every office on its
    first morning, and `PROJECTS[0]` being undefined used to take the whole
    screen down with "This screen did not draw" -- so every section that signs
    in for real is also the regression for that.

    The conversation sections need the page standing on its own prototype
    instead, projects AND crew, which is what `unreachable` is for: the
    composer does not exist without a crew, and the first version of this stub
    answered every read with an empty list, emptied the studio on sign-in, and
    reported a missing Chat button as a product defect.
  */
  /*
    OR THE OFFICE MAY SIMPLY NOT ANSWER.

    The conversation sections want the page standing on its own prototype --
    projects AND crew, which is the state every capture in this repository runs
    in -- while the turn endpoint answers properly. That keeps the subject of
    those sections the office's REPLY rather than the shape of a payload, and
    the prototype crew is what the composer needs to exist at all.
  */
  readonly unreachable?: boolean
}

/*
  AN OFFICE THAT BEHAVES LIKE THE REAL ONE.

  Three functions, because the session architecture has three: the gateway,
  which verifies a person's token; `signin`, which mints links and exchanges
  refresh tokens; and the voice function, which carries a turn.
*/
const open = async (office: Office, init = '', phone = false) => {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1440, height: 950 } },
  )
  if (init !== '') await ctx.addInitScript(init)
  const seen: string[] = []
  const good = (auth: string): boolean => office.accept.some((t) => auth === `Bearer ${t}`)

  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }

  await ctx.route('**/signin**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return
    }
    const sent = JSON.parse(route.request().postData() ?? '{}') as {
      action?: string
      email?: string
      refresh_token?: string
      back?: string
    }
    seen.push(`signin ${sent.action ?? '?'}`)
    if (sent.action === 'link') {
      if (sent.back !== undefined) seen.push(`back ${sent.back}`)
      const answer = office.onLink?.(String(sent.email ?? '')) ?? {
        status: 200,
        // The office answers the same way for any address, deliberately.
        body: { ok: true, said: 'Check your email for a link to sign in.' },
      }
      await route.fulfill({
        status: answer.status,
        headers: cors,
        body: JSON.stringify(answer.body),
      })
      return
    }
    if (sent.action === 'refresh') {
      seen.push(`refresh ${sent.refresh_token === REFRESH ? 'good' : 'bad'}`)
      await route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify(
          sent.refresh_token === REFRESH
            ? { ok: true, access_token: FRESH, refresh_token: REFRESH, expires_in: 3600 }
            : { ok: false, error: 'that link has been used' },
        ),
      })
      return
    }
    await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: false }) })
  })

  await ctx.route('**/hq-api**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return
    }
    if (office.unreachable === true) {
      await route.abort('connectionfailed')
      return
    }
    const auth = route.request().headers().authorization ?? ''
    const ok = good(auth)
    seen.push(`hq-api ${ok ? 'good' : 'bad'}${ok ? ` ${auth.slice(7)}` : ''}`)
    await route.fulfill({
      status: ok ? 200 : 401,
      headers: cors,
      body: ok ? '{"data":{"projects":[],"crew":[]}}' : JSON.stringify({ error: 'unauthorized' }),
    })
  })

  await ctx.route('**/voice*/turn**', async (route) => {
    const auth = route.request().headers().authorization ?? ''
    const ok = good(auth)
    seen.push(`turn ${ok ? 'good' : 'bad'}${ok ? ` ${auth.slice(7)}` : ''}`)
    await route.fulfill({
      status: ok ? 200 : 401,
      headers: cors,
      body: ok
        ? JSON.stringify({ speak: 'Two things are late on it.', did: 'answered' })
        : JSON.stringify({ error: 'unauthorized' }),
    })
  })

  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  return { ctx, page, seen, thrown }
}

/** A session in storage, the way `session.js` writes one. */
const stored = (access: string, expiresAt: number, refresh = REFRESH): string =>
  `try { localStorage.setItem('hq.session', ${JSON.stringify(
    JSON.stringify({ access_token: access, refresh_token: refresh, expires_at: expiresAt }),
  )}) } catch {}`

const slug = await (async (): Promise<string> => {
  const { ctx, page } = await open({ accept: [] })
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  const s = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
  await ctx.close()
  return s
})()

/* ====================================================================== *
 * 1. Signed out — an ordinary login, and the word token nowhere near it
 * ====================================================================== */
{
  const { ctx, page, seen } = await open({ accept: [] })
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(700)

  const form = page.locator('[data-bc-signinform]:not([hidden])')
  check('a browser with no session is offered a way to sign in', (await form.count()) === 1)

  const field = page.locator('#bc-email')
  check(
    'and what it asks for is an email address',
    (await field.getAttribute('type')) === 'email',
    (await field.getAttribute('type')) ?? '(no field)',
  )
  /*
    16px is a property of a TOUCH device (iOS zooms the page on focus), so it is measured on one. On a desktop with a mouse
    the sign-in strip is deliberately a thin line with a 13px field (docs.css, "quiet sign-in/out controls", Grant 4 Oct);
    that rule is scoped to (min-width: 861px) and (pointer: fine) and never reaches a phone. The first draft of this check
    measured the desktop field and was red when the strip was made quiet: it asserted the artefact, not the property.
  */
  {
    const phone = await open({ accept: [] }, '', true)
    await phone.page.goto(url(slug), { waitUntil: 'domcontentloaded' })
    await phone.page.waitForSelector('#bc-email')
    await phone.page.waitForTimeout(500)
    check(
      'and at least 16px on a touch phone, so iOS does not zoom the page on it',
      ((await phone.page.evaluate(
        inPage(`const el = document.querySelector('#bc-email')
         return el === null ? 0 : Number.parseFloat(getComputedStyle(el).fontSize)`),
      )) as number) >= 16,
    )
    await phone.ctx.close()
  }
  /*
    THE CORRECTION, ASSERTED.

    Not "there is no password field" -- an enumeration of the shapes the old
    ceremony could take would miss the next one. The property is that the
    normal user experience never mentions the office's credential at all.
  */
  const words = await page.locator('[data-bc-signinform]').innerText()
  check(
    'and nothing in it mentions a token, which is the correction itself',
    !/\btokens?\b/i.test(words) && (await page.locator('#bc-token').count()) === 0,
    words.replace(/\n+/g, ' / ').slice(0, 200),
  )

  /* --- asking for a link ------------------------------------------------ */
  await field.fill('someone@example.com')
  await page.locator('[data-bc-signin]').click()
  await page.waitForTimeout(900)
  const said = await page.locator('[data-bc-signin-said]').innerText()
  check('asking reaches the sign-in function', seen.includes('signin link'), seen.join(', '))
  check('and the page repeats what the office said', /check your email/i.test(said), said)
  check(
    'and tells it where to come back to, so the link lands on this page',
    seen.some((s) => s.startsWith('back http')),
    seen.filter((s) => s.startsWith('back')).join(', '),
  )
  check(
    'and nothing was stored merely by asking',
    (await page.evaluate(inPage("return localStorage.getItem('hq.session')"))) === null,
  )

  /* --- an address the office will not serve ----------------------------- */
  await ctx.close()
}
{
  const { ctx, page } = await open({
    accept: [],
    onLink: () => ({ status: 400, body: { error: 'That address is not one of ours.' } }),
  })
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(600)
  await page.locator('#bc-email').fill('stranger@example.com')
  await page.locator('[data-bc-signin]').click()
  await page.waitForTimeout(900)
  const said = await page.locator('[data-bc-signin-said]').innerText()
  check(
    'a refusal arrives in the office’s own words, not as a status code',
    said.includes('not one of ours') && !/\b400\b/.test(said),
    said,
  )
  await ctx.close()
}

/* ====================================================================== *
 * 2. Coming back from the link
 *
 * Supabase returns the session in the URL FRAGMENT, which never leaves the
 * browser. Taking it out of the address bar immediately afterwards matters for
 * a different reason: a URL with a token in it is a URL somebody pastes into a
 * chat.
 * ====================================================================== */
{
  const { ctx, page, seen, thrown } = await open({ accept: [ACCESS] })
  const back = `${url(slug)}#access_token=${ACCESS}&refresh_token=${REFRESH}&expires_in=3600&token_type=bearer`
  await page.goto(back, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(1200)

  const held = (await page.evaluate(inPage("return localStorage.getItem('hq.session')"))) as
    | string
    | null
  check(
    'the link signs the person in',
    held !== null && String(held).includes(ACCESS),
    String(held ?? '(nothing stored)').slice(0, 120),
  )
  const showing = (await page.evaluate(inPage('return window.location.href'))) as string
  check(
    'and the token is taken out of the address bar, so it cannot be pasted anywhere',
    !showing.includes(ACCESS),
    showing,
  )
  check(
    'and the sign-in strip goes away once there is a session',
    (await page.locator('[data-bc-signinform]:not([hidden])').count()) === 0,
  )
  check(
    'and the office is asked with the PERSON’s token, not a shared one',
    seen.some((s) => s === `hq-api good ${ACCESS}`),
    seen.filter((s) => s.startsWith('hq-api')).join(', '),
  )
  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* ====================================================================== *
 * 3. Sending — the button, then the keyboard
 * ====================================================================== */
{
  const {
    ctx,
    page: chat,
    seen,
    thrown,
  } = await open({ accept: [ACCESS], unreachable: true }, stored(ACCESS, hour(1)))
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
  check(
    'and the turn went with the person’s own token',
    seen.includes(`turn good ${ACCESS}`),
    seen.filter((s) => s.startsWith('turn')).join(', '),
  )
  check(
    'nothing on screen says unauthorized',
    !/unauthori[sz]ed/i.test(await chat.locator('#dock').innerText()),
    (await chat.locator('#dock').innerText()).replace(/\n+/g, ' / ').slice(-160),
  )

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

  const sent = await chat.locator('#dock .msg').count()
  await box.fill('first line')
  await box.press('Shift+Enter')
  await chat.waitForTimeout(400)
  const typed = await box.inputValue()
  check(
    'Shift+Enter makes a newline instead of sending',
    typed.includes('\n'),
    JSON.stringify(typed),
  )
  check(
    'and sends nothing',
    (await chat.locator('#dock .msg').count()) === sent,
    `${String(sent)} before, ${String(await chat.locator('#dock .msg').count())} after`,
  )
  await box.fill('')
  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* ====================================================================== *
 * 4. A session that is nearly out refreshes ITSELF
 *
 * This is the whole promise of the architecture -- "a magic link, once, and
 * then nothing" -- and it is invisible to every other suite, because a session
 * that works and a session that quietly renewed itself look identical from
 * outside. Stored a minute past its deadline, so the margin in `presentable`
 * cannot mask a refresh that never happens.
 * ====================================================================== */
{
  const { ctx, page, seen, thrown } = await open(
    { accept: [FRESH] },
    stored('the-expired-one', Date.now() - 60_000),
  )
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(1500)

  check(
    'an expiring session is exchanged rather than thrown away',
    seen.includes('refresh good'),
    seen.filter((s) => s.startsWith('refresh') || s.startsWith('signin')).join(', '),
  )
  check(
    'and the request that follows carries the NEW token',
    seen.some((s) => s === `hq-api good ${FRESH}`),
    seen.filter((s) => s.startsWith('hq-api')).join(', '),
  )
  /*
    ONE EXCHANGE, not one per request. A refresh token is single use, so a
    second exchange would fail and sign a working session out -- the defect
    `refreshing` exists to prevent, and nothing else asks about it.
  */
  check(
    'and only once, however many requests the page load makes',
    seen.filter((s) => s.startsWith('refresh')).length === 1,
    seen.filter((s) => s.startsWith('refresh')).join(', '),
  )
  check(
    'and the browser is left holding the new session',
    String(
      (await page.evaluate(inPage("return localStorage.getItem('hq.session')"))) ?? '',
    ).includes(FRESH),
  )
  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* ====================================================================== *
 * 5. A session the office refuses, mid-conversation
 * ====================================================================== */
{
  const { ctx, page } = await open(
    { accept: [], unreachable: true },
    stored('a-session-that-was-revoked', hour(1)),
  )
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(700)
  await page.locator('[data-bc-dock]:visible').first().click()
  await page.waitForTimeout(700)
  await page.locator('#dock [data-docksay]').fill('anyone there?')
  await page.locator('#dock [data-dockform] button[type="submit"]').click()
  await page.waitForTimeout(2500)
  const said = await page.locator('#dock .thread').innerText()
  check(
    'a refused session is explained in words rather than repeated as "unauthorized"',
    /not signed in/i.test(said) && !/\bunauthori[sz]ed\b/i.test(said),
    said.replace(/\n+/g, ' / ').slice(-240),
  )
  check(
    'and it is cleared, so the page can offer a way back in',
    (await page.evaluate(inPage("return localStorage.getItem('hq.session')"))) === null,
  )
  await ctx.close()
}

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
console.log(
  '\nTHE OFFICE IS STUBBED HERE and exercised for real in `npm run verify:chat-live`\n' +
    'and `npm run verify:basecamp-signin`, which go to the deployed functions.\n' +
    'Prove this suite can fail: `npm run verify:basecamp-chat -- --prove-it`.',
)
process.exit(fail === 0 ? 0 : 1)
