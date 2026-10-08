// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * The deployed review preview, signed in as the public Sample visitor, against the REAL gateway (#439).
 *   npm run trust:proxy-ca
 *   ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/verify/preview-sample.ts [https://team-hq-ux-review.vercel.app]
 *
 * The only state-changing thing this causes is the ordinary guest session the real `signin` function mints when a visitor
 * presses "Explore the Sample Office". Every other write is made impossible rather than hoped against: any POST to the gateway
 * is ABORTED in the browser and counted, and the run FAILS if the page tried to send one. It reads, looks, pans and zooms; it
 * does not create, edit or delete a project, note, document or message, and it sends no chat turn.
 *
 * Results are real-gateway results. The stand-in suite is `preview-app.ts`; the two are reported separately.
 */
import '../../src/safety/require-production-writes.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

declare const document: any
declare const window: any

const base = (process.argv[2] ?? 'https://team-hq-ux-review.vercel.app').replace(/\/$/, '')
const OUT = '.out/preview-sample'
await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok, detail })
}

const run = async (
  label: string,
  w: number,
  h: number,
  scheme: 'light' | 'dark',
): Promise<void> => {
  const touch = w < 600
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
  })
  await ctx.addInitScript(
    `try { localStorage.setItem('studio.appearance', JSON.stringify({ scheme: '${scheme}' })) } catch {}`,
  )
  const page = await ctx.newPage()
  const posts: string[] = []
  const errors: string[] = []
  const env: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(base) && r.headers()['x-vercel-id'] === undefined)
      env.push(`${String(r.status())} ${r.url()}`)
  })
  /* The one POST allowed is the visitor's own sign-in; any other POST to the gateway is aborted and counted. */
  await ctx.route(/\/functions\/v1\/hq-api/, async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(String(route.request().postData() ?? '').slice(0, 80))
      return route.abort()
    }
    return route.continue()
  })
  const tag = `${label}-${scheme}`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    const ok = await page
      .waitForSelector('[data-bc-sample-start]', { timeout: 20000 })
      .then(() => true)
      .catch(() => false)
    if (ok) break
    if (attempt === 2) throw new Error('the entry did not appear after three loads')
  }
  await page.screenshot({ path: `${OUT}/${tag}-1-entry.png` })
  await page.locator('[data-bc-sample-start]').first().click()
  await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
  const sample = (await page.evaluate(
    `(() => { try { return JSON.parse(localStorage.getItem('hq.session') || 'null')?.sample === true } catch { return false } })()`,
  )) as boolean
  check(`${tag}: pressing Explore signs the visitor in from the preview origin`, sample)
  await page
    .waitForFunction("(document.body.innerText || '').includes('Riverside')", undefined, {
      timeout: 60000,
    })
    .catch(() => null)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${tag}-2-home.png` })
  const text = (await page.evaluate(() => document.body.innerText)) as string
  await page.click('[data-bc-menu]')
  const menuText = (await page.locator('.bcmenulist').innerText()).replace(/\s+/g, ' ')
  check(
    `${tag}: the Sample projects are read through the real gateway`,
    /Riverside/.test(menuText),
    menuText.slice(0, 120),
  )
  await page.keyboard.press('Escape')
  check(
    `${tag}: nothing of a real office is shown`,
    !/grant|innergy|rogers|legacy coaching|wellness studio/i.test(text),
    text.match(/grant|innergy|rogers|legacy coaching|wellness studio/i)?.[0] ?? '',
  )
  /* project selection through the hamburger */
  await page.click('[data-bc-menu]')
  const items = await page.locator('.bcmenulist .bcmenuitem').count()
  check(`${tag}: the hamburger lists the Sample projects`, items >= 2, String(items))
  await page.locator('.bcmenulist .bcmenuitem', { hasText: 'Riverside' }).first().click()
  await page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${tag}-3-project.png` })
  check(`${tag}: a project board opens`, (await page.locator('[data-mod]').count()) >= 2)
  const over = (await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )) as number
  check(`${tag}: no sideways overflow`, over <= 1, `${String(over)}px`)
  if (!touch) {
    await page.waitForTimeout(1500)
    const b = (await page.evaluate(() => {
      const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
      return { x: r.x + r.width * 0.92, y: r.y + r.height * 0.85 }
    })) as { x: number; y: number }
    await page.mouse.move(b.x, b.y)
    for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -250)
    await page.waitForTimeout(500)
    const z = (await page.evaluate(() => {
      const t = document.querySelector('.bcstage')
      const m = /scale\(([-\d.e]+)\)/.exec(t?.style.transform ?? '')
      return m === null ? 1 : Number(m[1])
    })) as number
    check(`${tag}: wheel zooms the live Sample canvas`, z > 1.2, String(z))
    await page.screenshot({ path: `${OUT}/${tag}-4-zoomed.png` })
    /* No "Reset view" press here: on a Sample visitor it sends a layout reset to the gateway (a write the visitor is refused), which this run must not send. */
  }
  /* How this project looks, on the live Sample */
  await page.locator('[data-bc-pagemenu]').click({ force: true })
  await page.locator('[data-bc-look]').click({ force: true })
  await page.waitForTimeout(900)
  const sheet = (await page.evaluate(() => {
    const s = document.querySelector('#viewer .sheet')
    if (!s) return null
    const r = s.getBoundingClientRect()
    return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }
  })) as { w: number; h: number; vw: number; vh: number } | null
  await page.screenshot({ path: `${OUT}/${tag}-5-look.png` })
  check(
    `${tag}: How this project looks opens and fits`,
    sheet !== null && sheet.w > 100 && sheet.w <= sheet.vw && sheet.h <= sheet.vh,
    JSON.stringify(sheet),
  )
  /* The canvas background library on the live Sample: chosen and kept in this browser, never sent (the visitor is read-only). */
  await page.locator('[data-bd-pick="slate"]').click({ force: true })
  await page.waitForTimeout(400)
  const previewed = (await page.evaluate(() =>
    document.querySelector('[data-bc-board]')?.getAttribute('data-bg'),
  )) as string | null
  check(
    `${tag}: choosing a background previews it on the live Sample canvas`,
    previewed === 'slate',
    String(previewed),
  )
  await page.screenshot({ path: `${OUT}/${tag}-6-background-preview.png` })
  await page.locator('[data-bd-apply]').click()
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const kept = (await page.evaluate(() =>
    document.querySelector('[data-bc-board]')?.getAttribute('data-bg'),
  )) as string | null
  check(`${tag}: and it is still there after a reload`, kept === 'slate', String(kept))
  await page.screenshot({ path: `${OUT}/${tag}-7-background-applied.png` })
  check(
    `${tag}: no write reached the gateway (any POST was aborted and counted)`,
    posts.length === 0,
    `${String(posts.length)} aborted: ${posts.join(' | ')}`,
  )
  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  if (env.length > 0) console.log(`  note (environment, not counted): ${env.join(' | ')}`)
  await ctx.close()
}

await run('desktop', 1440, 900, 'light')
await run('desktop', 1440, 900, 'dark')
await run('phone', 390, 844, 'light')
await browser.close()
let bad = 0
for (const r of results) {
  if (!r.ok) bad += 1
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail === '' ? '' : ` - ${r.detail}`}`)
}
console.log(`\nREAL GATEWAY: ${String(results.length - bad)}/${String(results.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
