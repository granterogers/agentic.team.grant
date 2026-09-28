/*
 * Press every control in the experimental experience and prove something
 * happened.
 *
 * WHY THIS DID NOT EXIST AND SHOULD HAVE. `verify:controls` walks the default
 * studio and has never visited /basecamp — so every control in this
 * experience was unaudited for the one property that matters most about a
 * control: that pressing it does something. `verify:wired` is no substitute;
 * it checks that an attribute is looked up somewhere in the source, which a
 * handler attached to the wrong node satisfies perfectly.
 *
 * "Something happened" is judged by a fingerprint taken before and after:
 * the address, the number of elements, the visible text of the main surface,
 * and whether a dialog is open. A control that changes none of those either
 * did nothing or did something invisible, and both are defects here.
 *
 * THREE THINGS THIS REPOSITORY LEARNED THE HARD WAY, applied:
 *
 *  - the actionability log is printed, never swallowed. "Element is not
 *    stable" and "intercepts pointer events" have different causes and
 *    different fixes, and a bare count cannot tell you which you have.
 *  - shell state is restored BEFORE anything reads the page, not before the
 *    press: an open sheet changes which controls are even reachable, and a
 *    repair that runs after the state has been read is one step too late.
 *  - a control that is deliberately inert is listed by name with its reason,
 *    so the allow-list is an argument rather than a silencer.
 */
import { chromium, devices } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4641
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
const inPage = (body: string): string => `(() => { ${body} })()`

const SIZES = [
  { id: 'desktop', width: 1440, height: 900, touch: false },
  { id: 'phone', width: 390, height: 844, touch: true },
] as const

const only = process.env.SIZE ?? ''
const sizes = only === '' ? SIZES : SIZES.filter((s) => s.id === only)

const findings: string[] = []
const notes: string[] = []
let pressed = 0
let unpressable = 0
let inert = 0

const browser = await chromium.launch({ args: ['--lang=en-GB'] })

for (const size of sizes) {
  const ctx = await browser.newContext({
    ...(size.touch ? devices['Pixel 7'] : {}),
    viewport: { width: size.width, height: size.height },
    isMobile: size.touch,
    hasTouch: size.touch,
    deviceScaleFactor: 1,
    locale: 'en-GB',
  })
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })

  /** Put the shell back in a known state before anything reads the page. */
  const settle = async (): Promise<void> => {
    await page.evaluate(
      inPage(`document.getElementById('bcjump')?.remove()
         document.getElementById('bcscrim')?.remove()
         const dock = document.getElementById('dock')
         if (dock !== null) { dock.hidden = true; document.body.classList.remove('docked') }
         try { localStorage.setItem('studio.dock', 'shut') } catch {}`),
    )
    await page.waitForTimeout(80)
  }

  const fingerprint = async (): Promise<string> =>
    (await page.evaluate(
      inPage(`const m = document.querySelector('.bcmain')
         /*
           ARIA STATE IS PART OF THE FINGERPRINT.

           Without it, pressing a search filter looked like a control that
           did nothing: the only change was the pressed attribute, which no
           amount of innerText can show. Eleven false findings on the first
           run, all of them the audit being too coarse rather than the
           product being wrong - validate the instrument before believing it.

           No backticks in this comment: it lives inside a template literal,
           and one would end the string. This file earned that note the same
           way the rest of the repository did.
         */
         const flags = [...document.querySelectorAll('[aria-pressed], [aria-current]')]
           .map((e) => (e.getAttribute('aria-pressed') ?? '') + (e.getAttribute('aria-current') ?? ''))
           .join('')
         return [
           location.pathname,
           String(document.querySelectorAll('*').length),
           (m === null ? '' : (m.innerText ?? '')).replace(/\\s+/g, ' ').slice(0, 4000),
           document.getElementById('bcjump') === null ? 'nosheet' : 'sheet',
           document.getElementById('dock')?.hidden === false ? 'dock' : 'nodock',
           flags,
         ].join('|')`),
    )) as string

  const open = async (p: string): Promise<void> => {
    /*
      THE BOARD FORGETS WHAT THE LAST PRESS DID TO IT.

      A module's cross takes it off the page, and the page remembers that in
      localStorage - correctly, for a person. For this sweep it meant the
      first cross pressed on the home removed that module and every control
      in it for the rest of the run, the index loop broke at the gap, and
      half the home's controls (32 of 65) were never pressed at all while the
      report said "0 findings". CLAUDE.md's shutDock / openRail trap, a fourth
      time. Cleared before every visit so each press starts from the same
      page the collector counted.
    */
    await page
      .evaluate(() => {
        for (const k of Object.keys(localStorage))
          if (k.startsWith('bc.layout.')) localStorage.removeItem(k)
      })
      .catch(() => undefined)
    await page.goto(url(p), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bcmain')
    await page.waitForTimeout(450)
    await settle()
  }

  const slug = await (async (): Promise<string> => {
    await open('/basecamp')
    return (await page.evaluate(
      inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
         return el === null ? '' : (el.dataset.bcGo ?? '')`),
    )) as string
  })()

  const routes = [
    '/basecamp',
    '/basecamp/tasks',
    '/basecamp/activity',
    '/basecamp/search',
    ...(slug === ''
      ? []
      : [
          slug,
          `${slug}/tasks`,
          `${slug}/team`,
          `${slug}/documents`,
          `${slug}/contacts`,
          `${slug}/sources`,
          `${slug}/activity`,
        ]),
  ]

  for (const route of routes) {
    await open(route)

    /*
      Collected fresh for each index, because a press re-renders and every
      node the previous collection held is gone. Indexing into a live query
      is the only thing that survives that.
    */
    /*
      VISIBLE ONLY, and `:visible` rather than a hand-rolled box check.

      The first run reported fifteen controls as "could not be pressed" and
      every one was the audit's fault: the tray's narrow-width copy of Ask
      the team (display:none on a desktop), the buttons inside the collapsed
      add-task form, and the Open buttons inside the closed disclosure that
      holds completed tasks. All three are in the DOM and none is on screen.

      A control nobody can see is not a dead control. Reporting it as one
      teaches the reader to skim the report, which is how a real finding
      gets missed.
    */
    const SEL = ':is(.bcmain, .bctop, .bctray) :is(button, a[href]):visible'
    const count = await page.locator(SEL).count()

    for (let i = 0; i < count; i += 1) {
      await open(route)
      const all = page.locator(SEL)
      if ((await all.count()) <= i) break
      const el = all.nth(i)

      const name = (
        (await el.getAttribute('aria-label')) ??
        (await el.innerText().catch(() => '')) ??
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 46)

      const before = await fingerprint()
      /*
        A CONTROL THAT OPENS A NEW TAB CHANGES NOTHING ON THIS ONE, and that
        is not a dead control - it is the commonest thing a document does.

        The fingerprint is the address, the DOM, the text and whether a sheet
        is open, all of which are properties of THIS page, so the four
        documents that open their file read as inert the moment the gallery
        tile became a real button. Watching for the popup is the property;
        an allow-list of document titles would have silenced the shape a
        genuinely dead tile has.
      */
      let openedTab = false
      const onPopup = (): void => {
        openedTab = true
      }
      page.context().on('page', onPopup)
      try {
        await el.click({ timeout: 2500 })
      } catch (e) {
        page.context().off('page', onPopup)
        unpressable += 1
        /* The log names WHICH of the five actionability checks failed. */
        const why = e instanceof Error ? e.message.split('\n').slice(0, 6).join(' / ') : String(e)
        findings.push(`${size.id} ${route} — "${name}" could not be pressed: ${why.slice(0, 220)}`)
        continue
      }
      await page.waitForTimeout(420)
      page.context().off('page', onPopup)
      pressed += 1
      const after = await fingerprint()
      /* Close anything the press opened, or the next route opens behind it. */
      for (const extra of page.context().pages()) {
        if (extra !== page) await extra.close().catch(() => undefined)
      }

      if (before === after && !openedTab) {
        /*
          A CONTROL MAY CHANGE NOTHING ONLY IF IT SAYS IT IS ALREADY THERE.

          The first run of this audit reported seven inert controls and every
          one was navigation standing at its own destination, or a filter
          already selected - correctly a no-op. Naming them in an allow-list
          would have silenced exactly the shape a genuinely dead control has,
          so the exemption is a property instead: pressing something that
          does nothing is fine when the thing is marked current or pressed,
          and is a defect when it is not.

          That also makes the earlier fix checkable. Those controls read as
          broken because the experiment marked nothing as current at all.
        */
        const marked =
          (await el.getAttribute('aria-current')) === 'page' ||
          (await el.getAttribute('aria-pressed')) === 'true' ||
          (await el.isDisabled().catch(() => false))
        if (marked) {
          inert += 1
          notes.push(`${size.id} ${route} - "${name}" is already where it points, and says so`)
        } else {
          findings.push(
            `${size.id} ${route} - "${name}" changed nothing AND is not marked current or pressed: same address, same DOM, same text, no sheet`,
          )
        }
      }
    }
  }

  /*
    A ROW ANSWERS THE POINTER ONLY IF IT CAN BE PRESSED.

    Every list row lit up on hover, including the four tools whose rows lead
    nowhere - Contacts, Documents, Sources and Activity - so a Contacts row
    promised a destination it does not have, right beside a Tasks row that
    does. A false affordance is invisible to every other check here: the
    hover state lives in the stylesheet until a mouse lands on it, so no
    static read and no ordinary capture can see it.
  */
  for (const tool of ['contacts', 'documents', 'sources', 'activity', 'tasks']) {
    if (slug === '') break
    await open(`${slug}/${tool}`)
    const rows = page.locator('.bcitem')
    if ((await rows.count()) === 0) continue
    const row = rows.first()
    /*
      MEASURED THROUGH page.evaluate WITH A SELECTOR, not through
      locator.evaluate with a stringified arrow function.

      The first version passed an arrow function AS A STRING. Playwright
      evaluates a string as an expression, so it handed back the function
      itself both times - identical before and after, so nothing ever looked
      like it answered the pointer and the check reported a defect on a row
      that works. It said the same thing with the fix sabotaged, which is how
      it was caught: a detector that reports the same result in both worlds
      is measuring neither of them.
    */
    const bgOf = async (): Promise<string> =>
      (await page.evaluate(
        inPage(
          "const e = document.querySelector('.bcitem'); return e === null ? '' : getComputedStyle(e).backgroundColor",
        ),
      )) as string
    const pressable = (await page.evaluate(
      inPage(
        "const e = document.querySelector('.bcitem'); return e !== null && e.querySelector('button, a[href], input') !== null",
      ),
    )) as boolean
    // Park the pointer away from the list first, so `before` is a resting read.
    await page.mouse.move(4, 4)
    await page.waitForTimeout(90)
    const before = await bgOf()
    await row.hover()
    await page.waitForTimeout(190)
    const after = await bgOf()
    const lit = before !== after
    if (lit && !pressable) {
      findings.push(
        `${size.id} ${slug}/${tool} - a row answers the pointer and contains nothing that can be pressed: a destination promised and not there`,
      )
    }
    if (!lit && pressable) {
      findings.push(
        `${size.id} ${slug}/${tool} - a row CAN be pressed and does not answer the pointer: §13 asks a row to communicate clickability`,
      )
    }
  }

  if (thrown.length > 0) {
    for (const t of new Set(thrown)) findings.push(`${size.id} — page error: ${t.slice(0, 200)}`)
  }
  await ctx.close()
}

await browser.close()
server.close()

for (const n of notes) console.log(`note  ${n}`)
console.log(
  `\npressed ${String(pressed)} control(s) · ${String(unpressable)} unpressable · ${String(inert)} inert by design · ${String(findings.length)} finding(s)`,
)
if (findings.length === 0) {
  if (pressed < 40) {
    /*
      A press-everything audit that pressed almost nothing reports a perfect
      score. The floor is deliberately well under the real count so a genuine
      reduction does not trip it, and well over zero so a broken collector
      does.
    */
    console.error(
      `\nONLY ${String(pressed)} CONTROLS WERE PRESSED, which is not the same as no defects.`,
    )
    process.exit(2)
  }
  console.log('every control that is not a listed exception changed something when pressed')
  process.exit(0)
}
console.log('')
for (const f of findings) console.log(`FAIL  ${f}`)
process.exit(1)
