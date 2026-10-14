/**
 * Visual QA captures for the Team HQ design, at the surfaces the redesign is judged on. Writes PNGs to .out/visual/.
 *
 *   npx tsx scripts/verify/probe-visual.ts [tag]
 *
 * Local, read-only: serves web/studio. Each capture starts from a clean browser (default appearance) unless it names a stored
 * appearance. Captures are for a person to look at; this script asserts nothing except that each surface was reached.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const tag = process.argv[2] ?? 'after'
const OUT = join(process.cwd(), '.out', 'visual')
const { port, close } = await serve()
const browser = await chromium.launch()
const reached: string[] = []
const missed: string[] = []

const stored = (scheme: 'light' | 'dark') =>
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
  })

const newContext = async (opts: {
  width: number
  height: number
  mobile?: boolean
  scheme?: 'light' | 'dark'
}) => {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    isMobile: opts.mobile === true,
    hasTouch: opts.mobile === true,
    colorScheme: opts.scheme ?? 'light',
  })
  if (opts.scheme !== undefined) {
    await context.addInitScript((value) => {
      try {
        localStorage.setItem('studio.appearance', value)
      } catch {
        /* private */
      }
    }, stored(opts.scheme))
  }
  return context
}

const openProject = async (page: Page) => {
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page
    .locator('[data-bc-menu-open]:visible, [data-bc-menu]:visible')
    .first()
    .click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]:visible').first().click({ force: true })
  await page.waitForTimeout(1600)
}

const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(OUT, `${tag}-${name}.png`) })
  reached.push(name)
}

const miss = (name: string, why: string) => {
  missed.push(`${name}: ${why}`)
}

try {
  await mkdir(OUT, { recursive: true })

  // 1 and 2: the project dashboard, light and dark, desktop, from a clean default.
  {
    const c = await newContext({ width: 1440, height: 900 })
    const page = await c.newPage()
    await openProject(page)
    await shot(page, 'project-light-desktop')
    await c.close()
  }
  {
    const c = await newContext({ width: 1440, height: 900, scheme: 'dark' })
    const page = await c.newPage()
    await openProject(page)
    await shot(page, 'project-dark-desktop')
    await c.close()
  }

  // 3: the project dashboard at 390px.
  {
    const c = await newContext({ width: 390, height: 844, mobile: true })
    const page = await c.newPage()
    await openProject(page)
    await shot(page, 'project-phone-390')
    await c.close()
  }

  // 5: Team Chat open, desktop.
  {
    const c = await newContext({ width: 1440, height: 900 })
    const page = await c.newPage()
    await openProject(page)
    const chat = page.locator('[data-bc-dock]:visible').first()
    if ((await chat.count()) > 0) {
      await chat.click({ force: true })
      await page.waitForTimeout(700)
      await shot(page, 'team-chat-open-desktop')
    } else miss('team-chat-open-desktop', 'no visible Team Chat control')
    await c.close()
  }

  // 6: Global Settings. 7: the Appearance tab inside it.
  {
    const c = await newContext({ width: 1440, height: 900 })
    const page = await c.newPage()
    await openProject(page)
    const settings = page.locator('[data-bc-settings]:visible').first()
    if ((await settings.count()) > 0) {
      await settings.click({ force: true })
      await page.waitForTimeout(900)
      await shot(page, 'global-settings-desktop')
      const appearance = page
        .locator('#settings')
        .getByRole('button', { name: /^Appearance$/ })
        .first()
      if ((await appearance.count()) > 0) {
        await appearance.click({ force: true })
        await page.waitForTimeout(700)
        await shot(page, 'appearance-settings-desktop')
      } else miss('appearance-settings-desktop', 'no Appearance tab button in Settings')
    } else miss('global-settings-desktop', 'no visible Global Settings control')
    await c.close()
  }

  // 8: the maximised Card Table. 9: Docs & Files. 10: the canvas with a Post-it.
  {
    const c = await newContext({ width: 1440, height: 900 })
    const page = await c.newPage()
    await openProject(page)
    for (const [id, name] of [
      ['board', 'card-table-maximised-desktop'],
      ['documents', 'docs-files-desktop'],
    ] as const) {
      await page
        .locator('[data-bc-menu]:visible, [data-bc-menu-open]:visible')
        .first()
        .click({ force: true })
        .catch(() => undefined)
      await page.waitForTimeout(350)
      const item = page.locator(`[data-bc-menu-modules] [data-bc-expand="${id}"]`).first()
      if ((await item.count()) > 0) {
        await item.click({ force: true })
        await page.waitForTimeout(800)
        await shot(page, name)
        await page
          .locator('.bcexpx')
          .first()
          .click({ force: true })
          .catch(() => undefined)
        await page.waitForTimeout(700)
      } else miss(name, `no module menu item for ${id}`)
    }
    /*
      The "+ Note" control is drawn only while a project has NO Post-it (compose.js). A project that already holds one
      has the Post-it on the canvas, which is the surface this capture is for, so it is shot as it stands rather than
      reported missing. A project with neither a Post-it nor the control is still a miss.
    */
    const note = page.locator('[data-bc-newnote]:visible, .bcnoteempty:visible').first()
    const hasPostit = (await page.locator('.bcpostit, [data-bc-postit]').count()) > 0
    if ((await note.count()) > 0) {
      await note.click({ force: true })
      await page.waitForTimeout(600)
      await shot(page, 'canvas-with-postit-desktop')
    } else if (hasPostit) {
      await page.waitForTimeout(300)
      await shot(page, 'canvas-with-postit-desktop')
    } else miss('canvas-with-postit-desktop', 'no Post-it on the canvas and no + Note control')
    await c.close()
  }

  console.log(`CAPTURED ${String(reached.length)} into .out/visual/ with tag "${tag}":`)
  for (const r of reached) console.log(`  ${tag}-${r}.png`)
  for (const m of missed) console.log(`MISSED ${m}`)
} finally {
  await browser.close()
  close()
}
process.exitCode = missed.length === 0 ? 0 : 1
