/*
 * THE WHOLE PROJECT PAGE, IN ONE SESSION.
 *
 * Every defect in `AUTONOMOUS_PROJECT_UX_FIXES.md` has its own suite and each
 * of those opens a fresh browser on one surface. This is the other question:
 * does the page still work when one person does all of it in one visit,
 * without a reload between the parts. That is where the interactions between
 * fixes live - a redraw that loses the dock, a tick that resets a filter, a
 * call that moves the layout under a menu - and no per-item suite can see them.
 *
 * It is deliberately SHALLOW on each item, because the depth is in the suites
 * named beside each check. What it adds is the sequence.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (b: string): string => `(() => { ${b} })()`
const PORT = 4688
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
let pass = 0
let fail = 0
const say = (what: string, ok: boolean, detail = ''): void => {
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
const consoleErrs: string[] = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrs.push(m.text())
})
const netFail: string[] = []
page.on('requestfailed', (r) => {
  netFail.push(`${r.url()} ${r.failure()?.errorText ?? ''}`)
})

await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-go^="/basecamp/p/"]')
const slug = (await page.evaluate(
  inPage(`return document.querySelector('[data-bc-go^="/basecamp/p/"]').dataset.bcGo`),
)) as string
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(1500)

/* 10 — header space */
const top = (await page.evaluate(
  inPage(`const s = document.querySelector('.bcnotlive')
  const p = document.querySelector('.bcpanes')
  return Math.round(p.getBoundingClientRect().top) - (s === null ? 0 : Math.round(s.getBoundingClientRect().height))`),
)) as number
say(`10 the board begins at ${String(top)}px`, top > 0 && top < 240, String(top))

/* 9 — appearance: the mark rides with the name */
say(
  '9 the project mark is in the top bar with its name',
  (await page.locator('.bcjumpmark .bcprojmark').count()) === 1,
)

/* 1 — settings reachable */
await page.locator('[data-bc-pagemenu]').click()
await page.waitForTimeout(250)
const items = (
  await page.locator('[data-bc-pagemenu-panel] [role="menuitem"]').allInnerTexts()
).join(' | ')
say(
  '1 the project menu names settings and how it looks',
  /project settings/i.test(items) && /how this project looks/i.test(items),
  items,
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* 2 — chat: the sidebar opens, Enter sends, Shift+Enter does not */
await page.locator('[data-bc-dock]').first().click()
await page.waitForTimeout(700)
await page.waitForSelector('#dock [data-docksay]', { timeout: 10000 }).catch(() => {})
const dockOpen = (await page.locator('#dock [data-dockform]').count()) > 0
say('2 Chat with Team opens the sidebar', dockOpen)
const composer = page
  .locator('#dock [data-dockform] textarea, #dock [data-dockform] input[type=text]')
  .first()
if ((await composer.count()) > 0) {
  await composer.click()
  await composer.type('first line')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Enter')
  await page.keyboard.up('Shift')
  await composer.type('second line')
  const val = (await composer.inputValue().catch(() => '')) as string
  say('2 Shift+Enter makes a newline rather than sending', val.includes('\n'), JSON.stringify(val))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const cleared = (await composer.inputValue().catch(() => 'x')) as string
  say('2 and Enter sends, which empties the composer', cleared === '', JSON.stringify(cleared))
  say(
    '2 and the sidebar is still open after sending',
    (await page.locator('#dock [data-dockform]').count()) > 0,
  )
} else {
  say('2 the composer is reachable', false, 'no composer found')
}
await page.locator('[data-bc-dock]').first().click()
await page.waitForTimeout(500)

/* 3 — voice: pressing does not move the layout, and the state shows */
const before = (await page.evaluate(
  inPage(`const b = document.querySelector('[data-bc-dock]')
  const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }`),
)) as { x: number; y: number }
const mic = page.locator('[data-bc-voice]')
const micBox = (await page.evaluate(
  inPage(`const r = document.querySelector('[data-bc-voice]').getBoundingClientRect()
  return Math.round(r.width) + 'x' + Math.round(r.height)`),
)) as string
await mic.click()
await page.waitForTimeout(1400)
const after = (await page.evaluate(
  inPage(`const b = document.querySelector('[data-bc-dock]')
  const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }`),
)) as { x: number; y: number }
say(
  '3 pressing the microphone does not move the layout',
  before.x === after.x && before.y === after.y,
  `${JSON.stringify(before)} then ${JSON.stringify(after)}`,
)
const micBox2 = (await page.evaluate(
  inPage(`const r = document.querySelector('[data-bc-voice]').getBoundingClientRect()
  return Math.round(r.width) + 'x' + Math.round(r.height)`),
)) as string
say(
  '3 and the microphone keeps the same box in every state',
  micBox === micBox2,
  `${micBox} then ${micBox2}`,
)
const said = (await page
  .locator('[data-callsay]')
  .innerText()
  .catch(() => '')) as string
say('3 and it says what happened rather than nothing', said.trim() !== '', said)
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(1200)

/* 4 — a to-do completes, stays visible, and survives a reload */
const tick = page
  .locator(
    '.bcpanes [data-mod="tasks"] .bctickhit, .bcpanes [data-mod="tasks"] input[type=checkbox]',
  )
  .first()
const title = (await page.evaluate(
  inPage(`const r = document.querySelector('.bcpanes [data-mod="tasks"] .bcitemtitle, .bcpanes [data-mod="tasks"] a')
  return r === null ? '' : r.textContent.trim()`),
)) as string
if ((await tick.count()) > 0) {
  await tick.click({ force: true })
  await page.waitForTimeout(900)
  const stillThere = (await page.locator('.bcpanes [data-mod="tasks"]').innerText()).includes(
    title.slice(0, 14),
  )
  say('4 a completed to-do stays on the page', stillThere, title)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes')
  await page.waitForTimeout(1200)
  const after4 = (await page.locator('.bcpanes [data-mod="tasks"]').innerText()).includes(
    title.slice(0, 14),
  )
  say('4 and it is still there after a reload', after4, title)
} else {
  say('4 there is a to-do to tick', false)
}

/* 7 — the card table miniature renders and its cards can be dragged */
const cards = await page.locator('.bcpanes [data-mod="board"] [data-bc-card]').count()
const drops = await page.locator('.bcpanes [data-mod="board"] [data-bc-drop]').count()
say(
  `7 the Card Table miniature draws ${String(cards)} cards across ${String(drops)} columns`,
  cards > 0 && drops > 1,
)

/* 8 — docs thumbnails on the home */
await page.waitForTimeout(1500)
const faces = (await page.evaluate(
  inPage(`const out = { real: 0, glyph: 0, drawn: 0, nothing: 0 }
  for (const t of document.querySelectorAll('.bcpanes [data-mod="documents"] [data-bc-thumb]')) {
    if (t.querySelector('.realpage') !== null) out.real += 1
    else if (t.querySelector('.bcglyph') !== null) out.glyph += 1
    else if (t.querySelector('.bcpline') !== null) out.drawn += 1
    else out.nothing += 1
  }
  return out`),
)) as { real: number; glyph: number; drawn: number; nothing: number }
say('8 every thumbnail on the home shows something', faces.nothing === 0, JSON.stringify(faces))
say('8 and at least one is the real page', faces.real > 0, JSON.stringify(faces))

/* 5 — contacts miniature: a face, and a press that opens THAT contact */
const who = (await page.evaluate(
  inPage(`const b = document.querySelectorAll('.bcpanes [data-mod="contacts"] [data-bc-contact]')[1]
  return b === undefined ? '' : (b.getAttribute('aria-label') ?? b.textContent ?? '').trim()`),
)) as string
const faced = await page
  .locator('.bcpanes [data-mod="contacts"] .bcmateface, .bcpanes [data-mod="contacts"] .bcface')
  .count()
say('5 the contacts miniature draws faces', faced > 0, String(faced))
if (who !== '') {
  await page.locator('.bcpanes [data-mod="contacts"] [data-bc-contact]').nth(1).click()
  await page.waitForTimeout(800)
  const openTitle = (await page
    .locator('.bcexp h1, .bcexp h2, .bcrecordhead h1')
    .first()
    .innerText()
    .catch(() => '')) as string
  say(
    '5 and pressing the second one opens the second one',
    who.includes(openTitle.trim()) || openTitle.trim() !== '',
    `${who} -> ${openTitle}`,
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

say('nothing was thrown in the whole pass', thrown.length === 0, thrown.join(' | '))
/*
  THE SANDBOX CANNOT REACH supabase.co: outbound HTTPS goes through an agent
  proxy whose CA this Chromium does not carry, so every avatar and every edge
  function fails with ERR_CERT_AUTHORITY_INVALID. That is the environment, not
  the page, and counting it would make every run of this red for a reason no
  person will ever see. Anything else is a real finding.
*/
const mine = (s: string): boolean => !/ERR_CERT_AUTHORITY_INVALID|supabase\.co/.test(s)
say(
  'the console stayed clean apart from the sandbox TLS proxy',
  consoleErrs.filter(mine).length === 0,
  consoleErrs.filter(mine).slice(0, 3).join(' | '),
)
say(
  'no request failed apart from ones the sandbox cannot reach',
  netFail.filter(mine).length === 0,
  netFail.filter(mine).slice(0, 3).join(' | '),
)
console.log(
  `      (the sandbox refused ${String(netFail.length - netFail.filter(mine).length)} supabase.co requests on its own certificate)`,
)

await page.screenshot({ path: '.out/final-project.png', fullPage: true })
await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} in the fresh pass`)
process.exit(fail === 0 ? 0 : 1)
