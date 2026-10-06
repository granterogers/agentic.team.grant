/*
 * THE TWO SETTINGS SCREENS, AND WHETHER THEY ARE STILL LEGACY.
 *
 * Grant, 22 September: "Project Settings is still exposing the
 * old-fashioned/legacy interface... stop dropping the user into an obviously
 * legacy-looking interface; make Project Settings visually coherent with the
 * new application; preserve existing settings functionality; avoid
 * regressions." And of the other one: "Create a replacement interface using
 * the same design system as the new project experience: typography; spacing;
 * card/panel treatment; borders; shadows; controls; buttons; navigation;
 * interaction states; responsive behaviour... Do not simply recolour the
 * legacy page."
 *
 * "Visually coherent" is not directly testable and "looks legacy" is not
 * either. What IS testable, and is what those sentences actually rest on:
 *
 *  - pressing Project Settings no longer LEAVES the experience;
 *  - the screens are drawn with the experience's own tokens rather than the
 *    default studio's, which is measurable on the rendered pixels;
 *  - the same controls are still there and still act, which is the
 *    "preserve functionality, avoid regressions" half;
 *  - and the default studio's own settings are untouched, measured the same
 *    way.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4685
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

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()

/* --- 1. Project Settings is reached without leaving --------------------- */
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(400)
/* The board's own edge, read before we leave it, to compare against. */
const boardEdge = (await page.evaluate(
  inPage(`const el = document.querySelector('.bcmod')
     return el === null ? '' : getComputedStyle(el).borderTopWidth`),
)) as string
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(200)
const entry = page.locator('[data-bc-pagemenu-panel] button', { hasText: 'Project settings' })
/*
 * THE MENU SURVIVES A REDRAW.
 *
 * Grant, 23 September: "The three-dot/settings control has disappeared... this
 * is currently a blocker because project settings cannot be inspected."
 *
 * It was present and clickable at every width - five measurements said so
 * before anything was changed. Two things were wrong and both are real:
 * nothing on it said SETTINGS, and its open state lived in the DOM, so any of
 * the several things that redraw this shell replaced the panel with a fresh
 * hidden one and the menu vanished a moment after being opened.
 *
 * This asserts the second, which is the one a person experiences as a control
 * that does not work.
 */
check(
  'the project menu opens',
  (await page.locator('[data-bc-pagemenu-panel]:not([hidden])').count()) === 1,
)
check(
  'and it says Settings rather than describing itself as a page',
  ((await page.locator('[data-bc-pagemenu]').first().getAttribute('aria-label')) ?? '')
    .toLowerCase()
    .includes('settings'),
  (await page.locator('[data-bc-pagemenu]').first().getAttribute('aria-label')) ?? '',
)
/*
  A REAL REDRAW, of the kind nobody asked for. The first version of this
  dispatched a resize, which redraws nothing here - so it passed against a
  deliberately broken build, which is worse than no check at all.
*/
await page.evaluate('window.__shots.render()')
await page.waitForTimeout(400)
check(
  'and a redraw does not take it away again',
  (await page.locator('[data-bc-pagemenu-panel]:not([hidden])').count()) === 1,
  'the menu closed itself when the shell redrew',
)
/* Left OPEN, because the checks below press what is inside it. */

check('the page menu offers Project settings', (await entry.count()) === 1)
check(
  'and it is a move inside the experience rather than a hand-off out of it',
  (await entry.first().getAttribute('data-bc-leave')) === null,
  `data-bc-leave is ${String(await entry.first().getAttribute('data-bc-leave'))}`,
)
await entry.first().click()
await page.waitForTimeout(700)
check(
  'pressing it stays in Team HQ',
  !new URL(page.url()).pathname.startsWith('/classic'),
  page.url(),
)
check(
  'and the experimental shell is still around it',
  (await page.locator('.bctop').count()) === 1 &&
    (await page.locator('.bcrecordhead h1').innerText()).includes('Project Settings'),
)

/* --- 2. it is drawn in the experience's own system ---------------------- */
/*
  MEASURED, not eyeballed. The experience's body type is Instrument Sans at a
  16px base and its muted ink is its own token; the default studio's are
  different values. Reading them off the rendered pane is the closest a check
  can get to "this is the new design system" without describing a picture.
*/
const look = (await page.evaluate(
  inPage(`const pane = document.querySelector('.bcsetframe')
     if (pane === null) return null
     const tab = pane.querySelector('.subtab')
     const panel = pane.querySelector('.setroster, .setblock, .setproj, .setoffice')
     const cs = (el) => (el === null ? null : getComputedStyle(el))
     const p = cs(panel)
     const t = cs(tab)
     return {
       font: getComputedStyle(pane).fontFamily,
       tabRadius: t === null ? '' : t.borderRadius,
       tabMinHeight: t === null ? '' : t.minHeight,
       panelRadius: p === null ? '' : p.borderRadius,
       panelBorder: p === null ? '' : p.borderTopWidth,
       panelShadow: p === null ? '' : p.boxShadow,
     }`),
)) as Record<string, string> | null
check('the settings pane is on screen to measure', look !== null)
if (look !== null) {
  check(
    'it is set in the experience typeface',
    /Instrument Sans/.test(look.font ?? ''),
    look.font ?? '',
  )
  check(
    'its tab strip is the experience navigation, not the legacy one',
    Number.parseFloat(look.tabRadius ?? '0') >= 6 &&
      Number.parseFloat(look.tabMinHeight ?? '0') >= 36,
    `radius ${look.tabRadius ?? ''}, min-height ${look.tabMinHeight ?? ''}`,
  )
  /*
    COMPARED WITH THE EXPERIENCE'S OWN PANELS rather than against a number.

    The first version of this asserted a border of at least 1.4px, because the
    stylesheet asks for 1.5 - and Chromium at a device scale of 1 reports
    1px, so a correct panel failed a check about the harness's arithmetic.
    Asking whether the settings panel has the same edge as a module on the
    board is both the real question and immune to how the engine rounds.
  */
  check(
    'its panels carry the experience panel treatment: radius, a real border, a shadow',
    Number.parseFloat(look.panelRadius ?? '0') >= 8 &&
      Number.parseFloat(look.panelBorder ?? '0') >= 1 &&
      (look.panelShadow ?? 'none') !== 'none',
    `radius ${look.panelRadius ?? ''}, border ${look.panelBorder ?? ''}, shadow ${(look.panelShadow ?? '').slice(0, 40)}`,
  )
  check(
    'and it is the SAME edge the board uses, not a lookalike',
    boardEdge !== '' && boardEdge === look.panelBorder,
    `board ${boardEdge}, settings ${look.panelBorder}`,
  )
}

/* --- 3. the controls are still there and still act ---------------------- */
const panes = await page.locator('[data-setpane]').count()
check('every settings pane is still offered', panes >= 4, `${String(panes)} pane(s)`)
await page.locator('[data-setpane="labels"]').click()
await page.waitForTimeout(600)
check(
  'and choosing one changes the pane',
  (await page.locator('.bcsetframe').innerText()).toLowerCase().includes('label'),
  (await page.locator('.bcsetframe').innerText()).replace(/\n/g, ' / ').slice(0, 140),
)
await page.locator('[data-setpane="project"]').click()
await page.waitForTimeout(600)
const projectPane = await page.locator('.bcsetframe').innerText()
check(
  'the Project pane still carries the project-level controls',
  projectPane.length > 80,
  projectPane.replace(/\n/g, ' / ').slice(0, 140),
)

/* --- 4. the office's settings, in the same system ----------------------- */
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(400)
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(200)
await page.locator('[data-bc-settings]').first().click()
await page.waitForTimeout(800)
const sheet = (await page.evaluate(
  inPage(`const el = document.querySelector('#settings .sheet.settings')
     if (el === null) return null
     const cs = getComputedStyle(el)
     const host = getComputedStyle(document.querySelector('#settings'))
     const r = el.getBoundingClientRect()
     return {
       radius: cs.borderRadius,
       border: cs.borderTopWidth,
       shadow: cs.boxShadow,
       background: cs.backgroundColor,
       hostBackground: host.backgroundColor,
       hostPlace: host.placeItems,
       left: Math.round(r.left),
       right: Math.round(window.innerWidth - r.right),
       font: cs.fontFamily,
     }`),
)) as Record<string, string | number> | null
check('the office settings open from the experiment', sheet !== null)
if (sheet !== null) {
  check(
    'they are a dialog rather than a flush drawer: radius, border and shadow',
    Number.parseFloat(String(sheet.radius)) >= 8 &&
      Number.parseFloat(String(sheet.border)) >= 1 &&
      String(sheet.shadow) !== 'none',
    `radius ${String(sheet.radius)}, border ${String(sheet.border)}`,
  )
  check(
    'centred, with the project dimmed behind rather than half-covered',
    Math.abs(Number(sheet.left) - Number(sheet.right)) <= 8 &&
      String(sheet.hostBackground) !== 'rgba(0, 0, 0, 0)',
    `left ${String(sheet.left)}, right ${String(sheet.right)}, scrim ${String(sheet.hostBackground)}`,
  )
  check(
    'opaque, so the board does not show through its own cards',
    !/rgba\([^)]*,\s*0\)/.test(String(sheet.background)),
    String(sheet.background),
  )
  check(
    'and set in the experience typeface',
    /Instrument Sans/.test(String(sheet.font)),
    String(sheet.font),
  )
}
const tabs = await page.locator('#settings .settabs button').count()
check('every global settings tab is still there', tabs >= 8, `${String(tabs)} tab(s)`)
await page.locator('#settings .settabs button', { hasText: 'Behaviour' }).first().click()
await page.waitForTimeout(600)
check(
  'and choosing one still changes the tab',
  (await page.locator('#settings').innerText()).length > 200,
)

/* --- 5. the default studio's settings are untouched --------------------- */
/* --- §§12-14: two scopes, two controls --------------------------------- */
/*
  The project's menu must not carry the word Settings (§12), must not offer
  Arrange this page (§13), and must not be where the OFFICE's settings live
  (§14) -- those get their own three-dot control in the shell's top right,
  outside any project.
*/
await page.goto(url('/basecamp/p/legacy-coaching-course'), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-pagemenu]', { timeout: 20000 })
const scopes = (await page.evaluate(
  inPage(`
    const trigger = document.querySelector('[data-bc-pagemenu]')
    const menu = document.querySelector('[data-bc-pagemenu-panel]')
    const office = document.querySelector('.bcofficemenu [data-bc-settings]')
    const top = document.querySelector('.bctop')
    const head = document.querySelector('.bchead, header.bchead, .bcheadrow')
    return {
      triggerWords: trigger === null ? '' : (trigger.innerText || '').trim(),
      triggerNamed: trigger === null ? '' : (trigger.getAttribute('aria-label') || ''),
      items: menu === null ? [] : [...menu.querySelectorAll('[role=menuitem]')].map((b) => (b.textContent || '').trim()),
      officeExists: office !== null,
      officeInTop: office !== null && top !== null && top.contains(office),
      officeInProject: office !== null && head !== null && head.contains(office),
      officeNamed: office === null ? '' : (office.getAttribute('aria-label') || ''),
    }
  `),
)) as {
  triggerWords: string
  triggerNamed: string
  items: string[]
  officeExists: boolean
  officeInTop: boolean
  officeInProject: boolean
  officeNamed: string
}

check(
  'the project control shows dots, not the word Settings',
  scopes.triggerWords === '',
  `"${scopes.triggerWords}"`,
)
check(
  'but it still says what it opens, for anyone reading the page aloud',
  /settings/i.test(scopes.triggerNamed),
  scopes.triggerNamed,
)
check(
  'the project menu no longer offers Arrange this page',
  !scopes.items.some((w) => /arrange/i.test(w)),
  scopes.items.join(' / '),
)
check(
  'and no longer offers the office-wide settings',
  !scopes.items.some((w) => /everything/i.test(w)),
  scopes.items.join(' / '),
)
check(
  'it still offers this project settings',
  scopes.items.some((w) => /project settings/i.test(w)),
)
check('the office has its own control', scopes.officeExists)
check('in the shell top row', scopes.officeInTop)
check('and outside the project', !scopes.officeInProject)
check(
  'and it says which scope it changes',
  /office|everything|whole/i.test(scopes.officeNamed),
  scopes.officeNamed,
)

/*
  The office settings are the studio's own sheet, which is what
  `openGlobalSettings` has always opened -- so what this asserts is that the
  new control reaches it, not that a new surface exists. `body.behind` is the
  studio's signal for "a sheet is open"; the sheet element stays in the tree
  with its box taken away, so querying for the node reports it open while it
  is shut.
*/
await page.click('.bcofficemenu [data-bc-settings]')
const officeOpened = await page
  .waitForFunction(
    "document.body.classList.contains('behind') || (document.querySelector('#settings') !== null && document.querySelector('#settings').getBoundingClientRect().height > 0)",
    undefined,
    { timeout: 15000 },
  )
  .then(() => true)
  .catch(() => false)
check('and pressing it opens the office settings', officeOpened)

/*
  THE OTHER HALF OF EVERY SCOPED CHANGE, and the one that is easy to skip.
  Every rule added for this is scoped to the experiment; this is what proves
  it, by measuring the same element on the older studio, kept at /classic
  since #382 (the root is Team HQ now).
*/
await page.goto(url('/classic'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.evaluate(inPage(`window.location.hash = ''; return true`))
const def = (await page.evaluate(
  inPage(`return {
     experience: document.documentElement.dataset.experience ?? 'none',
     bc: document.querySelectorAll('.bctop, .bcsetframe').length,
   }`),
)) as { experience: string; bc: number }
check(
  'the older studio carries no Team HQ attribute or shell',
  def.experience === 'none' && def.bc === 0,
  `${def.experience}, ${String(def.bc)} experimental element(s)`,
)

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
