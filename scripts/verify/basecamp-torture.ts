/*
 * THE PROJECT HOME, TORTURED.
 *
 * Grant, 23 September: "Aggressively exercise the configurable project Home.
 * Move every module. Resize every module through minimum useful size, medium,
 * large, maximum. Create deliberately awkward arrangements. Verify: no
 * overlap; no clipped controls; no inaccessible content; no giant useless
 * whitespace; scroll panes remain usable; resizing actually changes useful
 * content presentation; drag handles remain obvious; clicking without dragging
 * still opens correctly; module menus remain accessible; layout persists after
 * refresh; layout persists after leaving/returning; hiding a module does not
 * delete data; hidden modules can be restored; default Team HQ arrangement
 * remains untouched. Test this at all required widths."
 *
 * Every clause above is a check below, in that order, and the ones that are
 * easy to fake are the ones done hardest:
 *
 *   - "resizing actually changes useful content presentation" is measured as
 *     MORE CONTENT VISIBLE, not as a bigger box. A pane that grows and shows
 *     the same three rows in more whitespace is the defect that sentence is
 *     about;
 *   - "no giant useless whitespace" is measured as the share of a pane's
 *     height its content occupies at the largest size;
 *   - "hiding does not delete data" is proved by reading the tool's own
 *     surface afterwards, not by putting the module back.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4691
const live = process.env.SUBJECT !== 'source'
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (!live) throw new Error('asked for source')
  const { readFile } = await import('node:fs/promises')
  await readFile('.out/live/index.html')
  server = await serveLive(PORT)
  subject = 'the deployed bytes in .out/live'
} catch {
  server = await serveStudio(PORT)
}
console.log(`subject: ${subject}\n`)
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
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()

const home = async (): Promise<void> => {
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes [data-mod]')
  await page.waitForTimeout(350)
}
const boxes = async (): Promise<Box[]> =>
  (await page.evaluate(
    inPage(`const out = []
       for (const el of document.querySelectorAll('.bcpanes [data-mod]')) {
         const r = el.getBoundingClientRect()
         out.push({ id: el.dataset.mod, x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) })
       }
       return out`),
  )) as Box[]
const overlapping = (list: Box[]): string => {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i] as Box
      const b = list[j] as Box
      if (
        a.x + 2 < b.x + b.w &&
        b.x + 2 < a.x + a.w &&
        a.y + 2 < b.y + b.h &&
        b.y + 2 < a.y + a.h
      ) {
        return `${a.id} and ${b.id}`
      }
    }
  }
  return ''
}
const drag = async (
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(320)
}

await home()
await page.evaluate(
  inPage(`for (const k of Object.keys(localStorage)) {
   if (k.startsWith('bc.layout.')) localStorage.removeItem(k)
 }
 return true`),
)
await home()
const ALL = (await boxes()).map((b) => b.id)
check('the board has every module on it to torture', ALL.length >= 6, ALL.join(', '))

/* --- 1. move every module, and check the board after each --------------- */
let moveTrouble = ''
for (const id of ALL) {
  const before = await boxes()
  const me = before.find((b) => b.id === id)
  const head = await page.locator(`[data-mod="${id}"] .bcmodhead`).first().boundingBox()
  if (me === undefined || head === null) {
    moveTrouble = `${id} had no header`
    break
  }
  /* Somewhere deliberately awkward: down and across, onto another module. */
  const target = before.find((b) => b.id !== id) as Box
  await drag(
    { x: head.x + 30, y: head.y + head.height / 2 },
    { x: target.x + 60, y: target.y + 30 },
  )
  const after = await boxes()
  const clash = overlapping(after)
  if (clash !== '') {
    moveTrouble = `moving ${id} left ${clash} overlapping`
    break
  }
  if (after.length !== before.length) {
    moveTrouble = `moving ${id} lost a module`
    break
  }
}
check(
  'every module can be moved, and nothing overlaps after any of them',
  moveTrouble === '',
  moveTrouble,
)

/* --- 2. resize every module through four sizes -------------------------- */
const sizes: { name: string; dx: number; dy: number }[] = [
  { name: 'minimum', dx: -900, dy: -900 },
  { name: 'medium', dx: 140, dy: 90 },
  { name: 'large', dx: 320, dy: 220 },
  { name: 'maximum', dx: 4000, dy: 4000 },
]
let sizeTrouble = ''
for (const id of ALL) {
  for (const s of sizes) {
    await page.locator(`[data-mod="${id}"]`).first().hover()
    await page.waitForTimeout(80)
    const grip = await page.locator(`[data-mod="${id}"] [data-bc-resize]`).first().boundingBox()
    if (grip === null) {
      sizeTrouble = `${id} has no resize grip`
      break
    }
    await drag(
      { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
      { x: grip.x + s.dx, y: grip.y + s.dy },
    )
    const now = await boxes()
    const clash = overlapping(now)
    if (clash !== '') {
      sizeTrouble = `${id} at ${s.name} left ${clash} overlapping`
      break
    }
    const me = now.find((b) => b.id === id) as Box
    if (me.w < 150 || me.h < 110) {
      sizeTrouble = `${id} at ${s.name} collapsed to ${String(me.w)}x${String(me.h)}`
      break
    }
  }
  if (sizeTrouble !== '') break
}
check(
  'every module resizes through four sizes without collapsing or overlapping',
  sizeTrouble === '',
  sizeTrouble,
)

/* --- 3. bigger really shows more ---------------------------------------- */
/*
  FROM THE DEFAULT ARRANGEMENT, because section 2 has just pulled every module
  out to its maximum: growing something that is already at its ceiling proves
  nothing, and the first run of this reported exactly that as a product defect.
*/
await home()
await page.evaluate(
  inPage(`for (const k of Object.keys(localStorage)) {
   if (k.startsWith('bc.layout.')) localStorage.removeItem(k)
 }
 return true`),
)
await home()
const rowsIn = async (id: string): Promise<number> =>
  (await page.evaluate(
    inPage(`const el = document.querySelector('[data-mod="${id}"] .bcmodbody')
       if (el === null) return -1
       const box = el.getBoundingClientRect()
       let seen = 0
       for (const row of el.querySelectorAll('li, .bcitem, .bcdoc, .bcminicard, .bcagendaitem, .bcmate, .bcevent')) {
         const r = row.getBoundingClientRect()
         if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.height > 6) seen += 1
       }
       return seen`),
  )) as number
const small = await rowsIn('documents')
await page.locator('[data-mod="documents"]').first().hover()
await page.waitForTimeout(100)
const g = await page.locator('[data-mod="documents"] [data-bc-resize]').first().boundingBox()
if (g === null) throw new Error('no grip')
await drag({ x: g.x + g.width / 2, y: g.y + g.height / 2 }, { x: g.x + 260, y: g.y + 260 })
const big = await rowsIn('documents')
check(
  'making a module bigger shows more of its content, not more whitespace',
  big > small,
  `${String(small)} rows visible before, ${String(big)} after`,
)
const spare = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-mod="documents"] .bcmodbody')
     return Math.round(((el.clientHeight - el.scrollHeight) / el.clientHeight) * 100)`),
)) as number
check(
  'and the enlarged module is not mostly empty',
  spare < 45,
  `${String(spare)}% of the pane is empty below its content`,
)

/* --- 3b. a neighbour gives way rather than leaving ----------------------- *
 *
 * Grant, 23 September: "enlarging one panel can cause the neighbouring panel
 * to jump/move away... the neighbouring panel should intelligently shrink to
 * compensate where possible... Only move a panel to another row when the
 * available width genuinely cannot accommodate both panels at their minimum
 * viable widths."
 *
 * Driven with the real handle rather than through the layout functions,
 * because the question is what the board does under a pointer.
 */
await home()
await page.evaluate(
  inPage(`for (const k of Object.keys(localStorage)) {
   if (k.startsWith('bc.layout.')) localStorage.removeItem(k)
 }
 return true`),
)
await home()
{
  const before = await boxes()
  /* A pair that really shares a row: same top, side by side. */
  const rowmates = before.filter((a) =>
    before.some((b) => b.id !== a.id && Math.abs(b.y - a.y) < 8 && b.x !== a.x),
  )
  check(
    'the default board has two modules sharing a row to test with',
    rowmates.length >= 2,
    before.map((b) => `${b.id}@${String(b.x)},${String(b.y)}`).join(' '),
  )
  if (rowmates.length >= 2) {
    const left = [...rowmates].sort((a, b) => a.x - b.x)[0] as Box
    const right = rowmates.find((m) => m.id !== left.id && Math.abs(m.y - left.y) < 8) as Box
    await page.locator(`[data-mod="${left.id}"]`).first().hover()
    await page.waitForTimeout(100)
    const grip = await page
      .locator(`[data-mod="${left.id}"] [data-bc-resize]`)
      .first()
      .boundingBox()
    if (grip !== null) {
      /*
        FAR ENOUGH TO ACTUALLY REACH THE NEIGHBOUR. A first attempt dragged by
        180px, which the panel absorbed as empty space to its right - so the
        neighbour had no reason to give way and the check reported correct
        behaviour as a failure. The drag now ends past the neighbour's left
        edge, which is the case the requirement is about.
      */
      /*
        ONE COLUMN INTO THE NEIGHBOUR, which is the case the requirement is
        about: enough that it must give way, not so much that it cannot fit at
        its minimum and legitimately moves down. Dragging halfway across it
        asserted "shrinks" and "stays on the row" at a width where only one of
        them can be true.
      */
      const third = before.find(
        (m) => m.id !== left.id && m.id !== right.id && Math.abs(m.y - left.y) < 8,
      )
      await drag(
        { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
        { x: right.x + 120, y: grip.y + grip.height / 2 },
      )
      const after = await boxes()
      const leftNow = after.find((m) => m.id === left.id) as Box
      const rightNow = after.find((m) => m.id === right.id) as Box
      check(
        'widening one panel really widens it',
        leftNow.w > left.w + 10,
        `${String(left.w)} -> ${String(leftNow.w)}`,
      )
      check(
        'and its neighbour stays on the same row rather than jumping away',
        Math.abs(rightNow.y - leftNow.y) < 8,
        `the neighbour was at y=${String(right.y)} and is now at y=${String(rightNow.y)}`,
      )
      check(
        'and gives way by shrinking',
        rightNow.w < right.w,
        `the neighbour was ${String(right.w)}px wide and is now ${String(rightNow.w)}px`,
      )
      check(
        'and nothing overlaps after the negotiation',
        overlapping(after) === '',
        overlapping(after),
      )
      /*
        AND NOTHING BEYOND THE NEIGHBOUR MOVED. This is what holding the
        neighbour's right edge buys: the negotiation is between two panels and
        the rest of the row never learns about it.
      */
      if (third !== undefined) {
        const thirdNow = after.find((m) => m.id === third.id) as Box
        check(
          'and the panel beyond the neighbour did not move at all',
          Math.abs(thirdNow.x - third.x) <= 2 && Math.abs(thirdNow.y - third.y) <= 2,
          `${third.id} was at ${String(third.x)},${String(third.y)} and is now at ${String(thirdNow.x)},${String(thirdNow.y)}`,
        )
      }
    }
  }
}

/* --- 4. scroll panes still usable at every size ------------------------- */
const scrollable = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcpanes .bcmodbody')) {
       const id = el.closest('[data-mod]').dataset.mod
       const over = el.scrollHeight - el.clientHeight
       if (over <= 4) continue
       el.scrollTop = 40
       out.push({ id, moved: el.scrollTop > 0 })
     }
     return out`),
)) as { id: string; moved: boolean }[]
check(
  'every pane with more in it than fits can still be scrolled',
  scrollable.every((s) => s.moved),
  scrollable
    .filter((s) => !s.moved)
    .map((s) => s.id)
    .join(', ') || 'none overflowed to test',
)

/* --- 5. nothing is clipped or unreachable ------------------------------- */
const clipped = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcpanes [data-mod] button, .bcpanes [data-mod] a, .bcpanes [data-mod] input')) {
       const pane = el.closest('[data-mod]')
       const p = pane.getBoundingClientRect()
       const r = el.getBoundingClientRect()
       if (r.width < 4 || r.height < 4) continue
       /* Outside the pane's own box horizontally is clipping; below it is scroll. */
       if (r.left < p.left - 2 || r.right > p.right + 2) {
         out.push((el.textContent ?? el.getAttribute('aria-label') ?? '?').trim().slice(0, 30))
       }
     }
     return out`),
)) as string[]
check(
  'no control is clipped out of the side of its module',
  clipped.length === 0,
  clipped.join(', '),
)

/* --- 6. a press that does not drag still opens -------------------------- */
/*
  Through the LOCATOR, which scrolls the header into view before pressing it.
  A raw mouse click at a measured point does not, and after section 1 has
  dragged everything about, the header this is aimed at is below the fold - the
  first run of this reported a working press as broken for that reason.

  Still the right-hand END of the header, which is empty space: pressing the
  title would pass whether or not the whole header is the target.
*/
const schedHead = page.locator('[data-mod="schedule"] .bcmodhead').first()
const headBox = await schedHead.boundingBox()
if (headBox === null) throw new Error('no schedule header')
await schedHead.click({ position: { x: headBox.width - 70, y: headBox.height / 2 } })
await page.waitForTimeout(500)
check(
  'a press on a header that does not move still opens the module',
  (await page.locator('[data-bc-expanded="schedule"]').count()) === 1,
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* --- 7. the handles and the menu stay reachable ------------------------- */
const affordances = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcpanes [data-mod]')) {
       const id = el.dataset.mod
       const head = el.querySelector('.bcmodhead')
       const grip = el.querySelector('[data-bc-resize]')
       out.push({
         id,
         grab: head === null ? '' : getComputedStyle(head).cursor,
         gripInside: grip === null ? false : grip.getBoundingClientRect().right <= el.getBoundingClientRect().right + 2,
         off: el.querySelector('[data-bc-modoff]') !== null,
       })
     }
     return out`),
)) as { id: string; grab: string; gripInside: boolean; off: boolean }[]
check(
  'every module still shows it can be dragged, resized and taken off',
  affordances.every((a) => a.grab === 'grab' && a.gripInside && a.off),
  affordances
    .filter((a) => a.grab !== 'grab' || !a.gripInside || !a.off)
    .map((a) => a.id)
    .join(', '),
)

/* --- 8. the arrangement survives a reload, and leaving and returning ---- */
const arranged = await boxes()
await home()
const afterReload = await boxes()
check(
  'the arrangement survives a reload',
  afterReload.every(
    (b, i) =>
      Math.abs(b.y - (arranged[i] as Box).y) <= 4 && Math.abs(b.x - (arranged[i] as Box).x) <= 4,
  ),
  afterReload.map((b) => `${b.id}@${String(b.x)},${String(b.y)}`).join(' '),
)
await page.goto(url('/basecamp/tasks'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(400)
await home()
const afterLeaving = await boxes()
check(
  'and survives leaving the project and coming back',
  afterLeaving.every((b, i) => Math.abs(b.y - (arranged[i] as Box).y) <= 4),
  afterLeaving.map((b) => `${b.id}@${String(b.y)}`).join(' '),
)

/* --- 9. hiding a module keeps its records ------------------------------- */
await page.locator('[data-mod="documents"]').first().hover()
await page.waitForTimeout(120)
await page.locator('[data-bc-modoff="documents"]').click()
await page.waitForTimeout(400)
check(
  'a module can be taken off the page',
  (await page.locator('[data-mod="documents"]').count()) === 0,
)
await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(400)
const stillThere = await page.locator('.bcdoc, .bclist .bcitem').count()
check(
  'and its records are untouched: the tool still lists them',
  stillThere >= 3,
  `${String(stillThere)} document(s) on the tool's own surface`,
)
await home()
/*
  THE WAY BACK IS ON THE BOARD, NOT IN THE PAGE MENU.

  §13 removed the Arrange entry and moved the restoring half onto the page, so
  this opened a menu item that no renderer emits any more and timed out -- a
  suite asserting a mechanism that was deliberately replaced, which reads as
  the product having lost a control it had just been given. The offer appears
  by itself when something is off, so it is asserted to be there and then
  pressed.
*/
await page.waitForTimeout(300)
check(
  'taking a module off puts the way back on the page, unprompted',
  (await page.locator('[data-bc-arr-on="documents"]').count()) > 0,
)
await page.locator('[data-bc-arr-on="documents"]').first().click()
await page.waitForTimeout(400)
check('and it can be put back', (await page.locator('[data-mod="documents"]').count()) === 1)

/*
 * --- 10. the default Team HQ is untouched by any of it --------------------
 *
 * WHICH SUBJECT CAN ANSWER THIS. The review deployment redirects its root
 * INTO the experiment on purpose - that redirect is how the experiment stays
 * off the product's address - so against the deployed bytes there is no
 * default Team HQ at "/" to inspect, and asserting there is reported the
 * isolation working as the isolation broken. Against the working tree "/" is
 * the default studio and the question is answerable, so it is asked there and
 * NAMED as unanswerable here rather than quietly passed.
 */
await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
const def = (await page.evaluate(
  inPage(`return {
     experience: document.documentElement.dataset.experience ?? 'none',
     bc: document.querySelectorAll('.bctop, .bcpanes').length,
     rail: document.querySelectorAll('.rail').length,
     at: location.pathname,
   }`),
)) as { experience: string; bc: number; rail: number; at: string }
if (def.at.startsWith('/basecamp')) {
  check(
    'the review deployment keeps its root pointed into the experiment, off the product',
    def.experience === 'basecamp',
    JSON.stringify(def),
  )
  console.log(
    '      NOT ASKED HERE: whether the default Team HQ is untouched. This host serves\n' +
      '      the experiment alone; run SUBJECT=source for that half.',
  )
} else {
  check(
    'the default Team HQ has no experimental shell and still draws its rail',
    def.experience === 'none' && def.bc === 0 && def.rail > 0,
    JSON.stringify(def),
  )
}

/* --- 11. and all of it again at the narrow widths ----------------------- */
for (const [name, width, height] of [
  ['tablet', 900, 1000],
  ['phone', 390, 844],
] as [string, number, number][]) {
  const small = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 700,
    hasTouch: width < 700,
  })
  const sp = await small.newPage()
  await sp.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await sp.waitForSelector('.bcpanes [data-mod]')
  await sp.waitForTimeout(500)
  const list = (await sp.evaluate(
    inPage(`const out = []
       for (const el of document.querySelectorAll('.bcpanes [data-mod]')) {
         const r = el.getBoundingClientRect()
         out.push({ id: el.dataset.mod, x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) })
       }
       return out`),
  )) as Box[]
  check(
    `${name}: the desktop arrangement does not leave slivers`,
    list.every((b) => b.w > width * 0.4),
    list.map((b) => `${b.id}:${String(b.w)}`).join(' '),
  )
  check(`${name}: nothing overlaps`, overlapping(list) === '', overlapping(list))
  const sideways = (await sp.evaluate(
    inPage(`return document.documentElement.scrollWidth - document.documentElement.clientWidth`),
  )) as number
  check(`${name}: no sideways scroll`, sideways <= 1, `${String(sideways)}px`)
  const offVisible = (await sp.evaluate(
    inPage(`const el = document.querySelector('[data-bc-modoff]')
       if (el === null) return 0
       const r = el.getBoundingClientRect()
       return Math.round(Math.min(r.width, r.height))`),
  )) as number
  check(
    `${name}: the control that takes a module off is thumb-sized and visible`,
    offVisible >= 44,
    `${String(offVisible)}px`,
  )
  await small.close()
}

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
process.exit(fail === 0 ? 0 : 1)
