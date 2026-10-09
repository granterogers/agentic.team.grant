// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * The canvas at its edges (ADR-0068). Real Chromium, static server, no office.
 *
 * The coordinate space is practically large, not unbounded: a module position and the pan are clamped to +-100,000
 * logical pixels and a size to 6,000 (layout.js REACH, MAX_SIZE). This proves what happens AT and BEYOND those limits,
 * that Fit and Reset bring a lost module back, that a drag still lands under the pointer far from the origin, and that a
 * crowded board stays responsive. Each check has a way to fail: a hostile stored value really is stored first.
 *   npx tsx scripts/verify/canvas-extremes.ts
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any
declare const localStorage: any

const PORT = 4673
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}
const errors: string[] = []
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-menu]')
await page.click('[data-bc-menu]')
await page.locator('.bcmenulist .bcmenuitem').first().click()
await page.waitForSelector('[data-bc-board]')
const slug = new URL(page.url()).pathname.split('/')[2] ?? ''
check('a project is open', slug !== '', slug)

const view = () =>
  page.evaluate(() => {
    const t = document.querySelector('.bcstage')
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(t.style.transform)
    return m === null ? null : { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
  })
const mods = () =>
  page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return [...document.querySelectorAll('.bcmod--placed')].map((e: any) => {
      const r = e.getBoundingClientRect()
      return {
        id: e.dataset.mod,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        on: r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh,
      }
    })
  })
const store = (doc: unknown) =>
  page.evaluate(
    ([k, d]) => localStorage.setItem(k as string, JSON.stringify(d)),
    [`bc.stage.${slug}`, doc],
  )
const reload = async (): Promise<void> => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(600)
}

/* ---- 1. hostile stored values: far past the limits, and not numbers at all ------------------------------------------- */
await store({
  mods: [
    { id: 'tasks', x: 1e12, y: -1e12, w: 99999, h: 99999, z: 1, tint: null },
    { id: 'board', x: -150000, y: 150000, w: 300, h: 200, z: 2, tint: null },
    { id: 'documents', x: Number.NaN, y: 'nope', w: -5, h: 0, z: 3, tint: null },
    { id: 'schedule', x: 99999, y: 99999, w: 400, h: 300, z: 4, tint: null },
  ],
  zoom: 1e9,
  pan: { x: 5e9, y: -5e9 },
  layouts: {},
  postits: [],
  gone: {},
  seeded: true,
})
await reload()
const v = await view()
check(
  'the page still draws with hostile stored values',
  v !== null && errors.length === 0,
  errors.join(' | '),
)
if (v !== null) {
  check('zoom is clamped to 2.5', v.zoom <= 2.5 + 1e-9, String(v.zoom))
  check(
    'pan is clamped to 100,000',
    Math.abs(v.x) <= 100000 + 1 && Math.abs(v.y) <= 100000 + 1,
    `${v.x},${v.y}`,
  )
}
/* The stored copy is repaired in memory and rewritten at the next save, so the property is read off what is DRAWN. */
{
  const zoom = v?.zoom ?? 1
  const drawn = await mods()
  const sized = drawn.every(
    (m) => m.w / zoom >= 239 && m.w / zoom <= 6001 && m.h / zoom >= 149 && m.h / zoom <= 6001,
  )
  check(
    'hostile sizes are drawn within 240..6000 by 150..6000',
    sized,
    JSON.stringify(drawn.map((m) => [m.id, m.w, m.h])),
  )
  const tasks = drawn.find((m) => m.id === 'tasks')
  check(
    'a module stored at 1e12 is drawn at the 100,000 limit, not at infinity',
    tasks !== undefined &&
      Number.isFinite(tasks.x) &&
      Math.abs((tasks.x - (v?.x ?? 0)) / zoom) <= 100050,
    JSON.stringify(tasks),
  )
}

/*
  A persisted zoom other than 100% once made the calendar measure its module at the wrong scale on the first paint,
  flip its size, redraw, and flip back: an endless render loop (about 45 redraws a second) at rest. A settled page
  does not mutate.
*/
await page.waitForTimeout(1500)
const churn = (await page.evaluate(
  `new Promise((res) => { let n = 0; const mo = new MutationObserver((l) => { n += l.length }); mo.observe(document.body, { childList: true, subtree: true, attributes: true }); setTimeout(() => res(n), 1500) })`,
)) as number
check(
  'a board restored at a non-default zoom is at rest, not re-rendering',
  churn === 0,
  `${churn} mutations in 1.5s`,
)

/* ---- 2. recovery: Tidy and Reset view for a hostile layout; Fit for a spread a person can make ---------------------- */
/*
  THE HONEST LIMIT: Fit cannot show modules 200,000px apart in a 1440px window (the minimum zoom is 20%, so the widest
  span it can frame is about 7,000px). Such a layout cannot be made by hand (it would take dozens of drags at 20%); it
  can only come from a hostile or corrupt stored document. The recovery for that is Tidy, which lays every module out
  inside the stage, then Reset view. Fit is proven for the spread a person can actually make.
*/
await page.click('[data-bc-tidy]')
await page.waitForTimeout(500)
await page.click('[data-bc-viewreset]')
await page.waitForTimeout(500)
const tidied = await mods()
check('there are modules to recover', tidied.length >= 4, String(tidied.length))
check(
  'Tidy then Reset view brings every module of a hostile layout back into the window',
  tidied.every((m) => m.on),
  JSON.stringify(tidied.filter((m) => !m.on)),
)
await store({
  mods: [
    { id: 'tasks', x: -2500, y: -1800, w: 400, h: 300, z: 1, tint: null },
    { id: 'board', x: 2600, y: 1900, w: 400, h: 300, z: 2, tint: null },
    { id: 'documents', x: 2600, y: -1800, w: 400, h: 300, z: 3, tint: null },
    { id: 'schedule', x: -2500, y: 1900, w: 400, h: 300, z: 4, tint: null },
  ],
  zoom: 2,
  pan: { x: 4000, y: 4000 },
  layouts: {},
  postits: [],
  gone: {},
  seeded: true,
})
await reload()
check(
  'before Fit, the realistic spread is lost off screen',
  (await mods()).every((m) => !m.on),
)
await page.click('[data-bc-fit]')
await page.waitForTimeout(500)
const fitted = await mods()
check(
  'Fit brings every module of a realistic spread (5,000px apart) into the window',
  fitted.length >= 4 && fitted.every((m) => m.on),
  JSON.stringify(fitted.filter((m) => !m.on)),
)
const vf = await view()
check(
  'Fit is within the zoom range',
  vf !== null && vf.zoom >= 0.2 - 1e-9 && vf.zoom <= 2.5 + 1e-9,
  JSON.stringify(vf),
)
await page.click('[data-bc-viewreset]')
await page.waitForTimeout(300)
const vr = await view()
check(
  'Reset view returns to the origin at 100%',
  vr !== null && vr.zoom === 1 && vr.x === 0 && vr.y === 0,
  JSON.stringify(vr),
)

/* ---- 3. a module far from the origin still drags 1:1 under the pointer ----------------------------------------------- */
await store({
  mods: [{ id: 'tasks', x: 90000, y: 90000, w: 400, h: 300, z: 1, tint: null }],
  zoom: 1,
  pan: { x: -90000, y: -90000 },
  layouts: {},
  postits: [],
  gone: {},
  seeded: true,
})
await reload()
const far0 = (await mods()).find((m) => m.id === 'tasks')
check(
  'a module 90,000px away is drawn where the pan puts it',
  far0?.on === true,
  JSON.stringify(far0),
)
if (far0?.on === true) {
  const hx = far0.x + 60
  const hy = far0.y + 12
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.mouse.move(hx + 137, hy + 71, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const far1 = (await mods()).find((m) => m.id === 'tasks')
  const dx = (far1?.x ?? 0) - far0.x
  const dy = (far1?.y ?? 0) - far0.y
  check(
    'dragging it far from the origin moves it exactly by the drag',
    dx === 137 && dy === 71,
    `${dx},${dy}`,
  )
}
await page.click('[data-bc-fit]')
await page.waitForTimeout(300)
check('Fit finds it again', ((await mods()).find((m) => m.id === 'tasks')?.on ?? false) === true)

/* ---- 4. a crowded board: many modules and notes stay responsive ------------------------------------------------------- */
const crowd = {
  mods: [] as any[],
  zoom: 1,
  pan: { x: 0, y: 0 },
  layouts: {},
  postits: [] as any[],
  gone: {},
  seeded: true,
}
const ids = ['tasks', 'board', 'documents', 'schedule', 'contacts', 'activity']
ids.forEach((id, i) => {
  crowd.mods.push({
    id,
    x: (i % 3) * 420,
    y: Math.floor(i / 3) * 320,
    w: 400,
    h: 300,
    z: i + 1,
    tint: null,
  })
})
for (let i = 0; i < 120; i += 1) {
  crowd.postits.push({
    id: `n_c${i}`,
    x: (i % 12) * 230 - 400,
    y: 700 + Math.floor(i / 12) * 210,
    w: 210,
    h: 190,
    z: 10 + i,
    text: `Note ${i}`,
    at: 1 + i,
  })
}
await store(crowd)
await reload()
check(
  '126 items on the board are all drawn',
  (await page.locator('.bcmod--placed, .bcpostit').count()) >= 126,
)
const board = (await page.evaluate(() => {
  const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})) as { x: number; y: number; w: number; h: number }
const frameCount = (ms: number): Promise<number> =>
  page.evaluate(
    `new Promise((resolve) => { let n = 0; const t = performance.now(); const tick = () => { n += 1; if (performance.now() - t < ${String(ms)}) requestAnimationFrame(tick); else resolve(n) }; requestAnimationFrame(tick) })`,
  ) as Promise<number>
const frames = await frameCount(1500)
await page.mouse.move(board.x + board.w * 0.5, board.y + board.h * 0.5)
await page.keyboard.down('Control')
const w0 = Date.now()
for (let i = 0; i < 20; i += 1) await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120)
await page.keyboard.up('Control')
const wheelMs = Date.now() - w0
const fps = await frameCount(1000)
check('idle frame rate with 126 items is healthy', frames >= 20, `${frames} frames in 1.5s`)
check('twenty zoom steps with 126 items finish promptly', wheelMs < 4000, `${wheelMs}ms`)
check('the frame rate holds after zooming', fps >= 20, `${fps} frames in 1s`)
check('no page errors', errors.length === 0, errors.join(' | '))

await browser.close()
server.close()
let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail === '' ? '' : ` - ${c.detail}`}`)
}
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
