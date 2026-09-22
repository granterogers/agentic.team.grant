/*
 * THE PROJECT BOARD AS A WORKSPACE: drag, resize, bounds, overlap, scroll,
 * persistence.
 *
 * Grant, 22 September: "Implement proper drag-and-drop module repositioning;
 * dynamic module resizing; sensible minimum sizes; sensible maximum sizes;
 * collision prevention; responsive rearrangement; persistence of the user's
 * chosen layout where appropriate... Do not substitute crude up/down controls
 * for genuine spatial rearrangement. Modules must not overlap or create broken
 * layouts."
 *
 * The unit tests in tests/studio/layout.test.ts prove the ARITHMETIC. Nothing
 * they assert can tell you whether a pointer gesture reaches the engine, and
 * this repository has shipped a control that looked fine and did nothing more
 * than once — so everything below is driven with a real pointer in a real
 * browser and asserted against the rendered boxes, not against the store.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4671
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

/** Every placed module's rendered box. */
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
      /*
        A two-pixel tolerance, because a sub-pixel grid track rounds and two
        boxes that share an edge would otherwise read as overlapping. Anything
        a person can SEE is far more than two pixels.
      */
      const over =
        a.x + 2 < b.x + b.w && b.x + 2 < a.x + a.w && a.y + 2 < b.y + b.h && b.y + 2 < a.y + a.h
      if (over) return `${a.id} and ${b.id}`
    }
  }
  return ''
}

/** Drag from one point to another the way a pointer does, in steps. */
const drag = async (
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 18 })
  await page.mouse.up()
  await page.waitForTimeout(350)
}

const openBoard = async (): Promise<void> => {
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes [data-mod]')
  await page.waitForTimeout(350)
}

/* Always start from a known layout: a stored one from an earlier run would
   make every assertion below about somebody else's arrangement. */
await openBoard()
await page.evaluate(
  inPage(`for (const k of Object.keys(localStorage)) {
   if (k.startsWith('bc.layout.')) localStorage.removeItem(k)
 }
 return true`),
)
await openBoard()

/* --- 1. the board is a grid of placed modules --------------------------- */
const first = await boxes()
check('the board places modules', first.length >= 4, `${String(first.length)} module(s)`)
check('nothing overlaps at rest', overlapping(first) === '', overlapping(first))

/* --- 2. the whole header expands, not just the title -------------------- */
/*
  Pressed at the RIGHT-HAND END of the header, which is empty space: a press
  on the title would pass whether or not the header is the target, which is
  the vacuous version of this check.
*/
const head = await page.locator('[data-mod="documents"] .bcmodhead').first().boundingBox()
if (head === null) throw new Error('no documents header')
await page.mouse.click(head.x + head.width - 60, head.y + head.height / 2)
await page.waitForTimeout(400)
check(
  'pressing empty space in a module header opens that module',
  (await page.locator('[data-bc-expanded="documents"]').count()) > 0,
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('and Escape closes it again', (await page.locator('[data-bc-expanded]').count()) === 0)

/* --- 3. a control inside the header does NOT expand ---------------------- */
await page.locator('[data-mod="contacts"]').first().hover()
await page.waitForTimeout(200)
await page.locator('[data-bc-modoff="contacts"]').first().click()
await page.waitForTimeout(400)
check(
  'the cross on a header takes the module off rather than opening it',
  (await page.locator('[data-bc-expanded]').count()) === 0 &&
    (await page.locator('[data-mod="contacts"]').count()) === 0,
)
const afterOff = await boxes()
check(
  'and the rest of the board closes up without overlapping',
  overlapping(afterOff) === '',
  overlapping(afterOff),
)

/* --- 4. putting it back -------------------------------------------------- */
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(200)
await page.locator('[data-bc-arrange]').first().click()
await page.waitForTimeout(300)
await page.locator('[data-bc-arr-on="contacts"]').first().click()
await page.waitForTimeout(400)
check(
  'the arrange panel puts a removed module back',
  (await page.locator('[data-mod="contacts"]').count()) > 0,
)

/* --- 5. dragging a module by its header moves it ------------------------- */
await openBoard()
const before = await boxes()
const docs = before.find((b) => b.id === 'documents') as Box
const tasks = before.find((b) => b.id === 'tasks') as Box
const headBox = await page.locator('[data-mod="documents"] .bcmodhead').first().boundingBox()
if (headBox === null) throw new Error('no header')
await drag(
  { x: headBox.x + 40, y: headBox.y + headBox.height / 2 },
  { x: tasks.x + 40, y: tasks.y + 20 },
)
const moved = await boxes()
const docsNow = moved.find((b) => b.id === 'documents') as Box
check(
  'dragging a module by its header moves it',
  Math.abs(docsNow.x - docs.x) > 40 || Math.abs(docsNow.y - docs.y) > 40,
  `was ${String(docs.x)},${String(docs.y)} — now ${String(docsNow.x)},${String(docsNow.y)}`,
)
check('and nothing overlaps after the drop', overlapping(moved) === '', overlapping(moved))

/* --- 6. the move survives a reload -------------------------------------- */
const droppedAt = { x: docsNow.x, y: docsNow.y }
await openBoard()
const reloaded = await boxes()
const docsBack = reloaded.find((b) => b.id === 'documents') as Box
check(
  'the arrangement survives a reload',
  Math.abs(docsBack.x - droppedAt.x) <= 4 && Math.abs(docsBack.y - droppedAt.y) <= 4,
  `dropped at ${String(droppedAt.x)},${String(droppedAt.y)} — reloaded at ${String(docsBack.x)},${String(docsBack.y)}`,
)

/* --- 7. resizing ---------------------------------------------------------- */
const sizeBefore = (await boxes()).find((b) => b.id === 'tasks') as Box
await page.locator('[data-mod="tasks"]').first().hover()
await page.waitForTimeout(150)
const grip = await page.locator('[data-mod="tasks"] [data-bc-resize]').first().boundingBox()
if (grip === null) throw new Error('no resize grip')
await drag(
  { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
  { x: grip.x + 240, y: grip.y + 180 },
)
const sizeAfter = (await boxes()).find((b) => b.id === 'tasks') as Box
check(
  'pulling the corner makes a module bigger',
  sizeAfter.w > sizeBefore.w + 40 && sizeAfter.h > sizeBefore.h + 40,
  `${String(sizeBefore.w)}x${String(sizeBefore.h)} -> ${String(sizeAfter.w)}x${String(sizeAfter.h)}`,
)
check(
  'and nothing overlaps after a resize',
  overlapping(await boxes()) === '',
  overlapping(await boxes()),
)

/* --- 8. the minimum holds ------------------------------------------------ */
const grip2 = await page.locator('[data-mod="tasks"] [data-bc-resize]').first().boundingBox()
if (grip2 === null) throw new Error('no resize grip')
await drag(
  { x: grip2.x + grip2.width / 2, y: grip2.y + grip2.height / 2 },
  { x: grip2.x - 900, y: grip2.y - 900 },
)
const tiny = (await boxes()).find((b) => b.id === 'tasks') as Box
check(
  'a module cannot be shrunk below a usable size',
  tiny.w >= 200 && tiny.h >= 150,
  `${String(tiny.w)}x${String(tiny.h)}`,
)

/* --- 9. the maximum holds ------------------------------------------------ */
const grip3 = await page.locator('[data-mod="tasks"] [data-bc-resize]').first().boundingBox()
if (grip3 === null) throw new Error('no resize grip')
const boardW = (await page.locator('.bcpanes').first().boundingBox())?.width ?? 0
await drag(
  { x: grip3.x + grip3.width / 2, y: grip3.y + grip3.height / 2 },
  { x: grip3.x + 4000, y: grip3.y + 4000 },
)
const huge = (await boxes()).find((b) => b.id === 'tasks') as Box
check(
  'a module cannot be dragged wider than the board',
  huge.w <= boardW + 4,
  `${String(huge.w)} against a board of ${String(Math.round(boardW))}`,
)
check(
  'and nothing overlaps at maximum size',
  overlapping(await boxes()) === '',
  overlapping(await boxes()),
)

/* --- 10. reset ----------------------------------------------------------- */
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(200)
await page.locator('[data-bc-arrange]').first().click()
await page.waitForTimeout(250)
await page.locator('[data-bc-arr-reset]').first().click()
await page.waitForTimeout(400)
await openBoard()
const reset = await boxes()
check(
  'reset puts the page back the way it was',
  reset.length === first.length && Math.abs((reset[0] as Box).y - (first[0] as Box).y) <= 4,
  `${String(reset.length)} module(s) against ${String(first.length)}`,
)

/* --- 11. a pane with more in it than fits scrolls ------------------------ */
const scrolls = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcpanes [data-mod] .bcmodbody')) {
       out.push({ id: el.closest('[data-mod]').dataset.mod, over: el.scrollHeight - el.clientHeight, style: getComputedStyle(el).overflowY })
     }
     return out`),
)) as { id: string; over: number; style: string }[]
check(
  'every pane body is an internal scroll container',
  scrolls.length > 0 && scrolls.every((s) => s.style === 'auto' || s.style === 'scroll'),
  scrolls.map((s) => `${s.id}:${s.style}`).join(' '),
)
const over = scrolls.filter((s) => s.over > 8)
check(
  'at least one pane actually has more content than it shows',
  over.length > 0,
  'if nothing overflows, the scroll treatment is untested and the item counts are too small',
)
if (over.length > 0) {
  const id = (over[0] as { id: string }).id
  const to = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-mod="${id}"] .bcmodbody')
       el.scrollTop = 120
       return el.scrollTop`),
  )) as number
  check(`and ${id} scrolls when it is scrolled`, to > 0, `scrollTop came back ${String(to)}`)
}

/* --- 12. no "one more" summary line remains ------------------------------ */
const moreWords = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcpanes .bcmore, .bcpanes .bcmodbody')) {
       const t = (el.textContent ?? '').trim()
       const m = t.match(/\\b\\d+\\s+more\\b/i)
       if (m !== null) out.push(m[0])
     }
     return out`),
)) as string[]
check(
  'no pane says "N more" in place of showing or scrolling to it',
  moreWords.length === 0,
  moreWords.join(', '),
)

/* --- 13. the workspace uses the width ------------------------------------ */
const usage = (await page.evaluate(
  inPage(`const el = document.querySelector('.bcmain')
     const r = el.getBoundingClientRect()
     return Math.round((r.width / window.innerWidth) * 100)`),
)) as number
check(
  'the workspace uses most of the viewport width, with a margin left',
  usage >= 88 && usage <= 97,
  `${String(usage)}% of a 1600px window`,
)

/* --- 14. responsive: one column on a phone, still no overlap ------------- */
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const small = await phone.newPage()
await small.goto(url(slug), { waitUntil: 'domcontentloaded' })
await small.waitForSelector('.bcpanes [data-mod]')
await small.waitForTimeout(400)
const narrow = (await small.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcpanes [data-mod]')) {
       const r = el.getBoundingClientRect()
       out.push({ id: el.dataset.mod, x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) })
     }
     return out`),
)) as Box[]
check(
  'on a phone every module is full width and stacked',
  narrow.length > 0 && narrow.every((b) => b.w > 280),
  narrow.map((b) => `${b.id}:${String(b.w)}`).join(' '),
)
check('and nothing overlaps on a phone', overlapping(narrow) === '', overlapping(narrow))
const sideways = (await small.evaluate(
  inPage(`return document.documentElement.scrollWidth - document.documentElement.clientWidth`),
)) as number
check('and the phone does not scroll sideways', sideways <= 1, `${String(sideways)}px`)
await phone.close()

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
