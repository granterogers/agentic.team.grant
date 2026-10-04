/* Activity filters and channel provenance in a real browser. npx tsx scripts/verify/activity-ui.ts */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4693
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) pass += 1
  else fail += 1
  console.log(
    `${ok ? 'ok   ' : 'FAIL '} ${what}${ok || detail === '' ? '' : `\n        ${detail}`}`,
  )
}
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})
await page.goto(url('/'))
await page.waitForTimeout(500)
const slug = (await page.evaluate(
  `document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`,
)) as string
await page.goto(url(`${slug}/activity`))
await page.waitForSelector('.bctimeline')
await page.waitForTimeout(300)
const count = async (): Promise<number> => page.locator('.bcevent').count()
const all = await count()
check('the project Activity lists real rows', all >= 4, String(all))
check(
  'a row done through ChatGPT says so, as "via ChatGPT"',
  (await page.locator('.bcvia', { hasText: 'via ChatGPT' }).count()) === 1,
)
check(
  'a row done through Telegram says so',
  (await page.locator('.bcvia', { hasText: 'via Telegram' }).count()) === 1,
)
check(
  'rows with no known door say nothing about one',
  (await page.locator('.bcevent').count()) > (await page.locator('.bcvia').count()),
)
const chips = (await page.locator('.bcactfilter .bcsrcchip').allTextContents()).map((t) =>
  t.replace(/\s+/g, ' ').trim(),
)
check(
  'only filters that can match something are offered',
  chips.some((c) => c.startsWith('Calendar')) && !chips.some((c) => c.startsWith('Documents')),
  chips.join(' | '),
)
await page.screenshot({ path: '.out/ux-activity-01.png' })
await page.locator('.bcactfilter .bcsrcchip', { hasText: 'Integrations' }).click()
await page.waitForTimeout(250)
check(
  'Integrations shows only rows from ChatGPT, Claude, Telegram, Slack or voice',
  (await count()) === 2,
  String(await count()),
)
await page.locator('.bcactfilter .bcsrcchip', { hasText: 'Calendar' }).click()
await page.waitForTimeout(250)
check('Calendar shows only the calendar row', (await count()) === 1)
await page.locator('.bcactfilter .bcsrcchip', { hasText: 'Everything' }).click()
await page.waitForTimeout(250)
check('Everything brings them back', (await count()) === all)
check('no page errors', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
