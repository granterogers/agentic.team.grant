// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/*
 * Capture half of the aesthetic pass (9 October 2026). Passes and fails nothing: it photographs the surfaces Grant
 * called out (home board, burger menu, chat dock, a maximised module, the look sheet with a material chosen, Settings,
 * the team page) in both schemes, so the images can be opened and judged.
 *
 *   npx tsx scripts/verify/aesthetic-shots.ts [palette] [outdir]
 *   SCHEMES=dark PHONE=1 npx tsx scripts/verify/aesthetic-shots.ts clay .out/phone
 *
 * Served locally from the working tree (the prototype office, no production contact).
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
const PORT = 4697
const PALETTE = process.argv[2] ?? 'slate'
const OUT = process.argv[3] ?? '.out/aesthetic'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
const thrown: string[] = []

const SCHEMES = (process.env.SCHEMES ?? 'dark,light').split(',')
for (const scheme of SCHEMES) {
  const phone = process.env.PHONE === '1'
  const ctx = await browser.newContext({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) },
    hasTouch: phone,
    isMobile: phone,
    locale: 'en-GB',
    colorScheme: 'dark',
  })
  await ctx.addInitScript(
    `try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: '${PALETTE}', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable' })) } catch {}`,
  )
  const page: Page = await ctx.newPage()
  page.on('pageerror', (e) => thrown.push(`${scheme}: ${e.message}`))
  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/${PALETTE}-${scheme}-${name}.png` })
  }
  const press = async (selector: string): Promise<void> => {
    await page
      .locator(selector)
      .first()
      .click({ force: true })
      .catch(() => null)
  }
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  const slug = (await page.evaluate(
    `(() => { const el = document.querySelector('[data-bc-go^="/p/"]'); return el === null ? '' : (el.dataset.bcGo ?? '') })()`,
  )) as string
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]', { timeout: 8000 })
  await shot('board')
  for (const v of ['week', 'day']) {
    await press(`.bcstage [data-cal-view="${v}"]`)
    await page.waitForTimeout(400)
    await page
      .locator('.bcstage [data-bc-cal]')
      .first()
      .screenshot({ path: `${OUT}/${PALETTE}-${scheme}-schedule-${v}.png` })
  }
  await press('.bcstage [data-cal-view="month"]')
  if (!phone) {
    for (let i = 0; i < 3; i += 1) await press('[data-bc-zoom="out"]')
    await shot('zoomed-out')
    await press('[data-bc-zoom="reset"]')
    for (let i = 0; i < 4; i += 1) await press('[data-bc-zoom="in"]')
    await shot('zoomed-in')
    await press('[data-bc-zoom="reset"]')
  }
  await page.click('[data-bc-menu]')
  await page.waitForTimeout(450)
  await shot('burger')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await press('[data-bc-dock]')
  await shot('dock')
  await press('[data-bc-dock]')
  await press('[data-bc-expand="schedule"]')
  await shot('maximised-schedule')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.goto(url(`${slug}/x/team`), { waitUntil: 'domcontentloaded' }).catch(() => null)
  await shot('team')
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await press('[data-bc-pagemenu]')
  await press('[data-bc-look]')
  await page.waitForSelector('.bdgrid', { timeout: 8000 }).catch(() => null)
  await press('[data-bd-pick="walnut"]')
  await shot('look-walnut')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await press('[data-bc-settings]')
  await shot('settings')
  await press('#settings [data-setting="appearance"]')
  await shot('settings-appearance')
  await press('#settings [data-setting="connections"]')
  await shot('settings-services')
  await ctx.close()
}
await browser.close()
server.close()
console.log(thrown.length === 0 ? 'no page errors' : `PAGE ERRORS:\n${thrown.join('\n')}`)
