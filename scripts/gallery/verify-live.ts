// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * Opens the PUBLISHED gallery in a fresh iPhone-sized Chromium session (touch emulation, not iOS Safari) and checks what a person would:
 *
 *   npx tsx scripts/gallery/verify-live.ts https://<gallery-host> [shots-dir]
 *
 * Needs the public internet (run `npm run trust:proxy-ca` once in the sandbox); it contacts only the gallery host.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

declare const document: any
const BASE = process.argv[2] ?? ''
const SHOTS = process.argv[3] ?? '.out/live'
if (BASE === '') {
  console.error('usage: verify-live.ts <https://host> [shots-dir]')
  process.exit(2)
}
await mkdir(SHOTS, { recursive: true })
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})
const page = await ctx.newPage()
const origin = new URL(BASE).origin
const foreign: string[] = []
const bad: string[] = []
page.on('request', (r) => {
  if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) foreign.push(r.url())
})
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
const res = await page.goto(BASE, { waitUntil: 'domcontentloaded' })
check(
  'gallery opens with 200 and no redirect to a login',
  res?.status() === 200 && page.url().startsWith(origin),
  `${res?.status()} ${page.url()}`,
)
await page.evaluate(`document.querySelectorAll('img').forEach((i) => { i.loading = 'eager' })`)
await page
  .waitForFunction(`[...document.images].every((i) => i.complete)`, undefined, { timeout: 90000 })
  .catch(() => null)
const r = (await page.evaluate(
  `(() => { const im = [...document.images].filter((i) => i.id !== 'lbi'); return { n: im.length, broken: im.filter((i) => i.naturalWidth === 0).length, sw: document.documentElement.scrollWidth, links: document.querySelectorAll('a[data-lb]').length } })()`,
)) as { n: number; broken: number; sw: number; links: number }
check('316 thumbnails all load', r.n === 316 && r.broken === 0, `${r.n} images, ${r.broken} broken`)
check('316 tappable screenshots', r.links === 316, String(r.links))
check('no horizontal overflow at 390px', r.sw <= 391, String(r.sw))
check('no request left the gallery origin', foreign.length === 0, foreign.slice(0, 2).join(', '))
check(
  'no failed request, no page error',
  bad.length === 0 && errors.length === 0,
  [...bad, ...errors].slice(0, 2).join(' | '),
)
const lab = (await page.evaluate(
  `(() => { const f = [...document.querySelectorAll('figure[data-s]')]; return { n: f.length, wrong: f.filter((x) => !x.dataset.cap.includes(' · ' + (x.dataset.s === 'light' ? 'Light' : 'Dark') + ' · ')).length } })()`,
)) as { n: number; wrong: number }
check(
  'Light/Dark labels agree with the card data',
  lab.n === 316 && lab.wrong === 0,
  `${lab.wrong} wrong of ${lab.n}`,
)
// Every full-resolution PNG is served (HEAD from the page), and the right one.
const full = (await page.evaluate(
  `Promise.all([...document.querySelectorAll('a[data-lb]')].map((a) => fetch(a.href, { method: 'HEAD' }).then((x) => x.status + ' ' + (x.headers.get('content-type') || '') + ' ' + x.headers.get('content-length'))))`,
)) as string[]
const okFull = full.filter((s) => s.startsWith('200 image/png'))
check(
  '316 full-resolution PNGs are served',
  okFull.length === 316,
  `${okFull.length} of ${full.length}`,
)
await page.screenshot({ path: `${SHOTS}/01-top.png` })
await page.selectOption('#jump', 'settings')
await page.waitForTimeout(500)
await page.screenshot({ path: `${SHOTS}/02-settings.png` })
// Filters
await page.evaluate(`document.querySelector('#jump').scrollIntoView()`)
await page.locator('.tog button[data-f="s-dark"]').tap()
const dark = (await page.evaluate(
  `(() => ({ vis: [...document.querySelectorAll('a[data-lb]')].filter((l) => l.offsetParent !== null).length, light: [...document.querySelectorAll('figure[data-s=light]')].filter((l) => l.offsetParent !== null).length, count: document.getElementById('count').textContent }))()`,
)) as { vis: number; light: number; count: string }
check(
  'Dark filter shows 158 and no Light',
  dark.vis === 158 && dark.light === 0,
  JSON.stringify(dark),
)
await page.locator('.tog button[data-f="only-mob"]').tap()
const mob = (await page.evaluate(
  `(() => [...document.querySelectorAll('a[data-lb]')].filter((l) => l.offsetParent !== null).map((l) => l.parentNode.dataset.wh))()`,
)) as string[]
check(
  'Dark + Mobile shows no 1440 image',
  mob.length > 0 && !mob.includes('1440x900'),
  `${mob.length} shown`,
)
await page.locator('.tog button[data-f="s-light"]').tap()
await page.locator('.tog button[data-f="only-desk"]').tap()
const ld = (await page.evaluate(
  `(() => [...document.querySelectorAll('a[data-lb]')].filter((l) => l.offsetParent !== null).map((l) => l.parentNode.dataset.wh + l.parentNode.dataset.s))()`,
)) as string[]
check(
  'Light + Desktop shows only 1440 Light',
  ld.length > 0 && ld.every((x) => x === '1440x900light'),
  `${ld.length} shown`,
)
await page.locator('.tog button[data-g="t"][data-f="all"]').tap()
await page.locator('.tog button[data-g="z"][data-f="all"]').tap()
const reset = (await page.evaluate(`document.getElementById('count').textContent`)) as string
check('clearing the filters brings all 316 back', reset === '316 of 316 shown', reset)
// Viewer
await page.selectOption('#jump', 'dashboard-and-project-workspace')
await page.waitForTimeout(400)
await page.locator('a[data-lb]:visible').first().tap()
await page.waitForSelector('#lb.on')
await page
  .waitForFunction(`document.getElementById('lbi').src.includes('/screenshots/')`, undefined, {
    timeout: 20000,
  })
  .catch(() => null)
const v1 = (await page.evaluate(
  `(() => ({ src: document.getElementById('lbi').src.split('/').slice(-2).join('/'), w: document.getElementById('lbi').naturalWidth, n: document.getElementById('lbn').textContent, cap: document.getElementById('lbc').textContent }))()`,
)) as { src: string; w: number; n: string; cap: string }
check(
  'tap opens the viewer, over all 316, and lazy-loads the full-resolution PNG',
  v1.src.startsWith('screenshots/') && v1.w >= 390 && v1.n.startsWith('1 / 316'),
  `${v1.src} ${v1.w}px ${v1.n}`,
)
await page.screenshot({ path: `${SHOTS}/03-viewer.png` })
const cdp = await ctx.newCDPSession(page)
const touch = async (
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  pts: { x: number; y: number }[],
): Promise<void> => {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })),
  })
}
// Swipe left: next
await touch('touchStart', [{ x: 300, y: 400 }])
for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: 300 - i * 30, y: 402 }])
await touch('touchEnd', [])
await page.waitForTimeout(500)
const v2 = (await page.evaluate(`document.getElementById('lbn').textContent`)) as string
check(
  'swipe left goes to the next screenshot',
  v2.startsWith('2 /') && v2 !== v1.n,
  `${v1.n} -> ${v2}`,
)
// Pinch out: zoom
const before = (await page.evaluate(`document.getElementById('lbi').style.transform`)) as string
await touch('touchStart', [
  { x: 150, y: 400 },
  { x: 240, y: 400 },
])
for (let i = 1; i <= 8; i++)
  await touch('touchMove', [
    { x: 150 - i * 12, y: 400 },
    { x: 240 + i * 12, y: 400 },
  ])
await touch('touchEnd', [])
await page.waitForTimeout(300)
const after = (await page.evaluate(`document.getElementById('lbi').style.transform`)) as string
const sc = (t: string): number => Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? 0)
check(
  'pinch zooms in',
  sc(after) > sc(before) * 1.5,
  `${sc(before).toFixed(2)} -> ${sc(after).toFixed(2)}`,
)
await page.screenshot({ path: `${SHOTS}/04-zoomed.png` })
await page.locator('#lbx').tap()
await page.waitForTimeout(300)
check('close returns to the gallery', (await page.locator('#lb.on').count()) === 0)
const sw2 = (await page.evaluate(`document.documentElement.scrollWidth`)) as number
check('still no horizontal overflow', sw2 <= 391, String(sw2))
await browser.close()
console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
