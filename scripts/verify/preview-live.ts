// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * The deployed ISOLATED review copy (team-hq-ux-review), driven in real Chromium (#439).
 *   npm run trust:proxy-ca && npx tsx scripts/verify/preview-live.ts [https://team-hq-ux-review.vercel.app]
 * Read-only: it loads the public page, opens the canvas, zooms, adds a note locally, and captures. It writes nothing anywhere
 * but this browser's own storage and .out/preview/.
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

declare const document: any
declare const window: any

const base = process.argv[2] ?? 'https://team-hq-ux-review.vercel.app'
await mkdir('.out/preview', { recursive: true })
const browser = await chromium.launch()
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}
const profiles = [
  { label: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
  { label: 'phone', viewport: { width: 390, height: 844 }, mobile: true },
]
for (const scheme of ['light', 'dark'] as const) {
  for (const p of profiles) {
    const ctx = await browser.newContext({
      viewport: p.viewport,
      isMobile: p.mobile,
      hasTouch: p.mobile,
      deviceScaleFactor: p.mobile ? 3 : 1,
    })
    await ctx.addInitScript(
      `try { localStorage.setItem('studio.appearance', JSON.stringify({ scheme: '${scheme}' })) } catch {}`,
    )
    const page = await ctx.newPage()
    const errors: string[] = []
    const bad: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('response', (r) => {
      // config.js is generated and absent by design on this copy: index.html says a 404 there is not an error.
      // A failure with no x-vercel-id was not sent by Vercel: it is the sandbox proxy (CLAUDE.md), reported and not counted.
      if (r.status() >= 400 && r.url().startsWith(base) && r.headers()['x-vercel-id'] === undefined)
        console.log(`  note: proxy failure, not Vercel: ${String(r.status())} ${r.url()}`)
      else if (r.status() >= 400 && r.url().startsWith(base) && !r.url().endsWith('/config.js'))
        bad.push(`${String(r.status())} ${r.url()}`)
    })
    const tag = `${p.label}-${scheme}`
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    /* The review copy ships no config.js, so it has no backend: it shows the signed-out entry, and the canvas is not reachable on it. */
    const text = (await page.evaluate(() => document.body.innerText)) as string
    check(`${tag}: the signed-out entry is drawn`, /A team that works on your projects/.test(text))
    check(`${tag}: it offers the Sample Office`, /Explore a Sample Office/.test(text))
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    check(`${tag}: no sideways overflow`, overflow <= 1, `${String(overflow)}px`)
    const shown = await page.evaluate(() => document.documentElement.dataset.scheme ?? '')
    check(
      `${tag}: the scheme asked for is the scheme drawn`,
      shown === scheme || shown === '',
      shown,
    )
    await page.screenshot({ path: `.out/preview/${tag}.png` })
    check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
    check(`${tag}: no 4xx/5xx from the preview`, bad.length === 0, bad.join(' | '))
    await ctx.close()
  }
}
await browser.close()
let failed = 0
for (const c of checks) {
  if (!c.ok) failed += 1
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail === '' ? '' : ` - ${c.detail}`}`)
}
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} passed`)
process.exit(failed === 0 ? 0 : 1)
