/**
 * The Team Chat dock while it fades out after a close, driven by real presses, at phone and desktop widths.
 *
 * The design under test: on a phone the dock covers the whole screen, so during its fade it must keep its pointer input. A press
 * on the fading dock must not fall through to the header beneath, where Sign out sits. On a desktop the dock is a side drawer
 * beside the workspace, and the design keeps it non-modal while it leaves (presses reach the workspace), so that case is a
 * control: it must still pass through, so the fix did not change the desktop.
 *
 *   npx tsx scripts/verify/probe-dock-fade.ts
 *
 * Read-only; serves web/studio locally. Each check reads the page at the moment of the press, not after the fade.
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const record = (check: string, ok: boolean, detail: unknown) => results.push({ check, ok, detail })

const openProject = async (page: Page) => {
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu]:visible').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]:visible').first().click({ force: true })
  await page.waitForTimeout(1500)
}

// Reads the header's first button and its centre, taken in the same step as the fade that follows a close.
const headerSpot = (page: Page) =>
  page.evaluate(() => {
    const dock = document.getElementById('dock')
    const header = [...document.querySelectorAll<HTMLElement>('.bctop button')].find((b) => {
      const r = b.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight
    })
    if (dock === null || header === undefined) return { ready: false }
    const r = header.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    return {
      ready: true,
      x,
      y,
      headerLabel: (header.getAttribute('aria-label') ?? header.textContent ?? '')
        .trim()
        .slice(0, 30),
      dockFadingBeforeHit: dock.classList.contains('leaving'),
    }
  })

const hitNow = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const dock = document.getElementById('dock')
      const hit = document.elementFromPoint(px, py)
      return {
        leaving: dock?.classList.contains('leaving') === true,
        hitInsideDock: dock !== null && hit !== null && dock.contains(hit),
        hit:
          hit === null
            ? 'none'
            : `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 30)}`,
      }
    },
    [x, y] as const,
  )

const runAt = async (label: 'phone' | 'desktop') => {
  const phone = label === 'phone'
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: phone,
    hasTouch: phone,
  })
  const page = await context.newPage()
  await openProject(page)
  await page.locator('[data-bc-dock]:visible').first().click({ force: true })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-dock-close]') !== null &&
      document.getElementById('dock')?.classList.contains('leaving') !== true,
    null,
    { timeout: 5000 },
  )
  await page.waitForTimeout(400)
  // Close with the dock's own control, then read the hit point at once, while the 200 ms fade is running.
  await page.locator('[data-dock-close]:visible').first().click({ force: true })
  const spot = await headerSpot(page)
  if (!spot.ready) {
    record(`${label}: the header and the dock are both present to test`, false, spot)
    await context.close()
    return
  }
  const during = await hitNow(page, spot.x as number, spot.y as number)
  if (phone) {
    record(
      `phone: during the dock's fade, a press on the header does not fall through to the header beneath`,
      during.leaving === true && during.hitInsideDock === true,
      { spot, during },
    )
  } else {
    record(
      `desktop control: the non-modal drawer still lets a press reach the workspace while it fades`,
      during.leaving === true && during.hitInsideDock === false,
      { spot, during },
    )
  }
  await page.waitForTimeout(500)
  const after = await hitNow(page, spot.x as number, spot.y as number)
  record(
    `${label}: once the fade ends, the same point is the header again`,
    after.leaving === false && after.hitInsideDock === false,
    { after },
  )
  await context.close()
}

try {
  await runAt('phone')
  await runAt('desktop')
} finally {
  await browser.close()
  close()
}

for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.check}`, JSON.stringify(r.detail))
const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0
    ? `ALL ${String(results.length)} CHECKS PASS`
    : `${String(failed)} of ${String(results.length)} FAILED`,
)
process.exitCode = failed === 0 ? 0 : 1
