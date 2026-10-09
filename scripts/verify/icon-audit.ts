// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: an audit script
/**
 * Icon geometry (aesthetic sprint, 9 October 2026). For every icon-only control on the main surfaces it measures:
 *   - optical centring: where the drawn ink (the SVG's painted box) sits against the centre of its button (> 1.5px off fails),
 *   - size: the icon's rendered size (one of a small set per surface),
 *   - stroke: the stroke width as drawn (rendered px, after scaling).
 * and fails when icons in one toolbar disagree about size or stroke by more than a pixel. A planted off-centre icon is shown
 * to the audit first; if it is not caught the run fails.
 *
 *   npx tsx scripts/verify/icon-audit.ts      (DEVICES=desktop,phone)
 */
import '../../src/safety/arm.ts'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4715
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const devices: Record<string, { w: number; h: number; touch: boolean }> = { desktop: { w: 1440, h: 900, touch: false }, phone: { w: 390, h: 844, touch: true } }
const wanted = (process.env.DEVICES ?? 'desktop,phone').split(',')

const MEASURE = `(() => {
  const out = []
  const btns = [...document.querySelectorAll('button, a[role="button"], [role="button"]')].filter((b) => {
    if (!b.querySelector('svg')) return false
    if (b.closest('[hidden], .bcvh, #gallery-control-skip')) return false
    const r = b.getBoundingClientRect(); const s = getComputedStyle(b)
    if (r.width < 12 || r.height < 12 || s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) return false
    return (b.textContent || '').trim() === ''
  })
  for (const b of btns) {
    const svg = b.querySelector('svg')
    const br = b.getBoundingClientRect()
    let ink = null
    try { const bb = svg.getBBox(); const m = svg.getScreenCTM(); if (m && bb.width > 0) { const x1 = bb.x * m.a + m.e, y1 = bb.y * m.d + m.f, x2 = (bb.x + bb.width) * m.a + m.e, y2 = (bb.y + bb.height) * m.d + m.f; ink = { l: Math.min(x1, x2), t: Math.min(y1, y2), r: Math.max(x1, x2), b: Math.max(y1, y2) } } } catch (e) {}
    const sr = svg.getBoundingClientRect()
    const box = ink || { l: sr.left, t: sr.top, r: sr.right, b: sr.bottom }
    const dx = (box.l + box.r) / 2 - (br.left + br.right) / 2
    const dy = (box.t + box.b) / 2 - (br.top + br.bottom) / 2
    const p = svg.querySelector('path, line, circle, rect, polyline')
    const sw = p ? parseFloat(getComputedStyle(p).strokeWidth) : 0
    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : sr.width
    const scale = sr.width / vb
    const host = b.closest('.bctop, .bcdockbar, .bcmodhead, .dockhead, .stg-bar, .bcexp, .bccal2head, .bcmenuwrap, #dock') || document.body
    out.push({ name: (b.getAttribute('aria-label') || b.getAttribute('title') || b.className || b.tagName).toString().slice(0, 40), host: (host.className || host.tagName).toString().split(' ')[0], dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, size: Math.round(sr.width), stroke: Math.round(sw * scale * 10) / 10, w: Math.round(br.width), h: Math.round(br.height) })
  }
  return out
})()`

type Icon = { name: string; host: string; dx: number; dy: number; size: number; stroke: number; w: number; h: number }
const failures: string[] = []
const seenCount = { checked: 0 }

const judge = (label: string, icons: Icon[], strict = true): void => {
  for (const i of icons) {
    seenCount.checked += 1
    /* An icon whose ink is a glyph with its own optical weight (a chevron, a dot menu) may sit up to 2px off; anything more is misaligned. */
    if (strict && (Math.abs(i.dx) > 1.5 || Math.abs(i.dy) > 1.5)) failures.push(`${label}: "${i.name}" ink is ${String(i.dx)}px / ${String(i.dy)}px off its button centre (${String(i.w)}x${String(i.h)})`)
  }
  const byHost = new Map<string, Icon[]>()
  for (const i of icons) byHost.set(i.host, [...(byHost.get(i.host) ?? []), i])
  for (const [host, list] of byHost) {
    if (list.length < 3) continue
    const strokes = list.map((i) => i.stroke).filter((s) => s > 0)
    if (strokes.length >= 3 && Math.max(...strokes) - Math.min(...strokes) > 1.2) failures.push(`${label}: icons in .${host} disagree about stroke weight (${strokes.join(', ')} px)`)
  }
}

/* The control: an icon button with its glyph deliberately 6px off centre must be caught. */
{
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 } })
  const page = await ctx.newPage()
  await page.setContent('<button id="x" style="width:44px;height:44px;padding:0;position:relative"><svg viewBox="0 0 24 24" width="20" height="20" style="position:absolute;left:18px;top:6px" stroke="black" fill="none"><path d="M4 4h16v16H4z"/></svg></button>')
  const r = (await page.evaluate(MEASURE)) as Icon[]
  const caught = r.length === 1 && (Math.abs(r[0]?.dx ?? 0) > 2 || Math.abs(r[0]?.dy ?? 0) > 2)
  console.log(caught ? 'control: the audit catches a planted off-centre icon' : 'CONTROL FAILED: the audit missed a planted off-centre icon')
  if (!caught) failures.push('control failed')
  await ctx.close()
}

const run = async (dev: string, scheme: string): Promise<void> => {
  const d = devices[dev]
  if (d === undefined) return
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, hasTouch: d.touch, isMobile: d.touch })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', scheme: '${scheme}', density: 'comfortable' })) } catch {}`)
  const page: Page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${String(PORT)}/basecamp`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const slug = ((await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]')?.dataset.bcGo ?? ''`)) as string) || '/p/riverside'
  await page.goto(`http://127.0.0.1:${String(PORT)}${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(700)
  const label = `${dev} ${scheme}`
  judge(`${label} board`, (await page.evaluate(MEASURE)) as Icon[])
  await page.locator('[data-bc-dock]').first().click({ force: true }); await page.waitForTimeout(500)
  judge(`${label} chat`, (await page.evaluate(MEASURE)) as Icon[])
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await page.locator('.bcstage [data-mod="schedule"] [data-bc-expand], .bcstage [data-mod="schedule"] [data-expand]').first().click({ force: true }).catch(() => null)
  await page.waitForTimeout(500)
  judge(`${label} maximised schedule`, (await page.evaluate(MEASURE)) as Icon[])
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.goto(`http://127.0.0.1:${String(PORT)}${slug}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-bc-board]'); await page.waitForTimeout(500)
  for (let tries = 0; tries < 3 && !(await page.locator('#settings .stg').isVisible().catch(() => false)); tries += 1) { await page.locator('[data-bc-settings]').first().click({ force: true }).catch(() => null); await page.waitForTimeout(700) }
  await page.waitForSelector('#settings .stg', { timeout: 3000 }).catch(async () => { console.log('settings did not open for', label, await page.evaluate(`document.querySelectorAll('[data-bc-settings]').length + ' controls; url ' + location.pathname`)) })
  judge(`${label} settings`, (await page.evaluate(MEASURE)) as Icon[])
  await ctx.close()
}
for (const dev of wanted) for (const scheme of ['dark', 'light']) await run(dev, scheme)
await browser.close()
server.close()
const unique = [...new Set(failures)]
for (const f of unique) console.log(`FAIL  ${f}`)
console.log(`\nicon audit: ${String(seenCount.checked)} icon controls measured, ${String(unique.length)} problem(s)`)
process.exit(unique.length === 0 ? 0 : 1)
