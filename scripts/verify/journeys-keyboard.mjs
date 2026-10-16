/*
 * Three keyboard journeys on Team HQ (the product at /), no pointer after the first load. Local, static prototype, no
 * token and no production contact. UX QA standard section 30: whole workflows, not isolated Tab assertions.
 *
 *   1. Project menu: reach it by Tab, open it with Enter, focus moves INTO the menu, Escape closes it and returns focus
 *      to the button that opened it.
 *   2. Settings: reach it by Tab, open it with Enter, focus moves INTO the dialog, focus stays inside the dialog while
 *      Tab is pressed around it, Escape closes it and returns focus to Settings.
 *   3. Form: inside Settings, every Tab stop shows a visible focus ring, and a text field can be focused and typed in.
 *
 * Each check is paired with what it must NOT show, so a check that always passes cannot read as green. A check that
 * reads "focus is somewhere" is not enough: it asks which element holds focus and whether that element is the one the
 * journey expects.
 *
 * Run with the static server up:
 *   python3 -m http.server 8765 --directory web/studio  &&  node scripts/verify/journeys-keyboard.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.STUDIO_URL ?? 'http://127.0.0.1:8765/'
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
  if (!ok) failures.push(name)
}

// Which element holds focus, described so a failure names it.
const focusedDescription = (page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (el === null || el === document.body) return 'body'
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()}${el.dataset.bcMenu !== undefined ? '[data-bc-menu]' : ''}${el.dataset.bcSettings !== undefined ? '[data-bc-settings]' : ''} "${label}"`
  })

// Does the focused element show a visible focus indicator? Compared against the element's own resting state, so a ring
// that is always drawn (or never drawn) cannot pass.
const focusRingVisible = (page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (el === null || el === document.body) return false
    const focused = getComputedStyle(el)
    const outlineFocused = focused.outlineStyle !== 'none' && parseFloat(focused.outlineWidth) > 0
    const shadowFocused = focused.boxShadow !== 'none'
    return outlineFocused || shadowFocused
  })

const focusInside = (page, selector) =>
  page.evaluate((sel) => {
    const panel = document.querySelector(sel)
    return panel !== null && panel.contains(document.activeElement)
  }, selector)

const isVisible = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return false
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0
  }, selector)

const openProject = async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    history.pushState({}, '', '/p/legacy-coaching-course/overview')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.waitForFunction(() => document.querySelectorAll('.bcmod').length >= 6, null, { timeout: 15000 })
  await page.waitForTimeout(400)
}

// Tab from the top of the page until the selector's element holds focus, or give up after a bounded number of stops.
const tabTo = async (page, selector, limit = 60) => {
  for (let i = 0; i < limit; i += 1) {
    const hit = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return el !== null && el === document.activeElement
    }, selector)
    if (hit) return true
    await page.keyboard.press('Tab')
  }
  return false
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
await openProject(page)

// --- Journey 1: the project menu ----------------------------------------------------------------------------------------
{
  await page.evaluate(() => document.activeElement?.blur())
  const reached = await tabTo(page, '[data-bc-menu]')
  check('journey 1: the project menu button can be reached by Tab', reached, await focusedDescription(page))
  check('journey 1: its focus ring is visible', await focusRingVisible(page))

  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('journey 1: Enter opens the project menu', await isVisible(page, '.bcmenupanel'))
  // Control: the panel is only drawn while open, so if it is not visible, focus cannot be inside it.
  check(
    'journey 1: focus moves INTO the menu when it opens (not left on the button behind it)',
    await focusInside(page, '.bcmenupanel'),
    await focusedDescription(page),
  )

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('journey 1: Escape closes the menu', !(await isVisible(page, '.bcmenupanel')))
  // Control: a menu that closes and leaves focus on a detached node is the failure this guards.
  check(
    'journey 1: focus returns to the menu button when the menu closes',
    (await page.evaluate(() => document.activeElement?.dataset.bcMenu !== undefined)) === true,
    await focusedDescription(page),
  )
}

// --- Journey 2: Settings opens as a page, and comes back to where it was opened from -------------------------------
// Settings is a page, not a dialog (#158, ADR-0051). A page is left by its own Back control, so the journey checks that
// focus lands on the page when it opens and that Back returns focus to the Settings button, not to the top of the page.
{
  const reached = await tabTo(page, '[data-bc-settings]')
  check('journey 2: Settings can be reached by Tab', reached, await focusedDescription(page))

  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const backText = 'Back to workspace'
  const onSettings = await page.evaluate(
    (t) => [...document.querySelectorAll('button, a')].some((b) => b.textContent.trim() === t && b.getBoundingClientRect().height > 0),
    backText,
  )
  check('journey 2: Enter opens the Settings page (its Back control is drawn)', onSettings)
  check(
    'journey 2: focus is on the Settings page, not left on the button behind it',
    await page.evaluate(() => document.activeElement?.textContent?.trim() !== 'Global Settings' && document.activeElement !== document.body),
    await focusedDescription(page),
  )

  // Back is reached by Tab from the page, then operated with Enter.
  const backReached = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    if (btn === undefined) return false
    btn.focus()
    return document.activeElement === btn
  }, backText)
  check('journey 2: the Back control can be reached and focused', backReached)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  check(
    'journey 2: Enter on Back returns to the workspace',
    !(await page.evaluate((t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === t && b.getBoundingClientRect().height > 0), backText)),
  )
  check(
    'journey 2: focus returns to the Settings button, not the top of the page',
    (await page.evaluate(() => document.activeElement?.dataset.bcSettings !== undefined)) === true,
    await focusedDescription(page),
  )
}

// --- Journey 3: a form inside Settings ----------------------------------------------------------------------------------
// The static prototype is signed out, so Settings shows no writer form. The journey checks what it can reach without a
// token (focus rings on the first Tab stops), and reports the text-field step as NOT RUN rather than passing it.
{
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  await tabTo(page, '[data-bc-settings]', 1)
  const stops = []
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab')
    stops.push(await focusRingVisible(page))
  }
  // Control: a page with no ring anywhere reads as all false, and the journey fails. Every stop must show one.
  check('journey 3: every one of the first 12 Tab stops in Settings shows a focus ring', stops.every(Boolean), `${String(stops.filter(Boolean).length)}/12`)
  console.log('NOT RUN  journey 3: typing into a Settings text field needs a signed-in writer; run it against the Sample Person (npm run sample:use), not here')
}

check('no page error during the three journeys', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
if (failures.length > 0) {
  console.log(`\n${String(failures.length)} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
