/*
 * THE WORDS, THE MARKS AND THE TOGGLE.
 *
 * The six requirements in Grant's 22 September batch that are small enough to
 * be waved through on a reading of the diff, and therefore the six most likely
 * to be half-done: a renamed control that was renamed in one of its three
 * places, a source list with marks on the miniature and not on the surface, a
 * toggle that opens and does not close, and a sidebar that starts from nothing.
 *
 * Every one of them is in his own verification list, which is why they are
 * driven here rather than asserted from the source.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4687
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

/*
  BACK TO THE PAGE, which is now more than one press (§21).

  Dismissal steps exactly one level: a record inside a sheet closes to the
  sheet, and the sheet closes to the page. A single Escape used to do both, so
  a tidy-up like this one left a sheet open whose backdrop swallowed the next
  click -- and that reports as a timeout on a control that is perfectly fine,
  sometimes several sections later. Bounded, so a surface that will not close
  fails as a test rather than hanging.
*/
const dismissAll = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    if ((await page.locator('[data-bc-expanded]').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
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
  await page.waitForSelector('.bcpanes')
  await page.waitForTimeout(400)
}
await home()

/* --- 1. Chat with Team, and the toggle ---------------------------------- */
const chat = page.locator('[data-bc-dock]:visible').first()
check(
  'the button says Chat with Team',
  (await chat.innerText()).trim() === 'Chat with Team',
  (await chat.innerText()).trim(),
)
const dockOpen = async (): Promise<boolean> =>
  (await page.evaluate(inPage("return document.getElementById('dock')?.hidden === false"))) === true
check('the sidebar starts closed', !(await dockOpen()))
await chat.click()
await page.waitForTimeout(500)
check('pressing it opens the sidebar', await dockOpen())
check(
  'and the control says it is pressed',
  (await chat.getAttribute('aria-pressed')) === 'true',
  String(await chat.getAttribute('aria-pressed')),
)
/* --- 2. the SAME button closes it --------------------------------------- */
await chat.click()
await page.waitForTimeout(500)
check('pressing the same button again closes it', !(await dockOpen()))
check(
  'and the control says so',
  (await chat.getAttribute('aria-pressed')) === 'false',
  String(await chat.getAttribute('aria-pressed')),
)
/* Closing it by its own X must leave the button honest, too. */
await chat.click()
await page.waitForTimeout(400)
await page.locator('#dock [data-dock-close]').click()
await page.waitForTimeout(400)
await home()
check(
  'closing the sidebar by its own X leaves the button telling the truth',
  (await page.locator('[data-bc-dock]:visible').first().getAttribute('aria-pressed')) === 'false',
)

/* --- 3. the sidebar has history in it ----------------------------------- */
await page.locator('[data-bc-dock]:visible').first().click()
await page.waitForTimeout(600)
const thread = await page.locator('#dock .thread').innerText()
check(
  'the sidebar opens on the conversation so far, not on nothing',
  !/ask them something/i.test(thread) && thread.trim().length > 40,
  thread.replace(/\n/g, ' / ').slice(0, 160),
)
check(
  'and the team have faces in it, which is where faces belong',
  (await page
    .locator('#dock .msg.theirs .face, #dock .msg.theirs svg, #dock .msg.theirs .mono')
    .count()) > 0,
)
await page.locator('[data-bc-dock]:visible').first().click()
await page.waitForTimeout(300)

/* --- 4. Sources: the word, and the marks -------------------------------- */
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(200)
const menu = await page.locator('[data-bc-pagemenu-panel]').innerText()
check(
  'the three-dot menu says Sources rather than a sentence',
  /(^|\n)\s*Sources\s*($|\n)/.test(menu) && !/where the material comes from/i.test(menu),
  menu.replace(/\n/g, ' / '),
)
await page.locator('[data-bc-sources]').first().click()
await page.waitForTimeout(600)
const marks = await page.locator('[data-bc-expanded="sources"] .bcsrcmark').count()
const rows = await page.locator('[data-bc-expanded="sources"] .bcsource').count()
check(
  'every source carries a mark, not just the ones with a logo to hand',
  rows > 0 && marks === rows,
  `${String(marks)} mark(s) for ${String(rows)} source(s)`,
)
const drawn = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('[data-bc-expanded="sources"] .bcsrcmark')) {
       out.push(el.querySelector('svg') === null ? 'letter' : 'logo')
     }
     return out`),
)) as string[]
check(
  'and the ones the office has a logo for get the logo',
  drawn.includes('logo'),
  drawn.join(', '),
)
await dismissAll()

/* --- 5. Add Contact, in all three places -------------------------------- */
check(
  'the contacts miniature says Add Contact',
  (await page.locator('[data-mod="contacts"] [data-bc-contact-add]').innerText()).trim() ===
    'Add Contact',
)
await page.goto(url(`${slug}/contacts`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-contact-add]')
await page.waitForTimeout(300)
check(
  'and so does the surface',
  (await page.locator('.bcrecordhead [data-bc-contact-add]').innerText()).trim() === 'Add Contact',
)
await page.locator('.bcrecordhead [data-bc-contact-add]').click()
await page.waitForTimeout(400)
check(
  'and so does the form it opens',
  (await page.locator('.bcrecordhead h1').innerText()).trim() === 'Add Contact',
  (await page.locator('.bcrecordhead h1').innerText()).trim(),
)
const nowhere = (await page.evaluate(
  inPage(`return document.body.innerText.toLowerCase().includes('add someone')`),
)) as boolean
check('and the old wording is nowhere on the page', !nowhere)

/* --- 6. Add a Task, and the list creation that survives it -------------- */
await page.goto(url(`${slug}/tasks`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcrecordhead')
await page.waitForTimeout(400)
const head = await page.locator('.bcrecordhead').innerText()
check(
  'the To-dos surface offers Add a Task first',
  head.includes('Add a Task'),
  head.replace(/\n/g, ' / '),
)
check(
  'and still offers to make a list, which is a different thing',
  head.includes('New list'),
  head.replace(/\n/g, ' / '),
)
check(
  'and nothing on it says "Add a list" any more',
  !(await page.locator('.bcmain').innerText()).includes('Add a list'),
)

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
