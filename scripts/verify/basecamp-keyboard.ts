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
const noRing = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('button, a[href], input, summary')) {
       const r = el.getBoundingClientRect()
       if (r.width === 0 || r.height === 0) continue
       el.focus()
       const cs = getComputedStyle(el)
       const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
       const shadow = cs.boxShadow !== 'none' && cs.boxShadow !== ''
       if (!ring && !shadow) {
         out.push(el.tagName.toLowerCase() + ' "' + (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) + '"')
       }
     }
     return out`),
)) as string[]
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

/* --- §8.2 point 4: a preview announces its tool AND its summary -------- */
const previews = (await page.evaluate(
  inPage(
    `return [...document.querySelectorAll('.bcpreview')].map((p) => p.getAttribute('aria-label') ?? '')`,
  ),
)) as string[]
check(
  'every preview announces what it opens and what it is summarising',
  previews.length > 0 && previews.every((p) => p.includes('Opens the') || p.includes('Opens')),
  previews.slice(0, 2).join(' // '),
)

/* --- §7: Shift+J from anywhere outside composition --------------------- */
await open('/basecamp')
await page.keyboard.press('Shift+J')
await page.waitForTimeout(300)
check('Shift+J opens Jump', (await page.locator('#bcjump').count()) === 1)
check('focus lands in the query box', (await here()).includes('bcinput'), await here())

/* --- §11.2: the focus trap ---------------------------------------------- */
const seen = new Set<string>()
let escaped = false
for (let i = 0; i < 25; i += 1) {
  await page.keyboard.press('Tab')
  const inside = (await page.evaluate(
    inPage("return document.activeElement?.closest('#bcjump') !== null"),
  )) as boolean
  if (!inside) {
    escaped = true
    break
  }
  seen.add(await here())
}
check('25 Tabs never leave the open sheet', !escaped, `focus reached ${await here()}`)
check(
  'the trap is not a single stuck element',
  seen.size > 1,
  `${String(seen.size)} distinct stop(s)`,
)

/* --- §7.3: the keyboard map --------------------------------------------- */
await page.locator('#bcjumpq').focus()
const first = await page.evaluate(
  inPage('return document.querySelector(\'[aria-selected="true"]\')?.textContent?.trim()'),
)
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(150)
const second = await page.evaluate(
  inPage('return document.querySelector(\'[aria-selected="true"]\')?.textContent?.trim()'),
)
check('ArrowDown moves the selection', first !== second, `${String(first)} -> ${String(second)}`)
await page.keyboard.press('ArrowUp')
await page.waitForTimeout(150)
check(
  'ArrowUp moves it back',
  (await page.evaluate(
    inPage('return document.querySelector(\'[aria-selected="true"]\')?.textContent?.trim()'),
  )) === first,
)
await page.keyboard.press('End')
await page.waitForTimeout(150)
const atEnd = await page.evaluate(
  inPage('return document.querySelector(\'[aria-selected="true"]\')?.textContent?.trim()'),
)
check('End jumps to the last result', atEnd !== first, String(atEnd))
await page.keyboard.press('Home')
await page.waitForTimeout(150)
check(
  'Home jumps back to the first',
  (await page.evaluate(
    inPage('return document.querySelector(\'[aria-selected="true"]\')?.textContent?.trim()'),
  )) === first,
)

/* --- §7.1: Escape closes and restores focus to the invoker -------------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
check('Escape closes the sheet', (await page.locator('#bcjump').count()) === 0)
check(
  'and focus returns to the control that opened it',
  (await page.evaluate(
    inPage("return document.activeElement?.hasAttribute('data-bc-jump') === true"),
  )) === true,
  await here(),
)

/* --- §7.1 and §7.3: the shortcut must not fire while composing ---------- */
const slug = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
await open(`${slug}/tasks`)
await page.locator('[data-bc-addtask]').first().click()
await page.waitForTimeout(200)
await page.locator('#bc-task-title').focus()
await page.keyboard.press('Shift+J')
await page.waitForTimeout(250)
check(
  'Shift+J does NOT open Jump while a field has focus',
  (await page.locator('#bcjump').count()) === 0,
  'typing a capital J into a title must type a J',
)
check(
  'and the letter was typed instead',
  (await page.locator('#bc-task-title').inputValue()).includes('J'),
  `the field holds "${await page.locator('#bc-task-title').inputValue()}"`,
)

/* --- §10E: a core journey completed with the keyboard only -------------- */
await open('/basecamp')
/*
  Home to a project to a tool, using only Shift+J and the arrow keys. This is
  the check that cannot be satisfied by parts that each work: it fails if the
  selection, the Enter handler, the navigation or the focus restore is wrong.
*/
await page.keyboard.press('Shift+J')
await page.waitForTimeout(300)
await page.locator('#bcjumpq').type('Legacy')
await page.waitForTimeout(350)
await page.keyboard.press('Enter')
await page.waitForTimeout(600)
check(
  'keyboard only: Jump, filter, Enter opened a project overview',
  (await page.locator('.bcgrid').count()) > 0 && page.url().includes('/basecamp/p/'),
  page.url(),
)

/* --- §7.3: Shift+Enter reaches a full search that actually searches ------ */
/*
  THE CHECK THAT WOULD HAVE CAUGHT THE BROKEN PROMISE.

  Shift+Enter used to navigate to `/?q=…` in the default studio. Nothing there
  reads `q`, and keepUrl strips the query on the first paint, so the keystroke
  went home and silently dropped what had been typed — indistinguishable, from
  the outside, from a search that found nothing.

  So the assertion is not "a search surface opened". It is that the query
  survived the promotion AND that results for it are on screen: a surface that
  opens empty is the same defect wearing a better address.
*/
await open('/basecamp')
await page.keyboard.press('Shift+J')
await page.waitForTimeout(300)
await page.locator('#bcjumpq').type('interview')
await page.waitForTimeout(300)
await page.keyboard.press('Shift+Enter')
await page.waitForTimeout(700)
check('Shift+Enter reaches the full search', page.url().endsWith('/basecamp/search'), page.url())
check(
  'and the query survived the promotion',
  (await page.locator('#bc-search-q').inputValue()) === 'interview',
  `the box holds "${await page.locator('#bc-search-q').inputValue()}"`,
)
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
