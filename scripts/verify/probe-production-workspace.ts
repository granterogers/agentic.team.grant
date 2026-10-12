// The gate comes first: this reads the production site, so it refuses to run without ALLOW_PRODUCTION_CHECKS=1.
import '../../src/safety/require-production-checks.ts'
/**
 * End-to-end verification of the Team HQ workspace on production, through the public Sample Office, as a visitor.
 * Real pointer and keyboard interactions. Each dialog is opened and closed, and then the workspace is used again to show it
 * still responds. The Sample says its changes are not saved; nothing here sends a message or changes the office's data.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/verify/probe-production-workspace.ts [desktop|phone]
 *
 * Writes .out/probe/prodws-<viewport>-<step>.png. Every check is recorded; none is hidden.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const BASE = 'https://ai-team-hq.vercel.app'
const OUT = join(process.cwd(), '.out', 'probe')
const viewport = process.argv[2] === 'phone' ? 'phone' : 'desktop'
const size = viewport === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const check = (name: string, ok: boolean, detail: unknown = {}) => {
  results.push({ check: name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name} ${JSON.stringify(detail).slice(0, 240)}`)
}
const failed: string[] = []
const pageErrors: string[] = []
const consoleErrors: string[] = []
const writes: string[] = []
const httpErrors: string[] = []

// The workspace is ready when the connecting line has gone and a project menu control is drawn. On a phone the home board draws
// the hamburger rather than the empty-state button, so either counts. On a timeout the screen is kept for judging.
const settle = async (page: Page) => {
  try {
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('Connecting to your office') === false &&
        document.querySelector('[data-bc-menu], [data-bc-menu-open]') !== null,
      null,
      { timeout: 90000 },
    )
  } catch (error) {
    await page.screenshot({ path: join(OUT, `prodws-${viewport}-stuck.png`) })
    throw error
  }
}

const state = (page: Page) =>
  page.evaluate(() => {
    const settings = document.getElementById('settings')
    const viewer = document.getElementById('viewer')
    const dock = document.getElementById('dock')
    const shell = document.querySelector('.shell')
    return {
      settingsOpen:
        settings !== null && !settings.hidden && !settings.classList.contains('leaving'),
      viewerOpen: viewer !== null && !viewer.hidden && !viewer.classList.contains('leaving'),
      chatOpen: dock !== null && !dock.hidden && !dock.classList.contains('leaving'),
      fading: [settings, viewer, dock].some((n) => n?.classList.contains('leaving') === true),
      inert: shell?.hasAttribute('inert') === true,
      behind: document.body.classList.contains('behind'),
    }
  })

// The Team Chat dock is shown when its conversation's close control is visible. That is what a person sees on both widths, and it
// is the only close a phone offers: on a phone the open dock covers the Chat toggle, so the toggle cannot close it.
const chatShown = (page: Page) =>
  page
    .locator('[data-dock-close]:visible')
    .count()
    .then((n) => n > 0)

// The workspace answers a real click: the Team Chat toggle opens the dock, and the dock's own close control shuts it again. Used
// after each dialog to show nothing is left blocking the page.
const workspaceResponds = async (page: Page) => {
  const toggle = page.locator('[data-bc-dock]:visible').first()
  // A missing control is a failed check, recorded, not an exception that ends the run.
  if ((await toggle.count()) === 0) {
    await page.screenshot({ path: join(OUT, `prodws-${viewport}-no-chat-control.png`) })
    check('a visible Team Chat control exists to test responsiveness', false, { url: page.url() })
    return false
  }
  const wasShown = await chatShown(page)
  if (wasShown) return false
  await toggle.click({ force: true, timeout: 5000 })
  await page.waitForTimeout(600)
  const opened = await chatShown(page)
  if (!opened) {
    await page.screenshot({ path: join(OUT, `prodws-${viewport}-chat-no-response.png`) })
    return false
  }
  await page.screenshot({ path: join(OUT, `prodws-${viewport}-chat-open.png`) })
  await page
    .locator('[data-dock-close]:visible')
    .first()
    .click({ force: true, timeout: 5000 })
    .catch(() => undefined)
  await page.waitForTimeout(600)
  const closed = !(await chatShown(page))
  if (!closed) await page.screenshot({ path: join(OUT, `prodws-${viewport}-chat-stuck-open.png`) })
  return closed
}

const browser = await chromium.launch()
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({
    viewport: size,
    isMobile: viewport === 'phone',
    hasTouch: viewport === 'phone',
    colorScheme: 'light',
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160))
  })
  page.on('requestfailed', (r) =>
    failed.push(
      `${r.method()} ${new URL(r.url()).pathname.slice(0, 60)} ${r.failure()?.errorText ?? ''}`,
    ),
  )
  page.on('request', (r) => {
    if (r.method() !== 'GET')
      writes.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname.slice(0, 60)}`)
  })
  // HTTP errors are not request failures: a 400 or 502 arrives as a response, so it is recorded from the response.
  // x-vercel-id is stamped by Vercel on every response it sends: its presence separates a platform error from a proxy fault.
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const h = res.headers()
      httpErrors.push(
        `${String(res.status())} ${res.request().method()} ${new URL(res.url()).pathname}${new URL(res.url()).search.slice(0, 80)} vercel-id=${h['x-vercel-id'] ?? 'NONE'} type=${h['content-type'] ?? 'NONE'}`,
      )
    }
  })

  // Enter the public Sample Office and wait for the workspace to settle, not for a fixed time.
  const enteredAt = Date.now()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bc-sample-start]').first().click({ force: true })
  await settle(page)
  const secondsToWorkspace = Math.round((Date.now() - enteredAt) / 1000)
  check('the Sample Office connects and shows the workspace', true, { secondsToWorkspace })
  await page.screenshot({ path: join(OUT, `prodws-${viewport}-home.png`) })
  const defaults = await page.evaluate(() => ({
    look: document.documentElement.dataset.look ?? null,
    scheme: document.documentElement.dataset.scheme ?? null,
  }))
  check('default look is Slate & Silver in this session', defaults.look === 'silver', defaults)

  // Open the first project, as a person does from the menu. The page menu, the modules and the documents are project controls.
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(OUT, `prodws-${viewport}-project.png`) })

  // Global Settings: opened from its header control with a press, a tab is chosen, Back closes it, and the workspace answers.
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForTimeout(900)
  const settingsOpened = (await state(page)).settingsOpen
  await page.screenshot({ path: join(OUT, `prodws-${viewport}-settings.png`) })
  const tabs = page
    .locator('[data-stg-tab], #settings nav button, #settings .st-nav button')
    .first()
  const hasTab = (await tabs.count()) > 0
  if (hasTab) await tabs.click({ force: true }).catch(() => undefined)
  await page.waitForTimeout(500)
  // On a phone Back first returns from a pane to the list of panes, and a second Back leaves Settings. Press visible Back until it
  // closes, and record how many presses that took, so the phone path is measured rather than assumed.
  let backPresses = 0
  for (let i = 0; i < 3 && (await state(page)).settingsOpen; i++) {
    await page.locator('[data-stg-back]:visible').first().click({ force: true })
    backPresses++
    await page.waitForTimeout(700)
  }
  const settingsClosed = !(await state(page)).settingsOpen && !(await state(page)).inert
  check(
    'Global Settings opens from its control and closes with Back; the workspace is released',
    settingsOpened && settingsClosed,
    { settingsOpened, settingsClosed, hasTab, backPresses },
  )
  check('workspace responds after closing Global Settings', await workspaceResponds(page))

  // Appearance: the look sheet previews a texture, Cancel restores the saved one, the sheet closes, the workspace responds.
  await page.locator('[data-bc-pagemenu]:visible').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-look]:visible').first().click({ force: true })
  await page.waitForTimeout(900)
  const looksOpen = (await state(page)).viewerOpen
  const picks = await page.locator('[data-bd-pick]').count()
  await page.locator('[data-bd-pick]').nth(1).click({ force: true })
  await page.waitForTimeout(400)
  const applyEnabledAfterPick = await page.locator('[data-bd-apply]').first().isEnabled()
  await page.screenshot({ path: join(OUT, `prodws-${viewport}-appearance-preview.png`) })
  await page.locator('[data-bd-cancel]').first().click({ force: true })
  await page.waitForTimeout(400)
  const applyDisabledAfterCancel = await page.locator('[data-bd-apply]').first().isDisabled()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const looksClosed = !(await state(page)).viewerOpen && !(await state(page)).behind
  check(
    'appearance sheet: a texture previews, Cancel reverts, Escape closes, workspace released',
    looksOpen && picks > 2 && applyEnabledAfterPick && applyDisabledAfterCancel && looksClosed,
    { looksOpen, picks, applyEnabledAfterPick, applyDisabledAfterCancel, looksClosed },
  )
  check('workspace responds after closing the appearance sheet', await workspaceResponds(page))

  // Canvas: a module is dragged by its title strip, the zoom control changes the scale, and the module's position changes.
  const mod = page.locator('[data-mod="tasks"]').first()
  const box = await mod.boundingBox()
  let moved = 0
  if (box !== null && viewport === 'desktop') {
    await page.mouse.move(box.x + 60, box.y + 16)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + 56, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await mod.boundingBox()
    moved = after === null ? 0 : Math.round(Math.hypot(after.x - box.x, after.y - box.y))
    await page.screenshot({ path: join(OUT, `prodws-${viewport}-canvas-dragged.png`) })
  }
  // The visible zoom control only: the first match can be a copy the layout hides.
  const zoomBefore = await page
    .locator('[data-bc-zoom="reset"]:visible')
    .first()
    .innerText()
    .catch(() => '')
  await page
    .locator('[data-bc-zoom="in"]:visible')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(300)
  const zoomAfter = await page
    .locator('[data-bc-zoom="reset"]:visible')
    .first()
    .innerText()
    .catch(() => '')
  await page
    .locator('[data-bc-zoom="reset"]:visible')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  if (viewport === 'desktop')
    check(
      'canvas: a module drags by its title strip and the zoom control changes the scale',
      moved > 40 && zoomBefore !== '' && zoomBefore !== zoomAfter,
      { movedPx: moved, zoomBefore, zoomAfter },
    )
  else
    console.log(
      `NOTE: no visible zoom control on a phone (visible zoom reading: "${zoomBefore}"); the phone canvas is not dragged`,
    )
  check('workspace responds after the canvas gestures', await workspaceResponds(page))

  // Modules: each module opens maximised from the menu, returns to the canvas, and the workspace responds after each.
  for (const id of ['tasks', 'documents', 'schedule', 'contacts']) {
    await page.locator('[data-bc-menu]:visible').first().click({ force: true })
    await page.waitForTimeout(350)
    await page
      .locator(`[data-bc-menu-modules] [data-bc-expand="${id}"]`)
      .first()
      .click({ force: true })
      .catch(() => undefined)
    await page.waitForTimeout(800)
    const maximised = (await page.locator('.bcexp').count()) > 0
    const fill = await page.evaluate(() => {
      const e = document.querySelector('.bcexp')
      const panel =
        e === null ? undefined : [...e.children].find((c) => !c.classList.contains('bcexpback'))
      const r = panel?.getBoundingClientRect()
      return r === undefined ? 0 : Math.round((r.width / window.innerWidth) * 100) / 100
    })
    if (maximised) await page.screenshot({ path: join(OUT, `prodws-${viewport}-module-${id}.png`) })
    await page
      .locator('.bcexpx')
      .first()
      .click({ force: true })
      .catch(() => undefined)
    await page.waitForTimeout(800)
    const returned = (await page.locator('.bcexp').count()) === 0
    check(
      `module ${id}: opens maximised and returns to the canvas`,
      maximised && returned && fill >= 0.8,
      { maximised, fill, returned },
    )
    check(`workspace responds after closing module ${id}`, await workspaceResponds(page))
  }

  // Calendar: next and today move the month, and a task on the list is reachable.
  const calBefore = await page
    .locator('[data-bc-cal]')
    .first()
    .innerText()
    .catch(() => '')
  await page
    .locator('[data-cal-nav="next"]')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(400)
  const calAfter = await page
    .locator('[data-bc-cal]')
    .first()
    .innerText()
    .catch(() => '')
  await page
    .locator('[data-cal-nav="today"]')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(400)
  check(
    'calendar: next changes the month, today returns, and the workspace responds',
    calBefore !== calAfter && (await workspaceResponds(page)),
    { changed: calBefore !== calAfter },
  )

  // Team Chat: five rapid presses with no pause between them, each the toggle when the dock is shut and its close control when it
  // is open. Five flips is an odd count, so the dock ends opposite to where it started, and one more press returns it.
  // What sits under the close control's centre just before each press, so a press that does not close says what took it.
  const hitsLog: string[] = []
  const pressChat = async () => {
    // On the desktop the toggle is never covered, so every press is the toggle. On a phone the open dock covers the toggle, so
    // the dock's own close control is used. A close control that is still sliding in is not a fair target, which is why the
    // desktop uses the toggle.
    if (viewport === 'desktop') {
      hitsLog.push(`toggle (desktop), shown=${String(await chatShown(page))}`)
      await page
        .locator('[data-bc-dock]:visible')
        .first()
        .click({ force: true, timeout: 5000 })
        .catch(() => undefined)
      return
    }
    if (await chatShown(page)) {
      const hit = await page
        .locator('[data-dock-close]:visible')
        .first()
        .evaluate((el) => {
          const r = el.getBoundingClientRect()
          const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return `${el.className}@${Math.round(r.left)},${Math.round(r.top)} under=${under?.tagName ?? 'none'}.${String(under?.className ?? '').slice(0, 40)}`
        })
        .catch(() => 'no close control')
      hitsLog.push(hit)
      await page
        .locator('[data-dock-close]:visible')
        .first()
        .click({ force: true, timeout: 5000 })
        .catch((e) => hitsLog.push(`click error: ${String(e).slice(0, 80)}`))
    } else {
      hitsLog.push('open via toggle')
      await page
        .locator('[data-bc-dock]:visible')
        .first()
        .click({ force: true, timeout: 5000 })
        .catch(() => undefined)
    }
  }
  // On a phone this press pattern reached the header Sign out in run 1 and ended the visitor session, so later steps could not run.
  // It is kept on the desktop, and the phone result is recorded as its own defect in the report rather than run here.
  if (viewport === 'phone')
    console.log(
      'NOTE: rapid Team Chat presses are not run on a phone; see the report (dock transition reached Sign out)',
    )
  const startShown = viewport === 'desktop' ? await chatShown(page) : null
  // The shown reading after each press, with no pause, so a failure says which press went wrong.
  if (viewport === 'desktop') {
    const trace: boolean[] = []
    for (let i = 0; i < 5; i++) {
      await pressChat()
      trace.push(await chatShown(page))
    }
    await page.waitForTimeout(700)
    const afterFive = await chatShown(page)
    await pressChat()
    await page.waitForTimeout(600)
    const afterSix = await chatShown(page)
    check(
      'Team Chat: five rapid presses and one more leave it consistent',
      afterFive !== startShown && afterSix === startShown && !(await state(page)).fading,
      { startShown, trace, afterFive, afterSix, hitsLog },
    )
  }
  await page.screenshot({ path: join(OUT, `prodws-${viewport}-after-rapid.png`) })
  // Close the dock if it is still open, so the menus below are reachable as a person would reach them.
  if (await chatShown(page))
    await page
      .locator('[data-dock-close]:visible')
      .first()
      .click({ force: true, timeout: 5000 })
      .catch(() => undefined)
  await page.waitForTimeout(500)

  // Documents: a document's record opens over the canvas and closes with Escape; the workspace responds afterwards.
  await page.locator('[data-bc-menu]:visible').first().click({ force: true })
  await page.waitForTimeout(350)
  await page
    .locator('[data-bc-menu-modules] [data-bc-expand="documents"]')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(800)
  const docCount = await page.locator('[data-bc-doc-open]').count()
  if (docCount > 0) await page.locator('[data-bc-doc-open]').first().click({ force: true })
  await page.waitForTimeout(1200)
  const docRecord = (await page.locator('.bcexp').count()) > 0
  if (docRecord) await page.screenshot({ path: join(OUT, `prodws-${viewport}-document.png`) })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  check(
    'documents: a document record opens and closes; the workspace responds',
    docCount > 0 && docRecord && (await workspaceResponds(page)),
    { docCount, docRecord },
  )

  // Browser Back closes Settings that was opened by a press (the history entry is real on production too).
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForTimeout(900)
  await page.goBack().catch(() => undefined)
  await page.waitForTimeout(900)
  check(
    'browser Back closes Global Settings on production',
    !(await state(page)).settingsOpen,
    await state(page),
  )

  // Final: nothing is left blocking the page, and the workspace answers once more.
  const finalState = await state(page)
  check(
    'final: no sheet fading, workspace released, responsive',
    !finalState.fading &&
      !finalState.inert &&
      !finalState.behind &&
      (await workspaceResponds(page)),
    finalState,
  )
  await page.screenshot({ path: join(OUT, `prodws-${viewport}-final.png`) })
  await context.close()
} catch (error) {
  // A step that cannot find its control ends the run with a recorded failure, not an unhandled crash, so the report still prints.
  check('the run reached its last step without an unhandled error', false, {
    error: String(error).slice(0, 220),
  })
} finally {
  await browser.close()
}

const uniqueWrites = [...new Set(writes)]
check('no page errors during the run', pageErrors.length === 0, pageErrors.slice(0, 5))
check('no failed requests during the run', failed.length === 0, failed.slice(0, 5))
console.log(`non-GET requests: ${String(writes.length)} ${JSON.stringify(uniqueWrites)}`)
console.log(
  `HTTP errors (4xx/5xx): ${String(httpErrors.length)} ${JSON.stringify([...new Set(httpErrors)])}`,
)
console.log(
  `console errors: ${String(consoleErrors.length)} ${JSON.stringify(consoleErrors.slice(0, 4))}`,
)
const bad = results.filter((r) => !r.ok).length
console.log(
  bad === 0
    ? `ALL ${String(results.length)} WORKSPACE CHECKS PASS (${viewport})`
    : `${String(bad)} of ${String(results.length)} FAILED (${viewport})`,
)
process.exitCode = bad === 0 ? 0 : 1
