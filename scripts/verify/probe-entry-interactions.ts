/**
 * Drive the sign-in and create-account controls on the entry screen (`/?welcome`), in a real browser,
 * without sending anything. No sign-in link is requested and the Sample Office is not opened.
 *
 *   npx tsx scripts/verify/probe-entry-interactions.ts
 *
 * Checks: the Sign in and Create account tabs switch the panel and aria-selected; an address that is not
 * an address is refused on the page with a message; and the refusal makes NO request to the gateway.
 * Serves web/studio locally.
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

type Tab = 'signin' | 'create'

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(port)}/?welcome`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  const tab = (name: Tab) => page.locator(`[data-bc-entry-tab="${name}"]`).first()
  const selected = async (name: Tab) => (await tab(name).getAttribute('aria-selected')) === 'true'
  const initial = { signin: await selected('signin'), create: await selected('create') }

  await tab('create').click({ force: true })
  await page.waitForTimeout(400)
  const afterCreate = {
    signin: await selected('signin'),
    create: await selected('create'),
    createForm: (await page.locator('[data-bc-entry-form="create"]').count()) > 0,
  }
  await tab('signin').click({ force: true })
  await page.waitForTimeout(400)
  const backToSignin = {
    signin: await selected('signin'),
    signinForm: (await page.locator('[data-bc-entry-form="signin"]').count()) > 0,
  }

  // Validation: a value that is not an address must be refused on the page, with no request out.
  const gatewayCalls: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (/functions\/v1|hq-api|supabase\.co/.test(u)) {
      gatewayCalls.push(`${r.method()} ${new URL(u).pathname}`)
    }
  })
  const field = page.locator('[data-bc-entry-form="signin"] input[type="email"]').first()
  await field.fill('not-an-address')
  await page
    .locator('[data-bc-entry-form="signin"] button[type="submit"]')
    .first()
    .click({ force: true })
  await page.waitForTimeout(900)
  const refusal = await page.evaluate(() => {
    const form = document.querySelector('[data-bc-entry-form="signin"]')
    const alert = document.querySelector('[role="alert"]')?.textContent ?? ''
    const text = `${form?.textContent ?? ''} ${alert}`
    return {
      mentionsAddress: /address|email/i.test(text),
      text: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    }
  })

  console.log(
    JSON.stringify({
      tabs: { initial, afterCreate, backToSignin },
      validation: { refusal, gatewayRequestsAfterSubmit: gatewayCalls },
      pageErrors: errors.slice(0, 3),
    }),
  )
} finally {
  await browser.close()
  close()
}
