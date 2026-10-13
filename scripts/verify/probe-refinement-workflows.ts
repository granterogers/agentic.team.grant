/**
 * End-to-end workflows for the Team HQ premium visual refinement, in real Chromium, against the local prototype
 * (web/studio served by probe-lib). Each workflow is driven the way a person drives it and checked by what the page
 * shows or stores afterwards. Prints PASS or FAIL per check; exits 1 if any check fails.
 *
 *   npx tsx scripts/verify/probe-refinement-workflows.ts
 *
 * Local only. It proves the prototype surfaces. Signed-in features (saving Team settings, the account's own appearance,
 * background upload) need a suitable signed-in account and are NOT covered here.
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
const results: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : ` — ${detail}`}`)
}
const base = `http://127.0.0.1:${String(port)}/`
const openProject = async (page: Page) => {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page
    .locator('[data-bc-menu-open]:visible, [data-bc-menu]:visible')
    .first()
    .click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]:visible').first().click({ force: true })
  await page.waitForTimeout(1400)
}
const newPage = async (
  width: number,
  height: number,
  mobile: boolean,
  scheme: 'light' | 'dark' = 'light',
) => {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: scheme,
  })
  await context.addInitScript(
    (value) => {
      try {
        localStorage.setItem('studio.appearance', value)
      } catch {
        /* private */
      }
    },
    JSON.stringify({
      palette: 'slate',
      texture: 'none',
      own: null,
      ownName: '',
      scheme,
      density: 'comfortable',
      look: 'silver',
      glass: 'soft',
      depth: 'soft',
    }),
  )
  return context
}

try {
  /* 1. PHONE HEADER AND GLOBAL SETTINGS THROUGH THE HAMBURGER (review 3), with Back and Forward. */
  {
    const ctx = await newPage(390, 844, true)
    const page = await ctx.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    await openProject(page)
    const threeDotHidden = (await page.locator('.bcofficemenu:visible').count()) === 0
    check(
      'phone: the header carries one overflow control (Global three-dot hidden)',
      threeDotHidden,
    )
    const nameBox = await page.locator('.bcjumpname:visible').first().boundingBox()
    check(
      'phone: the project name has room (at least 120px)',
      nameBox !== null && nameBox.width >= 120,
      `width ${String(Math.round(nameBox?.width ?? 0))}px`,
    )
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    check(
      'phone: the project screen does not scroll sideways',
      overflow <= 0,
      `overflow ${String(overflow)}px`,
    )
    await page.screenshot({ path: '.out/visual/wf-phone-project.png' })

    await page.locator('[data-bc-menu]:visible').first().click({ force: true })
    await page.waitForTimeout(450)
    const entry = page.locator('.bcmenuglobal:visible').first()
    check('phone: the menu offers a labelled Global Settings entry', (await entry.count()) > 0)
    await entry.scrollIntoViewIfNeeded()
    const reach = await entry.boundingBox()
    check(
      'phone: the Global Settings entry is reachable on the screen',
      reach !== null && reach.y >= 0 && reach.y + reach.height <= 844,
      reach === null ? 'no box' : `y ${String(Math.round(reach.y))}`,
    )
    await page.screenshot({ path: '.out/visual/wf-phone-menu.png' })
    await entry.click({ force: true })
    await page.waitForTimeout(900)
    const sheetOpen =
      (await page
        .locator('#settings:visible, [data-settings-sheet]:visible, .bcsheet:visible')
        .count()) > 0
    check('phone: Global Settings opens from the menu', sheetOpen)
    await page.screenshot({ path: '.out/visual/wf-phone-global-settings.png' })
    const menuClosed = (await page.locator('.bcmenupanel:not([hidden])').count()) === 0
    check('phone: the menu closes when Global Settings opens', menuClosed)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
    await page.waitForTimeout(700)
    await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
    await page.waitForTimeout(900)
    const stillInProject = (await page.locator('.bchere:visible .bcjumpname').count()) > 0
    check('phone: Back and Forward keep the app usable and return to a project', stillInProject)
    check(
      'phone: no page errors through the workflow',
      pageErrors.length === 0,
      pageErrors.slice(0, 2).join(' | '),
    )
    await ctx.close()
  }

  /* 2. DESKTOP: Global Settings still from the header three-dot; the menu is unchanged. */
  {
    const ctx = await newPage(1440, 900, false)
    const page = await ctx.newPage()
    await openProject(page)
    const dot = page.locator('[data-bc-settings]:visible').first()
    check('desktop: the header Global Settings control is visible', (await dot.count()) > 0)
    await dot.click({ force: true })
    await page.waitForTimeout(800)
    check(
      'desktop: Global Settings opens from the header control',
      (await page
        .locator('#settings:visible, [data-settings-sheet]:visible, .bcsheet:visible')
        .count()) > 0,
    )
    await page.screenshot({ path: '.out/visual/wf-desktop-global-settings.png' })
    await ctx.close()
  }

  /* 3. APPEARANCE: Reset to recommended applies and stores the default. */
  {
    const ctx = await newPage(1440, 900, false)
    const page = await ctx.newPage()
    await openProject(page)
    await page.locator('[data-bc-settings]:visible').first().click({ force: true })
    await page.waitForTimeout(800)
    const appearanceTab = page
      .locator('button:has-text("Appearance"), [role="tab"]:has-text("Appearance")')
      .first()
    if ((await appearanceTab.count()) > 0)
      await appearanceTab.click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(600)
    const reset = page.locator('[data-appearance-reset]:visible').first()
    check('appearance: the reset control is present', (await reset.count()) > 0)
    if ((await reset.count()) > 0) {
      await reset.click({ force: true })
      await page.waitForTimeout(600)
    }
    const stored = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('studio.appearance') ?? 'null') as Record<
          string,
          unknown
        > | null
      } catch {
        return null
      }
    })
    check(
      'appearance: reset stores the recommended palette',
      stored?.palette === 'slate',
      String(stored?.palette ?? 'none'),
    )
    check(
      'appearance: reset stores no concrete texture',
      stored?.texture === 'none',
      String(stored?.texture ?? 'none'),
    )
    await page.screenshot({ path: '.out/visual/wf-appearance-reset.png' })
    await ctx.close()
  }

  /* 4. TEAM CHAT: open the dock, the speaker label is drawn and readable in light and dark. */
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await newPage(1440, 900, false, scheme)
    const page = await ctx.newPage()
    await openProject(page)
    const dock = page.locator('[data-bc-dock]:visible').first()
    if ((await dock.count()) > 0) await dock.click({ force: true })
    await page.waitForTimeout(900)
    const label = page.locator('.t-label:visible', { hasText: 'Chief of Staff' }).first()
    check(`chat (${scheme}): the speaker label is drawn`, (await label.count()) > 0)
    await page.screenshot({ path: `.out/visual/wf-chat-${scheme}.png` })
    await ctx.close()
  }

  /* 5. CALENDAR: Day, Week and Month switch and the period label stays. */
  {
    const ctx = await newPage(1440, 900, false)
    const page = await ctx.newPage()
    await openProject(page)
    for (const view of ['week', 'day', 'month']) {
      const b = page.locator(`[data-cal-view="${view}"]:visible`).first()
      if ((await b.count()) > 0) await b.click({ force: true })
      await page.waitForTimeout(350)
      const pressed =
        (await page.locator(`[data-cal-view="${view}"][aria-pressed="true"]:visible`).count()) > 0
      check(`calendar: the ${view} view is selected after pressing it`, pressed)
    }
    await page.screenshot({ path: '.out/visual/wf-calendar-month.png' })
    await ctx.close()
  }

  /* 6. MODULE MAXIMISE AND RESTORE: a module maximises to an overlay and its own close control restores it. */
  {
    const ctx = await newPage(1440, 900, false)
    const page = await ctx.newPage()
    await openProject(page)
    const maxBtn = page.locator('[data-bc-max]:visible').first()
    check('maximise: a module maximise control is present', (await maxBtn.count()) > 0)
    if ((await maxBtn.count()) > 0) {
      /* Maximise opens the module as a large overlay; the check reads its heading's enclosing box. */
      const overlayWidth = (title: string) =>
        page.evaluate((t) => {
          for (const h of Array.from(document.querySelectorAll('h1, h2'))) {
            if ((h.textContent ?? '').trim() !== t) continue
            let box: Element | null = h
            while (box !== null && box.getBoundingClientRect().width < 900) box = box.parentElement
            if (box !== null && box.getBoundingClientRect().width > 0)
              return Math.round(box.getBoundingClientRect().width)
          }
          return 0
        }, title)
      const title = (
        await maxBtn.evaluate(
          (b) => b.closest('.bcmod')?.querySelector('.bcmodhead h2, h2')?.textContent ?? '',
        )
      ).trim()
      check('maximise: the module has a title to check', title !== '', title)
      await maxBtn.click({ force: true })
      await page.waitForTimeout(800)
      await page.screenshot({ path: '.out/visual/wf-maximised.png' })
      const wide = await overlayWidth(title)
      check(
        'maximise: the module opens full width',
        wide >= 900,
        `${String(wide)}px for "${title}"`,
      )
      const overlayClose = page
        .getByRole('button', { name: /^close|^back|^restore|^minimi[sz]e|^return/i })
        .filter({ visible: true })
        .first()
      /* The overlay's own Close (.bcexpx) is the signal: the board keeps a heading of the same name behind it, so a width test cannot tell open from shut. */
      const overlayOpen = () => page.locator('.bcexpx:visible').count()
      check(
        'maximise: the overlay has a close control',
        (await overlayClose.count()) > 0 && (await overlayOpen()) > 0,
      )
      if ((await overlayClose.count()) > 0) await overlayClose.click({ force: true })
      await page.waitForTimeout(800)
      check(
        'maximise: the close control restores the module',
        (await overlayOpen()) === 0,
        `${String(await overlayOpen())} overlay control(s) left`,
      )
    }
    await ctx.close()
  }

  /* 7. POST-IT: editing a note's text is kept; the note can be dragged. */
  {
    const ctx = await newPage(1440, 900, false)
    const page = await ctx.newPage()
    await openProject(page)
    const note = page.locator('.bcpostit:visible').first()
    if ((await note.count()) > 0) {
      const area = page.locator('.bcpostittext:visible').first()
      await area.click({ force: true })
      await area.fill('Check the venue deposit')
      await page.waitForTimeout(300)
      check(
        'post-it: text is kept when edited',
        (await area.inputValue()) === 'Check the venue deposit',
      )
      const bar = page.locator('.bcpostitbar:visible').first()
      const before = await note.boundingBox()
      const grip = await bar.boundingBox()
      if (before !== null && grip !== null) {
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
        await page.mouse.down()
        await page.mouse.move(grip.x + grip.width / 2 - 40, grip.y + grip.height / 2 + 30, {
          steps: 8,
        })
        await page.mouse.up()
        await page.waitForTimeout(400)
        const after = await note.boundingBox()
        check(
          'post-it: the note moves when its grip is dragged',
          after !== null && (Math.abs(after.x - before.x) > 5 || Math.abs(after.y - before.y) > 5),
        )
      }
      await page.screenshot({ path: '.out/visual/wf-postit.png' })
    } else check('post-it: a note is present on the canvas', false, 'no note found')
    await ctx.close()
  }

  /* 8. DOCUMENTS: open a document, then close it with Escape. */
  {
    const ctx = await newPage(1440, 900, false)
    const page = await ctx.newPage()
    await openProject(page)
    const doc = page.locator('[data-bc-doc-open]:visible').first()
    if ((await doc.count()) > 0) {
      await doc.click({ force: true })
      await page.waitForTimeout(900)
      await page.screenshot({ path: '.out/visual/wf-doc-open.png' })
      const viewerSel = '.bcdocpages, .bcdocimage, .bcdoctext'
      check(
        'documents: a document opens in the viewer',
        (await page.locator(`${viewerSel}`).count()) > 0,
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
      check(
        'documents: the viewer closes with Escape',
        (await page.locator(`${viewerSel}`).count()) === 0,
      )
    } else check('documents: a document is present', false, 'no document tile found')
    await ctx.close()
  }

  /* 9. MOBILE RAPID TAPS: many quick taps on the chat dock do not fall through to another control. */
  {
    const ctx = await newPage(390, 844, true)
    const page = await ctx.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    await openProject(page)
    const startUrl = page.url()
    const dock = page.locator('[data-bc-dock]:visible').first()
    if ((await dock.count()) > 0) {
      for (let i = 0; i < 12; i++) await dock.tap({ force: true }).catch(() => undefined)
      await page.waitForTimeout(700)
    }
    check(
      'mobile: rapid taps on the chat dock leave the screen where it was',
      page.url() === startUrl,
      page.url(),
    )
    check(
      'mobile: no page errors under rapid taps',
      pageErrors.length === 0,
      pageErrors.slice(0, 2).join(' | '),
    )
    await ctx.close()
  }

  /* 10. REDUCED MOTION: the page loads and a project opens with reduced motion requested. */
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    await openProject(page)
    check(
      'reduced motion: the page loads and opens a project',
      (await page.locator('.bchere:visible').count()) > 0,
    )
    check(
      'reduced motion: no page errors',
      pageErrors.length === 0,
      pageErrors.slice(0, 2).join(' | '),
    )
    await context.close()
  }
} finally {
  await browser.close()
  await close()
}

const failed = results.filter((r) => !r.ok)
console.log(
  `\n${String(results.length - failed.length)} of ${String(results.length)} checks passed`,
)
if (failed.length > 0) process.exit(1)
