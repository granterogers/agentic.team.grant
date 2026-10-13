/**
 * Regressions the independent review named in the visual redesign, checked in a real browser (local, read-only):
 *   1. A project that never chose a look gets the recommended 92% module opacity.
 *   2. The static board draws no dot grid, and the arrangement grid comes back while a module is being moved.
 *   3. A module with a tint a person chose keeps its own identity colour (the neutral identity does not reach it).
 *
 *   npx tsx scripts/verify/probe-visual-regressions.ts
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
  await page
    .locator('[data-bc-menu-open]:visible, [data-bc-menu]:visible')
    .first()
    .click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]:visible').first().click({ force: true })
  await page.waitForTimeout(1600)
}

const gridInk = (page: Page) =>
  page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('.bcgridcv')
    if (cv === null || cv.width === 0) return { canvas: false, painted: 0 }
    const data = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data
    let painted = 0
    if (data !== undefined) for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
    return { canvas: true, painted }
  })

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  })
  await context.addInitScript(() => {
    try {
      if (sessionStorage.getItem('reg-seeded') === null) {
        localStorage.clear()
        sessionStorage.setItem('reg-seeded', '1')
      }
    } catch {
      /* private */
    }
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openProject(page)

  // 1. Recommended module opacity for a project that never chose one.
  const modOp = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bc-mod-op').trim(),
  )
  record(
    'a project that never chose a look draws modules at the recommended 92%',
    modOp === '0.92',
    {
      modOp,
    },
  )

  // 2a. The static board draws no dots.
  const still = await gridInk(page)
  record('the standard view draws no dot grid', still.canvas === true && still.painted === 0, still)

  // 2b. Moving a module brings the arrangement grid back, and it goes away again when the move ends.
  const mod = page.locator('.bcmod--placed').first()
  const box = await mod.boundingBox()
  if (box !== null) {
    await page.mouse.move(box.x + 60, box.y + 16)
    await page.mouse.down()
    await page.mouse.move(box.x + 110, box.y + 40, { steps: 6 })
    await page.waitForTimeout(400)
    const moving = await gridInk(page)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await gridInk(page)
    record('while a module is moved, the arrangement grid is drawn', moving.painted > 0, { moving })
    record('when the move ends the grid goes away again', after.painted === 0, { after })
  } else record('a placed module exists to move for the grid check', false, null)

  // 3. A module with a tint the person chose keeps its own identity colour.
  const tinted = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.bcmod.bcmod--tinted')
    if (el === null) return null
    const own = getComputedStyle(el).getPropertyValue('--bc-tint').trim()
    const muted = getComputedStyle(document.documentElement)
      .getPropertyValue('--bc-text-muted')
      .trim()
    const mod = getComputedStyle(el).getPropertyValue('--bc-mod').trim()
    return { own, muted, mod, keptOwn: mod !== muted && own !== '' }
  })
  if (tinted === null) {
    console.log(
      'NOT EXERCISED: no module with a person-chosen tint in this prototype; the tinted rule is verified by the cascade only.',
    )
  } else {
    record('a module with a tint a person chose keeps that colour', tinted.keptOwn === true, tinted)
  }

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
