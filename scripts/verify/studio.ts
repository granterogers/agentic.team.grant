/**
 * Render the prototype, capture it, and put the pictures where they can be
 * judged.
 *
 *   npm run shots
 *
 * §14A: *"Never evaluate visual quality from source code alone."* This runs the
 * real files in a real browser at real sizes, in both themes, and writes PNGs.
 * It is not a pass/fail harness — it is the capture half of the
 * render→capture→critique loop, and the critique is done by looking.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'

const ROOT = 'web/studio'
const OUT = '.out'
const PORT = 4610

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.mjs': 'text/javascript; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) =>
  server.listen(PORT, '127.0.0.1', () => {
    r()
  }),
)
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const shots: string[] = []

const SIZES = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', devices['iPhone 14']],
] as const

for (const [size, opts] of SIZES) {
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(PORT)}/`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    })
    await page.waitForTimeout(900)

    const shoot = async (name: string) => {
      const file = `${OUT}/${name}-${size}-${scheme}.png`
      await page.screenshot({ path: file, fullPage: false })
      shots.push(file)
    }

    await shoot('portfolio')

    // The appearance picker, and one alternative palette, so a change to the
    // skin system is visible in a capture rather than only in the CSS.
    if (size === 'desktop' && scheme === 'light') {
      await page.locator('[data-settings]').click()
      await page.waitForTimeout(400)
      // Settings opens on Team now, not on the palette. The picker is a tab in.
      await page.locator('[data-setting="appearance"]').click()
      await page.waitForTimeout(400)
      await shoot('appearance')
      await page.locator('[data-palette-pick="clay"]').click()
      await page.locator('[data-texture-pick="plaster"]').click()
      await page.waitForTimeout(400)
      await page.locator('#settings .close').click()
      await page.waitForTimeout(300)
      await shoot('palette-clay')
      // Back to the default so the rest of the captures are comparable.
      await page.locator('[data-settings]').click()
      await page.locator('[data-palette-pick="paper"]').click()
      await page.locator('#settings .close').click()
      await page.waitForTimeout(300)
    }

    /*
      Hover states, captured deliberately.

      Iteration 4 added pointer-tracked tilt and a specular highlight, and a
      still of the page at rest shows none of it — which would have had Grant
      judging an iteration with its whole point missing. `mouse.move` twice,
      because a single move fires no `pointermove` on an element the cursor is
      already inside.
    */
    if (size === 'desktop') {
      const card = page.locator('.project[data-open="ai-learning"]')
      const box = await card.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
        await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.3)
        await page.waitForTimeout(500)
        await shoot('portfolio-hover')
      }
    }

    // The desk: a whole mode, and one a portfolio capture cannot show.
    if (size === 'desktop') {
      await page.locator('[data-go="desk"]').click()
      await page.waitForTimeout(700)
      await shoot('desk')
      await page.locator('[data-go="portfolio"]').first().click()
      await page.waitForTimeout(500)
    }

    // Into a project, which is the shared-element transition. Everything after
    // this — People, contacts, documents — only exists inside one.
    await page.locator('.project[data-open="legacy-coaching-course"]').click()
    await page.waitForTimeout(900)
    /*
      The tab is remembered per project, so a run that ended on People leaves
      the next one there. Board is what the "project" capture is of, so say so
      rather than depending on whatever the last run happened to leave behind.
    */
    await page.locator('[role="tab"][data-tab="overview"]').click()
    await page.waitForTimeout(500)
    await shoot('project')

    if (size === 'desktop') {
      const doc = page.locator('[data-doc="0"] .page')
      // Scroll it into view first: boundingBox() happily returns coordinates
      // for something below the fold, so the capture came back showing the top
      // of the page with the hover applied to something nobody could see.
      await doc.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      const box = await doc.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
        await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.26)
        await page.waitForTimeout(500)
        await shoot('document-hover')
      }
    }

    /*
      People is reached from INSIDE a project now, not from the top of the rail
      — Grant: "people is a subset of each project.. not merged". The old
      selector was a global nav item that no longer exists, which is exactly the
      kind of thing a capture script catches and a code review does not.
    */
    if (size === 'desktop') {
      /*
        Contacts is reached from the project's own tabs now. The rail used to
        carry a People sub-item under the current project; it duplicated this
        tab, so Grant asked for it gone — "obviously, they don't duplicate
        things". A capture script is where a removed selector announces itself.
      */
      await page.locator('[role="tab"][data-tab="contacts"]').click()
      await page.waitForTimeout(500)
      await shoot('contacts-section')
      /*
        The project switcher, open. It replaced the rail's project list — a
        still of it closed proves only that a button exists.
      */
      await page.locator('[data-switch-open]').click()
      await page.waitForTimeout(400)
      await shoot('project-switcher')
      await page.keyboard.press('Escape')
      await page.locator('h1').first().click()
      await page.waitForTimeout(300)

      /*
        Settings, all six tabs. It is the half of the product Grant said was
        being left behind, and a capture of only the first tab would prove the
        least interesting one.
      */
      await page.locator('[data-settings]').first().click()
      await page.waitForTimeout(500)
      for (const tab of ['team', 'behaviour', 'connections', 'channels', 'models', 'appearance']) {
        await page.locator(`[data-setting="${tab}"]`).click()
        await page.waitForTimeout(400)
        await shoot(`settings-${tab}`)
      }
      await page.locator('#settings .close').click()
      await page.waitForTimeout(400)

      await page.locator('[data-rail]').click()
      await page.waitForTimeout(600)
      await shoot('rail-collapsed')
      await page.locator('[data-rail]').click()
      await page.waitForTimeout(500)
    }

    /*
      The team's in-tray and the chat (#26, #27, #28).

      Both are new tabs on the project, and both are things Grant asked for in
      one sentence — so both get a capture on every size, not only desktop. The
      talk action is captured mid-flight, with the item already attached to the
      composer, because a still of the button proves nothing about whether the
      context actually travels.
    */
    await page.locator('[role="tab"][data-tab="team"]').click()
    await page.waitForTimeout(600)
    await shoot('team-board')

    await page.locator('[role="tab"][data-sub="jobs"]').click()
    await page.waitForTimeout(500)
    await shoot('active-jobs')

    await page.locator('[role="tab"][data-sub="outputs"]').click()
    await page.waitForTimeout(500)
    await shoot('team')

    await page.locator('[role="tab"][data-sub="chat"]').click()
    await page.waitForTimeout(500)
    await shoot('chat-empty')

    await page
      .locator('[data-say]')
      .fill('Can you turn the WS02 client list into an email I can send?')
    /*
      Enter rather than the Send button. On a phone the bottom navigation is
      fixed, and Playwright's scroll-into-view stops as soon as the button is
      technically visible — which is underneath it. Enter is also the path a
      person actually uses, so this tests the more common one.
    */
    await page.locator('[data-say]').press('Enter')
    await page.waitForTimeout(600)
    await shoot('chat')

    await page.locator('[role="tab"][data-tab="documents"]').click()
    await page.waitForTimeout(500)
    await shoot('documents')
    // The talk action on a document, and where it lands.
    await page.locator('[data-doc="0"]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.locator('.withtalk:has([data-doc="0"]) .talkabout').click()
    await page.waitForTimeout(600)
    await shoot('talk-about-a-document')

    await page.locator('[role="tab"][data-tab="overview"]').click()
    await page.waitForTimeout(500)

    for (const section of ['tasks', 'contacts', 'sources', 'activity']) {
      await page.locator(`[role="tab"][data-tab="${section}"]`).click()
      await page.waitForTimeout(500)
      await shoot(section)
    }

    await page.locator('[role="tab"][data-tab="documents"]').click()
    await page.waitForTimeout(500)

    // And a document, which is the second one.
    await page.locator('[data-doc="0"]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.locator('[data-doc="0"]').click()
    await page.waitForTimeout(700)
    await shoot('document')

    // Anything thrown while doing all that is a defect, not a note.
    if (errors.length > 0) {
      console.error(`  ${size}/${scheme} threw: ${errors.join(' · ')}`)
    }

    // Overflow is the failure that only shows on a phone.
    const wide = await page.evaluate(
      'document.documentElement.scrollWidth > document.documentElement.clientWidth + 2',
    )
    if (wide === true) console.error(`  ${size}/${scheme} OVERFLOWS sideways`)

    await ctx.close()
  }
}

await browser.close()
server.close()
console.log(shots.join('\n'))
