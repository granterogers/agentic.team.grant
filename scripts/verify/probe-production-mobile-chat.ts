// The gate comes first: this reads the production site, so it refuses to run without ALLOW_PRODUCTION_CHECKS=1.
import '../../src/safety/require-production-checks.ts'
/**
 * Mobile Team Chat regression on production, through the public Sample Office, as a visitor, at 390 x 844 with real touch input.
 *
 * The acceptance criterion: closing Team Chat on a phone must never activate Sign out, or any other control beneath the dock. Each
 * cycle closes the dock and, WITHOUT waiting for the fade, taps the header's Sign out position with a real touch tap while the
 * dock is still leaving. Nothing waits for an animation to finish before a rapid interaction.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/verify/probe-production-mobile-chat.ts
 *
 * Reads and presses only. The one write is the visitor session the Sample creates on entry; a non-GET request other than that
 * sign-in is recorded and fails the run. Writes .out/probe/mobile-chat-*.png.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const BASE = 'https://ai-team-hq.vercel.app'
const OUT = join(process.cwd(), '.out', 'probe')
const CYCLES = 10
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const check = (name: string, ok: boolean, detail: unknown = {}) => {
  results.push({ check: name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name} ${JSON.stringify(detail).slice(0, 300)}`)
}
const pageErrors: string[] = []
const consoleErrors: string[] = []
const writes: string[] = []
const failedRequests: string[] = []
const httpErrors: string[] = []

// The Team Chat dock's own close control is the close a phone offers (the open dock covers the toggle).
const closeShown = (page: Page) =>
  page
    .locator('[data-dock-close]:visible')
    .count()
    .then((n) => n > 0)

// Where the header's Sign out sits. It is the control a fall-through would reach, so it is the target of every tap.
const signOutSpot = (page: Page) =>
  page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-bc-signout]')
    if (b === null) return null
    const r = b.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })

// What is actually under a point, and whether it is the dock. Read during the fade, when a fall-through would happen.
const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const dock = document.getElementById('dock')
      const hit = document.elementFromPoint(px, py)
      return {
        leaving: dock?.classList.contains('leaving') === true,
        insideDock: dock !== null && hit !== null && dock.contains(hit),
        hit:
          hit === null
            ? 'none'
            : `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${String(hit.className).slice(0, 30)}`,
      }
    },
    [x, y] as const,
  )

// The visitor is still in the workspace: Sign out is drawn, the sign-in landing is not, and the project menu is reachable.
const sessionActive = (page: Page) =>
  page.evaluate(() => ({
    signOutDrawn: document.querySelector('[data-bc-signout]') !== null,
    landingShown: document.body.innerText.includes('Explore the Sample Office'),
    menuDrawn: document.querySelector('[data-bc-menu]') !== null,
  }))

const settled = (page: Page) =>
  page.evaluate(() => ({
    fading: ['settings', 'viewer', 'dock'].some(
      (id) => document.getElementById(id)?.classList.contains('leaving') === true,
    ),
    inert: document.querySelector('.shell')?.hasAttribute('inert') === true,
    behind: document.body.classList.contains('behind'),
  }))

const browser = await chromium.launch()
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160))
  })
  page.on('requestfailed', (r) =>
    failedRequests.push(
      `${r.method()} ${new URL(r.url()).pathname.slice(0, 60)} ${r.failure()?.errorText ?? ''}`,
    ),
  )
  page.on('request', (r) => {
    if (r.method() !== 'GET')
      writes.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname.slice(0, 60)}`)
  })
  // HTTP errors arrive as responses, not request failures, so they are recorded from the response with their query.
  page.on('response', (res) => {
    if (res.status() >= 400) {
      // x-vercel-id is stamped by Vercel on every response it sends: its presence separates a platform error from a proxy fault.
      const h = res.headers()
      httpErrors.push(
        `${String(res.status())} ${res.request().method()} ${new URL(res.url()).pathname}${new URL(res.url()).search.slice(0, 60)} vercel-id=${h['x-vercel-id'] ?? 'NONE'} type=${h['content-type'] ?? 'NONE'}`,
      )
    }
  })

  // 1. Open production Team HQ and enter the Sample Office. A failure to settle records what failed before it ends the run.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bc-sample-start]').first().click({ force: true })
  try {
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('Connecting to your office') === false &&
        document.querySelector('[data-bc-menu], [data-bc-menu-open]') !== null,
      null,
      { timeout: 90000 },
    )
  } catch (error) {
    await page.screenshot({ path: join(OUT, 'mobile-chat-not-settled.png') })
    console.log(
      `NOT SETTLED. HTTP errors: ${JSON.stringify(httpErrors)} failed: ${JSON.stringify(failedRequests)} shown: ${await page.evaluate(() => document.body.innerText.slice(0, 200))}`,
    )
    throw error
  }
  // Open the first project from the project menu, once: the menu opens with its first press and the project is chosen from it.
  await page
    .locator('[data-bc-menu-open]:visible, [data-bc-menu]:visible')
    .first()
    .click({ force: true })
  await page.locator('[data-bc-go*="/p/"]:visible').first().waitFor({ timeout: 10000 })
  await page.locator('[data-bc-go*="/p/"]:visible').first().click({ force: true })
  await page.waitForFunction(() => document.querySelector('[data-bc-dock]') !== null, null, {
    timeout: 10000,
  })
  await page.waitForTimeout(800)
  const enteredAt = await sessionActive(page)
  check(
    'the Sample Office is entered and the visitor session is active',
    enteredAt.signOutDrawn && !enteredAt.landingShown,
    enteredAt,
  )
  await page.screenshot({ path: join(OUT, 'mobile-chat-entered.png') })

  // 2. Open Team Chat with a press on its toggle.
  await page.locator('[data-bc-dock]:visible').first().tap()
  await page.waitForFunction(() => document.querySelector('[data-dock-close]') !== null, null, {
    timeout: 5000,
  })
  const opened = await closeShown(page)
  check('Team Chat opens from its toggle', opened, { opened })
  await page.screenshot({ path: join(OUT, 'mobile-chat-open.png') })

  // 3. Close normally with the dock's own close control, and let it finish (this is the one cycle that waits).
  await page.locator('[data-dock-close]:visible').first().tap()
  await page.waitForTimeout(700)
  const normalClose = { shown: await closeShown(page), ...(await settled(page)) }
  check(
    'a normal close shuts the dock and leaves nothing stale behind',
    !normalClose.shown && !normalClose.fading && !normalClose.inert && !normalClose.behind,
    normalClose,
  )

  // 4. Repeat: reopen, rapidly close, and tap Sign out's position DURING the closing fade. No waiting before the tap.
  const cycles: Array<Record<string, unknown>> = []
  for (let i = 1; i <= CYCLES; i++) {
    if (!(await closeShown(page))) {
      await page.locator('[data-bc-dock]:visible').first().tap()
      await page.waitForFunction(() => document.querySelector('[data-dock-close]') !== null, null, {
        timeout: 5000,
      })
    }
    const writesBefore = writes.length
    await page.locator('[data-dock-close]:visible').first().tap()
    // The fade is running now. Read where the press lands, then press there.
    const spot = await signOutSpot(page)
    let during: Record<string, unknown> = { spot: null }
    if (spot !== null) {
      during = { ...(await hitAt(page, spot.x, spot.y)) }
      await page.touchscreen.tap(spot.x, spot.y)
    }
    await page.waitForTimeout(450)
    const session = await sessionActive(page)
    const nonGetSinceClose = writes.slice(writesBefore)
    cycles.push({ cycle: i, spotFound: spot !== null, during, session, nonGetSinceClose })
    if (spot === null) break
  }
  const cycleOk = (c: Record<string, unknown>) => {
    const s = c.session as { signOutDrawn: boolean; landingShown: boolean }
    const d = c.during as { leaving?: boolean; insideDock?: boolean }
    return (
      c.spotFound === true &&
      d.leaving === true &&
      d.insideDock === true &&
      s.signOutDrawn &&
      !s.landingShown &&
      (c.nonGetSinceClose as string[]).length === 0
    )
  }
  check(
    `Sign out is never reached: ${String(CYCLES)} rapid close-and-tap cycles during the fade`,
    cycles.length === CYCLES && cycles.every(cycleOk),
    {
      cycles: cycles.length,
      passed: cycles.filter(cycleOk).length,
      firstFailure: cycles.find((c) => !cycleOk(c)) ?? null,
    },
  )
  await page.screenshot({ path: join(OUT, 'mobile-chat-after-cycles.png') })

  // 5. The session is still active after all the cycles, and nothing is stale.
  const afterCycles = await sessionActive(page)
  const staleAfter = await settled(page)
  check(
    'the visitor session remains active after the cycles, with no stale overlay',
    afterCycles.signOutDrawn &&
      !afterCycles.landingShown &&
      !staleAfter.fading &&
      !staleAfter.inert &&
      !staleAfter.behind,
    { afterCycles, staleAfter },
  )

  // 6. Team Chat still works: open it, see its conversation, and close it normally.
  if (!(await closeShown(page))) await page.locator('[data-bc-dock]:visible').first().tap()
  await page.waitForFunction(() => document.querySelector('[data-dock-close]') !== null, null, {
    timeout: 5000,
  })
  const chatWorks = await page
    .locator('[data-dock-say], [data-docksay]')
    .first()
    .isVisible()
    .catch(() => false)
  await page.locator('[data-dock-close]:visible').first().tap()
  await page.waitForTimeout(700)
  check(
    'Team Chat remains functional after the cycles (opens with its composer, closes normally)',
    chatWorks && !(await closeShown(page)),
    { chatWorks },
  )

  // 7. Another module opens and returns, and the workspace is interactive afterwards.
  await page.locator('[data-bc-menu]:visible').first().tap()
  await page.waitForTimeout(350)
  await page
    .locator('[data-bc-menu-modules] [data-bc-expand="tasks"]')
    .first()
    .tap()
    .catch(() => undefined)
  await page.waitForTimeout(800)
  const maximised = (await page.locator('.bcexp').count()) > 0
  await page.screenshot({ path: join(OUT, 'mobile-chat-module.png') })
  await page
    .locator('.bcexpx')
    .first()
    .tap()
    .catch(() => undefined)
  await page.waitForTimeout(800)
  const returned = (await page.locator('.bcexp').count()) === 0
  check(
    'another module opens maximised and returns to the canvas after the chat cycles',
    maximised && returned,
    { maximised, returned },
  )

  // 8. A final press on the dock toggle answers: the workspace is interactive.
  await page.locator('[data-bc-dock]:visible').first().tap()
  await page.waitForFunction(() => document.querySelector('[data-dock-close]') !== null, null, {
    timeout: 5000,
  })
  await page.locator('[data-dock-close]:visible').first().tap()
  await page.waitForTimeout(700)
  const finalSession = await sessionActive(page)
  check(
    'the workspace is interactive at the end and the session is still active',
    finalSession.signOutDrawn && !finalSession.landingShown && !(await closeShown(page)),
    finalSession,
  )

  await context.close()
} finally {
  await browser.close()
}

check('no page errors during the run', pageErrors.length === 0, pageErrors.slice(0, 5))
check('no failed requests during the run', failedRequests.length === 0, failedRequests.slice(0, 5))
console.log(`HTTP errors (4xx/5xx): ${String(httpErrors.length)} ${JSON.stringify(httpErrors)}`)
const unexpectedWrites = [...new Set(writes)].filter((w) => !w.includes('/functions/v1/signin'))
check(
  'the only non-GET request is the visitor sign-in the Sample creates',
  unexpectedWrites.length === 0,
  { writes: [...new Set(writes)] },
)
console.log(
  `console errors: ${String(consoleErrors.length)} ${JSON.stringify(consoleErrors.slice(0, 4))}`,
)
const bad = results.filter((r) => !r.ok).length
console.log(
  bad === 0
    ? `ALL ${String(results.length)} MOBILE CHAT CHECKS PASS`
    : `${String(bad)} of ${String(results.length)} FAILED`,
)
process.exitCode = bad === 0 ? 0 : 1
