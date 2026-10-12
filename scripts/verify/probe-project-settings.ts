/**
 * Open Project settings from the project menu on Team HQ (`/`) and check it renders, reports no page
 * errors, and returns to the project with Back. Desktop and phone. Read-only; serves web/studio locally.
 *
 *   npx tsx scripts/verify/probe-project-settings.ts
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  for (const [name, viewport, isMobile] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ] as const) {
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
    await page.waitForTimeout(1500)
    const projectPath = new URL(page.url()).pathname
    await page.locator('[data-bc-pagemenu]').first().click({ force: true })
    await page.waitForTimeout(300)
    const item = page.locator('[data-bc-go*="/settings"]').first()
    const itemFound = (await item.count()) > 0
    if (itemFound) await item.click({ force: true })
    await page.waitForTimeout(1200)
    const settingsPath = new URL(page.url()).pathname
    const heading = await page.evaluate(() => {
      const h = document.querySelector('h1, h2')
      return (h?.textContent ?? '').trim().slice(0, 60)
    })
    const bodyText = await page.evaluate(() => document.body.innerText.length)
    await page.screenshot({ path: `.out/probe/project-settings-${name}.png` })
    await page.goBack()
    await page.waitForTimeout(900)
    console.log(
      JSON.stringify({
        viewport: name,
        menuItemFound: itemFound,
        projectPath,
        settingsPath,
        heading,
        renderedChars: bodyText,
        backReturnsToProject: new URL(page.url()).pathname === projectPath,
        pageErrors: errors.slice(0, 2),
      }),
    )
    await context.close()
  }
} finally {
  await browser.close()
  close()
}
