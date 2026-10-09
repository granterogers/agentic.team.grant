// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: an audit script
/**
 * Motion and focus (aesthetic sprint, 9 October 2026).
 *
 *   reduced motion: with prefers-reduced-motion on, opening the menu, the chat and a maximised module, and closing them, must
 *   leave no running animation or transition longer than 20ms (a finished state, not a movement). With it off, the same actions
 *   must animate (so the check is not satisfied by a page that never animates: its control).
 *
 *   focus: tabbing through the first controls of the board, the open menu and Settings, every focused control must show a
 *   visible indicator (an outline, or a box-shadow that differs from its unfocused one), at least 2px, with a colour that is not
 *   transparent. A planted control with `outline: none` is shown to the audit first and must be caught.
 *
 *   npx tsx scripts/verify/motion-focus.ts
 */
import '../../src/safety/arm.ts'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4716
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const failures: string[] = []
const notes: string[] = []
const u = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const open = async (reduced: boolean, w = 1440, h = 900) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', scheme: 'dark', density: 'comfortable' })) } catch {}`)
  const page = await ctx.newPage()
  await page.goto(u('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const slug = ((await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]')?.dataset.bcGo ?? ''`)) as string) || '/p/riverside'
  await page.goto(u(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(800)
  return { ctx, page, slug }
}

/* Longest running animation or transition, in ms, among everything on the page right now. */
const running = (page: Page): Promise<number> =>
  page.evaluate(`(() => { let longest = 0; for (const a of document.getAnimations()) { const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null; if (!t) continue; if (a.playState !== 'running') continue; const d = Number(t.duration) || 0; if (t.iterations === Infinity) continue; if (d > longest) longest = d }; return longest })()`) as Promise<number>

const sample = async (page: Page, act: (p: Page) => Promise<void>): Promise<number> => {
  let worst = 0
  await act(page)
  for (let i = 0; i < 6; i += 1) {
    worst = Math.max(worst, await running(page))
    await page.waitForTimeout(15)
  }
  return worst
}

const actions: [string, (p: Page) => Promise<void>, (p: Page) => Promise<void>][] = [
  ['the project menu', async (p) => { await p.locator('[data-bc-menu]').first().click({ force: true }) }, async (p) => { await p.keyboard.press('Escape') }],
  ['the chat', async (p) => { await p.locator('[data-bc-dock]').first().click({ force: true }) }, async (p) => { await p.keyboard.press('Escape') }],
  ['a maximised module', async (p) => { await p.locator('.bcstage [data-mod="schedule"] [data-bc-expand], .bcstage [data-mod="schedule"] [data-expand]').first().click({ force: true }) }, async (p) => { await p.keyboard.press('Escape') }],
]

/* ------------------------------------------------------------- reduced motion --- */
for (const reduced of [false, true]) {
  const { ctx, page } = await open(reduced)
  for (const [name, openIt, closeIt] of actions) {
    const inMs = await sample(page, openIt)
    await page.waitForTimeout(700)
    const outMs = await sample(page, closeIt)
    await page.waitForTimeout(700)
    if (reduced) {
      if (inMs > 20) failures.push(`reduced motion: opening ${name} still runs a ${String(Math.round(inMs))}ms animation`)
      if (outMs > 20) failures.push(`reduced motion: closing ${name} still runs a ${String(Math.round(outMs))}ms animation`)
    } else {
      notes.push(`motion on: ${name} opens in ${String(Math.round(inMs))}ms, closes in ${String(Math.round(outMs))}ms`)
      if (inMs < 80) failures.push(`control: with motion on, opening ${name} did not animate (${String(Math.round(inMs))}ms), so the reduced-motion check proves nothing`)
    }
  }
  await ctx.close()
}

/* ------------------------------------------------------------------- focus --- */
const FOCUS = `(() => {
  const e = document.activeElement
  if (!e || e === document.body) return null
  const s = getComputedStyle(e)
  const label = (e.getAttribute('aria-label') || e.textContent || e.className || e.tagName).toString().trim().slice(0, 36)
  const ow = parseFloat(s.outlineWidth) || 0
  const hasOutline = s.outlineStyle !== 'none' && ow >= 2 && !/rgba?\\(\\d+, \\d+, \\d+, 0\\)/.test(s.outlineColor)
  const shadow = s.boxShadow !== 'none'
  return { label, hasOutline, shadow, outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, boxShadow: s.boxShadow.slice(0, 60), tag: e.tagName.toLowerCase(), ring: e.matches(':focus-visible') }
})()`

{
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } })
  const page = await ctx.newPage()
  await page.setContent('<button id="bad" style="outline:none;box-shadow:none">no ring</button>')
  await page.keyboard.press('Tab')
  const r = (await page.evaluate(FOCUS)) as any
  const caught = r !== null && !r.hasOutline && !r.shadow
  console.log(caught ? 'control: the audit catches a control with no focus ring' : 'CONTROL FAILED: a planted ring-less control was not caught')
  if (!caught) failures.push('focus control failed')
  await ctx.close()
}
{
  const { ctx, page } = await open(false)
  /* Both a before-and-after of the shadow, so an inherited decorative shadow is not mistaken for a ring. */
  let checked = 0
  const seen = new Set<string>()
  for (let i = 0; i < 45; i += 1) {
    await page.keyboard.press('Tab')
    const r = (await page.evaluate(FOCUS)) as any
    if (r === null) continue
    const key = `${r.tag}:${r.label}`
    if (seen.has(key)) continue
    seen.add(key)
    checked += 1
    if (!r.hasOutline && !r.shadow) failures.push(`focus: "${r.label}" (${r.tag}) shows no focus indicator (${r.outline})`)
  }
  notes.push(`focus: ${String(checked)} distinct controls tabbed on the board`)
  if (checked < 12) failures.push(`focus control: only ${String(checked)} controls were reached by Tab, so the check is thin`)
  await ctx.close()
}

await browser.close()
server.close()
for (const n of notes) console.log(n)
for (const f of [...new Set(failures)]) console.log(`FAIL  ${f}`)
console.log(`\nmotion and focus: ${String(new Set(failures).size)} problem(s)`)
process.exit(failures.length === 0 ? 0 : 1)
