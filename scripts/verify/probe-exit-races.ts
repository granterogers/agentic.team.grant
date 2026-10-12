/**
 * Exit-transition races on Team HQ (`/`), driven in a real browser. Three regressions from the second review:
 *
 *   1. Reopening the document viewer during its exit restores the open state: not hidden, not leaving, focus
 *      moved into it, workspace behind it blurred again.
 *   2. Repainting while Team Chat is leaving does not cut the fade short (the drawer is still on screen at 60 ms).
 *   3. While Global Settings leaves, the workspace behind it stays inert and the opener keeps focus, so nothing
 *      behind the fading sheet can be pressed. Both are released when the exit ends.
 *
 *   npx tsx scripts/verify/probe-exit-races.ts
 *
 * Read-only; serves web/studio locally. Desktop, motion on. Each check reads the page, never a fixed pause alone.
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

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openProject(page)

  // 1. Viewer: close with Escape, reopen 60 ms later while it is still fading.
  await page.locator('[data-bc-pagemenu]').first().click({ force: true })
  await page.waitForTimeout(300)
  await page.locator('[data-bc-look]').first().click({ force: true })
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  // Wait until the exit has actually begun, rather than a fixed pause: a reopen before that proves nothing.
  const leavingBeforeReopen = await page
    .waitForFunction(
      () => document.getElementById('viewer')?.classList.contains('leaving') === true,
      null,
      { timeout: 500 },
    )
    .then(() => true)
    .catch(() => false)
  await page.waitForTimeout(60)
  await page.locator('[data-bc-pagemenu]').first().click({ force: true })
  await page.waitForTimeout(300)
  await page.locator('[data-bc-look]').first().click({ force: true })
  await page.waitForTimeout(60)
  const reopened = await page.evaluate(() => {
    const v = document.getElementById('viewer')
    const a = document.activeElement
    return {
      hidden: v?.hidden ?? null,
      leaving: v?.classList.contains('leaving') ?? null,
      focusInside: a instanceof HTMLElement && v !== null && v.contains(a),
      behind: document.body.classList.contains('behind'),
    }
  })
  await page.waitForTimeout(500)
  const reopenedLater = await page.evaluate(() => {
    const v = document.getElementById('viewer')
    return { hidden: v?.hidden ?? null, behind: document.body.classList.contains('behind') }
  })
  record(
    'viewer reopened during exit stays open, takes focus and re-blurs the workspace',
    leavingBeforeReopen &&
      reopened.hidden === false &&
      reopened.leaving === false &&
      reopened.focusInside &&
      reopened.behind &&
      reopenedLater.hidden === false &&
      reopenedLater.behind,
    { leavingBeforeReopen, reopened, reopenedLater },
  )
  // Closing the reopened viewer returns focus to the control that opened it, not to the body.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  // The opener is a menu item that closes on the choice, so focus returns to the project menu's button, inside the shell.
  const focusAfterReopenedClose = await page.evaluate(() => {
    const a = document.activeElement
    return a instanceof HTMLElement && a !== document.body && a.closest('.shell') !== null
  })
  record(
    'viewer reopened during exit returns focus into the workspace on close',
    focusAfterReopenedClose,
    {
      focusAfterReopenedClose,
    },
  )

  // 2. Team Chat: a repaint during its exit must not snap it shut.
  const chat = page.getByRole('button', { name: /chat with team/i }).first()
  await chat.click({ force: true })
  await page.waitForTimeout(700)
  // The close and a repaint go in ONE task: the drawer is leaving for 200 ms, and a navigation (which renders the page and
  // so repaints the drawer) has to land inside that window. Clicking through the menu takes longer than the fade.
  const dockAt40 = await page.evaluate(async () => {
    const d = document.getElementById('dock')
    const toggle = [...document.querySelectorAll<HTMLElement>('button')].find((b) =>
      /chat with team/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
    )
    toggle?.click()
    const at0 = { hidden: d?.hidden ?? null, leaving: d?.classList.contains('leaving') ?? null }
    document.querySelector<HTMLElement>('[data-bc-menu-open]')?.click()
    await new Promise((r) => setTimeout(r, 30))
    document.querySelector<HTMLElement>('[data-bc-go*="/p/"]')?.click()
    return at0
  })
  await page.waitForTimeout(40)
  const dockAfterRepaint = await page.evaluate(() => {
    const d = document.getElementById('dock')
    return { hidden: d?.hidden ?? null, leaving: d?.classList.contains('leaving') ?? null }
  })
  await page.waitForTimeout(500)
  const dockDone = await page.evaluate(() => document.getElementById('dock')?.hidden ?? null)
  record(
    'repaint during chat exit does not cut the fade short',
    dockAt40.hidden === false && dockAfterRepaint.hidden === false && dockDone === true,
    {
      dockAt40,
      dockAfterRepaint,
      dockDone,
    },
  )

  // 3. Global Settings: while it leaves, nothing behind it is reachable; both are released afterwards.
  // Opened from the keyboard, so the opener has focus and must get it back.
  await page.locator('[data-bc-settings]').first().focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  await page.locator('[data-stg-back]').first().click({ force: true })
  await page.waitForTimeout(60)
  const during = await page.evaluate(() => {
    const shell = document.querySelector('.shell')
    const settings = document.getElementById('settings')
    const opener = document.querySelector<HTMLElement>('[data-bc-settings]')
    const r = opener?.getBoundingClientRect()
    const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null
    return {
      settingsLeaving: settings?.classList.contains('leaving') ?? null,
      shellInert: shell?.hasAttribute('inert') ?? null,
      openerClickable: hit !== null && opener?.contains(hit) === true,
      settingsPointerEvents: settings ? getComputedStyle(settings).pointerEvents : null,
    }
  })
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => {
    const shell = document.querySelector('.shell')
    const opener = document.querySelector<HTMLElement>('[data-bc-settings]')
    return {
      shellInert: shell?.hasAttribute('inert') ?? null,
      focusOnOpener: document.activeElement === opener,
    }
  })
  record(
    'settings closing keeps the workspace inert and unclickable, then releases it and returns focus',
    during.settingsLeaving === true &&
      during.shellInert === true &&
      during.openerClickable === false &&
      during.settingsPointerEvents === 'none' &&
      after.shellInert === false &&
      after.focusOnOpener,
    { during, after },
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
