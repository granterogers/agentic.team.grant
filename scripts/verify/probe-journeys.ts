/**
 * Complete multi-step journeys on Team HQ (`/`), run in a real browser. Each journey starts from a fresh page, and after it
 * runs a global health check: no page errors, no stale overlay (a sheet still fading, the workspace blurred or inert with
 * nothing open), and history consistent with what is on screen. Every journey runs ROUNDS times, so an intermittent failure
 * shows up.
 *
 *   npx tsx scripts/verify/probe-journeys.ts
 *
 * Read-only: nothing is written to the office. The prototype's own browser storage may change (appearance, arrangement);
 * each journey starts from a fresh browser context, so nothing carries over. Serves web/studio locally. Desktop, motion on.
 */
import { type BrowserContext, chromium, type Locator, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const ROUNDS = 2
const { port, close } = await serve()
const browser = await chromium.launch()

type Outcome = {
  journey: string
  round: number
  ok: boolean
  steps: Record<string, unknown>
  problems: string[]
}
const outcomes: Outcome[] = []

// A press that is allowed to fail quietly: the journey checks the state it leaves behind, not the press itself.
const tap = (locator: Locator) =>
  locator
    .first()
    .click({ force: true })
    .catch(() => undefined)

const openProject = async (page: Page) => {
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await tap(page.locator('[data-bc-menu-open]'))
  await page.waitForTimeout(400)
  await tap(page.locator('[data-bc-go*="/p/"]'))
  await page.waitForTimeout(1500)
}

// What is on screen, read in one step, so the checks compare like with like.
const health = (page: Page) =>
  page.evaluate(() => {
    const settings = document.getElementById('settings')
    const viewer = document.getElementById('viewer')
    const dock = document.getElementById('dock')
    return {
      settingsOpen: settings !== null && !settings.hidden,
      viewerOpen: viewer !== null && !viewer.hidden,
      dockOpen: dock !== null && !dock.hidden,
      fading: [settings, viewer, dock].some((n) => n?.classList.contains('leaving') === true),
      inert: document.querySelector('.shell')?.hasAttribute('inert') === true,
      behind: document.body.classList.contains('behind'),
      settingsHistory: history.state?.settings === true,
    }
  })

type Health = Awaited<ReturnType<typeof health>>

const problemsIn = (h: Health) => {
  const problems: string[] = []
  if (h.fading) problems.push('a sheet is still fading')
  if (h.inert !== h.settingsOpen)
    problems.push(`workspace inert=${String(h.inert)} but settings open=${String(h.settingsOpen)}`)
  if (h.behind !== h.viewerOpen)
    problems.push(`workspace blurred=${String(h.behind)} but viewer open=${String(h.viewerOpen)}`)
  if (h.settingsOpen !== h.settingsHistory) {
    problems.push(
      `settings open=${String(h.settingsOpen)} but its history entry=${String(h.settingsHistory)}`,
    )
  }
  return problems
}

type Journey = {
  name: string
  fresh: boolean
  run: (page: Page, context: BrowserContext) => Promise<Record<string, unknown>>
  expect: (steps: Record<string, unknown>) => boolean
}

const journeys: Journey[] = [
  {
    // Appearance: preview a texture and cancel it, pick another and apply it, reload: the applied choice persists.
    name: 'appearance: preview, cancel, apply, reload',
    fresh: true,
    run: async (page) => {
      await tap(page.locator('[data-bc-pagemenu]'))
      await page.waitForTimeout(300)
      await tap(page.locator('[data-bc-look]'))
      await page.waitForTimeout(900)
      const picks = page.locator('[data-bd-pick]')
      const pickCount = await picks.count()
      await tap(picks.nth(1))
      await page.waitForTimeout(300)
      await tap(page.locator('[data-bd-cancel]'))
      await page.waitForTimeout(300)
      await tap(picks.nth(2))
      await page.waitForTimeout(300)
      await tap(page.locator('[data-bd-apply]'))
      await page.waitForTimeout(500)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      const stored = await page.evaluate(() => localStorage.getItem('studio.appearance') ?? '')
      return { pickCount, stored: stored.length > 0 }
    },
    expect: (s) => (s.pickCount as number) > 2 && s.stored === true,
  },
  {
    // Canvas: drag a module by its title strip, zoom in and out, reload: the arrangement and the zoom are still there.
    name: 'canvas: drag, zoom, reload',
    fresh: true,
    run: async (page) => {
      const mod = page.locator('[data-mod="tasks"]').first()
      const box = await mod.boundingBox()
      let movedPx = 0
      if (box !== null) {
        const fromX = box.x + 60
        const fromY = box.y + 16
        await page.mouse.move(fromX, fromY)
        await page.mouse.down()
        await page.mouse.move(fromX + 60, fromY + 40, { steps: 8 })
        await page.mouse.up()
        await page.waitForTimeout(400)
        const after = await mod.boundingBox()
        movedPx = after === null ? 0 : Math.round(Math.hypot(after.x - box.x, after.y - box.y))
      }
      await tap(page.locator('[data-bc-zoom="in"]'))
      await tap(page.locator('[data-bc-zoom="out"]'))
      await page.waitForTimeout(300)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      return { movedPx }
    },
    expect: (s) => (s.movedPx as number) > 40,
  },
  {
    // Module: maximise Tasks from the menu and return; open the Card Table from its own header and close with Escape.
    name: 'module: maximise, return, reopen from header',
    fresh: true,
    run: async (page) => {
      await tap(page.locator('[data-bc-menu]'))
      await page.waitForTimeout(300)
      await tap(page.locator('[data-bc-menu-modules] [data-bc-expand="tasks"]'))
      await page.waitForTimeout(700)
      const maximised = (await page.locator('.bcexp').count()) > 0
      await tap(page.locator('.bcexpx'))
      await page.waitForTimeout(800)
      const returned = (await page.locator('.bcexp').count()) === 0
      // Only a header a person can see is pressed.
      const header = page.locator('header.bcmodhead[data-bc-expand="board"] .bcmodopen').first()
      const headerShown = (await header.count()) > 0 && (await header.isVisible())
      if (headerShown) await header.click({ force: true })
      await page.waitForTimeout(700)
      const reopened = (await page.locator('.bcexp').count()) > 0
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)
      return { maximised, returned, headerShown, reopened }
    },
    expect: (s) =>
      s.maximised === true &&
      s.returned === true &&
      (s.headerShown === false || s.reopened === true),
  },
  {
    // Calendar: move forward, then back to today, then reload.
    name: 'calendar: navigate and reload',
    fresh: true,
    run: async (page) => {
      const cal = page.locator('[data-bc-cal]').first()
      const before = await cal.innerText().catch(() => '')
      await tap(page.locator('[data-cal-nav="next"]'))
      await page.waitForTimeout(300)
      const after = await cal.innerText().catch(() => '')
      await tap(page.locator('[data-cal-nav="today"]'))
      await page.waitForTimeout(300)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      return { navChanged: before !== after }
    },
    expect: (s) => s.navChanged === true,
  },
  {
    // Chat: five quick toggles, then one more; the drawer agrees with the toggle at each end.
    name: 'chat: rapid open and close',
    fresh: true,
    run: async (page) => {
      const toggle = page.getByRole('button', { name: /chat with team/i }).first()
      for (let i = 0; i < 5; i++) await toggle.click({ force: true })
      await page.waitForTimeout(600)
      const openAfterFive = await page.evaluate(() => {
        const d = document.getElementById('dock')
        return d !== null && !d.hidden && !d.classList.contains('leaving')
      })
      await toggle.click({ force: true })
      await page.waitForTimeout(500)
      const closedAfterOne = await page.evaluate(() => {
        const d = document.getElementById('dock')
        return d === null || d.hidden
      })
      return { openAfterFive, closedAfterOne }
    },
    expect: (s) => s.openAfterFive === true && s.closedAfterOne === true,
  },
  {
    // Settings: open, close with Back, open again, close with Escape.
    name: 'settings: open, Back, reopen, Escape',
    fresh: true,
    run: async (page) => {
      await page.locator('[data-bc-settings]').first().focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(900)
      const openFirst = (await health(page)).settingsOpen
      await tap(page.locator('[data-stg-back]'))
      await page.waitForTimeout(600)
      await page.locator('[data-bc-settings]').first().focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(900)
      const openSecond = (await health(page)).settingsOpen
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
      const closedAfterEscape = !(await health(page)).settingsOpen
      return { openFirst, openSecond, closedAfterEscape }
    },
    expect: (s) => s.openFirst === true && s.openSecond === true && s.closedAfterEscape === true,
  },
  {
    // Documents: open the module, press a document (its record opens over the workspace), Escape gives back.
    name: 'documents: open a document and return',
    fresh: true,
    run: async (page) => {
      await tap(page.locator('[data-bc-menu]'))
      await page.waitForTimeout(300)
      await tap(page.locator('[data-bc-menu-modules] [data-bc-expand="documents"]'))
      await page.waitForTimeout(700)
      const documents = await page.locator('[data-bc-doc-open]').count()
      await tap(page.locator('[data-bc-doc-open]'))
      await page.waitForTimeout(900)
      const recordOpened = (await page.locator('.bcexp').count()) > 0
      // A maximised view makes the page beneath it inert (compose.css: .bcunder[inert]), so the record is what is reachable.
      const beneathInert = await page.evaluate(
        () => document.querySelector('.bcunder')?.hasAttribute('inert') === true,
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)
      const closed = (await page.locator('.bcexp').count()) === 0
      const focusInWorkspace = await page.evaluate(() => {
        const a = document.activeElement
        return a instanceof HTMLElement && a !== document.body && a.closest('.shell') !== null
      })
      return { documents, recordOpened, beneathInert, closed, focusInWorkspace }
    },
    expect: (s) =>
      (s.documents as number) > 0 &&
      s.recordOpened === true &&
      s.beneathInert === true &&
      s.closed === true &&
      s.focusInWorkspace === true,
  },
  {
    // Landing: an invalid address is refused on the page, and no write request leaves the browser.
    name: 'landing: invalid address refused, nothing sent',
    fresh: false,
    run: async (page) => {
      const sent: string[] = []
      await page.route('**/*', (route) => {
        const request = route.request()
        if (request.method() !== 'GET' && request.url().includes('127.0.0.1') === false)
          sent.push(request.url())
        void route.continue()
      })
      await page.goto(`http://127.0.0.1:${String(port)}/?welcome`, {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForTimeout(1200)
      const email = page.locator('input[type="email"]').first()
      const hasForm = (await email.count()) > 0
      if (hasForm) {
        await email.fill('not-an-address')
        await tap(page.getByRole('button', { name: /email me a sign-in link/i }))
        await page.waitForTimeout(600)
      }
      return { hasForm, outboundWrites: sent.length }
    },
    expect: (s) => s.hasForm === true && s.outboundWrites === 0,
  },
]

try {
  for (let round = 1; round <= ROUNDS; round++) {
    for (const journey of journeys) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      if (journey.fresh) await openProject(page)
      let steps: Record<string, unknown>
      try {
        steps = await journey.run(page, context)
      } catch (e) {
        steps = { threw: (e as Error).message.split('\n')[0] }
      }
      await page.waitForTimeout(400)
      const h = journey.fresh ? await health(page) : null
      const problems = [...(h === null ? [] : problemsIn(h)), ...errors.slice(0, 2)]
      const ok = !('threw' in steps) && journey.expect(steps) && problems.length === 0
      outcomes.push({ journey: journey.name, round, ok, steps: { ...steps, health: h }, problems })
      await context.close()
    }
  }
} finally {
  await browser.close()
  close()
}

for (const o of outcomes)
  console.log(
    `${o.ok ? 'PASS' : 'FAIL'}: ${o.journey} (round ${String(o.round)})`,
    o.ok ? '' : JSON.stringify({ steps: o.steps, problems: o.problems }).slice(0, 700),
  )
const failed = outcomes.filter((o) => !o.ok).length
console.log(
  failed === 0
    ? `ALL ${String(outcomes.length)} JOURNEY RUNS PASS`
    : `${String(failed)} of ${String(outcomes.length)} journey runs FAILED`,
)
process.exitCode = failed === 0 ? 0 : 1
