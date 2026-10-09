// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a dense harness kept readable as written
/**
 * When a script of the page does not arrive, the page says so and offers a reload (web/studio/index.html).
 *
 *   npx tsx scripts/verify/boot-recovery.ts
 *
 * Local only (no network beyond 127.0.0.1). Each case has its control:
 *   - a module answered with 502 text/plain (what the build sandbox's proxy did to /net.js): the notice appears, names the file,
 *     offers Reload, and Reload (with the file served properly again) starts the app;
 *   - the same page with nothing broken: NO notice (a notice on a healthy start would be the defect);
 *   - a slow but working start (the module answers after 10 s): the neutral notice appears, then the app's own first draw replaces it.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any

const PORT = 4741
const server = await serveStudio(PORT)
const base = `http://127.0.0.1:${String(PORT)}`
const browser = await chromium.launch()
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const notice = (page: any) => page.evaluate(() => document.querySelector('[data-boot-notice]')?.textContent ?? null) as Promise<string | null>

/* control: nothing broken */
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForTimeout(9500)
  check('control: a healthy start shows no notice', (await notice(page)) === null && (await page.locator('#root').evaluate((r: any) => r.childElementCount)) > 0)
  await ctx.close()
}

/* a module that arrives as a 502 text/plain */
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  let broken = true
  await page.route('**/net.js', (route) => (broken ? route.fulfill({ status: 502, contentType: 'text/plain; charset=utf-8', body: 'Bad Gateway' }) : route.continue()))
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForTimeout(9500)
  const said = await notice(page)
  check('a module that fails to arrive: the page says so and names the file', said !== null && /could not finish loading/.test(said) && said.includes('/net.js'), String(said))
  check('and offers a Reload button of a touch-sized height', (await page.locator('[data-boot-notice] button').evaluate((b: any) => b.getBoundingClientRect().height)) >= 44)
  broken = false
  await page.locator('[data-boot-notice] button').click()
  await page.waitForSelector('[data-bc-menu], .bcentry, [data-bc-board]', { timeout: 20000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
  check('Reload with the file served again starts the app and the notice is gone', (await notice(page)) === null && (await page.locator('#root').evaluate((r: any) => r.childElementCount)) > 0)
  await ctx.close()
}

/* a slow start */
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.route('**/app.js', async (route) => {
    await new Promise((r) => setTimeout(r, 24000))
    await route.continue()
  })
  await page.goto(base, { waitUntil: 'commit' })
  await page.waitForTimeout(21500)
  const slow = await notice(page)
  check('a start still going after twenty seconds shows the neutral notice (no file named)', slow !== null && /taking longer/.test(slow), String(slow))
  await page.waitForTimeout(6000)
  check("and the app's own first draw replaces it when it finally arrives", (await notice(page)) === null && (await page.locator('#root').evaluate((r: any) => r.childElementCount)) > 0)
  await ctx.close()
}

await browser.close()
server.close()
const bad = results.filter((r) => !r).length
console.log(`\n${results.length - bad}/${results.length} passed`)
process.exit(bad === 0 ? 0 : 1)
