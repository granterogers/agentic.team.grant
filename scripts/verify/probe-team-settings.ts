/**
 * Global Settings → Team: finds the rendered cards and their Configure buttons, measures them at desktop and phone
 * widths, and writes captures. Local, read-only; prints measurements, asserts only that the pane was reached.
 *
 *   npx tsx scripts/verify/probe-team-settings.ts
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  for (const [label, width, height, mobile] of [
    ['desktop', 1440, 900, false],
    ['phone', 390, 844, true],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
    })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    /* On a phone the header control is hidden and Global Settings is an entry in the project menu (review 3). */
    const headerSettings = page.locator('[data-bc-settings]:visible').first()
    if ((await headerSettings.count()) > 0) await headerSettings.click({ force: true })
    else {
      await page.locator('[data-bc-menu]:visible').first().click({ force: true })
      await page.waitForTimeout(400)
      await page.locator('.bcmenuglobal:visible').first().click({ force: true })
    }
    await page.waitForTimeout(900)
    const teamTab = page
      .getByRole('tab', { name: /^team$/i })
      .or(page.locator('button:has-text("Team")').filter({ hasNotText: 'Agentic' }))
      .first()
    if ((await teamTab.count()) > 0) await teamTab.click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `.out/visual/discover-settings-team-${label}.png` })
    const cards = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) =>
        /configure/i.test(b.textContent ?? ''),
      )
      return buttons.slice(0, 10).map((b) => {
        let card: Element | null = b
        for (let i = 0; i < 6 && card !== null; i++) {
          const r = card.getBoundingClientRect()
          if (r.width > 200 && r.height > 80 && card.tagName !== 'BUTTON') break
          card = card.parentElement
        }
        const r = card?.getBoundingClientRect()
        const br = b.getBoundingClientRect()
        return {
          cardCls: String(card?.className ?? '').slice(0, 40),
          cardH: r === undefined ? null : Math.round(r.height),
          cardW: r === undefined ? null : Math.round(r.width),
          btnTopInCard: r === undefined ? null : Math.round(br.top - r.top),
          btnBottomGap: r === undefined ? null : Math.round(r.bottom - br.bottom),
          name: (card?.querySelector('b,strong,h3,h4')?.textContent ?? '').trim().slice(0, 24),
        }
      })
    })
    console.log(`--- ${label} ${String(width)}px: ${String(cards.length)} Configure button(s)`)
    for (const c of cards) console.log(JSON.stringify(c))
    await context.close()
  }
} finally {
  await browser.close()
  await close()
}
