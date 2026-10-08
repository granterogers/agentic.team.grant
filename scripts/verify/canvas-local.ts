// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate, which the project's TypeScript has no DOM library for
/**
 * The infinite canvas and the project menu, in a real browser (8 October 2026).
 *   npx tsx scripts/verify/canvas-local.ts
 *
 * Local class: a static server and Chromium, no office and nothing from production. Without a token the page draws its
 * prototype projects, and the layout store works against localStorage exactly as it does for a person.
 * Asserted: the menu replaces Home/Jump/tray; wheel zoom is centred on the pointer and stable over many steps; plain wheel
 * over a scrollable module scrolls it instead; bare-canvas drag pans; a module drag lands under the pointer at any zoom;
 * resize works at zoom; the view and the arrangement survive a reload; two projects keep separate views; a note's plus
 * adds a note beside it and none overlap.
 */
import '../../src/safety/arm.ts'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

/* The page functions below run in the browser, where these exist; the project's TypeScript has no DOM library. */
declare const document: any
declare const window: any

const PORT = 4652
const server = await serveStudio(PORT)
const browser = await chromium.launch()
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const errors: string[] = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(e.message))
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const rect = (p: Page, sel: string) =>
  p.evaluate((s) => {
    const el = document.querySelector(s)
    if (el === null) throw new Error(`missing ${s}`)
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }, sel)
const view = (p: Page) =>
  p.evaluate(() => {
    const t = document.querySelector('.bcstage') as any
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(t.style.transform)
    if (m === null) throw new Error('no transform')
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
  })

try {
  /* ------------------------------------------------------------ the menu */
  await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-menu]')
  check(
    'no Home button, Jump control or tray',
    (await page.locator('[data-bc-jump], .bctray, [aria-label^="Home"]').count()) === 0,
  )
  check(
    'no project selected shows the empty canvas, not a project list',
    (await page.locator('.bcvoid').count()) === 1 &&
      (await page.locator('.bcgrid--projects').count()) === 0,
  )
  await page.click('[data-bc-menu]')
  const items = await page.locator('.bcmenulist .bcmenuitem').count()
  check('the menu lists the projects', items >= 2, `${String(items)} projects`)
  check('the menu offers Create project', (await page.locator('.bcmenucreate').count()) === 1)
  await page.keyboard.press('Escape')
  check('Escape closes the menu', (await page.locator('.bcmenupanel').isVisible()) === false)
  await page.click('[data-bc-menu]')
  await page.mouse.click(900, 600)
  check('pressing outside closes the menu', (await page.locator('.bcmenupanel').isVisible()) === false)
  await page.click('[data-bc-menu]')
  const first = page.locator('.bcmenulist .bcmenuitem').first()
  const firstName = (await first.innerText()).trim()
  await first.click()
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(500)
  check(
    'choosing a project opens its workspace and closes the menu',
    (await page.locator('.bcmenupanel').isVisible()) === false,
  )
  check(
    'the active project is named in the header',
    (await page.locator('.bchere').innerText()).includes(firstName),
  )
  await page.click('[data-bc-menu]')
  check(
    'the active project is marked current',
    (await page.locator('.bcmenuitem[aria-current="page"]').count()) >= 1,
  )
  await page.keyboard.press('Escape')
  const slugA = new URL(page.url()).pathname

  /* ------------------------------------------------------------ zoom */
  const board = await rect(page, '[data-bc-board]')
  const px = Math.round(board.x + 700)
  const py = Math.round(board.y + 330)
  const bx0 = px - board.x
  const by0 = py - board.y
  const v0 = await view(page)
  const worldBefore = { x: (bx0 - v0.x) / v0.zoom, y: (by0 - v0.y) / v0.zoom }
  await page.mouse.move(px, py)
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(100)
  const v1 = await view(page)
  check('wheel over bare canvas zooms in', v1.zoom > v0.zoom, `${v0.zoom} -> ${v1.zoom}`)
  check('the page did not scroll', (await page.evaluate(() => window.scrollY)) === 0)
  const worldAfter = { x: (bx0 - v1.x) / v1.zoom, y: (by0 - v1.y) / v1.zoom }
  check(
    'zoom is centred on the pointer',
    Math.abs(worldAfter.x - worldBefore.x) < 0.02 && Math.abs(worldAfter.y - worldBefore.y) < 0.02,
    `before ${worldBefore.x.toFixed(3)},${worldBefore.y.toFixed(3)} after ${worldAfter.x.toFixed(3)},${worldAfter.y.toFixed(3)}`,
  )
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, i % 2 === 0 ? 240 : -240)
  }
  await page.waitForTimeout(100)
  const v2 = await view(page)
  const w2 = { x: (bx0 - v2.x) / v2.zoom, y: (by0 - v2.y) / v2.zoom }
  check(
    'twelve mixed wheel steps do not drift',
    Math.abs(w2.x - worldBefore.x) < 0.5 && Math.abs(w2.y - worldBefore.y) < 0.5,
    `${w2.x.toFixed(2)},${w2.y.toFixed(2)}`,
  )
  for (let i = 0; i < 30; i += 1) await page.mouse.wheel(0, 400)
  const vmin = await view(page)
  check(
    'zoom stops at the minimum',
    vmin.zoom >= 0.2 - 1e-9 && vmin.zoom <= 0.21,
    String(vmin.zoom),
  )
  check(
    'zoomed out, every module is still on the page',
    (await page.locator('.bcmod--placed').count()) >= 4,
  )

  /* wheel over scrollable content must scroll it, not zoom */
  await page.click('[data-bc-zoom="reset"]')
  await page.waitForTimeout(300)
  const scroller = await page.evaluate(() => {
    for (const el of document.querySelectorAll('.bcmodbody')) {
      if (el.scrollHeight > el.clientHeight + 4) {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: (el as any).scrollTop }
      }
    }
    return null
  })
  if (scroller === null) check('a module has scrollable content to test', false)
  else {
    const z0 = (await view(page)).zoom
    await page.mouse.move(scroller.x, scroller.y)
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(150)
    const after = await page.evaluate(
      ([x, y]) =>
        (document.elementFromPoint(x as number, y as number)?.closest('.bcmodbody') as any | null)
          ?.scrollTop ?? -1,
      [scroller.x, scroller.y],
    )
    check(
      'wheel over scrollable content scrolls it and does not zoom',
      after > scroller.top && (await view(page)).zoom === z0,
      `scrollTop ${String(scroller.top)} -> ${String(after)}`,
    )
  }

  /* ------------------------------------------------------------ pan */
  const vp0 = await view(page)
  const bare = await page.evaluate(() => {
    const b = (document.querySelector('[data-bc-board]') as any).getBoundingClientRect()
    for (let y = b.bottom - 20; y > b.top + 20; y -= 25) {
      for (let x = b.right - 160; x > b.left + 20; x -= 25) {
        const e = document.elementFromPoint(x, y)
        if (e !== null && (e.classList.contains('bcstage') || e.classList.contains('bcpanes')))
          return { x, y }
      }
    }
    return null
  })
  if (bare === null) throw new Error('there is no bare canvas to pan from')
  await page.mouse.move(bare.x, bare.y)
  await page.mouse.down()
  await page.mouse.move(bare.x - 100, bare.y - 60, { steps: 6 })
  await page.mouse.up()
  const vp1 = await view(page)
  check(
    'dragging bare canvas pans by exactly the drag',
    Math.abs(vp1.x - vp0.x + 100) < 1.5 && Math.abs(vp1.y - vp0.y + 60) < 1.5,
    `${vp1.x - vp0.x},${vp1.y - vp0.y}`,
  )

  /* ------------------------------------------------------------ move and resize at a non-1 zoom */
  await page.click('[data-bc-viewreset]')
  await page.waitForTimeout(350)
  await page.click('[data-bc-zoom="out"]')
  await page.waitForTimeout(350)
  const z = (await view(page)).zoom
  const head = await rect(page, '[data-mod="tasks"] .bcmodhead')
  const modBefore = await rect(page, '[data-mod="tasks"]')
  await page.mouse.move(head.x + 20, head.y + 10)
  await page.mouse.down()
  await page.mouse.move(head.x + 20 + 150, head.y + 10 + 90, { steps: 8 })
  await page.mouse.up()
  const modAfter = await rect(page, '[data-mod="tasks"]')
  check(
    'a dragged module follows the pointer at zoom',
    Math.abs(modAfter.x - modBefore.x - 150) < 14 && Math.abs(modAfter.y - modBefore.y - 90) < 14,
    `z ${String(z)} dx ${(modAfter.x - modBefore.x).toFixed(1)} dy ${(modAfter.y - modBefore.y).toFixed(1)} (guides may snap up to 6 logical px)`,
  )
  const rz = await rect(page, '[data-mod="tasks"] [data-bc-resize]')
  await page.mouse.move(rz.x + rz.w / 2, rz.y + rz.h / 2)
  await page.mouse.down()
  await page.mouse.move(rz.x + rz.w / 2 + 80, rz.y + rz.h / 2 + 50, { steps: 6 })
  await page.mouse.up()
  const modSized = await rect(page, '[data-mod="tasks"]')
  check(
    'a module resizes at zoom',
    modSized.w > modAfter.w + 40 && modSized.h > modAfter.h + 20,
    `${modAfter.w.toFixed(0)}x${modAfter.h.toFixed(0)} -> ${modSized.w.toFixed(0)}x${modSized.h.toFixed(0)}`,
  )
  /* drag far beyond the original stage */
  const head2 = await rect(page, '[data-mod="tasks"] .bcmodhead')
  await page.mouse.move(head2.x + 20, head2.y + 10)
  await page.mouse.down()
  await page.mouse.move(head2.x + 20 + 1200, head2.y + 10 + 400, { steps: 10 })
  await page.mouse.up()
  const far = await rect(page, '[data-mod="tasks"]')
  check(
    'a module may leave the original stage',
    far.x + far.w > board.x + board.w + 100 || far.x > board.x + board.w - 80,
    `x ${far.x.toFixed(0)}`,
  )

  /* ------------------------------------------------------------ persistence and isolation */
  await page.waitForTimeout(500)
  const stored = await view(page)
  const posBefore = await rect(page, '[data-mod="tasks"]')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(600)
  const restored = await view(page)
  const posAfter = await rect(page, '[data-mod="tasks"]')
  check(
    'the view survives a reload',
    Math.abs(restored.zoom - stored.zoom) < 0.002 &&
      Math.abs(restored.x - stored.x) < 1 &&
      Math.abs(restored.y - stored.y) < 1,
  )
  check(
    'the arrangement survives a reload',
    Math.abs(posAfter.x - posBefore.x) < 1.5 &&
      Math.abs(posAfter.y - posBefore.y) < 1.5 &&
      Math.abs(posAfter.w - posBefore.w) < 1.5,
  )
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem').nth(1).click()
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(600)
  const other = await view(page)
  check(
    'another project has its own view',
    page.url() !== url(slugA) && other.zoom === 1 && other.x === 0 && other.y === 0,
    JSON.stringify(other),
  )
  await page.goto(url(slugA), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(500)
  check(
    'and the first project kept its view',
    Math.abs((await view(page)).zoom - stored.zoom) < 0.002,
  )

  /* ------------------------------------------------------------ fit and reset */
  await page.click('[data-bc-fit]')
  await page.waitForTimeout(400)
  const mods = await page.evaluate(() =>
    [...document.querySelectorAll('.bcmod--placed')].map((e) => {
      const r = e.getBoundingClientRect()
      return { l: r.left, r: r.right, t: r.top, b: r.bottom }
    }),
  )
  const bx = await rect(page, '[data-bc-board]')
  check(
    'Fit brings every module into view',
    mods.every(
      (m) => m.l >= bx.x - 2 && m.r <= bx.x + bx.w + 2 && m.t >= bx.y - 2 && m.b <= bx.y + bx.h + 2,
    ),
  )
  await page.click('[data-bc-viewreset]')
  await page.waitForTimeout(400)
  const reset = await view(page)
  check(
    'Reset view returns to the origin at 100%',
    reset.zoom === 1 && reset.x === 0 && reset.y === 0,
  )

  /* ------------------------------------------------------------ post-its */
  check(
    'there is no top-level New Note control',
    (await page.locator('.bcdock [data-bc-newnote]').count()) === 0,
  )
  const noteCount = await page.locator('.bcpostit').count()
  await page.locator('.bcpostit').first().hover()
  await page.locator('.bcpostit [data-bc-note-add]').first().click()
  await page.waitForTimeout(400)
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('.bcpostit')].map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, f: e.contains(document.activeElement) }
    }),
  )
  check('the plus adds one note', after.length === noteCount + 1)
  check(
    'the new note takes focus',
    after.some((n) => n.f),
  )
  const overlap = after.some((a, i) =>
    after.some(
      (b, j) =>
        j > i &&
        a.x < b.x + b.w - 1 &&
        b.x < a.x + a.w - 1 &&
        a.y < b.y + b.h - 1 &&
        b.y < a.y + a.h - 1,
    ),
  )
  check('notes do not overlap', !overlap)
  await page.click('[data-bc-zoom="out"]')
  await page.mouse.move(400, 500)
  await page.mouse.wheel(0, 200)
  await page.locator('.bcpostit').first().hover()
  await page.locator('.bcpostit [data-bc-note-add]').first().click()
  await page.waitForTimeout(300)
  check(
    'a note can be added while zoomed and panned',
    (await page.locator('.bcpostit').count()) === noteCount + 2,
  )
} finally {
  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  server.close()
}
console.log(failed === 0 ? '\nALL GREEN' : `\n${String(failed)} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
