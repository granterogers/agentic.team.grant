/*
 * A PHONE, AND SOMEBODY WHO DOES NOT WANT THINGS MOVING.
 *
 * Grant, 23 September, section 17: "Break it at 390x844. Test: the project
 * home is usable; there is a touch alternative to drag; menus work; the chat
 * input works; the microphone works; the board works; dialogs work; sticky
 * controls do not cover content."
 *
 * And section 14: "Animation acceptance. Hover, press, drag, resize, menu,
 * checkbox, miniature to full, modal. Respect prefers-reduced-motion."
 *
 * TWO THINGS THAT LOOK LIKE ONE CHECK AND ARE NOT. "There is a rule inside a
 * reduced-motion media query" is a fact about a stylesheet; "nothing moves for
 * somebody who asked for nothing to move" is a fact about the page. The second
 * is asked here, by reading computed durations with the preference on, because
 * a rule can sit in the right block and be overridden by a later one - which is
 * the specific trap this stylesheet has fallen into twice.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { type Browser, chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4699
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (process.env.SUBJECT === 'source') throw new Error('asked for source')
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

const browser: Browser = await chromium.launch({ args: ['--lang=en-GB'] })
const phone = async (motion: 'no-preference' | 'reduce' = 'no-preference') =>
  browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    reducedMotion: motion,
  })

const ctx = await phone()
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()

const go = async (p: string): Promise<void> => {
  await page.goto(url(p), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain', { timeout: 8000 }).catch(() => null)
  await page.waitForTimeout(450)
}
const sideways = async (): Promise<number> =>
  (await page.evaluate(
    inPage(`return document.documentElement.scrollWidth - document.documentElement.clientWidth`),
  )) as number

/* --- 1. every surface, at 390, without sliding sideways ----------------- */
const ROUTES: [string, string][] = [
  ['the portfolio', '/basecamp/'],
  ['the project home', slug],
  ['to-dos', `${slug}/tasks`],
  ['the card table', `${slug}/board`],
  ['the schedule', `${slug}/schedule`],
  ['docs and files', `${slug}/documents`],
  ['contacts', `${slug}/contacts`],
  ['sources', `${slug}/sources`],
  ['project settings', `${slug}/settings`],
  ['your own list', '/basecamp/tasks'],
]
for (const [name, path] of ROUTES) {
  await go(path)
  check(
    `${name}: does not push the phone sideways`,
    (await sideways()) <= 1,
    `${String(await sideways())}px`,
  )
}

/* --- 2. the tray does not sit on top of the last thing on the page ------ */
await go(slug)
await page.evaluate(inPage(`window.scrollTo(0, document.body.scrollHeight)`))
await page.waitForTimeout(500)
const covered = (await page.evaluate(
  inPage(`const tray = document.querySelector('.bctray')
     if (tray === null) return { tray: false, hidden: [] }
     const t = tray.getBoundingClientRect()
     const hidden = []
     for (const el of document.querySelectorAll('.bcmain button, .bcmain a, .bcmain input')) {
       const r = el.getBoundingClientRect()
       if (r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) continue
       /* Its middle under the tray, and the tray in front of it. */
       const midY = r.top + r.height / 2
       if (midY > t.top && midY < t.bottom) {
         const at = document.elementFromPoint(r.left + r.width / 2, midY)
         if (at !== null && at.closest('.bctray') !== null) {
           hidden.push((el.textContent ?? '?').replace(/\\s+/g, ' ').trim().slice(0, 28))
         }
       }
     }
     return { tray: true, hidden }`),
)) as { tray: boolean; hidden: string[] }
check(
  'the sticky bottom bar covers nothing at the end of the page',
  covered.hidden.length === 0,
  covered.hidden.join(', '),
)

/* --- 3. a touch alternative to every drag ------------------------------- */
await go(`${slug}/board`)
const moves = await page.locator('[data-bc-move]').count()
check(
  'a card can be moved by a control as well as by dragging',
  moves > 0,
  `${String(moves)} move control(s)`,
)
const moveSize = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-move]')
     if (el === null) return 0
     const r = el.getBoundingClientRect()
     return Math.round(Math.min(r.width, r.height))`),
)) as number
check('and that control is thumb-sized', moveSize >= 44, `${String(moveSize)}px`)

await go(slug)
const arrangeByHand = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-mod] .bcmodhead')
     return el === null ? '' : getComputedStyle(el).cursor`),
)) as number | string
/*
  WHAT A PHONE CAN ACTUALLY DO TO THIS PAGE.

  This used to open the page menu and look for an Arrange entry. §13 removed
  that entry deliberately -- the board supports direct manipulation and the
  panel was explaining it in prose -- so the check went red on a correct change
  and would have sent somebody putting the menu back.

  The affordance a phone genuinely has is the cross: dragging and resizing are
  switched off at this width on purpose (one column, nothing to arrange), and
  the cross is drawn at full opacity below 1180px precisely because a touch
  device has no hover. Taking a module off then reveals the way back. That is
  the property worth asserting -- the page can be changed and the change can be
  undone -- rather than the existence of a particular control.
*/
const crosses = await page.locator('[data-bc-modoff]').count()
const crossBox = await page.locator('[data-bc-modoff]').first().boundingBox()
check(
  'where dragging is switched off on a phone, a module can still be taken off the page',
  crosses > 0 && (crossBox?.width ?? 0) >= 44 && (crossBox?.height ?? 0) >= 44,
  `header cursor is ${String(arrangeByHand)}, ${String(crosses)} cross(es), first is ${String(Math.round(crossBox?.width ?? 0))}x${String(Math.round(crossBox?.height ?? 0))}`,
)
const took = await page.locator('[data-bc-modoff]').first().getAttribute('data-bc-modoff')
await page.locator('[data-bc-modoff]').first().click()
await page.waitForTimeout(400)
check(
  'and putting it back is offered on the page itself, with no menu to find',
  (await page.locator(`[data-bc-arr-on="${String(took)}"]`).count()) > 0,
  `took off ${String(took)}`,
)
await page
  .locator(`[data-bc-arr-on="${String(took)}"]`)
  .first()
  .click()
await page.waitForTimeout(400)
check('and it comes back', (await page.locator(`[data-mod="${String(took)}"]`).count()) > 0)

/* --- 4. the things a thumb has to hit ----------------------------------- */
await go(slug)
for (const [what, sel] of [
  ['the microphone', '[data-bc-voice]'],
  ['Chat with Team', '[data-bc-dock]:visible'],
  ['the page menu', '[data-bc-pagemenu]'],
] as [string, string][]) {
  const box = await page.locator(sel).first().boundingBox()
  check(
    `${what} is thumb-sized on a phone`,
    box !== null && Math.min(box.width, box.height) >= 44,
    box === null
      ? 'not on the page'
      : `${String(Math.round(box.width))}x${String(Math.round(box.height))}`,
  )
}

/* --- 5. the chat sidebar, on a phone ------------------------------------ */
await page.locator('[data-bc-dock]:visible').first().click()
await page.waitForTimeout(600)
const chat = (await page.evaluate(
  inPage(`const d = document.getElementById('dock')
     if (d === null || d.hidden) return { open: false }
     const r = d.getBoundingClientRect()
     const box = d.querySelector('[data-docksay]')
     const b = box === null ? null : box.getBoundingClientRect()
     return {
       open: true,
       width: Math.round(r.width),
       inView: r.left >= -2 && r.right <= window.innerWidth + 2,
       composer: b === null ? null : { h: Math.round(b.height), font: Number.parseFloat(getComputedStyle(box).fontSize) },
     }`),
)) as {
  open: boolean
  width?: number
  inView?: boolean
  composer?: { h: number; font: number } | null
}
check(
  'the chat sidebar opens on a phone and fits the screen',
  chat.open && chat.inView === true,
  JSON.stringify(chat),
)
check(
  'and its box is big enough to type in, at a size iOS will not zoom',
  (chat.composer?.h ?? 0) >= 32 && (chat.composer?.font ?? 0) >= 16,
  JSON.stringify(chat.composer),
)
await page.locator('#dock [data-dock-close]').click()
await page.waitForTimeout(300)

/* --- 6. a dialog on a phone -------------------------------------------- */
await go(`${slug}/contacts`)
await page.locator('[data-bc-contact]').first().click()
await page.waitForTimeout(500)
const dialog = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-contactedit], .bcrecord, .bcsheet')
     if (el === null) return null
     const r = el.getBoundingClientRect()
     return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth }`),
)) as { w: number; left: number; right: number; vw: number } | null
check(
  'a record opens on a phone within the screen',
  dialog !== null && dialog.left >= -2 && dialog.right <= dialog.vw + 2,
  JSON.stringify(dialog),
)
const smallFields = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcmain input, .bcmain textarea, .bcmain select')) {
       const r = el.getBoundingClientRect()
       if (r.height < 4) continue
       const size = Number.parseFloat(getComputedStyle(el).fontSize)
       if (size < 16) out.push((el.getAttribute('data-bc-ctfield') ?? el.id ?? el.type) + ':' + String(size))
     }
     return out`),
)) as string[]
check(
  'every field on it is at least 16px, or iOS Safari zooms the page on focus',
  smallFields.length === 0,
  smallFields.join(', '),
)

check('nothing threw on the phone', thrown.length === 0, thrown.join(' | '))
await ctx.close()

/*
 * --- 7. SOMEBODY WHO ASKED FOR NOTHING TO MOVE ---------------------------
 *
 * Read off the page with the preference on, not off the stylesheet. Anything
 * still animating for longer than a blink is named.
 */
for (const [where, path] of [
  ['the project home', slug],
  ['to-dos', `${slug}/tasks`],
  ['the card table', `${slug}/board`],
] as [string, string][]) {
  const still = await phone('reduce')
  const sp = await still.newPage()
  await sp.goto(url(path), { waitUntil: 'domcontentloaded' })
  await sp.waitForSelector('.bcmain', { timeout: 8000 }).catch(() => null)
  await sp.waitForTimeout(700)
  const moving = (await sp.evaluate(
    inPage(`const out = []
       const secs = (v) => Math.max(...String(v).split(',').map((x) => {
         const t = x.trim()
         return t.endsWith('ms') ? Number.parseFloat(t) / 1000 : Number.parseFloat(t) || 0
       }))
       for (const el of document.querySelectorAll('.bctop *, .bcmain *, .bctray *')) {
         const cs = getComputedStyle(el)
         const a = secs(cs.animationDuration)
         const t = secs(cs.transitionDuration)
         const infinite = String(cs.animationIterationCount).includes('infinite')
         if ((a > 0.08 && (infinite || a > 0.4)) || t > 0.4) {
           out.push(String(el.className).slice(0, 34) + ' a=' + String(a) + ' t=' + String(t) + (infinite ? ' forever' : ''))
         }
       }
       return [...new Set(out)]`),
  )) as string[]
  check(
    `${where}: nothing keeps moving for somebody who asked for stillness`,
    moving.length === 0,
    moving.slice(0, 6).join('\n        '),
  )
  await still.close()
}

/*
 * --- 8. AND THE CONTROL: the same page DOES animate by default ------------
 *
 * Without this, a stylesheet that had lost every transition would score
 * perfectly on the section above.
 */
{
  const lively = await phone('no-preference')
  const lp = await lively.newPage()
  await lp.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await lp.waitForSelector('.bcmain')
  await lp.waitForTimeout(600)
  const animated = (await lp.evaluate(
    inPage(`let n = 0
       for (const el of document.querySelectorAll('.bctop *, .bcmain *, .bctray *')) {
         const cs = getComputedStyle(el)
         if (Number.parseFloat(cs.transitionDuration) > 0 || Number.parseFloat(cs.animationDuration) > 0) n += 1
       }
       return n`),
  )) as number
  check(
    'the page really does animate when nobody has asked it not to',
    animated > 10,
    `${String(animated)} element(s) carry a transition or an animation`,
  )
  await lively.close()
}

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
process.exit(fail === 0 ? 0 : 1)
