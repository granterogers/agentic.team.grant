// biome-ignore-all format: dense checks kept readable as written
/**
 * The Activity screen over the office's EXISTING activity rows (ledger off), in a real browser, signed out so the page draws its own
 * project records. Local only: a static server and Chromium. Checks the things a person does: read a row, open its details, filter by who
 * and by project, clear, and see nothing overflow at desktop and phone width.
 *
 *   npx tsx scripts/verify/activity-feed-ui.ts [--shots=<dir>]
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const shotsDir = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? ''
const PORT = 4697
const server = await serveStudio(PORT)
if (shotsDir !== '') await mkdir(shotsDir, { recursive: true })
let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${ok || detail === '' ? '' : `\n        ${detail}`}`)
}
const browser = await chromium.launch()
try {
  for (const vp of [
    { name: '1440', width: 1440, height: 900, touch: false },
    { name: '390', width: 390, height: 844, touch: true },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(PORT)}/activity`)
    await page.waitForSelector('.bcact-item[data-act-source="feed"]', { timeout: 20000 })
    const tag = `${vp.name}px`
    const rows = await page.$$('.bcact-item[data-act-source="feed"]')
    check(`${tag}: the existing rows are drawn as a timeline, grouped by day`, rows.length > 0 && (await page.$$('.bcact-dayhead')).length > 0, `${String(rows.length)} rows`)
    const first = page.locator('.bcact-item[data-act-source="feed"]').first()
    check(`${tag}: a row names who did it, what they did and when`, (await first.locator('.bcact-who').innerText()).length > 0 && (await first.locator('.bcact-sentence').innerText()).length > 0 && (await first.locator('.bcact-time').count()) === 1)
    check(`${tag}: the page claims no outcome it was not given (no result chip on a feed row)`, (await page.$$('.bcact-item[data-act-source="feed"] .bcact-result')).length === 0)
    await first.locator('.bcact-sentence').click()
    const pane = first.locator('.bcact-detail')
    const text = await pane.innerText()
    check(`${tag}: opening a row shows who, when and how we know, and no technical block`, (await pane.isVisible()) && /Who/.test(text) && /When/.test(text) && /How we know/.test(text) && !/Technical details/.test(text), text.slice(0, 120))
    await first.locator('.bcact-sentence').click()
    check(`${tag}: pressing it again closes it`, !(await pane.isVisible()))
    if (shotsDir !== '') {
      await first.locator('.bcact-sentence').click()
      await page.screenshot({ path: `${shotsDir}/feed-open-${vp.name}.png` })
      await first.locator('.bcact-sentence').click()
    }
    // filters: the older feed has no server filter, so a change asks nothing and the held rows narrow
    await page.locator('[data-act-panel]').click()
    const who = page.locator('[data-act-sel="agent"]')
    const options = await who.locator('option').allTextContents()
    check(`${tag}: the Who filter lists the team`, options.length > 2, options.join(', '))
    const before = (await page.$$('.bcact-item[data-act-source="feed"]')).length
    await who.selectOption({ index: 2 })
    const during = (await page.$$('.bcact-item[data-act-source="feed"]')).length
    const empty = await page.$('.bcempty')
    check(`${tag}: filtering by a person narrows the held rows (or says nothing matches)`, during < before || empty !== null, `${String(before)} -> ${String(during)}`)
    await page.locator('[data-act-clear="all"]').first().click()
    check(`${tag}: clearing the filters brings every row back`, (await page.$$('.bcact-item[data-act-source="feed"]')).length === before)
    const views = await page.locator('[data-act-view]').allInnerTexts()
    check(`${tag}: only the views the older feed can answer are offered`, views.some((v) => /All/.test(v)) && !views.some((v) => /Completed|Problems|Errors/.test(v)), views.join(' | '))
    // A string, because this project's TypeScript program has no DOM library (adding one changes fetch's types for every script).
    const o = (await page.evaluate('({ scroll: document.documentElement.scrollWidth, vw: window.innerWidth })')) as { scroll: number; vw: number }
    check(`${tag}: no horizontal overflow`, o.scroll <= o.vw + 1, `${String(o.scroll)} of ${String(o.vw)}`)
    check(`${tag}: no page error`, errors.length === 0, errors.join('; '))
    if (shotsDir !== '') await page.screenshot({ path: `${shotsDir}/feed-${vp.name}.png`, fullPage: false })
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}
console.log(`${String(pass)} passed, ${String(fail)} failed`)
process.exit(fail === 0 ? 0 : 1)
