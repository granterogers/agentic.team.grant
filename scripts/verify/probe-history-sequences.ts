/**
 * Settings history and modal sequences on Team HQ (`/`), driven by real clicks, key presses and history traversal. Each
 * sequence starts from a fresh page and records, after every step: the URL path, whether Settings is shown (and not
 * fading), the history entry the page is on, where focus is, and whether the workspace behind is inert.
 *
 * Sequences: Back then reopen immediately; double Back; Escape then reopen; rapid open, close, open; reload with a settings
 * entry; Forward after closing; closing one modal and opening another. Each sequence runs REPEATS times so that an
 * intermittent ordering failure shows up.
 *
 *   npx tsx scripts/verify/probe-history-sequences.ts
 *
 * Read-only; serves web/studio locally. Desktop, motion on.
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const REPEATS = 3
const { port, close } = await serve()
const browser = await chromium.launch()
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const check = (name: string, ok: boolean, detail: unknown) =>
  results.push({ check: name, ok, detail })

type Seen = {
  path: string
  settingsShown: boolean
  settingsFading: boolean
  historySettings: boolean
  focus: 'settings' | 'shell' | 'body' | 'other'
  inert: boolean
  viewerShown: boolean
  behind: boolean
}

const observe = (page: Page) =>
  page.evaluate(() => {
    const s = document.getElementById('settings')
    const v = document.getElementById('viewer')
    const a = document.activeElement
    let focus: Seen['focus'] = 'other'
    if (a === null || a === document.body) focus = 'body'
    else if (s?.contains(a) === true) focus = 'settings'
    else if (document.querySelector('.shell')?.contains(a) === true) focus = 'shell'
    return {
      path: location.pathname,
      settingsShown: s !== null && !s.hidden && !s.classList.contains('leaving'),
      settingsFading: s?.classList.contains('leaving') === true,
      historySettings: history.state?.settings === true,
      focus,
      inert: document.querySelector('.shell')?.hasAttribute('inert') === true,
      viewerShown: v !== null && !v.hidden && !v.classList.contains('leaving'),
      behind: document.body.classList.contains('behind'),
    } as Seen
  })

// A press point on the Settings sheet that is not a control, found while the sheet is open.
const sheetSpot = (page: Page) =>
  page.evaluate(() => {
    const el = document.getElementById('settings')
    if (el === null) return null
    const r = el.getBoundingClientRect()
    for (let fy = 0.02; fy < 1; fy += 0.04) {
      for (let fx = 0.02; fx < 1; fx += 0.04) {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        const hit = document.elementFromPoint(x, y)
        if (!(hit instanceof HTMLElement) || !el.contains(hit)) continue
        if (hit.closest('.close, [data-stg-back], button, a, input, select, textarea') !== null)
          continue
        return { x, y }
      }
    }
    return null
  })

const freshPage = async (context: Awaited<ReturnType<typeof browser.newContext>>) => {
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)
  return page
}

const openByKeyboard = async (page: Page) => {
  await page.locator('[data-bc-settings]').first().focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.getElementById('settings')?.hidden === false, null, {
    timeout: 1500,
  })
  await page.waitForTimeout(900)
}

const backClick = (page: Page) => page.locator('[data-stg-back]').first().click({ force: true })

const sequences: Array<{ name: string; run: (page: Page) => Promise<Record<string, Seen>> }> = [
  {
    // Back, then a press on the sheet while it is still fading. Expected: open again, one settings entry, focus in Settings.
    name: 'Back followed immediately by reopen',
    run: async (page) => {
      await openByKeyboard(page)
      const pageBefore = await observe(page)
      const spot = await sheetSpot(page)
      await backClick(page)
      if (spot !== null) await page.mouse.click(spot.x, spot.y)
      await page.waitForTimeout(600)
      return { pageBefore, after: await observe(page) }
    },
  },
  {
    // Back twice in a row. Expected: closed, no settings entry left, the second press did not reopen.
    name: 'double Back',
    run: async (page) => {
      await openByKeyboard(page)
      await backClick(page)
      await backClick(page).catch(() => undefined)
      await page.waitForTimeout(700)
      return { after: await observe(page) }
    },
  },
  {
    // Escape, then a press on the sheet while it fades. Expected: open again with a settings entry.
    name: 'Escape followed by reopen',
    run: async (page) => {
      await openByKeyboard(page)
      const spot = await sheetSpot(page)
      await page.keyboard.press('Escape')
      if (spot !== null) await page.mouse.click(spot.x, spot.y)
      await page.waitForTimeout(600)
      return { after: await observe(page) }
    },
  },
  {
    // Open, close by Back, open again from the opener, close by Escape. Expected: each step matches its own state.
    name: 'rapid open, close, open',
    run: async (page) => {
      await openByKeyboard(page)
      await backClick(page)
      await page.waitForTimeout(260)
      await openByKeyboard(page)
      const opened = await observe(page)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
      return { opened, after: await observe(page) }
    },
  },
  {
    // Open Settings, reload the page (the settings history entry survives, the sheet does not), then open it again. Expected:
    // the reload shows no sheet, the reopen pushes a clean entry, and Back from it lands on the page, not on a stale entry.
    name: 'reload with a settings history entry',
    run: async (page) => {
      await openByKeyboard(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      const reloaded = await observe(page)
      await page
        .locator('[data-bc-menu-open]')
        .first()
        .click({ force: true })
        .catch(() => undefined)
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await openByKeyboard(page)
      const reopened = await observe(page)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
      return { reloaded, reopened, after: await observe(page) }
    },
  },
  {
    // Close by Back, then Forward. Expected: Forward reopens Settings at the same path, and the history entry is back.
    name: 'Forward navigation after closing',
    run: async (page) => {
      await openByKeyboard(page)
      await backClick(page)
      await page.waitForTimeout(600)
      const closed = await observe(page)
      await page.goForward({ waitUntil: 'commit' }).catch(() => undefined)
      await page.waitForTimeout(700)
      return { closed, forward: await observe(page) }
    },
  },
  {
    // Close the appearance sheet with Escape, then open Settings straight away. Expected: the sheets never overlap, the
    // appearance sheet is shut, Settings is open, the workspace is inert once.
    name: 'closing one modal and opening another',
    run: async (page) => {
      await page.locator('[data-bc-pagemenu]').first().click({ force: true })
      await page.waitForTimeout(300)
      await page.locator('[data-bc-look]').first().click({ force: true })
      await page.waitForTimeout(900)
      await page.keyboard.press('Escape')
      await openByKeyboard(page)
      await page.waitForTimeout(400)
      const after = await observe(page)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
      return { after, closed: await observe(page) }
    },
  },
]

const EMPTY: Seen = {
  path: '',
  settingsShown: false,
  settingsFading: false,
  historySettings: false,
  focus: 'other',
  inert: false,
  viewerShown: false,
  behind: false,
}

try {
  for (let round = 0; round < REPEATS; round++) {
    for (const seq of sequences) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await freshPage(context)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      const steps = await seq.run(page).catch((e: Error) => ({
        error: { ...EMPTY, note: e.message.split('\n')[0] },
      }))
      const label = `${seq.name} (round ${String(round + 1)})`
      const s = steps as Record<string, Seen>
      let ok = false
      if (seq.name === 'Back followed immediately by reopen')
        ok =
          s.after.settingsShown &&
          s.after.inert &&
          s.after.historySettings &&
          s.after.focus === 'settings' &&
          s.after.path === s.pageBefore.path
      else if (seq.name === 'double Back')
        ok =
          !s.after.settingsShown &&
          !s.after.historySettings &&
          !s.after.inert &&
          s.after.focus === 'shell'
      else if (seq.name === 'Escape followed by reopen')
        ok =
          s.after.settingsShown &&
          s.after.historySettings &&
          s.after.inert &&
          s.after.focus === 'settings'
      else if (seq.name === 'rapid open, close, open')
        ok =
          s.opened.settingsShown &&
          s.opened.historySettings &&
          s.after.settingsShown === false &&
          !s.after.inert &&
          s.after.focus === 'shell'
      else if (seq.name === 'reload with a settings history entry')
        ok =
          !s.reloaded.settingsShown &&
          s.reopened.settingsShown &&
          s.reopened.historySettings &&
          !s.after.settingsShown &&
          !s.after.inert &&
          s.after.focus === 'shell'
      else if (seq.name === 'Forward navigation after closing')
        ok =
          !s.closed.settingsShown &&
          !s.closed.historySettings &&
          s.forward.settingsShown &&
          s.forward.historySettings &&
          s.forward.path === s.closed.path
      else if (seq.name === 'closing one modal and opening another')
        ok =
          !s.after.viewerShown &&
          s.after.settingsShown &&
          s.after.inert &&
          !s.closed.settingsShown &&
          !s.closed.inert
      check(label, ok && errors.length === 0, { steps: s, pageErrors: errors.slice(0, 2) })
      await context.close()
    }
  }
} finally {
  await browser.close()
  close()
}

for (const r of results)
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}: ${r.check}`,
    r.ok ? '' : JSON.stringify(r.detail).slice(0, 900),
  )
const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0
    ? `ALL ${String(results.length)} SEQUENCE CHECKS PASS`
    : `${String(failed)} of ${String(results.length)} FAILED`,
)
process.exitCode = failed === 0 ? 0 : 1
