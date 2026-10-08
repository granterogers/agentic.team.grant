/*
 * BACK, AND WHAT IT CLOSES FIRST.
 *
 * Grant, 22 September: "using the browser Back button or a mouse Back button
 * while inside an expanded module can immediately throw the user back to
 * Project Selection... 1. If a modal/expanded module/detail view is open, Back
 * should close that first. 2. If an internal project navigation state can
 * sensibly be reversed, Back should reverse it. 3. Only when the user is
 * genuinely back at the root project view should another Back action navigate
 * away toward Project Selection/Home. Where technically appropriate, use
 * browser history/state correctly rather than hijacking the Back button."
 *
 * So this drives the REAL browser Back - page.goBack(), which is the same
 * history traversal the mouse button performs - and asserts the three levels
 * in order. A test that called a close handler would prove nothing about the
 * thing he pressed.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4679
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const back = async (): Promise<void> => {
  await page.goBack()
  await page.waitForTimeout(500)
}
const dialogs = async (): Promise<number> => page.locator('[data-bc-expanded]').count()
const here = (): string => new URL(page.url()).pathname

/* Arrive the way a person does: the portfolio, then a project. */
await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(400)
const slug = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
await page.locator('[data-bc-menu]').click()
await page.locator(`.bcmenupanel [data-bc-go="${slug}"]`).first().click()
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(400)
check('a project opens from the portfolio', here() === slug, here())

/* --- 1. Back closes an expanded module before anything else ------------- */
await page
  .locator('[data-mod="documents"] .bcmodhead')
  .first()
  .click({ position: { x: 80, y: 10 } })
await page.waitForTimeout(500)
check('a module opens expanded', (await dialogs()) === 1)
check(
  'and the expanded view is in the address, so the browser knows it is a place',
  /\/x\//.test(here()),
  here(),
)
await back()
check('Back closes the expanded view', (await dialogs()) === 0)
check('and leaves you on the project, not at project selection', here() === slug, here())

/* --- 2. two levels deep: a record inside an expanded view --------------- */
await page
  .locator('[data-mod="tasks"] .bcmodhead')
  .first()
  .click({ position: { x: 80, y: 10 } })
await page.waitForTimeout(500)
await page.locator('[data-bc-expanded="tasks"] [data-bc-task-open]').first().click()
await page.waitForTimeout(500)
const recordShown = (await page.locator('[data-bc-expanded="tasks"]').innerText()).includes(
  'Details',
)
check('a task record opens inside the expanded view', recordShown)
await back()
check('Back comes out of the record, not out of the project', (await dialogs()) === 1, here())
await back()
check('and Back again closes the expanded view', (await dialogs()) === 0)
check('still on the project', here() === slug, here())

/* --- 3. internal navigation reverses ------------------------------------ */
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(400)
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(200)
await page.locator('[data-bc-pagemenu-panel] [data-bc-expand="team"]').first().click()
await page.waitForTimeout(500)
check('the team opens from the page menu', (await dialogs()) === 1)
await back()
check('and Back closes that too', (await dialogs()) === 0, here())

/*
 * --- 3b. DISMISSING RETURNS EXACTLY ONE LEVEL (§21) ----------------------
 *
 * Grant, 23 September: "Sources -> Notion -> dismiss individual source popup
 * by clicking outside" returned all the way to project Home. "Closing a child
 * surface should return exactly ONE level. Preserve navigation context. Test:
 * outside click, Escape, Back, explicit close."
 *
 * Back was already right, because it is real history and section 2 proves it.
 * The other three went through one handler that cleared the sheet AND every
 * record inside it, so dismissing a detail threw away the list it was opened
 * from -- on every child surface in the experience, not only on Sources.
 *
 * All three are driven here against the source example he gave. Each one opens
 * the detail again first, because a check that reuses the state the previous
 * one left is asserting about a screen it did not set up.
 */
const openSourceDetail = async (): Promise<boolean> => {
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes')
  await page.waitForTimeout(400)
  await page.locator('[data-bc-pagemenu]').first().click()
  await page.waitForTimeout(200)
  await page.locator('[data-bc-pagemenu-panel] [data-bc-sources]').first().click()
  await page.waitForTimeout(500)
  const one = await page.locator('[data-bc-source]').first()
  if ((await one.count()) === 0) return false
  await one.click()
  await page.waitForTimeout(400)
  return true
}
/** Is a source DETAIL showing, as opposed to the list of them? */
const onDetail = async (): Promise<boolean> =>
  (await page.locator('[data-bc-source-close], [data-bc-source-save]').count()) > 0
/** Is the Sources list still open behind it? */
const onSources = async (): Promise<boolean> =>
  (await dialogs()) === 1 && (await page.locator('[data-bc-source]').count()) > 0

const opened = await openSourceDetail()
check('a source detail opens from the Sources list', opened && (await onDetail()))
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check(
  'Escape returns to Sources, not to the project home',
  !(await onDetail()) && (await onSources()),
  `detail ${String(await onDetail())} · sources ${String(await onSources())} · dialogs ${String(await dialogs())}`,
)

await openSourceDetail()
/*
  OUTSIDE MEANS OUTSIDE THE DETAIL, and the sheet is what is around it, so the
  press lands near the top-left of the viewport -- where the backdrop is and no
  control of the detail's is.
*/
await page.mouse.click(8, 8)
await page.waitForTimeout(400)
check(
  'clicking outside returns to Sources, not to the project home',
  !(await onDetail()) && (await onSources()),
  `detail ${String(await onDetail())} · sources ${String(await onSources())} · dialogs ${String(await dialogs())}`,
)

await openSourceDetail()
const closer = page.locator('[data-bc-source-close]').first()
if ((await closer.count()) > 0) {
  await closer.click()
  await page.waitForTimeout(400)
  check(
    'and the explicit close does the same',
    !(await onDetail()) && (await onSources()),
    `detail ${String(await onDetail())} · sources ${String(await onSources())}`,
  )
}

/*
  AND THE SHEET ITSELF STILL CLOSES. The one-level rule must not make the
  Sources list undismissable: a second Escape, with nothing open inside it,
  closes the sheet and leaves the project where it was.
*/
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check(
  'a second dismissal closes Sources and leaves you on the project',
  (await dialogs()) === 0 && here() === slug,
  `dialogs ${String(await dialogs())} · ${here()}`,
)

/* --- 4. only then does Back leave the project --------------------------- */
await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(400)
await page.locator('[data-bc-menu]').click()
await page.locator(`.bcmenupanel [data-bc-go="${slug}"]`).first().click()
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(400)
await page
  .locator('[data-mod="schedule"] .bcmodhead')
  .first()
  .click({ position: { x: 80, y: 10 } })
await page.waitForTimeout(500)
await back()
await back()
check('from the bare project, Back finally goes to project selection', here() === '/', here())

/* --- 5. Forward reopens it, because it is a real history entry ---------- */
await page.goForward()
await page.waitForTimeout(500)
await page.goForward()
await page.waitForTimeout(600)
check(
  'and Forward reopens the expanded view rather than losing it',
  (await dialogs()) === 1,
  here(),
)

/* --- 6. a reload lands on the same screen ------------------------------- */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
check(
  'reloading an expanded view comes back to it',
  (await dialogs()) === 1,
  `${here()} — dialogs ${String(await dialogs())}`,
)

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
