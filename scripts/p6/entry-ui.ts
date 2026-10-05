/**
 * The signed-out experience, the account creation form and the set-up screen, in a real browser against local files.
 *   npx tsx scripts/p6/entry-ui.ts [label]      captures into .out/entry-<label>/ at four widths
 *
 * The office is unreachable on purpose and the link-sending endpoint is answered by the harness, so nothing is sent and
 * nobody is emailed. What is judged is the page: what a stranger sees, what the form says at each step, that it fits a
 * phone, that every control has a name and is at least 44px where touched, that the keyboard reaches everything, and that
 * the words a person reads never include an internal noun. The real link and the real office are proved by
 * `verify:account-lifecycle` and by `verify:account-ui` (the deployed page).
 */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'

const label = process.argv[2] ?? 'now'
const out = `.out/entry-${label}`
mkdirSync(out, { recursive: true })

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  try {
    const body = await readFile(
      join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, '')),
    )
    res.writeHead(200, {
      'content-type':
        TYPES[extname(path) === '' ? '.html' : extname(path)] ?? 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4796, '127.0.0.1', () => r()))

const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`)
}

const WIDTHS = [
  { name: 'desktop', width: 1680, height: 1000, touch: false },
  { name: 'laptop', width: 1280, height: 800, touch: false },
  { name: 'tablet', width: 820, height: 1100, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true },
]

const prepare = async (page: Page, signin: { answer: Record<string, unknown> }): Promise<void> => {
  await page.route(/\.supabase\.co\/functions\/v1\/hq-api/, (route) => route.abort())
  await page.route(/\/functions\/v1\/signin/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(signin.answer),
    }),
  )
}

const FORBIDDEN =
  /tenant|workspace|organi[sz]ation|office[_ ]?id|\btoken\b|\bRLS\b|supabase|basecamp/i

const browser = await chromium.launch()
for (const vp of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch && vp.width < 600,
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const signin = {
    answer: { ok: true, said: 'Check your email for a link to sign in.' } as Record<
      string,
      unknown
    >,
  }
  await prepare(page, signin)
  await page.goto('http://127.0.0.1:4796/?welcome=1', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcentrycard', { timeout: 20000 })
  await page.waitForTimeout(600)
  const tag = `${vp.name}`

  // --- 1. what a stranger sees ------------------------------------------------
  const text = await page.locator('.bcentrycard').innerText()
  check(
    `${tag}: the entry screen offers Sign in and Create account`,
    (await page.locator('[data-bc-entry-tab]').count()) === 2,
  )
  check(
    `${tag}: no internal noun in the words`,
    !FORBIDDEN.test(text),
    text.match(FORBIDDEN)?.[0] ?? '',
  )
  check(
    `${tag}: no invented projects behind it`,
    (await page.locator('.bcmain, .bctop').count()) === 0,
  )
  await page.screenshot({ path: `${out}/${tag}-1-signin.png`, fullPage: true })

  const wide = await page.evaluate(
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
  )
  check(`${tag}: no sideways scroll`, Number(wide) <= 1, `${String(wide)}px`)

  // --- 2. sizes, names, fonts ---------------------------------------------------
  const floor = vp.touch ? 44 : 40
  const audit = (await page.evaluate(`(() => {
    const bad = []
    for (const el of document.querySelectorAll('.bcentrycard button, .bcentrycard input, .bcentrycard a')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      const name = (el.getAttribute('aria-label') || el.textContent || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || '').trim()
      if (!name) bad.push('no name: ' + el.tagName)
      if (r.height < ${floor} - 1 && el.tagName !== 'A') bad.push(el.tagName + ' ' + name.slice(0, 20) + ' ' + Math.round(r.height) + 'px')
      if (el.tagName === 'INPUT' && parseFloat(getComputedStyle(el).fontSize) < 16) bad.push('input under 16px: ' + name)
    }
    return bad
  })()`)) as string[]
  check(
    `${tag}: controls are named, tall enough, inputs are 16px or more`,
    audit.length === 0,
    audit.join('; '),
  )

  // --- 3. validation, in words -------------------------------------------------
  await page.locator('[data-bc-entry-tab="create"]').click()
  await page.locator('[data-bc-entry-form="create"] button[type=submit]').click()
  check(
    `${tag}: create with nothing typed says what is missing`,
    /name first/i.test(await page.locator('[data-bc-entry-said]').innerText()),
  )
  await page.fill('#bc-entry-name', 'Alex Morgan')
  await page.fill('#bc-entry-email-new', 'not-an-address')
  await page.locator('[data-bc-entry-form="create"] button[type=submit]').click()
  check(
    `${tag}: a bad address is refused in words`,
    /does not look like an email/i.test(await page.locator('[data-bc-entry-said]').innerText()),
  )
  await page.screenshot({ path: `${out}/${tag}-2-create-invalid.png`, fullPage: true })

  // --- 4. success: the confirmation says what happens next -----------------------
  await page.fill('#bc-entry-email-new', 'alex.morgan@example.invalid')
  await page.locator('[data-bc-entry-form="create"] button[type=submit]').click()
  await page.waitForSelector('.bcentrysent', { timeout: 8000 })
  const sent = await page.locator('.bcentrysent').innerText()
  check(
    `${tag}: after Create account it says to check email and names the address`,
    /check your email/i.test(sent) && sent.includes('alex.morgan@example.invalid'),
  )
  check(
    `${tag}: and says an existing account is simply signed in`,
    /already had an account/i.test(sent),
  )
  await page.screenshot({ path: `${out}/${tag}-3-sent.png`, fullPage: true })
  await page.locator('[data-bc-entry-other]').click()
  check(
    `${tag}: Use a different address returns to the form with the name kept`,
    (await page.inputValue('#bc-entry-name')) === 'Alex Morgan',
  )

  // --- 5. failure is said, not swallowed -----------------------------------------
  signin.answer = {
    ok: false,
    said: 'The office could not send that. Check the address, or try again shortly.',
  }
  await page.fill('#bc-entry-email-new', 'alex.morgan@example.invalid')
  await page.locator('[data-bc-entry-form="create"] button[type=submit]').click()
  await page.waitForTimeout(700)
  const failed =
    (await page
      .locator('[data-bc-entry-said]')
      .innerText()
      .catch(() => '')) +
    (await page
      .locator('.bcentrysent')
      .innerText()
      .catch(() => ''))
  check(
    `${tag}: a send failure is not reported as success`,
    !/check your email/i.test(failed) || /could not send/i.test(failed),
    failed.slice(0, 80),
  )
  signin.answer = { ok: true }

  // --- 6. keyboard ---------------------------------------------------------------
  await page.goto('http://127.0.0.1:4796/?welcome=1', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcentrycard')
  const order: string[] = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    order.push(
      (await page.evaluate(
        `(document.activeElement?.getAttribute('data-bc-entry-tab') || document.activeElement?.id || document.activeElement?.tagName || '')`,
      )) as string,
    )
  }
  check(
    `${tag}: Tab reaches both tabs, the email field and the button`,
    order.includes('signin') &&
      order.includes('create') &&
      order.some((o) => /bc-entry-email/.test(o)) &&
      order.includes('BUTTON'),
    order.join(' > '),
  )

  // --- 7. the set-up screen, as a signed-in person with no office ------------------
  const page2 = await context.newPage()
  await page2.route(/\.supabase\.co\/functions\/v1\/hq-api/, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: 'no_office', can_create: true }),
    }),
  )
  await page2.route(/\/functions\/v1\/signin/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true, email: 'alex.morgan@example.invalid' }),
    }),
  )
  await page2.addInitScript(
    `localStorage.setItem('hq.session', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Date.now() + 3600000 })); localStorage.setItem('hq.signup-name', 'Alex Morgan')`,
  )
  await page2.goto('http://127.0.0.1:4796/', { waitUntil: 'domcontentloaded' })
  await page2.waitForSelector('[data-bc-setup-form]', { timeout: 20000 })
  await page2.waitForTimeout(600)
  const setup = await page2.locator('.bcentrycard').innerText()
  check(
    `${tag}: a signed-in person with no office is asked to set one up, in plain words`,
    /set up your office/i.test(setup) && !FORBIDDEN.test(setup),
    setup.match(FORBIDDEN)?.[0] ?? '',
  )
  check(
    `${tag}: the name from sign-up is already filled in`,
    (await page2.inputValue('#bc-setup-name')) === 'Alex Morgan',
  )
  check(
    `${tag}: and Sign out is offered`,
    (await page2.locator('[data-bc-setup-out]').count()) === 1,
  )
  await page2.screenshot({ path: `${out}/${tag}-4-setup.png`, fullPage: true })
  await page2.close()

  check(`${tag}: no page errors`, errors.length === 0, errors.join('; ').slice(0, 120))
  await context.close()
}
await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\nentry-ui: ${results.length - failed.length}/${results.length}  (captures in ${out})`)
if (failed.length > 0) process.exitCode = 1
