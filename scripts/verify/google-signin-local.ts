/*
 * Continue with Google, in a real Chromium, against a mocked office. Nothing from production.
 *   npm run verify:google-signin
 *
 * Local class: a static server over web/studio and a mocked sign-in function (page.route). The page is given its endpoints
 * through the same globals a deployment's config sets. Asserted at desktop and at 390 x 844:
 *   A. the flag is off by default: no Google button is drawn
 *   B. with the flag on: the button is drawn, and pressing it asks the office for a provider address with a flow nonce
 *   C. the browser is sent to the provider address, and this browser remembers a google flow for that nonce
 *   D. a return from Google with a valid session, for that nonce, is adopted
 *   E. a return that names a cancellation shows the cancellation, and nothing is adopted
 *   F. a return with a session but no flow in this browser (a forwarded link) is refused and nothing is adopted
 *   G. when the office refuses to start (not set up), the page shows the office's sentence beside the button
 * A control: with the flag off the button must be absent, so a broken detector cannot pass by drawing nothing.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const b = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(b)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4798, '127.0.0.1', () => r()))

const SIGNIN = 'https://signin.test/functions/v1/signin'
const PROVIDER = 'https://provider.test/auth/v1/authorize'
const GATEWAY = 'https://gw.test/functions/v1/hq-api'
const ORIGIN = 'http://127.0.0.1:4798'
const NONCE = 'g'.repeat(30)
const CANCELLED = 'You cancelled signing in with Google, so nothing was changed.'
const OTHER_BROWSER_START = 'This sign-in link was not requested from this browser'
const JSON_TYPE = 'application/json'

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const browser = await chromium.launch()

type Office = { google: boolean; startSaid?: string }

async function openPage(office: Office, width: number, mobile: boolean) {
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    isMobile: mobile,
    hasTouch: mobile,
  })
  await context.addInitScript(
    ({ signin, gateway }) => {
      ;(window as unknown as Record<string, string>).HQ_SIGNIN = signin
      ;(window as unknown as Record<string, string>).HQ_API = gateway
    },
    { signin: SIGNIN, gateway: GATEWAY },
  )
  const starts: Record<string, unknown>[] = []
  const flowsSeen: string[] = []
  await context.route(`${SIGNIN}*`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
    const action = String(body.action ?? '')
    if (action === 'methods') {
      return route.fulfill({
        status: 200,
        contentType: JSON_TYPE,
        body: JSON.stringify({ ok: true, password: false, google: office.google }),
      })
    }
    if (action === 'google_start') {
      starts.push(body)
      // Read this browser's flow store from the page's own frame, before the navigation that leaves this origin.
      const seen = await route
        .request()
        .frame()
        .evaluate(() => localStorage.getItem('hq.signin.flow') ?? '')
      flowsSeen.push(seen)
      if (office.startSaid !== undefined) {
        return route.fulfill({
          status: 200,
          contentType: JSON_TYPE,
          body: JSON.stringify({ ok: false, said: office.startSaid }),
        })
      }
      const url = `${PROVIDER}?provider=google&redirect_to=${encodeURIComponent(String(body.back))}`
      return route.fulfill({
        status: 200,
        contentType: JSON_TYPE,
        body: JSON.stringify({ ok: true, url }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: JSON_TYPE,
      body: JSON.stringify({ ok: false, said: 'not in this check' }),
    })
  })
  await context.route(`${PROVIDER}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>provider</title><p>provider page</p>',
    }),
  )
  await context.route(`${GATEWAY}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: JSON_TYPE,
      body: JSON.stringify({ ok: false }),
    }),
  )
  await context.route('https://**', (route) => route.abort())
  const page = await context.newPage()
  return { context, page, starts, flowsSeen }
}

const hasButton = (page: Page) => page.locator('[data-bc-google-start]').count()

for (const [label, width, mobile] of [
  ['desktop', 1440, false],
  ['phone', 390, true],
] as const) {
  // A. Off by default.
  {
    const { context, page } = await openPage({ google: false }, width, mobile)
    await page.goto(`${ORIGIN}/?welcome=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    check(
      `${label}: A. the flag is off, so no Google button is drawn`,
      (await hasButton(page)) === 0,
    )
    await context.close()
  }

  // B-C. On: the button is drawn, pressing it asks for a provider address with a flow, and sends the browser there.
  {
    const { context, page, starts, flowsSeen } = await openPage({ google: true }, width, mobile)
    await page.goto(`${ORIGIN}/?welcome=1`, { waitUntil: 'domcontentloaded' })
    await page
      .waitForFunction(() => document.querySelector('[data-bc-google-start]') !== null, null, {
        timeout: 8000,
      })
      .catch(() => undefined)
    const drawn = (await hasButton(page)) === 1
    check(`${label}: B. with the flag on, the button is drawn`, drawn)
    if (drawn) {
      const navigated = page
        .waitForURL(/provider\.test/, { timeout: 8000 })
        .then(() => true)
        .catch(() => false)
      await page.locator('[data-bc-google-start]').first().click()
      const went = await navigated
      check(
        `${label}: C1. pressing it asks the office for a provider address with a flow nonce`,
        starts.length === 1 && /^[a-z0-9]{24,64}$/.test(String(starts[0]?.nonce ?? '')),
        JSON.stringify(starts[0] ?? null).slice(0, 120),
      )
      check(
        `${label}: C2. the browser is sent to the provider address`,
        went,
        page.url().slice(0, 100),
      )
      const flows = flowsSeen[0] ?? ''
      const nonce = String(starts[0]?.nonce ?? '')
      check(
        `${label}: C3. this browser remembers a google flow for that nonce`,
        flows.includes(`"nonce":"${nonce}"`) && flows.includes('"kind":"google"'),
        flows.slice(0, 120),
      )
    }
    await context.close()
  }

  // D. A return with a valid session for a google flow this browser started is adopted.
  {
    const { context, page } = await openPage({ google: true }, width, mobile)
    await page.goto(`${ORIGIN}/?welcome=1`, { waitUntil: 'domcontentloaded' })
    await page.evaluate((nonce) => {
      const exp = Date.now() + 60 * 60 * 1000
      localStorage.setItem('hq.signin.flow', JSON.stringify([{ nonce, kind: 'google', exp }]))
    }, NONCE)
    await page.goto(
      `${ORIGIN}/?welcome=1&flow=${NONCE}#access_token=tok-abc&refresh_token=ref-abc&expires_in=3600`,
      { waitUntil: 'domcontentloaded' },
    )
    await page.waitForTimeout(1200)
    const held = await page.evaluate(() => localStorage.getItem('hq.session') ?? '')
    check(
      `${label}: D. a valid google return for this browser's flow is adopted`,
      held.includes('tok-abc'),
    )
    check(
      `${label}: D2. the address is cleaned of the token and the flow`,
      !page.url().includes('access_token') && !page.url().includes('flow='),
      page.url().slice(0, 80),
    )
    await context.close()
  }

  // E. A cancellation is named, and nothing is adopted.
  {
    const { context, page } = await openPage({ google: true }, width, mobile)
    await page.goto(`${ORIGIN}/?welcome=1`, { waitUntil: 'domcontentloaded' })
    await page.evaluate((nonce) => {
      localStorage.setItem(
        'hq.signin.flow',
        JSON.stringify([{ nonce, kind: 'google', exp: Date.now() + 3600000 }]),
      )
    }, NONCE)
    await page.goto(
      `${ORIGIN}/?welcome=1&flow=${NONCE}#error=access_denied&error_description=User+denied`,
      { waitUntil: 'domcontentloaded' },
    )
    await page.waitForTimeout(1200)
    const shown = await page.locator('[role=alert]').allTextContents()
    check(
      `${label}: E. a cancellation is named as one`,
      shown.some((t) => t.includes(CANCELLED)),
      shown.join(' | ').slice(0, 120),
    )
    check(
      `${label}: E2. a cancellation adopts nothing`,
      (await page.evaluate(() => localStorage.getItem('hq.session') ?? '')) === '',
    )
    await context.close()
  }

  // F. A session with no flow in this browser is refused.
  {
    const { context, page } = await openPage({ google: true }, width, mobile)
    await page.goto(`${ORIGIN}/?welcome=1#access_token=forwarded&refresh_token=x&expires_in=3600`, {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForTimeout(1200)
    const shown = await page.locator('[role=alert]').allTextContents()
    check(
      `${label}: F. a forwarded return with no flow here is refused in words`,
      shown.some((t) => t.includes(OTHER_BROWSER_START)),
      shown.join(' | ').slice(0, 120),
    )
    check(
      `${label}: F2. nothing is adopted for it`,
      (await page.evaluate(() => localStorage.getItem('hq.session') ?? '')) === '',
    )
    await context.close()
  }

  // G. The office refuses to start: its sentence is shown beside the button.
  {
    const { context, page } = await openPage(
      {
        google: true,
        startSaid: 'Signing in with Google is not switched on for this office.',
      },
      width,
      mobile,
    )
    await page.goto(`${ORIGIN}/?welcome=1`, { waitUntil: 'domcontentloaded' })
    await page
      .waitForFunction(() => document.querySelector('[data-bc-google-start]') !== null, null, {
        timeout: 8000,
      })
      .catch(() => undefined)
    await page.locator('[data-bc-google-start]').first().click()
    await page.waitForTimeout(800)
    const said = (await page.locator('[data-bc-google-said]').first().textContent()) ?? ''
    check(
      `${label}: G. a refusal to start is shown in the office's words`,
      said.includes('not switched on for this office'),
      said.slice(0, 100),
    )
    await context.close()
  }
}

await browser.close()
server.close()
console.log(
  failed === 0
    ? '\nGoogle sign-in: every check passed.'
    : `\nGoogle sign-in: ${String(failed)} check(s) FAILED.`,
)
process.exitCode = failed === 0 ? 0 : 1
