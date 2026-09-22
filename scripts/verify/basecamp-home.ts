/*
 * The project home: what is on the first screen, and what changing it does.
 *
 * Grant's §21: Docs & Files must be a first-class live pane, all five tools
 * must be understandable from the initial 1440x900 view, Docs & Files must
 * survive a narrow viewport, and he asked to see the add/remove handling.
 *
 * Every check here is a PROPERTY rather than an artefact, because this file's
 * whole subject is a composition and a composition is the thing most likely to
 * change next. "The Docs and Files pane shows at least two documents" survives
 * a redesign; "the third grid cell has class bcdocs" does not.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium, devices } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4667
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

/*
  What the home must carry, and what it must NOT.

  §21 named five, and project home v2 removed one of them: *"Remove the Chat to
  the Team module from the project homepage. Do not replace it with another
  chat module. It is completely superfluous when the sidebar already provides
  this functionality."* So chat moved from the required list to the forbidden
  one, and it is checked in both directions — a requirement that is only ever
  tested for presence cannot notice a removal being undone.
*/
const REQUIRED = ['tasks', 'board', 'documents', 'schedule']
const FORBIDDEN = ['chat', 'sources']

/* ------------------------------------------------- the desktop first view */
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
  })
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  const slug = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
  check('the portfolio offers a project to open', slug !== '')

  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes')
  await page.waitForSelector('.bcthumb .realpage', { timeout: 8000 }).catch(() => null)
  await page.waitForTimeout(300)

  const boxes = (await page.evaluate(
    inPage(`const out = {}
       for (const m of document.querySelectorAll('.bcpanes [data-mod]')) {
         const r = m.getBoundingClientRect()
         out[m.dataset.mod] = { top: Math.round(r.top), bottom: Math.round(r.bottom) }
       }
       return JSON.stringify(out)`),
  )) as string
  const where = JSON.parse(boxes) as Record<string, { top: number; bottom: number }>

  for (const id of REQUIRED) {
    const b = where[id]
    check(
      `${id} is on the home and inside the first 1440x900 view`,
      b !== undefined && b.bottom <= 900,
      b === undefined ? 'the pane is not on the home at all' : `it runs to ${String(b.bottom)}px`,
    )
  }
  for (const id of FORBIDDEN) {
    check(`${id} is NOT a module on the home (project home v2)`, where[id] === undefined)
  }

  /* --- the chrome v2 specifies, each asserted where it actually is --- */
  check(
    'the blue Chat button is on the project head',
    (await page.locator('.bcheadacts [data-bc-dock]').count()) === 1,
  )
  check(
    'a microphone sits beside it, as its own control',
    (await page.locator('.bcheadacts [data-bc-voice]').count()) === 1,
  )
  check(
    'Ask the team is gone from the top of the interface',
    (await page.locator('.bctop').innerText()).toLowerCase().includes('ask the team') === false,
    await page.locator('.bctop').innerText(),
  )
  check(
    'Change this page is gone, and a three-dot menu is there instead',
    (await page.locator('[data-bc-pagemenu]').count()) === 1 &&
      (await page.locator('.bchead').innerText()).includes('Change this page') === false,
  )
  /*
    NO TEAM IMAGERY ON THE HOME. v2: *"Do not display pictures or avatars of
    team members throughout the project homepage."* Asserted as the absence of
    the face element anywhere inside the home, which is a property rather than
    a list of the places it used to appear.
  */
  check(
    'no avatars or monograms anywhere on the project home',
    (await page.locator('.bchome .bcface').count()) === 0,
    `${String(await page.locator('.bchome .bcface').count())} still drawn`,
  )

  /*
    A PANE, NOT A CARD. The point of §21 is that Docs and Files shows the
    documents rather than a count of them or a link to them, so the check is
    that several document objects are drawn - and that at least one of them is
    a REAL rendered page rather than the placeholder drawing.
  */
  const docs = (await page.evaluate(
    inPage(`const pane = document.querySelector('[data-mod="documents"]')
       if (pane === null) return JSON.stringify({ tiles: 0, real: 0, titled: 0, links: 0 })
       return JSON.stringify({
         tiles: pane.querySelectorAll('.bcdoc').length,
         real: pane.querySelectorAll('.bcthumb .realpage').length,
         titled: [...pane.querySelectorAll('.bcdoctitle')].filter((x) => (x.textContent ?? '').trim() !== '').length,
         links: pane.querySelectorAll('a[href]').length,
       })`),
  )) as string
  const d = JSON.parse(docs) as { tiles: number; real: number; titled: number; links: number }
  check(
    'the Docs and Files pane shows several documents, not a count',
    d.tiles >= 3,
    JSON.stringify(d),
  )
  check('every document shown carries its title', d.titled === d.tiles, JSON.stringify(d))
  check(
    'at least one thumbnail is a REAL rendered page, not the drawn placeholder',
    d.real >= 1,
    `${String(d.real)} of ${String(d.tiles)} rendered — pdf.js did not paint`,
  )

  /*
    OPENS IN A NEW TAB, which is the thing §21 asks for by name.

    ASSERTED BY THE REQUEST, not by the tab's address. A PDF opened in a new
    tab in headless Chromium reports its location as ":" - the viewer that
    would normally own that tab is not there - so reading the popup's url says
    ":" however well the product works, and a check written that way fails on
    correct behaviour for ever. Twenty polls of it said ":" twenty times, which
    is the instrument being wrong rather than the page.

    What is true either way is that pressing the document made the browser go
    and fetch that file in a second tab. So: catch the popup, and catch the
    request for the file, and require both.
  */
  const wanted = (await page
    .locator('[data-mod="documents"] .bcdoc--openable')
    .first()
    .getAttribute('data-bc-doc')) as string
  const asked: string[] = []
  ctx.on('request', (r) => {
    if (r.url().includes(wanted)) asked.push(r.url())
  })
  const popup = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null)
  await page.locator('[data-mod="documents"] .bcdoc--openable').first().click()
  const opened = await popup
  for (let i = 0; i < 30 && asked.length === 0; i += 1) await page.waitForTimeout(100)
  check('pressing a document opens a new tab', opened !== null, 'no second tab was opened at all')
  check('and that tab fetches the real file', asked.length > 0, `nothing requested ${wanted}`)
  if (opened !== null) await opened.close()

  check('nothing was thrown while drawing the home', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* ------------------------------------------------ Docs and Files on a phone */
{
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    locale: 'en-GB',
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  await page.goto(url('/basecamp/p/legacy-coaching-course'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes')
  await page.waitForTimeout(500)
  const phone = (await page.evaluate(
    inPage(`const pane = document.querySelector('[data-mod="documents"]')
       if (pane === null) return JSON.stringify({ there: false })
       const r = pane.getBoundingClientRect()
       const tile = pane.querySelector('.bcthumb')
       return JSON.stringify({
         there: true,
         tiles: pane.querySelectorAll('.bcdoc').length,
         tileWidth: tile === null ? 0 : Math.round(tile.getBoundingClientRect().width),
         overflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
       })`),
  )) as string
  const ph = JSON.parse(phone) as {
    there: boolean
    tiles?: number
    tileWidth?: number
    overflow?: number
  }
  check('Docs and Files is still on the home at 390px', ph.there === true)
  check('and it still shows documents there', (ph.tiles ?? 0) >= 2, JSON.stringify(ph))
  /*
    A tile under about 120px stops reading as a document and becomes texture,
    which would make the pane present and useless - worse than absent, because
    it looks like the requirement was met.
  */
  check(
    'and its thumbnails are still big enough to recognise',
    (ph.tileWidth ?? 0) >= 120,
    `tile is ${String(ph.tileWidth)}px wide`,
  )
  check('the phone home does not scroll sideways', (ph.overflow ?? 1) === 0, JSON.stringify(ph))
  await ctx.close()
}

/* ------------------------------------- adding and removing tools (§14) ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  const page = await ctx.newPage()
  await page.goto(url('/basecamp/p/legacy-coaching-course'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes')
  await page.waitForTimeout(300)

  const mods = async (): Promise<string[]> =>
    (await page.evaluate(
      inPage(
        `return [...document.querySelectorAll('.bcpanes [data-mod]')].map((m) => m.dataset.mod)`,
      ),
    )) as string[]

  const before = await mods()

  /*
    OPEN THE PANEL, don't TOGGLE it. The arrange control is a toggle and the
    panel puts itself back after a render, so a blind second press CLOSES it -
    which is how a correct product produced "element is not visible" on the
    reset button. Ask what state it is in, the way a person does by looking.
  */
  const openArrange = async (): Promise<void> => {
    const panel = page.locator('[data-bc-arrange-panel]')
    if (await panel.isVisible()) return
    await page.locator('[data-bc-pagemenu]').first().click()
    await page.waitForTimeout(150)
    await page.locator('[data-bc-arrange]').first().click()
    await page.waitForTimeout(200)
  }
  check('the home starts with every tool on it', before.length >= 6, before.join(','))

  /*
    Arranging lives in the three-dot menu now, so it has to be opened first.
    The check timed out on a hidden control the moment v2 moved it, which is
    the audit noticing a real change rather than a defect.
  */
  await openArrange()
  /*
    THE PANEL NAMES WHAT IS OFF THE PAGE, and the board names what is on it.

    It used to list every module with Up, Down and Remove beside each. Grant,
    22 September: *"Do not substitute crude up/down controls for genuine
    spatial rearrangement."* Moving is dragging now and removing is the cross
    on the module's own header, so the panel has exactly one job left that
    dragging cannot do - putting back something that is not there to drag.
    With nothing off the page it correctly offers nothing, which is what is
    asserted first.
  */
  check(
    'with every tool on the page the panel offers nothing to put back',
    (await page.locator('[data-bc-arrange-panel] [data-bc-arr-on]').count()) === 0,
  )
  await page.keyboard.press('Escape')

  /* Removing is the cross on the module's own header now. */
  await page.locator('[data-mod="documents"]').first().hover()
  await page.waitForTimeout(150)
  await page.locator('[data-bc-modoff="documents"]').click()
  await page.waitForTimeout(300)
  const without = await mods()
  check('removing a tool takes it off the home', !without.includes('documents'), without.join(','))
  check('and leaves every other tool where it was', without.length === before.length - 1)

  /*
    THE RECORDS ARE UNTOUCHED, which is §14's hard constraint and the one that
    has to be proved rather than asserted in a comment. The tool is off the
    home; its surface still lists the same documents.
  */
  await page.goto(url('/basecamp/p/legacy-coaching-course/documents'), {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(300)
  const still = await page.locator('.bcdoc, .bcitem').count()
  check(
    'removing it from the home removed NO documents',
    still >= 3,
    `${String(still)} documents on the tool's own surface`,
  )

  await page.goto(url('/basecamp/p/legacy-coaching-course'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes')
  await page.waitForTimeout(300)
  check('and the removal survives a reload', !(await mods()).includes('documents'))

  await openArrange()
  check(
    'and the panel now offers to put it back',
    (await page.locator('[data-bc-arr-on="documents"]').count()) === 1,
  )
  await page.locator('[data-bc-arr-on="documents"]').click()
  await page.waitForTimeout(300)
  check('putting it back puts it back', (await mods()).includes('documents'))

  await openArrange()
  await page.locator('[data-bc-arr-reset]').click()
  await page.waitForTimeout(300)
  check(
    'putting it back the way it was restores the default page',
    (await mods()).length === before.length,
    `${(await mods()).join(',')} against ${before.join(',')}`,
  )
  await ctx.close()
}

await browser.close()
server.close()

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
if (fail > 0) process.exit(1)
