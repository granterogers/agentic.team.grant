/**
 * Canvas drag under zoom, over an overlapping module, and with touch, on Team HQ (`/`) in a real browser.
 *
 *   npx tsx scripts/verify/probe-canvas.ts
 *
 * 1. Drags the To-dos module by its header at 100% and at a zoomed-out level; a 60 px gesture should move
 *    the module by about 60 px on screen at both zooms (within the 6 px alignment guide).
 * 2. Drags one module across another and checks that only the dragged module moved.
 * 3. Drags a module with real touch events and checks it moved.
 * Serves web/studio locally; nothing is sent to a server.
 */
import { chromium, type Page } from 'playwright'
import { serve, touchDrag } from './probe-lib.ts'

const boxOf = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
  }, sel)

const mouseDrag = async (page: Page, from: [number, number], dx: number, dy: number) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + dx / 2, from[1] + dy / 2, { steps: 6 })
  await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(600)
}

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)

  // 1. Zoom: a 60 px gesture at 100% and at a zoomed-out level.
  const tasks = '[data-mod="tasks"]'
  const at100 = await boxOf(page, tasks)
  if (at100 === null) throw new Error('no to-dos module')
  await mouseDrag(page, [at100[0] + 60, at100[1] + 16], 60, 0)
  const after100 = await boxOf(page, tasks)
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-bc-zoom="out"]').first().click({ force: true })
  }
  await page.waitForTimeout(500)
  const zoomLabel = await page.locator('[data-bc-zoom="reset"]').first().textContent()
  const beforeZoomed = await boxOf(page, tasks)
  if (beforeZoomed === null) throw new Error('module lost after zoom')
  await mouseDrag(page, [beforeZoomed[0] + 60, beforeZoomed[1] + 16], 60, 0)
  const afterZoomed = await boxOf(page, tasks)
  console.log(
    JSON.stringify({
      zoom: {
        at100: { before: at100, afterDrag: after100, deltaX: (after100?.[0] ?? 0) - at100[0] },
        zoomedLabel: zoomLabel,
        zoomedBefore: beforeZoomed,
        zoomedAfter: afterZoomed,
        deltaXScreen: (afterZoomed?.[0] ?? 0) - beforeZoomed[0],
      },
    }),
  )

  // Restore 100% for the overlap test.
  await page.locator('[data-bc-zoom="reset"]').first().click({ force: true })
  await page.waitForTimeout(500)

  // 2. Overlap: drag To-dos onto the Card Table; only To-dos must move.
  const board = '[data-mod="board"]'
  const boardBefore = await boxOf(page, board)
  const tasksBefore = await boxOf(page, tasks)
  if (boardBefore !== null && tasksBefore !== null) {
    const dx = boardBefore[0] - tasksBefore[0] + 40
    await mouseDrag(page, [tasksBefore[0] + 60, tasksBefore[1] + 16], dx, 0)
  }
  const boardAfter = await boxOf(page, board)
  const tasksAfter = await boxOf(page, tasks)
  const boardMoved = boardBefore && boardAfter ? boardAfter[0] - boardBefore[0] : null
  const tasksMoved = tasksBefore && tasksAfter ? tasksAfter[0] - tasksBefore[0] : null
  console.log(JSON.stringify({ overlap: { boardMoved, tasksMoved } }))

  // 3. Touch: a real touch drag of the Schedule module by its header.
  const schedule = '[data-mod="schedule"]'
  const sched = await boxOf(page, schedule)
  if (sched !== null) await touchDrag(page, [sched[0] + 60, sched[1] + 16], 0, 50)
  const schedAfter = await boxOf(page, schedule)
  console.log(
    JSON.stringify({
      touch: {
        before: sched,
        after: schedAfter,
        movedY: sched !== null && schedAfter !== null ? schedAfter[1] - sched[1] : null,
      },
      pageErrors: errors.slice(0, 3),
    }),
  )
} finally {
  await browser.close()
  close()
}
