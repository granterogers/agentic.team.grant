/**
 * Closing transitions on Team HQ (`/`), driven by real pointer presses. Each check reads the page after every step.
 *
 * The design under test: a modal sheet (Global Settings, the appearance sheet) keeps covering the page while it fades out.
 * Nothing falls through to the workspace, and a press on the closing sheet, anywhere except its own close controls, reopens
 * it. A press on a close control during the fade does nothing. The workspace behind a closing Settings page stays inert.
 *
 *   npx tsx scripts/verify/probe-exit-races.ts
 *
 * Read-only; serves web/studio locally. Desktop, motion on. Waits are for an observable state (the 'leaving' class, the
 * history), not for a fixed time; the one fixed pause is the 200 ms the fade itself takes.
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const record = (check: string, ok: boolean, detail: unknown) => results.push({ check, ok, detail })

const openProject = async (page: Page) => {
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)
}

// A point inside a sheet that is not a control, found by hit testing the page. Null when there is none.
const freePoint = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    for (let fy = 0.02; fy < 1; fy += 0.04) {
      for (let fx = 0.02; fx < 1; fx += 0.04) {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        const hit = document.elementFromPoint(x, y)
        if (!(hit instanceof HTMLElement) || !el.contains(hit)) continue
        if (
          hit.closest(
            '.close, [data-stg-back], [data-bc-expclose], .bcexpx, button, a, input, select, textarea',
          ) !== null
        )
          continue
        return { x, y }
      }
    }
    return null
  }, selector)

// Records, for every press on the page, whether a modal sheet was fading at that instant. The checks read it afterwards, so
// a pass proves the press arrived during the fade rather than after it.
const recordPresses = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __presses: boolean[] }
    w.__presses = []
    // On window, so it runs before the page's own capture listeners: a reopen by the press must not be seen as an open sheet.
    window.addEventListener(
      'pointerdown',
      () => {
        w.__presses.push(
          ['settings', 'viewer'].some(
            (id) => document.getElementById(id)?.classList.contains('leaving') === true,
          ),
        )
      },
      true,
    )
  })

const pressesWhileLeaving = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __presses?: boolean[] }
    return (w.__presses ?? []).includes(true)
  })

// The state a person can observe, read in one step so the checks compare like with like.
const snapshot = (page: Page, id: 'settings' | 'viewer') =>
  page.evaluate((sheetId) => {
    const sheet = document.getElementById(sheetId)
    const shell = document.querySelector('.shell')
    const active = document.activeElement
    return {
      open: sheet !== null && !sheet.hidden && !sheet.classList.contains('leaving'),
      leaving: sheet?.classList.contains('leaving') === true,
      inert: shell?.hasAttribute('inert') === true,
      behind: document.body.classList.contains('behind'),
      historySettings: history.state?.settings === true,
      path: location.pathname,
      focusInWorkspace:
        active instanceof HTMLElement && active !== document.body && active.isConnected,
    }
  }, id)

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openProject(page)

  // A. Viewer closed by Escape, then pressed on while it fades: it reopens, with the blur back.
  await page.locator('[data-bc-pagemenu]').first().click({ force: true })
  await page.waitForTimeout(300)
  await page.locator('[data-bc-look]').first().click({ force: true })
  await page.waitForTimeout(900)
  // The press point is found while the viewer is still open, and the press follows the close with no page read in between:
  // that is the timing a person produces, and the recorder below proves the press arrived while the sheet was fading.
  const point = await freePoint(page, '#viewer .sheet, #viewer')
  await recordPresses(page)
  await page.keyboard.press('Escape')
  if (point !== null) await page.mouse.click(point.x, point.y)
  const viewerFading = await snapshot(page, 'viewer')
  const pressedWhileFading = await pressesWhileLeaving(page)
  const viewerReopened = await snapshot(page, 'viewer')
  await page.waitForTimeout(500)
  const viewerLater = await snapshot(page, 'viewer')
  record(
    'viewer: a press on the fading sheet reopens it, with the workspace blurred again',
    pressedWhileFading === true &&
      point !== null &&
      viewerReopened.open &&
      viewerLater.open &&
      viewerLater.behind,
    { pressedWhileFading, viewerFading, point, viewerReopened, viewerLater },
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const viewerClosed = await snapshot(page, 'viewer')
  record(
    'viewer: Escape closes it again and focus is in the workspace',
    !viewerClosed.open && viewerClosed.focusInWorkspace && !viewerClosed.behind,
    { viewerClosed },
  )

  // B. Settings closed by its Back button; the workspace is unreachable while it fades; a press on the sheet reopens it.
  await page.locator('[data-bc-settings]').first().focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const settingsOpen = await snapshot(page, 'settings')
  const sheetPoint = await freePoint(page, '#settings')
  await recordPresses(page)
  await page.locator('[data-stg-back]').first().click({ force: true })
  if (sheetPoint !== null) await page.mouse.click(sheetPoint.x, sheetPoint.y)
  const settingsPressedWhileFading = await pressesWhileLeaving(page)
  const settingsReopened = await snapshot(page, 'settings')
  await page.waitForTimeout(500)
  const settingsLater = await snapshot(page, 'settings')
  record(
    'settings: a press on the sheet while it fades reopens it; the workspace is inert again once it is open',
    settingsOpen.open &&
      settingsPressedWhileFading === true &&
      sheetPoint !== null &&
      settingsReopened.open &&
      settingsLater.open &&
      settingsLater.inert &&
      settingsLater.historySettings,
    { settingsOpen, settingsPressedWhileFading, sheetPoint, settingsReopened, settingsLater },
  )
  // Back again: this closes it, and the history entry it opened is the one that goes.
  await page.locator('[data-stg-back]').first().click({ force: true })
  await page.waitForTimeout(600)
  const settingsClosed = await snapshot(page, 'settings')
  record(
    'settings: Back closes it, releases the workspace and leaves no settings entry',
    !settingsClosed.open && !settingsClosed.inert && !settingsClosed.historySettings,
    { settingsClosed },
  )

  // C. Double Back: the second press lands on the close control during the fade and must not undo the first close.
  await page.locator('[data-bc-settings]').first().focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  await page.locator('[data-stg-back]').first().click({ force: true })
  await page
    .locator('[data-stg-back]')
    .first()
    .click({ force: true, timeout: 300 })
    .catch(() => undefined)
  await page.waitForTimeout(700)
  const doubleBack = await snapshot(page, 'settings')
  record(
    'double Back: a second press on the close control does not reopen Settings',
    !doubleBack.open && !doubleBack.historySettings && !doubleBack.inert,
    { doubleBack },
  )

  // D. Rapid cycles with no pauses between presses: each cycle closes with Back and reopens with a press on the sheet.
  await page.locator('[data-bc-settings]').first().focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  // The sheet does not move, so its press point is found once, and every reopen press follows its Back press directly.
  const spot = await freePoint(page, '#settings')
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-stg-back]').first().click({ force: true })
    if (spot !== null) await page.mouse.click(spot.x, spot.y)
  }
  await page.waitForTimeout(600)
  const rapidOpen = await snapshot(page, 'settings')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  const rapidClosed = await snapshot(page, 'settings')
  record(
    'rapid: repeated Back and reopen presses end open with one settings entry; Escape then closes it cleanly',
    rapidOpen.open &&
      rapidOpen.historySettings &&
      rapidOpen.inert &&
      !rapidClosed.open &&
      !rapidClosed.historySettings &&
      !rapidClosed.inert,
    { rapidOpen, rapidClosed },
  )

  record('no page errors', errors.length === 0, errors.slice(0, 3))
  await context.close()
} finally {
  await browser.close()
  close()
}

for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.check}`, JSON.stringify(r.detail))
const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0
    ? `ALL ${String(results.length)} CHECKS PASS`
    : `${String(failed)} of ${String(results.length)} FAILED`,
)
process.exitCode = failed === 0 ? 0 : 1
