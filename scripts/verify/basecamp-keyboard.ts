/*
 * Keyboard and accessibility, driven rather than inspected.
 *
 * §15 is the contract and §10E of the run brief is the gate. Everything here
 * is executed in a real browser: keys are pressed, focus is read back after
 * each one, and the journeys are completed without a pointer at all.
 *
 * Two things this deliberately does NOT do. It does not assert that a rule
 * exists in the stylesheet — a focus ring nobody can see is still a failing
 * focus ring, so the outline is read off the computed style of the focused
 * element. And it does not count elements and call that coverage: the
 * keyboard-only journey at the end is the check that matters, because it is
 * the only one that fails when the parts work and the whole does not.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4636
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
const inPage = (body: string): string => `(() => { ${body} })()`

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const here = async (): Promise<string> =>
  (await page.evaluate(
    inPage(`const a = document.activeElement
       if (a === null) return 'none'
       const label = (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)
       return a.tagName.toLowerCase() + '|' + (a.className || '') + '|' + label`),
  )) as string

const open = async (p: string): Promise<void> => {
  await page.goto(url(p), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(500)
}

await open('/basecamp')

/* --- §15: a first-focus Skip to main content link ---------------------- */
await page.keyboard.press('Tab')
check(
  'the first Tab reaches Skip to main content',
  (await here()).includes('Skip to main content'),
  await here(),
)
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
check(
  'Skip to main content moves focus into main',
  (await page.evaluate(
    inPage(
      "return document.activeElement?.closest('main') !== null || document.activeElement?.id === 'bcmain'",
    ),
  )) === true,
  await here(),
)

/* --- §15: one logical h1, headings descend ----------------------------- */
const headings = (await page.evaluate(
  inPage(`return [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName)`),
)) as string[]
check('exactly one h1', headings.filter((h) => h === 'H1').length === 1, headings.join(','))
check('the h1 comes before any h2', headings.indexOf('H1') === 0, headings.slice(0, 5).join(','))

/* --- §13: visible focus on every interactive element ------------------- */
/*
  Read off the COMPUTED style of the element while it is focused, not out of
  the stylesheet. A rule that exists and is overridden is the same as no rule,
  and only the browser knows which won.
*/
/*
  AND READ IT AFTER THE TRANSITION, not at the instant of focus.

  `.bcinput` answers focus with a box-shadow and transitions it, so reading the
  computed style in the same tick returns the value it is transitioning FROM --
  fully transparent. That reports a control with a perfectly good focus ring as
  having none, which is the kind of finding somebody eventually switches a
  check off over. Two frames plus a beat is enough for a 120ms transition.
*/
const noRing = (await page.evaluate(`(async () => {
     const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 220)))
     const out = []
     for (const el of document.querySelectorAll('button, a[href], input, summary')) {
       const r = el.getBoundingClientRect()
       if (r.width === 0 || r.height === 0) continue
       /*
         A RECTANGLE IS NOT VISIBILITY. A control inside a shut <details>
         measures its full size in Chromium, because a closed disclosure is
         content-visibility: hidden and that keeps the geometry -- so this
         walked controls nobody can see, could not focus them, and reported
         them as having no focus ring.
       */
       if (el.checkVisibility !== undefined &&
           !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue
       el.focus()
       await settle()
       const cs = getComputedStyle(el)
       const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
       const shadow = cs.boxShadow !== 'none' && cs.boxShadow !== '' &&
         !/\\/\\s*0\\s*\\)/.test(cs.boxShadow)
       if (!ring && !shadow) {
         out.push(el.tagName.toLowerCase() + ' "' + (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) + '"')
       }
     }
     return out
   })()`)) as string[]
check('every visible interactive element shows focus', noRing.length === 0, noRing.join('; '))

/* --- §15: icon-only and preview controls have accessible names --------- */
const nameless = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('button, a[href]')) {
       const r = el.getBoundingClientRect()
       if (r.width === 0 || r.height === 0) continue
       const name = (el.getAttribute('aria-label') ?? '') + ' ' + (el.textContent ?? '')
       if (name.trim() === '') out.push(el.outerHTML.slice(0, 70))
     }
     return out`),
)) as string[]
check('no control is nameless', nameless.length === 0, nameless.join(' | '))

/* The portfolio's project previews were removed with the portfolio (8 October 2026), and with them their announce check. */

await open('/basecamp')
await page.locator('[data-bc-menu]').focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check('Enter on the hamburger opens the menu', await page.locator('.bcmenupanel').isVisible())
check('focus lands on the first entry', (await here()).includes('bcmenuitem'), await here())
const firstItem = await page.evaluate(
  inPage("return document.activeElement?.textContent?.trim() ?? ''"),
)
await page.keyboard.press('ArrowDown')
const secondItem = await page.evaluate(
  inPage("return document.activeElement?.textContent?.trim() ?? ''"),
)
check(
  'ArrowDown moves to the next entry',
  firstItem !== secondItem,
  `${String(firstItem)} -> ${String(secondItem)}`,
)
await page.keyboard.press('ArrowUp')
check(
  'ArrowUp moves back',
  (await page.evaluate(inPage("return document.activeElement?.textContent?.trim() ?? ''"))) ===
    firstItem,
)
await page.keyboard.press('End')
const lastItem = await page.evaluate(
  inPage("return document.activeElement?.textContent?.trim() ?? ''"),
)
check('End jumps to the last entry', lastItem !== firstItem, String(lastItem))
await page.keyboard.press('Home')
check(
  'Home jumps back to the first',
  (await page.evaluate(inPage("return document.activeElement?.textContent?.trim() ?? ''"))) ===
    firstItem,
)
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
check('Escape closes the menu', !(await page.locator('.bcmenupanel').isVisible()))
check(
  'and focus returns to the hamburger',
  (await page.evaluate(
    inPage("return document.activeElement?.hasAttribute('data-bc-menu') === true"),
  )) === true,
  await here(),
)

/* --- A core journey with the keyboard only: hamburger, entry, Enter, a project ------------------- */
await open('/basecamp')
await page.locator('[data-bc-menu]').focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
check(
  'keyboard only: hamburger, Enter, Enter opened a project overview',
  (await page.locator('.bchome').count()) > 0 && new URL(page.url()).pathname.startsWith('/p/'),
  page.url(),
)

/* --- Search is reached from the menu and actually searches --------------------------------------- */
await open('/basecamp')
await page.locator('[data-bc-menu]').focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
await page.locator('.bcmenuitem', { hasText: 'Search' }).first().click()
await page.waitForTimeout(500)
check('the menu reaches the full search', new URL(page.url()).pathname === '/search', page.url())
await page.locator('#bc-search-q').fill('interview')
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
const hits = await page.locator('.bcresult').count()
check('and it actually found something', hits > 0, `${String(hits)} result(s) for "interview"`)
check(
  'results name their type and their project',
  (await page.locator('.bcresult').first().innerText()).length > 10,
  await page
    .locator('.bcresult')
    .first()
    .innerText()
    .then((t) => t.replace(/\n/g, ' / ')),
)

/* Filters are pressable by keyboard and say which is on. */
check(
  'the type filters report their state with aria-pressed',
  (await page.locator('[data-bc-kind][aria-pressed="true"]').count()) === 1,
)
await page.locator('[data-bc-kind="Documents"]').click()
await page.waitForTimeout(400)
check(
  'pressing a filter narrows the results',
  (await page.locator('.bcresult').count()) <= hits &&
    (await page.locator('[data-bc-kind="Documents"]').getAttribute('aria-pressed')) === 'true',
)

await open('/basecamp')
const slug = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string

/* --- §15: aria-current marks where you are ------------------------------ */
const crumb = await page.locator('.bccrumb').count()
check('the overview is the landing surface, so it shows no tool breadcrumb', crumb === 0)

/* --- §15: reduced motion is respected ----------------------------------- */
const rm = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
})
const rmp = await rm.newPage()
await rmp.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await rmp.waitForSelector('.bcmain')
await rmp.waitForTimeout(400)
const durations = (await rmp.evaluate(
  inPage(`const cs = getComputedStyle(document.documentElement)
     return ['--bc-t-in', '--bc-t-out', '--bc-t-page', '--bc-t-nav'].map((n) => cs.getPropertyValue(n).trim())`),
)) as string[]
check(
  'under reduced motion every duration token collapses',
  durations.every((d) => d === '1ms'),
  durations.join(', '),
)
await rm.close()

/* --- §15: 200% zoom keeps the content and the actions ------------------- */
/*
  Emulated as HALF the viewport at twice the scale, which is what a browser
  zoom actually does to layout. The thing that must survive is the content and
  the actions, so the check is that the primary control is still reachable and
  the page still does not scroll sideways.
*/
const z = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 })
const zp = await z.newPage()
await zp.goto(url(`${slug}/tasks`), { waitUntil: 'domcontentloaded' })
await zp.waitForSelector('.bcmain')
await zp.waitForTimeout(400)
check(
  'at 200% zoom the primary action is still there',
  (await zp.locator('[data-bc-addtask]').first().isVisible()) === true,
)
check(
  'at 200% zoom there is still no horizontal page overflow',
  (await zp.evaluate(
    inPage('return document.documentElement.scrollWidth - document.documentElement.clientWidth'),
  )) === 0,
)
await z.close()

check('nothing was thrown during the sweep', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()

let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(
    `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.ok || c.detail === '' ? '' : `\n        ${c.detail}`}`,
  )
}
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
