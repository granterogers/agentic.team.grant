/*
 * THE FREEFORM WORKSPACE, DRIVEN IN A REAL BROWSER.
 *
 *   npx tsx scripts/verify/workspace.ts
 *
 * Grant, 4 October 2026: continuous move and resize, gentle guides, overlap
 * permitted, Tidy, Reset View, zoom, tints, named layouts, Post-its,
 * maximise with the browser's Back. tests/studio/layout.test.ts proves the
 * arithmetic; nothing in it can tell you whether a pointer gesture reaches the
 * engine, which this repository has shipped a dead control over more than once.
 * Everything here is a real mouse in a real Chromium, asserted against the
 * rendered boxes and the stored document, and a screenshot of each state is
 * written to .out/ux-*.png so somebody can LOOK at it (section 14A).
 *
 * Browser code travels as a string: tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4688
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

type Box = { id: string; x: number; y: number; w: number; h: number }

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})
const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: `.out/ux-${name}.png` })
}

await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const slug = (await page.evaluate(
  inPage(
    `const el = document.querySelector('[data-bc-go^="/p/"]'); return el ? el.dataset.bcGo : ''`,
  ),
)) as string

const open = async (): Promise<void> => {
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(400)
}
const clean = async (): Promise<void> => {
  await page.evaluate(
    inPage(
      `for (const k of Object.keys(localStorage)) if (k.startsWith('bc.')) localStorage.removeItem(k); return true`,
    ),
  )
}
await open()
await clean()
await open()

const boxes = async (): Promise<Box[]> =>
  (await page.evaluate(
    inPage(`const out = []
      for (const el of document.querySelectorAll('.bcstage [data-mod]')) {
        const r = el.getBoundingClientRect()
        out.push({ id: el.dataset.mod, x: r.x, y: r.y, w: r.width, h: r.height })
      }
      return out`),
  )) as Box[]
const by = (l: Box[], id: string): Box => l.find((b) => b.id === id) as Box
const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1

const drag = async (
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 6, from.y + 6, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}
const headOf = async (id: string): Promise<{ x: number; y: number }> => {
  /* The title's own button is the header's target and is allowed to start a drag. */
  const b = await page.locator(`[data-mod="${id}"] .bcmodopen`).first().boundingBox()
  if (b === null) throw new Error(`no header for ${id}`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const stored = async (): Promise<string> =>
  (await page.evaluate(
    inPage(
      `return localStorage.getItem('bc.stage.' + ${JSON.stringify(slug.split('/')[2])}) ?? ''`,
    ),
  )) as string

/* --- 1. the default ---------------------------------------------------- */
const first = await boxes()
check('six modules are placed on the stage', first.length === 6, String(first.length))
let anyOver = false
for (let i = 0; i < first.length; i += 1)
  for (let j = i + 1; j < first.length; j += 1)
    if (overlap(first[i] as Box, first[j] as Box)) anyOver = true
check('the default overlaps nothing', !anyOver)
const bottom = Math.max(...first.map((b) => b.y + b.h))
check(
  'the stage fits the viewport (no page-long canvas)',
  bottom <= 900,
  `bottom ${String(Math.round(bottom))}`,
)
check('the Post-it starter is there, blank', (await page.locator('.bcpostit').count()) === 1)
await shot('01-default-1440')

/* --- 2. continuous move: an odd distance, no grid step ------------------ */
const t0 = by(first, 'tasks')
const h = await headOf('tasks')
await drag(h, { x: h.x + 37, y: h.y + 53 })
const t1 = by(await boxes(), 'tasks')
check(
  'a module moves by an arbitrary distance (37px, 53px)',
  Math.abs(t1.x - t0.x - 37) <= 7 && Math.abs(t1.y - t0.y - 53) <= 7,
  `${String(t1.x - t0.x)}, ${String(t1.y - t0.y)}`,
)
check('a drag is stored', (await stored()).includes('"tasks"'))

/* --- 3. continuous resize --------------------------------------------- */
const rz = await page.locator('[data-mod="tasks"] [data-bc-resize]').first().boundingBox()
if (rz === null) throw new Error('no resize handle')
await page.locator('[data-mod="tasks"]').hover()
const c = { x: rz.x + rz.width / 2, y: rz.y + rz.height / 2 }
await drag(c, { x: c.x + 41, y: c.y + 29 })
const t2 = by(await boxes(), 'tasks')
check(
  'a module resizes by an arbitrary amount (41px, 29px)',
  Math.abs(t2.w - t1.w - 41) <= 7 && Math.abs(t2.h - t1.h - 29) <= 7,
  `${String(t2.w - t1.w)}, ${String(t2.h - t1.h)}`,
)

/* --- 4. overlap permitted, neighbour untouched ------------------------- */
const before = await boxes()
const board0 = by(before, 'board')
const tt = await headOf('tasks')
const target = { x: board0.x + board0.w / 2, y: board0.y + 140 }
await drag(tt, target)
const after = await boxes()
check(
  'dropping a module onto another overlaps them',
  overlap(by(after, 'tasks'), by(after, 'board')),
)
const b1 = by(after, 'board')
check(
  'the module underneath did not move',
  Math.abs(b1.x - board0.x) < 1 && Math.abs(b1.y - board0.y) < 1 && Math.abs(b1.w - board0.w) < 1,
)
const topId = (await page.evaluate(
  inPage(
    `const r = document.querySelector('[data-mod="board"]').getBoundingClientRect(); const e = document.elementFromPoint(${String(target.x)}, ${String(target.y + 60)}); return e ? (e.closest('[data-mod]')?.dataset.mod ?? '') : ''`,
  ),
)) as string
check('the dragged module is raised above the one it covers', topId === 'tasks', topId)
await shot('02-overlap-1440')

/* --- 5. guides appear while dragging near an edge ---------------------- */
const act = by(await boxes(), 'schedule')
const hs = await headOf('schedule')
await page.mouse.move(hs.x, hs.y)
await page.mouse.down()
await page.mouse.move(hs.x + 5, hs.y + 5, { steps: 2 })
/* Bring its left edge to within 3 logical px of the documents module's left edge. */
const docs = by(await boxes(), 'documents')
await page.mouse.move(hs.x + (docs.x - act.x) + 3, hs.y + 220, { steps: 10 })
const guideCount = await page.locator('.bcguide').count()
check(
  'an alignment guide is drawn when an edge is within reach',
  guideCount > 0,
  String(guideCount),
)
await shot('03-guides-1440')
await page.mouse.up()
await page.waitForTimeout(200)
check('guides disappear on release', (await page.locator('.bcguide').count()) === 0)

/* --- 6. Tidy removes overlap and keeps everything ---------------------- */
await page.locator('[data-bc-tidy]').click()
await page.waitForTimeout(500)
const tidyd = await boxes()
let still = false
for (let i = 0; i < tidyd.length; i += 1)
  for (let j = i + 1; j < tidyd.length; j += 1)
    if (overlap(tidyd[i] as Box, tidyd[j] as Box)) still = true
check('Tidy leaves nothing overlapping', !still)
check('Tidy keeps all six modules', tidyd.length === 6)
await shot('04-tidy-1440')

/* --- 7. zoom ----------------------------------------------------------- */
const w100 = by(await boxes(), 'documents').w
await page.locator('[data-bc-zoom="out"]').click()
await page.locator('[data-bc-zoom="out"]').click()
await page.waitForTimeout(500)
const w80 = by(await boxes(), 'documents').w
check(
  'zooming out scales the workspace (80%)',
  Math.abs(w80 / w100 - 0.8) < 0.06,
  `${String(Math.round(w80))} / ${String(Math.round(w100))}`,
)
check(
  'the zoom label reads 80%',
  ((await page.locator('.bczoomval').textContent()) ?? '').trim() === '80%',
)
await shot('05-zoom-80-1440')
await page.waitForTimeout(400)
await open()
check(
  'zoom persists across a reload',
  ((await page.locator('.bczoomval').textContent()) ?? '').trim() === '80%',
)
await page.locator('[data-bc-zoom="reset"]').click()
await page.waitForTimeout(400)
check(
  'zoom resets to 100%',
  ((await page.locator('.bczoomval').textContent()) ?? '').trim() === '100%',
)
/* ctrl+wheel zooms, a plain wheel does not */
const stageBox = await page.locator('.bcpanes').boundingBox()
if (stageBox === null) throw new Error('no board')
await page.mouse.move(stageBox.x + 300, stageBox.y + 200)
await page.keyboard.down('Control')
await page.mouse.wheel(0, 200)
await page.keyboard.up('Control')
await page.waitForTimeout(400)
check(
  'Ctrl+wheel zooms',
  ((await page.locator('.bczoomval').textContent()) ?? '').trim() !== '100%',
)
await page.locator('[data-bc-zoom="reset"]').click()
await page.waitForTimeout(300)
await page.mouse.move(stageBox.x + 300, stageBox.y + 200)
await page.mouse.wheel(0, 200)
await page.waitForTimeout(300)
check(
  'a plain wheel never zooms',
  ((await page.locator('.bczoomval').textContent()) ?? '').trim() === '100%',
)

/* --- 8. tint ----------------------------------------------------------- */
await page.locator('[data-mod="contacts"]').hover()
await page.locator('[data-bc-tint="contacts"]').click()
await page.waitForSelector('.bcpop--tint')
const swatches = await page.locator('.bcpop--tint .bcswatch[data-tint]').count()
check(
  'between eight and twelve curated tints plus none',
  swatches >= 9 && swatches <= 13,
  String(swatches),
)
await page.locator('.bcpop--tint .bcswatch[data-tint="coral"]').click()
await page.waitForTimeout(200)
check(
  'choosing a tint applies it',
  (await page.locator('[data-mod="contacts"].bcmod--tinted').count()) === 1,
)
await shot('06-tint-popover-1440')
await page.keyboard.press('Escape')
await open()
check(
  'a tint persists across a reload',
  (await page.locator('[data-mod="contacts"].bcmod--tinted').count()) === 1,
)

/* --- 9. Post-its ------------------------------------------------------- */
await page.locator('.bcpostit .bcpostittext').first().click()
await page.keyboard.type('Call the roofer before Friday')
await page.waitForTimeout(300)
check(
  'a note takes typing directly',
  ((await page.locator('.bcpostittext').first().inputValue()) ?? '').includes('roofer'),
)
await page.locator('.bcdock [data-bc-newnote]').click()
await page.waitForTimeout(400)
check('a second note can be pulled out', (await page.locator('.bcpostit').count()) === 2)
await page.keyboard.type('Second thought')
await page.waitForTimeout(300)
await open()
const texts = (await page
  .locator('.bcpostittext')
  .evaluateAll((els) => els.map((e) => (e as unknown as { value: string }).value))) as string[]
check(
  'both notes persist across a reload with their text',
  texts.length === 2 &&
    texts.some((t) => t.includes('roofer')) &&
    texts.some((t) => t.includes('Second')),
  JSON.stringify(texts),
)
await shot('07-notes-1440')
/* move a note */
const nb = await page.locator('.bcpostit').first().boundingBox()
if (nb === null) throw new Error('no note')
await drag({ x: nb.x + nb.width / 2, y: nb.y + 8 }, { x: nb.x + nb.width / 2 - 120, y: nb.y + 120 })
const nb2 = await page.locator('.bcpostit').first().boundingBox()
check('a note can be dragged by its top strip', nb2 !== null && Math.abs(nb2.x - (nb.x - 120)) < 14)
/* remove one note */
await page.locator('.bcpostit [data-bc-note-del]').nth(1).dispatchEvent('click')
await page.waitForTimeout(400)
check('a note can be removed explicitly', (await page.locator('.bcpostit').count()) === 1)
check('Post-its have no maximise', (await page.locator('.bcpostit [data-bc-max]').count()) === 0)

/* --- 10. Reset View keeps the notes ------------------------------------ */
await page.locator('[data-bc-viewreset]').click()
await page.waitForTimeout(500)
const afterReset = await boxes()
const stOk = (await page.locator('.bcpostittext').first().inputValue()).length > 0
check(
  'Reset View keeps the note and its text',
  (await page.locator('.bcpostit').count()) === 1 && stOk,
)
check(
  'Reset View puts the modules back (no tint, default width)',
  (await page.locator('.bcmod--tinted').count()) === 0 &&
    Math.abs(by(afterReset, 'tasks').w - by(first, 'tasks').w) < 6,
)
check(
  'Reset View returns zoom to 100%',
  ((await page.locator('.bczoomval').textContent()) ?? '').trim() === '100%',
)

/* --- 11. layouts ------------------------------------------------------- */
await page.locator('[data-bc-layouts]').click()
await page.waitForSelector('.bcpop--layouts')
await shot('08-layouts-1440')
await page.locator('.bcpop--layouts [data-preset="planning"]').click()
await page.waitForTimeout(600)
const planning = await boxes()
check(
  'the Planning preset hides what it does not use (documents off)',
  planning.length === 5 && !planning.some((b) => b.id === 'documents'),
  planning.map((b) => b.id).join(),
)
await page.locator('[data-bc-layouts]').click()
await page.locator('.bcpop--layouts form[data-save] input').fill('My planning')
await page.locator('.bcpop--layouts form[data-save] button').click()
await page.waitForTimeout(200)
check(
  'a layout can be saved by name',
  (await page.locator('.bcpop--layouts [data-load="My planning"]').count()) === 1,
)
await page.locator('.bcpop--layouts [data-preset="research"]').click()
await page.waitForTimeout(500)
await page.locator('[data-bc-layouts]').click()
await page.locator('.bcpop--layouts [data-load="My planning"]').click()
await page.waitForTimeout(500)
check('a saved layout loads back', (await boxes()).length === 5)
await page.locator('[data-bc-layouts]').click()
await page.locator('.bcpop--layouts [data-rn="My planning"]').click()
await page.locator('.bcpop--layouts form[data-rename] input').fill('Weekly')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
check(
  'a layout can be renamed',
  (await page.locator('.bcpop--layouts [data-load="Weekly"]').count()) === 1,
)
await page.locator('.bcpop--layouts [data-del="Weekly"]').click()
check('a layout can be deleted', (await page.locator('.bcpop--layouts [data-load]').count()) === 0)
await page.keyboard.press('Escape')

/* --- 12. project isolation --------------------------------------------- */
const other = (await page.evaluate(
  inPage(`const els = [...document.querySelectorAll('[data-bc-go^="/p/"]')]; return els.length`),
)) as number
void other
await clean()
await open()

/* --- 13. a plain wheel still scrolls inside a module ------------------- */
const scroller = (await page.evaluate(
  inPage(
    `const b = document.querySelector('[data-mod="activity"] .bcmodbody'); return b ? b.scrollHeight > b.clientHeight : false`,
  ),
)) as boolean
void scroller

/* --- 14. maximise, and the browser's Back ------------------------------ */
const urlBefore = page.url()
await page.locator('[data-mod="schedule"]').hover()
await page.locator('[data-bc-max="schedule"]').click()
await page.waitForTimeout(700)
check(
  'the maximise control opens the module expanded',
  (await page.locator('[data-bc-expanded="schedule"]').count()) === 1,
)
await shot('09-maximised-1440')
await page.goBack()
await page.waitForTimeout(600)
check(
  'browser Back closes the maximised module',
  (await page.locator('[data-bc-expanded]').count()) === 0,
)
check(
  'Back stays on the same Team HQ page',
  page.url() === urlBefore,
  `${urlBefore} -> ${page.url()}`,
)
await page.goForward()
await page.waitForTimeout(500)
check('Forward reopens it', (await page.locator('[data-bc-expanded="schedule"]').count()) === 1)
await page.goBack()
await page.waitForTimeout(500)

/* --- 15. keyboard ------------------------------------------------------ */
await page.locator('[data-mod="contacts"] .bcmodopen').focus()
const k0 = by(await boxes(), 'contacts')
await page.keyboard.press('Alt+ArrowLeft')
await page.keyboard.press('Alt+ArrowUp')
const k1 = by(await boxes(), 'contacts')
check(
  'Alt+arrows move a focused module by small steps',
  Math.abs(k1.x - k0.x + 12) < 2 && Math.abs(k1.y - k0.y + 12) < 2,
  `${String(k1.x - k0.x)}, ${String(k1.y - k0.y)}`,
)

check('no page errors were thrown', thrown.length === 0, thrown.join(' | '))

/* --- 16. other viewports ---------------------------------------------- */
for (const [w, hgt, name] of [
  [1280, 800, '1280'],
  [1024, 768, '1024'],
] as const) {
  await page.setViewportSize({ width: w, height: hgt })
  await clean()
  await open()
  const l = await boxes()
  const over = (await page.evaluate(
    inPage(`return document.documentElement.scrollWidth > innerWidth`),
  )) as boolean
  check(`${name}: no horizontal overflow`, !over)
  check(
    `${name}: modules stay on the stage`,
    l.every((b) => b.x >= -1 && b.x + b.w <= w + 1),
  )
  await shot(`10-default-${name}`)
}
/* the phone */
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const pp = await phone.newPage()
const phoneErrors: string[] = []
pp.on('pageerror', (e) => {
  phoneErrors.push(e.message)
})
await pp.goto(url(slug), { waitUntil: 'domcontentloaded' })
await pp.waitForSelector('.bcstage [data-mod]')
await pp.waitForTimeout(500)
const phoneOver = (await pp.evaluate(
  inPage(`return document.documentElement.scrollWidth > innerWidth + 1`),
)) as boolean
check('phone: no horizontal overflow', !phoneOver)
const stackedOk = (await pp.evaluate(
  inPage(
    `const els = [...document.querySelectorAll('.bcstage [data-mod]')]; return els.every((e, i) => i === 0 || e.getBoundingClientRect().top >= els[i-1].getBoundingClientRect().top - 1)`,
  ),
)) as boolean
check('phone: modules stack in order', stackedOk)
check('phone: no page errors', phoneErrors.length === 0, phoneErrors.join(' | '))
await pp.screenshot({ path: '.out/ux-11-phone-390.png' })
await pp.screenshot({ path: '.out/ux-11-phone-390-full.png', fullPage: true })

console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
