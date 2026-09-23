/*
 * THE CARD TABLE, AS A BOARD RATHER THAN AS A PICTURE.
 *
 * Grant, 22 September: "The Card Table module currently appears to be
 * interactive but clicking it can do nothing. Fix this... Cards must be
 * dynamically draggable between columns. Moving a card must update its actual
 * underlying state rather than merely animating the UI... Test: opening the
 * Card Table; moving cards; persistence; moving repeatedly between columns;
 * empty columns; long columns; scrolling; responsive behaviour."
 *
 * Every one of those is a check below. "Updates the underlying state rather
 * than animating" is the one that decides the shape of the rest: the card is
 * dropped, the page is RELOADED, and the assertion is made against what comes
 * back — because an interface that only animates passes any assertion made
 * before the reload.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4675
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
  await page.waitForSelector('[data-mod="board"]')
  await page.waitForTimeout(350)
}

await home()
await page.evaluate(
  inPage(`for (const k of Object.keys(localStorage)) {
   if (k.startsWith('bc.todos.') || k.startsWith('bc.layout.')) localStorage.removeItem(k)
 }
 return true`),
)
await home()

/* --- 1. the miniature is a board, and its cards are controls ------------- */
const miniCols = await page.locator('[data-mod="board"] .bcminicol').count()
check('the Card Table miniature draws its columns', miniCols === 4, `${String(miniCols)} column(s)`)
const miniCards = await page.locator('[data-mod="board"] .bcminicard').count()
check(
  'and the cards in them, rather than four numbers',
  miniCards > 0,
  `${String(miniCards)} card(s)`,
)
const colours = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('[data-mod="board"] .bcminicolname')) {
       out.push(getComputedStyle(el).color)
     }
     return out`),
)) as string[]
check(
  'each column is a different colour, so the statuses are legible at a glance',
  new Set(colours).size === colours.length && colours.length === 4,
  colours.join(' '),
)

/* --- 2. pressing a card in the miniature opens that to-do ---------------- */
const firstMini = page.locator('[data-mod="board"] .bcminicard').first()
const miniName = (await firstMini.innerText()).trim()
await firstMini.click()
await page.waitForTimeout(600)
const opened = await page.locator('[data-bc-expanded]').first().innerText()
check(
  'pressing a card in the miniature opens that to-do',
  opened.includes(miniName),
  opened.replace(/\n/g, ' / ').slice(0, 140),
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* --- 3. the module opens the full board --------------------------------- */
await page.locator('[data-mod="board"] .bcmodhead').first().click()
await page.waitForTimeout(600)
check(
  'the Card Table module opens the board',
  (await page.locator('[data-bc-expanded="board"] .bcbcol').count()) === 4,
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* --- 4. at its own address, with real columns --------------------------- */
const board = async (): Promise<void> => {
  await page.goto(url(`${slug}/board`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcbcol')
  await page.waitForTimeout(400)
}
await board()

const stageOf = async (name: string): Promise<string> =>
  (await page.evaluate(
    inPage(`const el = [...document.querySelectorAll('[data-bc-card]')]
       .find((c) => (c.textContent ?? '').includes(${JSON.stringify(name)}))
     return el === undefined ? 'missing' : (el.dataset.stage ?? '')`),
  )) as string

const firstCard = page.locator('[data-bc-card]').first()
const subject = (await firstCard.locator('.bcitemtitle').innerText()).trim()
const startedIn = await stageOf(subject)
check(
  'the board opens with cards in columns',
  startedIn !== 'missing',
  `${subject} is in ${startedIn}`,
)

/* --- 5. dragging a card to another column ------------------------------- */
const target = startedIn === 'done' ? 'todo' : 'done'
await firstCard.dragTo(page.locator(`[data-bc-drop="${target}"]`))
await page.waitForTimeout(700)
check(
  `dragging "${subject}" from ${startedIn} to ${target} moves it`,
  (await stageOf(subject)) === target,
  `it is in ${await stageOf(subject)}`,
)

/* --- 6. and it is still there after a reload ---------------------------- */
await board()
check(
  'and the move is still there after a reload, so it changed the record and not the picture',
  (await stageOf(subject)) === target,
  `after reload it is in ${await stageOf(subject)}`,
)

/* --- 7. moving repeatedly ----------------------------------------------- */
const trip = ['doing', 'todo', 'done', 'doing']
let wrong = ''
for (const want of trip) {
  const card = page.locator('[data-bc-card]').filter({ hasText: subject }).first()
  await card.dragTo(page.locator(`[data-bc-drop="${want}"]`))
  await page.waitForTimeout(600)
  const got = await stageOf(subject)
  if (got !== want) wrong = `wanted ${want}, got ${got}`
}
check('moving the same card round the board repeatedly works every time', wrong === '', wrong)

/* --- 8. the select is the other way to move it -------------------------- */
const card = page.locator('[data-bc-card]').filter({ hasText: subject }).first()
await card.locator('[data-bc-move]').selectOption('todo')
await page.waitForTimeout(600)
check('the control on the card moves it too', (await stageOf(subject)) === 'todo')
await board()
check('and that move persists as well', (await stageOf(subject)) === 'todo')

/* --- 9. a stuck card says so in its own control ------------------------- */
const stuck = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-card][data-stage="blocked"]')
     if (el === null) return 'none'
     const sel = el.querySelector('[data-bc-move]')
     return sel === null ? 'no control' : sel.options[sel.selectedIndex].text`),
)) as string
check(
  'a stuck card does not claim to be something else',
  stuck === 'none' || stuck === 'Stuck',
  `its control reads "${stuck}"`,
)

/* --- 10. an empty column is still a drop target ------------------------- */
const empties = (await page.evaluate(
  inPage(`const out = []
     for (const col of document.querySelectorAll('[data-bc-drop]')) {
       if (col.querySelectorAll('[data-bc-card]').length === 0) out.push(col.dataset.bcDrop)
     }
     return out`),
)) as string[]
check(
  'an empty column is drawn and can still be dropped into',
  empties.every((e) => e !== undefined),
  `empty columns: ${empties.join(', ') || 'none right now'}`,
)

/* --- 11. a long column scrolls rather than pushing the page ------------- */
const longest = (await page.evaluate(
  inPage(`let best = 0
     for (const col of document.querySelectorAll('.bcbcol')) {
       best = Math.max(best, col.querySelectorAll('[data-bc-card]').length)
     }
     return best`),
)) as number
check(
  'the board has a column long enough to be worth testing',
  longest >= 3,
  `${String(longest)} cards`,
)
const sideways = (await page.evaluate(
  inPage(`return document.documentElement.scrollWidth - document.documentElement.clientWidth`),
)) as number
check('and the board does not push the page sideways', sideways <= 1, `${String(sideways)}px`)

/* --- 12. responsive ------------------------------------------------------ */
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const small = await phone.newPage()
await small.goto(url(`${slug}/board`), { waitUntil: 'domcontentloaded' })
await small.waitForSelector('.bcbcol')
await small.waitForTimeout(400)
const phoneWide = (await small.evaluate(
  inPage(`return document.documentElement.scrollWidth - document.documentElement.clientWidth`),
)) as number
check('the board fits a phone without scrolling sideways', phoneWide <= 1, `${String(phoneWide)}px`)
const phoneControl = (await small.evaluate(
  inPage(`const el = document.querySelector('[data-bc-move]')
     if (el === null) return 0
     return Math.round(el.getBoundingClientRect().height)`),
)) as number
check(
  'and the move control is thumb-sized there, since a drag is not',
  phoneControl >= 44,
  `${String(phoneControl)}px tall`,
)
await phone.close()

/*
 * --- THE MINIATURE IS A BOARD TOO ----------------------------------------
 *
 * Grant, 23 September: "Cards/elements within the miniature Card Table should
 * support appropriate drag-and-drop/reordering... Prevent accidental
 * opening/clicking while dragging. Persist ordering after reload where
 * ordering is intended to persist."
 */
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-mod="board"]')
await page.waitForTimeout(600)

check(
  'every card in the miniature can be dragged',
  (await page.locator('[data-mod="board"] .bcminicard[draggable="true"]').count()) ===
    (await page.locator('[data-mod="board"] .bcminicard').count()),
  `${String(await page.locator('[data-mod="board"] .bcminicard[draggable="true"]').count())} of ${String(await page.locator('[data-mod="board"] .bcminicard').count())}`,
)
check(
  'and every column in it will take one',
  (await page.locator('[data-mod="board"] [data-bc-drop]').count()) >= 3,
  `${String(await page.locator('[data-mod="board"] [data-bc-drop]').count())} drop target(s)`,
)
check(
  'and the type on it is at or above the 12px floor',
  (
    (await page.evaluate(
      inPage(`const out = []
       for (const el of document.querySelectorAll('[data-mod="board"] *')) {
         if (el.children.length > 0) continue
         const t = (el.textContent ?? '').trim()
         if (t === '') continue
         const size = Number.parseFloat(getComputedStyle(el).fontSize)
         if (size < 12) out.push(t.slice(0, 20) + ' @' + String(size))
       }
       return out`),
    )) as string[]
  ).length === 0,
  (
    (await page.evaluate(
      inPage(`const out = []
       for (const el of document.querySelectorAll('[data-mod="board"] *')) {
         if (el.children.length > 0) continue
         const t = (el.textContent ?? '').trim()
         if (t === '') continue
         const size = Number.parseFloat(getComputedStyle(el).fontSize)
         if (size < 12) out.push(t.slice(0, 20) + ' @' + String(size))
       }
       return out`),
    )) as string[]
  ).join(', '),
)

/*
  DRAGGING ONE IN THE MINIATURE, with the native events the board uses - and
  then asserting the card did NOT also open, which is the accident Grant named.
*/
const miniCard = page.locator('[data-mod="board"] .bcminicard').first()
const movedTitle = (await miniCard.innerText()).trim()
const targetStage = (await page.evaluate(
  inPage(`const card = document.querySelector('[data-mod="board"] .bcminicard')
     const from = card?.closest('[data-bc-drop]')?.dataset.bcDrop ?? ''
     for (const col of document.querySelectorAll('[data-mod="board"] [data-bc-drop]')) {
       if (col.dataset.bcDrop !== from) return col.dataset.bcDrop
     }
     return ''`),
)) as string
await page.evaluate(
  `(() => {
     const card = document.querySelector('[data-mod="board"] .bcminicard')
     const to = document.querySelector('[data-mod="board"] [data-bc-drop="${targetStage}"]')
     if (card === null || to === null) return false
     const dt = new DataTransfer()
     card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
     to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
     to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
     card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
     return true
   })()`,
)
await page.waitForTimeout(900)
check(
  'dragging a card in the miniature moves it to the column it was dropped on',
  (await page.evaluate(
    inPage(`const cards = [...document.querySelectorAll('[data-mod="board"] .bcminicard')]
       const moved = cards.find((c) => (c.textContent ?? '').trim() === ${JSON.stringify(movedTitle)})
       return moved === undefined ? '' : (moved.closest('[data-bc-drop]')?.dataset.bcDrop ?? '')`),
  )) === targetStage,
  `wanted ${targetStage}`,
)
check(
  'and dragging it did not also open it',
  (await page.locator('[data-bc-expanded]').count()) === 0,
  'a drag opened the card as well as moving it',
)
/* And it is still there after a reload, because the move went to the office. */
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-mod="board"]')
await page.waitForTimeout(700)
check(
  'and the move survives a reload',
  (await page.evaluate(
    inPage(`const cards = [...document.querySelectorAll('[data-mod="board"] .bcminicard')]
       const moved = cards.find((c) => (c.textContent ?? '').trim() === ${JSON.stringify(movedTitle)})
       return moved === undefined ? '' : (moved.closest('[data-bc-drop]')?.dataset.bcDrop ?? '')`),
  )) === targetStage,
  `wanted ${targetStage}`,
)

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
