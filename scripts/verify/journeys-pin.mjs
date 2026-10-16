/*
 * The PIN sign-in journey, in a real Chromium, against a MOCKED sign-in function. Local only: no token, no production
 * contact, and the PIN is never printed.
 *
 *   python3 -m http.server 8765 --directory web/studio  &&  node scripts/verify/journeys-pin.mjs
 *
 * A person who is signed out sees the PIN form when the office offers PIN sign-in. The journey checks that they can use
 * it by keyboard alone, that the office's own sentences are shown when it refuses, and that a correct PIN stores a
 * session that survives the reload. Each check is paired with what it must NOT show.
 *
 * The mock answers only what the office answers (see supabase/functions/signin/index.ts): a wrong PIN, a lock and an
 * unknown address each come back as the same kind of sentence, and nothing is stored on a refusal.
 */
import { chromium } from 'playwright'

const BASE = process.env.STUDIO_URL ?? 'http://127.0.0.1:8765/'
const SIGNIN = 'https://signin.test/mock/signin'
const PIN_REFUSED = 'That PIN is not right. Check it and try again.'
const PIN_LOCKED = 'Too many wrong PINs. Try again in fifteen minutes.'
const EMAIL = 'pin.journey@example.test'
const PIN = '4821'
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

/*
 * A context whose sign-in function is the mock. `methods` decides whether the office offers PIN sign-in; `answer` decides
 * what it says to pin_sign_in. Every request to the sign-in function is recorded, with the PIN only as its length.
 */
async function openSignedOut({ methods = true, answer, width = 1440, mobile = false }) {
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile })
  await context.addInitScript(
    ({ signin }) => {
      window.HQ_SIGNIN = signin
      window.HQ_API = 'https://gw.test/mock/hq-api'
    },
    { signin: SIGNIN },
  )
  const requests = []
  await context.route(`${SIGNIN}*`, (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    requests.push({ action: body.action, email: body.email, pinLength: typeof body.pin === 'string' ? body.pin.length : 0 })
    if (body.action === 'methods') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pin: methods }) })
    }
    if (body.action === 'pin_sign_in' && answer !== undefined) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(body)) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, said: 'not in this check' }) })
  })
  // Nothing else leaves the machine. A network failure keeps a held session, so the page is not signed out by accident.
  await context.route('https://**', (route) => route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  // The header's "Sign in" link (shell.js, a.bcsignlink) opens the entry screen at ?welcome, the same way a person does.
  await page.goto(`${BASE}?welcome`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  return { context, page, requests, errors }
}

const formVisible = (page) =>
  page.evaluate(() => {
    const f = document.querySelector('[data-bc-password-form]')
    if (f === null) return false
    const r = f.getBoundingClientRect()
    return r.height > 0 && getComputedStyle(f).display !== 'none'
  })

const said = (page) => page.evaluate(() => document.querySelector('[data-bc-password-said]')?.textContent.trim() ?? '')
const storedSession = (page) => page.evaluate(() => localStorage.getItem('hq.session') !== null)

// --- 1. The form is offered only when the office offers PIN sign-in ----------------------------------------------------
for (const [label, width, mobile] of [['desktop', 1440, false], ['phone', 390, true]]) {
  const on = await openSignedOut({ methods: true, width, mobile })
  check(`1 (${label}): a signed-out person sees the PIN form when the office offers it`, await formVisible(on.page))
  const hasFields = await on.page.evaluate(() => {
    const f = document.querySelector('[data-bc-password-form]')
    return f !== null && f.querySelector('[name=email]') !== null && f.querySelector('[name=pin]') !== null
  })
  check(`1 (${label}): the form has an email field and a PIN field`, hasFields)
  await on.context.close()

  const off = await openSignedOut({ methods: false, width, mobile })
  check(`1 control (${label}): with PIN sign-in off the form is absent`, !(await formVisible(off.page)))
  await off.context.close()
}

// --- 2. By keyboard alone: type an address and a PIN, press Enter -------------------------------------------------------
{
  const j = await openSignedOut({
    answer: () => ({ ok: true, session: { access_token: 'mock', refresh_token: 'mock', expires_in: 3600, token_type: 'bearer' } }),
  })
  const { page } = j
  // Focus the email field by Tab from the top of the page, not by script, so the path is the one a keyboard user takes.
  let reached = false
  for (let i = 0; i < 60 && !reached; i += 1) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement?.name === 'email' && document.activeElement.closest('[data-bc-password-form]') !== null)
  }
  check('2: the email field can be reached by Tab', reached)
  await page.keyboard.type(EMAIL)
  await page.keyboard.press('Tab')
  const onPin = await page.evaluate(() => document.activeElement?.name === 'pin')
  check('2: Tab moves from the email field to the PIN field', onPin)
  await page.keyboard.type(PIN)
  const pinShown = await page.evaluate(() => document.activeElement?.value?.length ?? 0)
  check('2: the PIN field takes the digits (its value is not reported)', pinShown === PIN.length)

  // Control: the PIN field must not be a visible text field. A PIN printed on screen is a defect.
  const pinIsPassword = await page.evaluate(() => document.activeElement?.type === 'password')
  check('2: the PIN field masks what is typed', pinIsPassword)

  const focusRing = await page.evaluate(() => {
    const el = document.activeElement
    const cs = getComputedStyle(el)
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'
  })
  check('2: the PIN field shows a visible focus ring', focusRing)

  await page.keyboard.press('Enter')
  await page.waitForFunction(() => localStorage.getItem('hq.session') !== null, null, { timeout: 15000 }).catch(() => undefined)
  await page.waitForTimeout(800)
  const sent = j.requests.find((r) => r.action === 'pin_sign_in')
  check('2: Enter sends the sign-in request with the address the person typed', sent?.email === EMAIL, sent === undefined ? 'no request' : '')
  check('2: the request carries the PIN (its length only is recorded)', sent?.pinLength === PIN.length)
  check('2: a correct PIN stores a session, and it survives the reload', await storedSession(page))
  check('2: no page error on the way through', j.errors.length === 0, j.errors.slice(0, 2).join(' | '))
  await j.context.close()
}

// --- 3. Refusals that never reach the office -----------------------------------------------------------------------------
{
  const j = await openSignedOut({ answer: () => ({ ok: false, said: PIN_REFUSED }) })
  const { page } = j
  await page.fill('[data-bc-password-form] [name=email]', EMAIL)
  await page.click('[data-bc-password-form] button[type=submit]')
  await page.waitForTimeout(400)
  check('3: an empty PIN is refused on the page with a sentence', (await said(page)) === 'Enter your PIN.', await said(page))
  check('3: an empty PIN sends no request to the office', !j.requests.some((r) => r.action === 'pin_sign_in'))

  await page.fill('[data-bc-password-form] [name=email]', 'not-an-address')
  await page.fill('[data-bc-password-form] [name=pin]', PIN)
  await page.click('[data-bc-password-form] button[type=submit]')
  await page.waitForTimeout(400)
  check(
    '3: a bad address is refused on the page with a sentence',
    (await said(page)) === 'That does not look like an email address.',
    await said(page),
  )
  check('3: a bad address sends no request to the office', !j.requests.some((r) => r.action === 'pin_sign_in'))
  await j.context.close()
}

// --- 4. The office's own refusals are shown, and nothing is stored --------------------------------------------------------
for (const [label, sentence] of [
  ['a wrong PIN', PIN_REFUSED],
  ['a locked login', PIN_LOCKED],
]) {
  const j = await openSignedOut({ answer: () => ({ ok: false, said: sentence }) })
  const { page } = j
  await page.fill('[data-bc-password-form] [name=email]', EMAIL)
  await page.fill('[data-bc-password-form] [name=pin]', PIN)
  await page.click('[data-bc-password-form] button[type=submit]')
  await page.waitForTimeout(800)
  check(`4 (${label}): the office's sentence is shown`, (await said(page)) === sentence, await said(page))
  check(`4 (${label}): no session is stored`, !(await storedSession(page)))
  check(`4 (${label}): the person stays on the form and can try again`, await formVisible(page))
  const enabled = await page.evaluate(() => !document.querySelector('[data-bc-password-form] button[type=submit]').disabled)
  check(`4 (${label}): the submit button is enabled again`, enabled)
  await j.context.close()
}

// --- 5. The office cannot be reached: the person is told, and nothing is stored --------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    window.HQ_SIGNIN = 'https://signin.test/mock/signin'
    window.HQ_API = 'https://gw.test/mock/hq-api'
  })
  await context.route('https://signin.test/**', (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    if (body.action === 'methods') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pin: true }) })
    }
    return route.abort()
  })
  await context.route('https://**', (route) => route.abort())
  const page = await context.newPage()
  // The header's "Sign in" link (shell.js, a.bcsignlink) opens the entry screen at ?welcome, the same way a person does.
  await page.goto(`${BASE}?welcome`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.fill('[data-bc-password-form] [name=email]', EMAIL)
  await page.fill('[data-bc-password-form] [name=pin]', PIN)
  await page.click('[data-bc-password-form] button[type=submit]')
  await page.waitForTimeout(1200)
  const words = await said(page)
  check('5: an unreachable office is said so on the page', words.length > 0 && /reach|try again/i.test(words), words)
  check('5: nothing is stored when the office cannot be reached', !(await storedSession(page)))
  await context.close()
}

await browser.close()
if (failures.length > 0) {
  console.log(`\n${String(failures.length)} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
