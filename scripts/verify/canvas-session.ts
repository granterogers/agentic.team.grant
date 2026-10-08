// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * Navigation, restoration, isolation and extended use of the canvas, in real Chromium (#439, QA v2).
 *   npx tsx scripts/verify/canvas-session.ts
 *
 * 1. each project keeps its own view and notes; switching away and back restores them;
 * 2. the browser's Back and Forward buttons restore the view of the project they land on;
 * 3. a reload restores zoom, pan and notes;
 * 4. signing out leaves no arrangement, note or view in the browser for the next person;
 * 5. after a long session of zooming, panning and dragging the page still draws at a healthy rate, does not grow without bound
 *    and is not re-rendering by itself.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any
declare const localStorage: any

const PORT = 4680
const server = await serveStudio(PORT)
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}
const errors: string[] = []
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(e.message))

const view = (): Promise<{ x: number; y: number; zoom: number } | null> =>
  page.evaluate(() => {
    const t = document.querySelector('.bcstage')
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(
      t?.style.transform ?? '',
    )
    return m === null ? null : { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
  })
const noteTexts = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.bcpostit .bcpostittext')]
      .map((e: any) => String(e.value ?? ''))
      .filter((t: string) => t !== '')
      .sort(),
  )
const openProject = async (index: number): Promise<string> => {
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem').nth(index).click()
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(600)
  return new URL(page.url()).pathname
}
const zoomAtBare = async (steps: number): Promise<void> => {
  const b = (await page.evaluate(() => {
    const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
    return { x: r.x + r.width * 0.92, y: r.y + r.height * 0.85 }
  })) as { x: number; y: number }
  await page.mouse.move(b.x, b.y)
  for (let i = 0; i < steps; i += 1) await page.mouse.wheel(0, -250)
  await page.waitForTimeout(400)
}

await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-menu]')
const pathA = await openProject(0)
const pathB = await openProject(1)
check(
  'two different projects',
  pathA !== pathB && pathA !== '' && pathB !== '',
  `${pathA} / ${pathB}`,
)

/* 1. set up A: zoom, pan, a note */
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(600)
if ((await page.locator('.bcpostit').count()) === 0)
  await page.locator('.bcnoteempty').first().click()
else {
  await page.locator('.bcpostit').first().hover()
  await page
    .locator('.bcpostit [data-bc-note-add]')
    .first()
    .evaluate((el: any) => el.click())
}
await page.keyboard.type('only in project A')
await page.locator('[data-bc-board]').click({ position: { x: 5, y: 5 }, force: true })
await page.waitForTimeout(900)
await zoomAtBare(3)
const vA = await view()
check('project A is zoomed in', (vA?.zoom ?? 1) > 1.2, JSON.stringify(vA))

/* B is its own */
const toB = await openProject(1)
const vB = await view()
const notesB = await noteTexts()
check(
  'project B starts at its own default view, not A’s',
  (vB?.zoom ?? 0) === 1,
  JSON.stringify(vB),
)
check('A’s note is not in B', !notesB.includes('only in project A'), JSON.stringify(notesB))
check('B is the project we asked for', toB === pathB, toB)

/* and back to A through the menu */
await openProject(0)
const vA2 = await view()
check(
  'back in A the zoom is restored',
  vA !== null && vA2 !== null && Math.abs(vA2.zoom - vA.zoom) < 1e-6,
  `${JSON.stringify(vA)} -> ${JSON.stringify(vA2)}`,
)
check('and A’s note is there', (await noteTexts()).includes('only in project A'))

/* 2. browser Back and Forward */
await openProject(1)
await page.goBack()
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(700)
const vBack = await view()
check(
  'Back lands on A with its view',
  new URL(page.url()).pathname === pathA && Math.abs((vBack?.zoom ?? 0) - (vA?.zoom ?? -1)) < 1e-6,
  `${page.url()} ${JSON.stringify(vBack)}`,
)
await page.goForward()
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(700)
check(
  'Forward lands on B at its own view',
  new URL(page.url()).pathname === pathB && (await view())?.zoom === 1,
  `${page.url()} ${JSON.stringify(await view())}`,
)

/* 3. reload */
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(700)
const vR = await view()
check(
  'a reload restores the zoom',
  Math.abs((vR?.zoom ?? 0) - (vA?.zoom ?? -1)) < 1e-6,
  JSON.stringify(vR),
)
check('and the note', (await noteTexts()).includes('only in project A'))

/* 4. signing out leaves nothing of the person's arrangement behind */
const before = await page.evaluate(() =>
  Object.keys(localStorage).filter((k: string) => k.startsWith('bc.stage.')),
)
check('there is something stored to be wiped', before.length > 0, before.join(','))
await page.evaluate(`import('/signout.js').then((m) => m.signOut({ reload: false }))`)
await page.waitForTimeout(800)
const after = await page.evaluate(() =>
  Object.keys(localStorage).filter((k: string) => k.startsWith('bc.')),
)
check('sign-out wipes every arrangement, note and view', after.length === 0, after.join(','))
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(700)
check(
  'the next person at this browser sees no note and a default view',
  !(await noteTexts()).includes('only in project A') && (await view())?.zoom === 1,
)

/* 5. extended use */
const stats = () =>
  page.evaluate(() => ({
    nodes: document.querySelectorAll('*').length,
    heap: (performance as any).memory?.usedJSHeapSize ?? 0,
  }))
const frames = (ms: number): Promise<number> =>
  page.evaluate(
    `new Promise((resolve) => { let n = 0; const t = performance.now(); const tick = () => { n += 1; if (performance.now() - t < ${String(ms)}) requestAnimationFrame(tick); else resolve(n) }; requestAnimationFrame(tick) })`,
  ) as Promise<number>
await page.click('[data-bc-viewreset]').catch(() => undefined)
await page.waitForTimeout(500)
const s0 = await stats()
const board = (await page.evaluate(() => {
  const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})) as { x: number; y: number; w: number; h: number }
const t0 = Date.now()
for (let round = 0; round < 40; round += 1) {
  await page.mouse.move(board.x + board.w * 0.92, board.y + board.h * 0.85)
  await page.keyboard.down('Control')
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, i % 2 === 0 ? -150 : 150)
  await page.keyboard.up('Control')
  await page.mouse.move(board.x + board.w * 0.93, board.y + board.h * 0.9)
  await page.mouse.down()
  await page.mouse.move(board.x + board.w * 0.93 - 150, board.y + board.h * 0.9 - 40, { steps: 5 })
  await page.mouse.up()
  const head = await page.evaluate(() => {
    const r = document.querySelector('[data-mod] .bcmodhead')?.getBoundingClientRect()
    return r ? { x: r.x + 24, y: r.y + 8 } : null
  })
  if (head !== null) {
    await page.mouse.move(head.x, head.y)
    await page.mouse.down()
    await page.mouse.move(head.x + 40, head.y + 20, { steps: 4 })
    await page.mouse.move(head.x, head.y, { steps: 4 })
    await page.mouse.up()
  }
}
const longMs = Date.now() - t0
await page.click('[data-bc-fit]').catch(() => undefined)
await page.waitForTimeout(800)
const s1 = await stats()
const fps = await frames(1500)
const churn = (await page.evaluate(
  `new Promise((res) => { let n = 0; const mo = new MutationObserver((l) => { n += l.length }); mo.observe(document.body, { childList: true, subtree: true, attributes: true }); setTimeout(() => res(n), 1500) })`,
)) as number
check('a long session of zoom, pan and drag completed', longMs < 150_000, `${longMs}ms`)
check(
  'the page did not grow: element count',
  s1.nodes <= s0.nodes + 40,
  `${s0.nodes} -> ${s1.nodes}`,
)
check(
  'the heap did not balloon',
  s1.heap === 0 || s1.heap < s0.heap + 60 * 1024 * 1024,
  `${Math.round(s0.heap / 1e6)}MB -> ${Math.round(s1.heap / 1e6)}MB`,
)
check('it still draws at a healthy rate', fps >= 25, `${fps} frames in 1.5s`)
check('it is at rest afterwards, not re-rendering', churn < 5, `${churn} mutations in 1.5s`)
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
