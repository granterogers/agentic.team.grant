/**
 * Close the viewer (the appearance sheet uses it) with motion on, then check the workspace is not left blurred and
 * inert. Review finding: body.behind stayed set after the exit, so the shell kept pointer-events none.
 *
 *   npx tsx scripts/verify/probe-viewer-close.ts
 *
 * Read-only; serves web/studio locally. Desktop only.
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)

  await page.locator('[data-bc-pagemenu]').first().click({ force: true })
  await page.waitForTimeout(300)
  await page.locator('[data-bc-look]').first().click({ force: true })
  await page.waitForTimeout(900)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(60)
  const during = await page.evaluate(() => document.body.classList.contains('behind'))
  await page.waitForTimeout(700)

  const after = await page.evaluate(() => {
    const viewer = document.getElementById('viewer')
    const shell = document.querySelector<HTMLElement>('.shell')
    const pe = shell ? getComputedStyle(shell).pointerEvents : 'missing'
    const target = document.querySelector<HTMLElement>('[data-bc-settings]')
    let hit = false
    if (target) {
      const r = target.getBoundingClientRect()
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      hit = at !== null && target.contains(at)
    }
    return {
      viewerHidden: viewer?.hidden ?? null,
      behind: document.body.classList.contains('behind'),
      shellPointerEvents: pe,
      workspaceControlReachable: hit,
    }
  })
  console.log(
    JSON.stringify({
      closing: { behindWhileExiting: during },
      afterExit: after,
      pageErrors: errors.slice(0, 2),
    }),
  )
  const ok =
    after.viewerHidden === true &&
    after.behind === false &&
    after.shellPointerEvents !== 'none' &&
    after.workspaceControlReachable
  console.log(
    ok
      ? 'PASS: workspace is clickable after the viewer closes'
      : 'FAIL: workspace left blurred or unreachable',
  )
  process.exitCode = ok && errors.length === 0 ? 0 : 1
  await context.close()
} finally {
  await browser.close()
  close()
}
