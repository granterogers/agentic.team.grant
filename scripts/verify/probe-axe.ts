/**
 * Run axe-core on Team HQ's main surfaces in a real browser and report violations by rule, impact and count.
 *
 *   npx tsx scripts/verify/probe-axe.ts
 *
 * Surfaces: the entry screen, the project overview, the Team Chat drawer, Global Settings and the appearance
 * sheet, in light and dark. Read-only; serves web/studio locally. axe reports what it can test automatically;
 * it does not prove the page is accessible.
 */
import { readFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

type Violation = { id: string; impact: string | null | undefined; nodes: number; help: string }

const AXE = await readFile('node_modules/axe-core/axe.min.js', 'utf8')

const runAxe = async (page: Page): Promise<Violation[]> => {
  await page.addScriptTag({ content: AXE })
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact?: string | null; nodes: unknown[]; help: string }> }> } }).axe
    const r = await axe.run(document, { resultTypes: ['violations'] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }))
  })
  return result
}

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript((s) => {
      localStorage.setItem('studio.appearance', JSON.stringify({ scheme: s, look: 'silver' }))
    }, scheme)
    let page = await context.newPage()
    const report: Record<string, Violation[]> = {}

    await page.goto(`http://127.0.0.1:${String(port)}/?welcome`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    report.entry = await runAxe(page)
    // The welcome flag lives in this tab's session storage, so the workspace needs a fresh tab.
    await page.close()
    page = await context.newPage()

    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
    await page.waitForTimeout(1500)
    report.overview = await runAxe(page)

    await page.getByRole('button', { name: /chat with team/i }).first().click({ force: true })
    await page.waitForTimeout(800)
    report.chat = await runAxe(page)
    await page.getByRole('button', { name: /chat with team/i }).first().click({ force: true })
    await page.waitForTimeout(500)

    await page.locator('[data-bc-settings]').first().click({ force: true })
    await page.waitForTimeout(900)
    report.settings = await runAxe(page)
    await page.locator('[data-stg-back]').first().click({ force: true })
    await page.waitForTimeout(500)

    await page.locator('[data-bc-pagemenu]').first().click({ force: true })
    await page.waitForTimeout(300)
    await page.locator('[data-bc-look]').first().click({ force: true })
    await page.waitForTimeout(900)
    report.appearance = await runAxe(page)

    for (const [surface, violations] of Object.entries(report)) {
      const summary = violations.map((v) => `${v.id}(${v.impact ?? '-'}):${v.nodes}`)
      console.log(JSON.stringify({ scheme, surface, violations: summary }))
    }
    await context.close()
  }
} finally {
  await browser.close()
  close()
}
