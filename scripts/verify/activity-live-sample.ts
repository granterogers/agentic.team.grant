// biome-ignore-all format: dense checks kept readable as written
/**
 * The Activity screen on the DEPLOYED page, over real production data, as a visitor to the public Sample Office (a real office on the
 * real gateway, open to anybody, read-only). Reads only; writes nothing.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/verify/activity-live-sample.ts [--page=https://ai-team-hq.vercel.app] [--shots=<dir>]
 *
 * The browser needs `npm run trust:proxy-ca` in the build sandbox.
 */
import '../../src/safety/require-production-checks.ts'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const PAGE = arg('page') ?? 'https://ai-team-hq.vercel.app'
const shots = arg('shots') ?? ''
if (shots !== '') mkdirSync(shots, { recursive: true })
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
    { name: 'desktop', width: 1440, height: 900, touch: false },
    { name: 'phone', width: 390, height: 844, touch: true },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch })
    const page = await ctx.newPage()
    const errors: string[] = []
    const calls: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('response', (r) => {
      const m = /section=([a-z_]+)/.exec(r.url())
      if (m !== null && r.url().includes('hq-api')) calls.push(`${m[1]}:${String(r.status())}`)
    })
    const tag = vp.name
    await page.goto(`${PAGE}/`)
    await page.waitForSelector('[data-bc-sample-start]', { timeout: 60000 })
    await page.locator('[data-bc-sample-start]').click()
    await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
    await page.goto(`${PAGE}/activity`)
    await page.waitForSelector('.bcact-item', { timeout: 60000 })
    await page.waitForTimeout(2500)
    const rows = await page.$$('.bcact-item')
    check(`${tag}: the live Activity page draws real rows`, rows.length > 3, `${String(rows.length)} rows`)
    const whoNames = await page.locator('.bcact-who').allInnerTexts()
    check(`${tag}: rows name who did it (agents by name, or You)`, whoNames.length > 0 && whoNames.every((w) => w.trim() !== ''), [...new Set(whoNames)].slice(0, 6).join(', '))
    const sentences = await page.locator('.bcact-sentence').allInnerTexts()
    check(`${tag}: rows say what was done, in words`, sentences.length > 0 && sentences.every((s) => s.trim().length > 3), sentences.slice(0, 3).join(' | '))
    check(`${tag}: rows carry a time and a day heading`, (await page.$$('.bcact-time')).length > 0 && (await page.$$('.bcact-dayhead')).length > 0)
    const feedMode = (await page.$$('.bcact-item[data-act-source="feed"]')).length
    check(`${tag}: the existing feed is what is drawn (the ledger is off)`, feedMode === rows.length, `${String(feedMode)} of ${String(rows.length)}`)
    check(`${tag}: the page asked for the existing feed, and it answered`, calls.some((c) => c.startsWith('lately:200')), calls.slice(0, 12).join(' '))
    const first = page.locator('.bcact-item').first()
    await first.locator('.bcact-sentence').click()
    const detail = await first.locator('.bcact-detail').innerText()
    check(`${tag}: a row opens to show who, when and how we know`, /Who/.test(detail) && /When/.test(detail), detail.slice(0, 100).replace(/\n/g, ' / '))
    if (shots !== '') await page.screenshot({ path: `${shots}/live-open-${tag}.png` })
    await first.locator('.bcact-sentence').click()
    await page.locator('[data-act-panel]').click()
    const before = (await page.$$('.bcact-item')).length
    const sel = page.locator('[data-act-sel="agent"]')
    const options = await sel.locator('option').count()
    if (options > 2) {
      await sel.selectOption({ index: 2 })
      const after = (await page.$$('.bcact-item')).length
      check(`${tag}: the Who filter narrows the list`, after < before || (await page.$('.bcempty')) !== null, `${String(before)} -> ${String(after)}`)
      await page.locator('[data-act-clear="all"]').first().click()
      check(`${tag}: clearing restores it`, (await page.$$('.bcact-item')).length === before)
    } else check(`${tag}: the Who filter lists the team`, false, `${String(options)} options`)
    const o = (await page.evaluate('({ scroll: document.documentElement.scrollWidth, vw: window.innerWidth })')) as { scroll: number; vw: number }
    check(`${tag}: no horizontal overflow`, o.scroll <= o.vw + 1, `${String(o.scroll)} of ${String(o.vw)}`)
    check(`${tag}: no page error`, errors.length === 0, errors.join('; '))
    if (shots !== '') await page.screenshot({ path: `${shots}/live-${tag}.png` })
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`${String(pass)} passed, ${String(fail)} failed`)
process.exit(fail === 0 ? 0 : 1)
