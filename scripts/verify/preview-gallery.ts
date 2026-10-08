// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a long script of captures and assertions, one per line
/**
 * Review gallery: the deployed preview, signed in as the public Sample visitor against the REAL gateway, with each canvas
 * material applied through the real picker and photographed, so Grant can judge them from URLs (#445).
 *   npm run trust:proxy-ca
 *   ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/verify/preview-gallery.ts [https://team-hq-ux-review.vercel.app]
 *
 * The only state-changing thing this causes is the ordinary guest session the real `signin` function mints. Every POST to the
 * gateway is aborted in the browser and counted, and the run FAILS if there was one. Backgrounds chosen here are kept in the
 * visitor's own browser only (a Sample visitor sends no layout writes). It also asserts that choosing a material disturbs
 * nothing: every module and Post-it keeps its position and size.
 *
 * Images go to docs/ux/review-gallery/ (served by the preview at /review/) as JPEG, with an index.html written beside them.
 */
import '../../src/safety/require-production-writes.ts'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'

declare const document: any
declare const window: any

const base = (process.argv[2] ?? 'https://team-hq-ux-review.vercel.app').replace(/\/$/, '')
const OUT = 'docs/ux/review-gallery'
await mkdir(OUT, { recursive: true })
const LIB = (await import('../../web/studio/textures/bg/library.json', { with: { type: 'json' } })).default as { id: string; name: string; category: string; tone: string }[]
const browser = await chromium.launch()
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok, detail })
}
const shots: { file: string; caption: string; group: string }[] = []

const session = async (w: number, h: number, scheme: 'light' | 'dark') => {
  const touch = w < 600
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ scheme: '${scheme}' })) } catch {}`)
  const page = await ctx.newPage()
  const posts: string[] = []
  const errors: string[] = []
  const bad: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(base) && r.headers()['x-vercel-id'] !== undefined) bad.push(`${String(r.status())} ${r.url()}`)
  })
  await ctx.route(/\/functions\/v1\/hq-api/, async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(String(route.request().postData() ?? '').slice(0, 80))
      return route.abort()
    }
    return route.continue()
  })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    if (await page.waitForSelector('[data-bc-sample-start]', { timeout: 20000 }).then(() => true).catch(() => false)) break
    if (attempt === 2) throw new Error('the entry did not appear')
  }
  await page.locator('[data-bc-sample-start]').first().click()
  await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
  await page.waitForFunction("(document.body.innerText || '').length > 50", undefined, { timeout: 30000 })
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem', { hasText: 'Riverside' }).first().click()
  await page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await page.waitForTimeout(1800)
  return { ctx, page, posts, errors, bad }
}
const shot = async (page: Page, file: string, caption: string, group: string): Promise<void> => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 80 })
  shots.push({ file: `${file}.jpg`, caption, group })
}
const rects = (page: Page): Promise<string> =>
  page.evaluate(() => JSON.stringify([...document.querySelectorAll('[data-mod], .bcpostit')].map((e: any) => {
    const r = e.getBoundingClientRect()
    return [e.getAttribute('data-mod') ?? e.className.split(' ')[0], Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
  }))) as Promise<string>
const noteTexts = (page: Page): Promise<string> =>
  page.evaluate(() => JSON.stringify([...document.querySelectorAll('.bcpostit .bcpostittext')].map((e: any) => e.value))) as Promise<string>
const openLook = async (page: Page): Promise<void> => {
  await page.locator('[data-bc-pagemenu]').click({ force: true })
  await page.locator('[data-bc-look]').click({ force: true })
  await page.waitForSelector('.bdgrid', { timeout: 15000 })
  await page.waitForTimeout(350)
}
const close = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('viewer')?.hidden === true, null, { timeout: 5000 })
  await page.waitForTimeout(350)
}
const choose = async (page: Page, id: string): Promise<void> => {
  await openLook(page)
  await page.locator(`[data-bd-pick="${id}"]`).click({ force: true })
  await page.waitForTimeout(250)
  await page.locator('[data-bd-apply]').click()
  await page.waitForTimeout(400)
  await close(page)
}
const resetView = async (page: Page): Promise<void> => {
  await page.click('[data-bc-viewreset]').catch(() => undefined)
  await page.waitForTimeout(450)
}
const bare = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
    return { x: r.x + r.width * 0.93, y: r.y + r.height * 0.9 }
  }) as Promise<{ x: number; y: number }>

/* ---- desktop, light: every material, at the default view and zoomed out ---- */
{
  const s = await session(1440, 900, 'light')
  await resetView(s.page)
  const baseRects = await rects(s.page)
  const baseNotes = await noteTexts(s.page)
  check('the Sample board has modules and a note to protect', baseRects.length > 100 && baseNotes.length > 2, `${baseRects.length} chars`)
  const order = [{ id: 'default', name: 'Microcement (the default)', tone: 'light' }, ...LIB]
  for (const e of order) {
    await choose(s.page, e.id)
    await resetView(s.page)
    check(`${e.id}: choosing it moves no module and no note`, (await rects(s.page)) === baseRects && (await noteTexts(s.page)) === baseNotes)
    await shot(s.page, `desktop-light-${e.id}`, `${e.name}: the Riverside Café Sample board, light, 1440x900, default view`, 'Light, default view')
    const b = await bare(s.page)
    await s.page.mouse.move(b.x, b.y)
    for (let i = 0; i < 4; i += 1) await s.page.mouse.wheel(0, 250)
    await s.page.waitForTimeout(500)
    await shot(s.page, `desktop-light-${e.id}-zoomed-out`, `${e.name}: zoomed out to about 60% so the material shows around the panels`, 'Light, zoomed out')
    await resetView(s.page)
  }
  /* zoom levels on one material: the texture scales with the canvas */
  await choose(s.page, 'slate')
  for (const [label, wheel] of [['25', 14], ['100', 0], ['200', -5]] as const) {
    await resetView(s.page)
    const b = await bare(s.page)
    await s.page.mouse.move(b.x, b.y)
    for (let i = 0; i < Math.abs(wheel); i += 1) await s.page.mouse.wheel(0, wheel > 0 ? 250 : -250)
    await s.page.waitForTimeout(600)
    const z = (await s.page.evaluate(() => { const m = /scale\(([-\d.e]+)\)/.exec(document.querySelector('.bcstage').style.transform); return m === null ? 1 : Number(m[1]) })) as number
    await shot(s.page, `zoom-slate-${label}`, `Blue-grey slate at ${String(Math.round(z * 100))}% zoom: the tile scales with the canvas and stays on the grid's origin`, 'Zoom levels')
  }
  await resetView(s.page)
  check('light: no gateway write was sent (every POST aborted and counted)', s.posts.length === 0, `${String(s.posts.length)}`)
  check('light: every image the page asked the preview for answered', s.bad.length === 0, s.bad.join(' | '))
  check('light: no page errors', s.errors.length === 0, s.errors.join(' | '))
  /* the picker itself */
  await openLook(s.page)
  await shot(s.page, 'picker-desktop-light', 'The Canvas Background picker in How this project looks (light)', 'The picker')
  await s.page.locator('[data-bd-pick="walnut"]').click({ force: true })
  await s.page.waitForTimeout(500)
  await shot(s.page, 'picker-preview-walnut', 'Previewing Warm walnut: the sheet steps to the corner so the canvas can be judged; nothing is kept until Apply', 'The picker')
  await s.page.locator('[data-bd-cancel]').click()
  await close(s.page)
  await s.ctx.close()
}

/* ---- desktop, dark ---- */
{
  const s = await session(1440, 900, 'dark')
  await resetView(s.page)
  for (const e of [{ id: 'default', name: 'Microcement (the default)' }, ...LIB]) {
    await choose(s.page, e.id)
    await resetView(s.page)
    await shot(s.page, `desktop-dark-${e.id}`, `${e.name}: dark scheme, 1440x900`, 'Dark, default view')
  }
  await openLook(s.page)
  await shot(s.page, 'picker-desktop-dark', 'The Canvas Background picker (dark)', 'The picker')
  await close(s.page)
  check('dark: no gateway write was sent', s.posts.length === 0, String(s.posts.length))
  check('dark: no page errors', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()
}

/* ---- tablet: the picker and the chat dock resized over a material ---- */
{
  const s = await session(768, 1024, 'light')
  await choose(s.page, 'linen')
  await resetView(s.page)
  await shot(s.page, 'tablet-linen', 'Natural linen, tablet 768x1024', 'Tablet and phone')
  await openLook(s.page)
  await s.page.locator('[data-bd-pick="leather"]').click({ force: true })
  await s.page.waitForTimeout(500)
  await shot(s.page, 'tablet-picker-preview-leather', 'Tablet: previewing Tan leather', 'Tablet and phone')
  const over1 = (await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) as number
  check('tablet: the picker causes no sideways overflow', over1 <= 1, `${String(over1)}px`)
  await s.page.locator('[data-bd-cancel]').click()
  await close(s.page)
  await s.page.click('[data-bc-dock]')
  await s.page.waitForSelector('.dock [data-docksay]')
  const g = (await s.page.evaluate(() => { const r = document.querySelector('.dockgrip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })) as { x: number; y: number }
  const w0 = (await s.page.evaluate(() => document.querySelector('.dock').getBoundingClientRect().width)) as number
  await s.page.mouse.move(g.x, g.y)
  await s.page.mouse.down()
  await s.page.mouse.move(g.x - 120, g.y, { steps: 6 })
  await s.page.mouse.up()
  const w1 = (await s.page.evaluate(() => document.querySelector('.dock').getBoundingClientRect().width)) as number
  check('tablet: the chat dock resizes over a material', w1 > w0 + 40, `${String(Math.round(w0))} -> ${String(Math.round(w1))}`)
  await shot(s.page, 'tablet-chat-resized', 'Tablet: Team Chat widened over Natural linen', 'Tablet and phone')
  check('tablet: no sideways overflow with the chat open', ((await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) as number) <= 1)
  check('tablet: no gateway write', s.posts.length === 0)
  await s.ctx.close()
}

/* ---- phone ---- */
{
  const s = await session(390, 844, 'light')
  await choose(s.page, 'paper')
  await shot(s.page, 'phone-paper', 'Handmade paper, iPhone-sized 390x844', 'Tablet and phone')
  await openLook(s.page)
  await shot(s.page, 'phone-picker', 'The picker on a phone: one scrolling row of materials, Apply stays in reach', 'Tablet and phone')
  await s.page.locator('[data-bd-pick="slate"]').click({ force: true })
  await s.page.waitForTimeout(500)
  await shot(s.page, 'phone-picker-preview', 'Previewing Blue-grey slate on the phone', 'Tablet and phone')
  check('phone: the picker causes no sideways overflow', ((await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) as number) <= 1)
  await s.page.locator('[data-bd-cancel]').click()
  check('phone: no gateway write', s.posts.length === 0)
  await s.ctx.close()
}

/* ---- the index page ---- */
const groups = [...new Set(shots.map((x) => x.group))]
const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team HQ canvas backgrounds: review gallery</title>
<style>
:root { color-scheme: light dark; --bg: #f1eee8; --ink: #26241f; --mute: #6b665c; --card: #fbfaf7; --edge: #d9d4c8 }
@media (prefers-color-scheme: dark) { :root { --bg: #1d2024; --ink: #e8e6e1; --mute: #a29e94; --card: #262a2f; --edge: #3a3f45 } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px }
h1 { font-size: 24px; margin: 0 0 4px } h2 { font-size: 18px; margin: 32px 0 12px }
p { color: var(--mute); max-width: 70ch } a { color: inherit }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap: 16px }
figure { margin: 0; background: var(--card); border: 1px solid var(--edge); border-radius: 12px; overflow: hidden }
figure img { display: block; width: 100%; height: auto }
figcaption { padding: 10px 12px; font-size: 14px }
</style></head><body><main>
<h1>Team HQ: canvas backgrounds</h1>
<p>Photographs of the deployed preview (<a href="/">${esc(base)}</a>) signed in as the public Sample visitor, on the real Sample data, each material applied through the real picker. Taken ${new Date().toISOString().slice(0, 10)}. Click a picture for full size. To try it yourself: open the preview, press Explore the Sample Office, open a project, then the project's menu, How this project looks, Canvas background.</p>
${groups.map((g) => `<h2>${esc(g)}</h2><div class="grid">${shots.filter((x) => x.group === g).map((x) => `<figure><a href="${x.file}"><img src="${x.file}" alt="${esc(x.caption)}" loading="lazy"></a><figcaption>${esc(x.caption)}</figcaption></figure>`).join('')}</div>`).join('\n')}
</main></body></html>
`
await writeFile(`${OUT}/index.html`, html)
await browser.close()
let bad = 0
for (const c of results) {
  if (!c.ok) bad += 1
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail === '' ? '' : ` - ${c.detail}`}`)
}
console.log(`\nREAL GATEWAY: ${String(results.length - bad)}/${String(results.length)} passed; ${String(shots.length)} images in ${OUT}`)
process.exit(bad === 0 ? 0 : 1)
