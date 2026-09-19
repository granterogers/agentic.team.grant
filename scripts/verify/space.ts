/**
 * Where the pixels actually go.
 *
 * Issue #85 asks for *"less decoration, less clutter"* and says, twice,
 * measure rather than squint. `npm run probe` prints one box at a time, which
 * is right when you already suspect an element; #85 is the opposite shape —
 * the question is which of forty boxes is spending the room, and reading the
 * stylesheet is how you convince yourself it is fine twice in a row.
 *
 * So this walks the real page and reports the ratios that decide the answer:
 *
 *   - how much of a panel is its header, per panel, on every tab;
 *   - whether the #108 fade is actually ON, per panel — the classes are
 *     toggled by `markPanelScroll`, and a fade whose class never lands looks
 *     identical to a fade that was never written;
 *   - the tallest run of empty page below the last content, and the empty run
 *     in the rail, which is what makes a screen feel sparse and cramped at the
 *     same time.
 *
 * Reporting only. It fails nothing — #85 is a critique pass, and a threshold
 * invented here would be a number nobody agreed to.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4614
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

/*
  Passed as a STRING for the same reason probe.ts does it: this project's
  tsconfig has no `dom` lib, so a closure touching `document` cannot typecheck
  even though it only ever runs in the browser.
*/
const PANELS = `(() => {
  const out = []
  for (const panel of document.querySelectorAll('.panel')) {
    const head = panel.querySelector(':scope > header')
    const wrap = panel.querySelector(':scope > .pbodywrap')
    if (head === null || wrap === null) continue
    const pr = panel.getBoundingClientRect()
    const hr = head.getBoundingClientRect()
    out.push({
      name: (head.textContent || '').trim().split('\\n')[0].slice(0, 28),
      panel: Math.round(pr.height),
      header: Math.round(hr.height),
      share: Math.round((hr.height / Math.max(1, pr.height)) * 100),
      below: Math.round(wrap.scrollHeight - wrap.clientHeight - wrap.scrollTop),
      /*
        The OTHER direction, added with #267. A panel is a resizable widget
        whose height is a stored spec, not its content - so it can be short of
        room (below, above) or holding a great deal of nothing, and only the
        second explains a board that reads as sparse. The home board's Tasks
        panel is 381px of body around 54px of "Reading what is open..." with
        no token, which is the question #267 was filed to answer in pixels
        rather than off a PNG.
      */
      spare: (() => {
        /*
          scrollHeight is never LESS than clientHeight, so it cannot answer
          this: a 381px box holding 54px of content reports scrollHeight 381
          and the subtraction is always zero. The first draft of this line did
          exactly that and printed nothing on every panel in the product,
          which is the found-nothing check that cannot report anything.
          Measure the deepest painted child instead, as EMPTY does one level
          up, and the Tasks panel came back 327.
        */
        let low = wrap.getBoundingClientRect().top
        for (const el of wrap.querySelectorAll('*')) {
          const r = el.getBoundingClientRect()
          if (r.height === 0 || r.width === 0) continue
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.opacity === '0') continue
          if (r.bottom > low) low = r.bottom
        }
        return Math.max(0, Math.round(wrap.getBoundingClientRect().bottom - low))
      })(),
      clipped: wrap.scrollHeight - wrap.clientHeight > 4,
      more: panel.classList.contains('more'),
      above: panel.classList.contains('above'),
      fade: getComputedStyle(panel, '::after').opacity,
    })
  }
  return out
})()`

const EMPTY = `(() => {
  // The lowest painted pixel inside a container, ignoring the container's own
  // box. A container that is 900 tall whose deepest child ends at 500 is 400
  // of nothing, however the padding is written.
  const deepest = (root) => {
    let low = root.getBoundingClientRect().top
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.width === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      if (r.bottom > low) low = r.bottom
    }
    return low
  }
  const measure = (sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { sel, height: Math.round(r.height), used: Math.round(deepest(el) - r.top),
             empty: Math.round(r.bottom - deepest(el)) }
  }
  return [measure('.rail'), measure('.main'), measure('.tabbody')].filter((x) => x !== null)
})()`

/*
  Report every panel on whatever board is currently on screen.

  Factored out for #267. The home board has panels too - #219 made it a board
  and #220 made those panels collapsible, resizable widgets - and this walked
  none of them, so the one screen that opens every session was the one screen
  the space audit was silent about.

  Running it found a second, larger silence in the same run: the project
  Overview reported no panels either, because #25 made that tab a MAP with the
  board behind a Map/Panels toggle. So the audit had quietly stopped seeing
  every panel in the product while continuing to print three container rows
  and look healthy. Same shape as verify:arrangement breaking on the same
  change - when a change moves what a screen opens on, the audits pointed at
  the displaced screen go silent rather than red.
*/
const reportPanels = async (page: import('playwright').Page): Promise<number> => {
  const panels = (await page.evaluate(PANELS)) as {
    name: string
    panel: number
    header: number
    share: number
    below: number
    spare: number
    clipped: boolean
    more: boolean
    above: boolean
    fade: string
  }[]
  for (const p of panels) {
    const says = p.clipped ? (p.more ? `fade on (opacity ${p.fade})` : 'CLIPPED, NO FADE') : '—'
    const room = p.spare > 40 ? ` · ${String(p.spare)}px spare` : ''
    console.log(
      `  panel ${p.name.padEnd(28)} ${String(p.panel).padStart(4)}px · header ${String(p.header).padStart(3)}px (${String(p.share).padStart(2)}%) · ${String(p.below).padStart(4)}px below${room} · ${says}`,
    )
  }
  return panels.length
}

/*
  A board with no panels on it is the shape of both silences above, so say so
  rather than printing nothing. Reporting only, like the rest of this file -
  a board can legitimately be empty if Grant has removed every panel - but a
  line naming the screen is what turns "the audit found nothing" into "the
  audit looked and there was nothing", which #267 exists because nobody could
  tell apart.
*/
const sawNoPanels = (where: string): void => {
  console.log(`  (no panels on ${where} — the board is empty, or the audit cannot reach it)`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => {
  console.error(`THREW: ${e.message}`)
})
await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

/*
  The home board's two lazy reads, before measuring it.

  `needTasks` and `needLately` fire on arrival, so a 700ms pause measures the
  Tasks and Recent activity panels while they still say "Reading what is
  open…". This reported **329px spare on the Tasks panel** — a real number
  about one line of placeholder text, and it was one step from being written up
  as an emptiness defect on the front door.

  The same correction the capture harness needed, and the same rule: wait for
  what the page KNOWS it has, never for a clock. Tolerant of never arriving,
  because the sandbox has no server and a measurement of the settled empty
  state is still worth printing — it is simply a different fact, and the line
  below says which was measured.
*/
const settled = await page
  .waitForFunction(
    `(() => {
      const w = window.__shots
      if (!w || !w.latest) return false
      // Settled means the board is no longer CLAIMING to be reading.
      // Asking whether the store is full cannot work on the prototype path,
      // where nothing fetches and the store stays null for ever - that
      // predicate spent its whole timeout on every single run. The page's own
      // sentence is the honest signal, and it is shown now only while a read
      // is genuinely out.
      if (document.body.innerText.includes('Reading what is open')) return false
      return true
    })()`,
    { timeout: 14_000 },
  )
  .then(() => true)
  .catch(() => false)
await page.waitForTimeout(250)

console.log('\n─── portfolio ───')
console.log(
  settled
    ? '  (the lazy panels have settled)'
    : '  (the lazy panels did NOT settle in 14s — these numbers describe a loading board)',
)
for (const row of (await page.evaluate(EMPTY)) as {
  sel: string
  height: number
  used: number
  empty: number
}[]) {
  console.log(
    `  ${row.sel.padEnd(10)} ${String(row.height).padStart(5)}px tall · ${String(row.used).padStart(5)}px used · ${String(row.empty).padStart(5)}px empty`,
  )
}

// #267: the home board's panels, which this never walked.
if ((await reportPanels(page)) === 0) sawNoPanels('the home board')

await page.locator('.project[data-open="legacy-coaching-course"]').click()
await page.waitForTimeout(700)

for (const tab of ['overview', 'work', 'sources', 'team']) {
  const t = page.locator(`[data-tab="${tab}"]`)
  if ((await t.count()) === 0) continue
  await t.first().click()
  await page.waitForTimeout(600)
  console.log(`\n─── ${tab} ───`)
  for (const row of (await page.evaluate(EMPTY)) as {
    sel: string
    height: number
    used: number
    empty: number
  }[]) {
    console.log(
      `  ${row.sel.padEnd(10)} ${String(row.height).padStart(5)}px tall · ${String(row.used).padStart(5)}px used · ${String(row.empty).padStart(5)}px empty`,
    )
  }
  /*
    Overview opens on the MAP since #25, so the panels board is one press
    away and this audit had stopped seeing it. Press Panels when the toggle
    is there; every other tab has no toggle and reports its panels directly.
  */
  const toPanels = page.locator('[data-overview="panels"]')
  if ((await toPanels.count()) > 0) {
    await toPanels.first().click({ force: true })
    await page.waitForTimeout(600)
  }
  if ((await reportPanels(page)) === 0) sawNoPanels(tab)
}

/*
  The phone, which is the harder half of #85.

  A desktop screen that spends 53px on a panel header is wasteful. A phone
  screen that spends its ENTIRE first viewport on chrome before one line of
  project content is a different complaint — the person has scrolled past
  everything the page says about itself and still not reached the project.

  So this asks one question and answers it in pixels: from the top of the
  scrolling page, how far down is the first piece of actual content, and what
  is stacked above it. `first` is the first element inside the board or the tab
  body that carries real words; everything above it is furniture by definition.
*/
const FURNITURE = `(() => {
  const doc = document.scrollingElement
  const top = doc.scrollTop
  const vh = window.innerHeight
  /*
    Content, whatever the Overview happens to BE (#188).

    This selector knew about panels and cards, and #25 turned the project
    Overview into a map — so on the surface this measure exists for it matched
    nothing, reported 0px, and read as "no furniture at all". A found-nothing
    result that looks like a perfect score is the worst answer a measure can
    give, and this repository has recorded that shape twice.

    The map's own surface is planeport. The list is ordered from most to least
    specific and the FIRST match wins, so a panel board still measures the way
    it did.

    No backticks in this comment: it lives inside a template literal, and that
    is the eighth time in this repository.
  */
  const first = document.querySelector(
    '.ptasks > li, .panel > .pbodywrap > *, .tabbody .card, .tabbody li, .planeport, ' +
    '.tabbody .plane')
  let y = first === null ? null : Math.round(first.getBoundingClientRect().top + top)
  /*
    Discount the prototype strip, because Grant never sees it (#188).

    The audit runs without a token, so the page correctly says it is showing
    invented projects — 81px of it, at the very top, above everything. Counting
    that as furniture measures the HARNESS rather than the product, which is
    this repository's most-recorded class of wrong answer.

    The strip's own height is subtracted rather than the measure being moved
    below it, so a run WITH a token gives the same number.

    No backticks in this comment: template literal.
  */
  const strip = document.querySelector('.mockbar')
  const stripH = strip === null ? 0 : Math.round(strip.getBoundingClientRect().height)
  if (y !== null) y = Math.max(0, y - stripH)
  /*
    DERIVED, not listed.

    This was a hand-written list of ten selectors, and a list of things you
    thought of cannot measure a screen. On the phone Overview it named three
    bands totalling 145px under a first content pixel at 466 — so it reported
    0.55 screens of furniture and accounted for a third of it, which sends
    somebody to shrink the wrong element. Everything it could not see was
    something nobody had added to the list: the nav row, the project switcher,
    the panel-arrangement controls, the Map and Panels toggle.

    So the bands are read off the page instead. Every element wholly above the
    first content pixel, tall enough to be worth a name, keeping the OUTERMOST
    of any nest — one row of the page is one entry, which is how a person sees
    it. It cannot go stale, and a band that appears because of a change nobody
    told this file about still gets named.

    No backticks in this comment: template literal.
  */
  const above = []
  if (y !== null) {
    const kept = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      const t = Math.round(r.top + top)
      if (r.height < 12) continue
      if (Math.round(r.bottom + top) > y + stripH) continue
      if (kept.some((k) => k.contains(el))) continue
      kept.push(el)
      above.push({
        /*
          classList, not a split on the className string. The split was written
          as a backslash-s and reached the page as a pattern that breaks on the
          LETTER s, so any class containing one would have been chopped into
          pieces. It had not bitten yet only because the four bands this
          measure has named so far happen not to contain one.

          No backticks in this comment: it lives inside a template literal, and
          that is the ninth time in this repository.
        */
        sel: el.tagName.toLowerCase() +
             (el.classList.length === 0
               ? ''
               : '.' + Array.from(el.classList).slice(0, 2).join('.')),
        height: Math.round(r.height),
        y: t,
      })
    }
  }
  return { viewport: vh, firstContentAt: y, found: first === null ? null : first.className,
           stripDiscounted: stripH,
           screensOfFurniture: y === null ? null : Math.round((y / vh) * 100) / 100,
           above: above.filter((a) => y === null || a.y < y) }
})()`

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
const pp = await phone.newPage()
await pp.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
await pp.waitForTimeout(700)
await pp.locator('.project[data-open="legacy-coaching-course"]').first().click()
await pp.waitForTimeout(900)

const f = (await pp.evaluate(FURNITURE)) as {
  viewport: number
  firstContentAt: number | null
  screensOfFurniture: number | null
  found: string | null
  stripDiscounted: number
  above: { sel: string; height: number; y: number }[]
}
console.log('\n─── phone, project overview ───')
console.log(`  viewport ${String(f.viewport)}px`)
console.log(
  f.found === null
    ? '  NO CONTENT FOUND — this measure matched nothing, so the number below would be a lie'
    : `  first content pixel at ${String(f.firstContentAt)}px — ${String(f.screensOfFurniture)} screens of furniture above it` +
        ` (measured to .${String(f.found).split(' ')[0]}${
          f.stripDiscounted === 0
            ? ''
            : `, less ${String(f.stripDiscounted)}px of prototype strip Grant never sees`
        })`,
)
for (const a of f.above) {
  console.log(`    ${a.sel.padEnd(22)} ${String(a.height).padStart(4)}px at y=${String(a.y)}`)
}

/*
  The chat, on a phone (#197).

  A conversation is the one screen where the composer competes with the content
  for the same pixels, and the phone is where that competition is decided.
*/
const chatTab = pp.locator('[data-tab="team"]')
if ((await chatTab.count()) > 0) {
  await chatTab.first().click()
  await pp.waitForTimeout(600)
  const sub = pp.locator('[data-sub="chat"]')
  if ((await sub.count()) > 0) {
    await sub.first().click()
    await pp.waitForTimeout(600)
  }
  /*
    MY TASKS on a phone (#259).

    The screen Grant reads a to-do list on, measured the same way as the
    project Overview: how far down the first task starts, and which bands took
    the room. A list where one item is visible is a list nobody uses on a
    phone, and this is the only instrument that can say so with a number.

    Seeded with a token, because the composer, the search and the rows are all
    drawn for a writer only — without one this would measure an empty screen
    and report a flattering figure about a page that has no tasks on it.
  */
  {
    await pp.evaluate(`try { localStorage.setItem('hq.token', 'space-audit') } catch (e) {}`)
    await pp.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
    await pp.waitForTimeout(700)
    const toTasks = pp.locator('.navitem[data-go="tasks"], [data-go="tasks"]')
    if ((await toTasks.count()) > 0) {
      await toTasks.first().click({ force: true })
      await pp.waitForTimeout(900)
    }
    /*
      Seeded, because there is no gateway behind this file server.

      Through `window.__shots` and its own `mineKey()`, never a copy of the
      key: the store is keyed by bucket, query and sort together, and a harness
      that rebuilds that rule writes to a name the renderer does not read —
      which reported rows 3 and zero rows in the DOM the last time it was done
      by hand.
    */
    await pp.evaluate(`(() => {
      const w = window.__shots
      if (!w || !w.mine) return
      const day = 86400000
      const on = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10)
      w.mine.counts = { today: 4, overdue: 1, upcoming: 4, inbox: 2,
                        unscheduled: 2, done: 11, all: 18 }
      w.mine.bucket = 'today'
      w.mine.query = ''
      w.mine.sort = 'smart'
      w.mine.lists[w.mineKey()] = [1, 2, 3, 4].map((n) => ({
        id: 'sp-' + n, title: 'A task with a realistic length of title, number ' + n,
        state: 'todo', due_on: on(n - 2), labels: n === 1 ? ['errand'] : [],
        overdue: n === 1, project: null, repeats: null, for_job: null,
        remind_at: null, parent: null, subtasks: [] }))
      w.render()
    })()`)
    await pp.waitForTimeout(500)
    const seen = (await pp.evaluate(`(() => {
      const first = document.querySelector('.ptasks > li')
      const strip = document.querySelector('.mockbar')
      const sh = strip === null ? 0 : Math.round(strip.getBoundingClientRect().height)
      if (first === null) {
        return { rows: document.querySelectorAll('.ptasks > li').length, at: null,
                 buckets: null, hidden: null }
      }
      const top = document.scrollingElement.scrollTop
      const strip2 = document.querySelector('.mybuckets')
      return {
        rows: document.querySelectorAll('.ptasks > li').length,
        /*
          And how many are ON SCREEN, which is the product question. The count
          of rows rendered says nothing about a phone: the list can hold twenty
          and show one.
        */
        visible: Array.from(document.querySelectorAll('.ptasks > li')).filter((li) => {
          const r = li.getBoundingClientRect()
          return r.top < window.innerHeight && r.bottom > 0
        }).length,
        at: Math.max(0, Math.round(first.getBoundingClientRect().top + top) - sh),
        /*
          And how many bucket tabs are off the right edge of the strip, which
          is the thing a capture cannot show: the scrollbar is hidden on a
          phone, so four of seven were reachable with nothing saying so.
        */
        buckets: strip2 === null ? null : strip2.querySelectorAll('.mybucket').length,
        hidden: strip2 === null ? null
          : Array.from(strip2.querySelectorAll('.mybucket')).filter((b) =>
              b.getBoundingClientRect().right > strip2.getBoundingClientRect().right + 1).length,
      }
    })()`)) as {
      rows: number
      visible: number
      at: number | null
      buckets: number | null
      hidden: number | null
    }
    const bands = (await pp.evaluate(FURNITURE)) as {
      firstContentAt: number | null
      above: { sel: string; height: number; y: number }[]
    }
    console.log('\n─── phone, my tasks (#259) ───')
    if (seen.at === null) {
      console.log(`  NO TASK ROWS FOUND — ${String(seen.rows)} row(s) in .ptasks`)
    } else {
      console.log(
        `  first task at ${String(seen.at)}px of 844 — ` +
          `${String(Math.round((seen.at / 844) * 100))}% of the screen spent first`,
      )
      console.log(
        `  ${String(seen.visible ?? 0)} of ${String(seen.rows)} task row(s) on screen ` +
          'without scrolling',
      )
      console.log(
        `  buckets: ${String(seen.buckets ?? 0)} drawn, ${String(seen.hidden ?? 0)} past the ` +
          'right edge of the strip (the fade is what says so)',
      )
      for (const b of bands.above) {
        console.log(`    ${b.sel.padEnd(24)} ${String(b.height).padStart(4)}px at y=${String(b.y)}`)
      }
    }
  }

  const chat = (await pp.evaluate(`(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { sel, h: Math.round(r.height), w: Math.round(r.width), y: Math.round(r.top) }
    }
    return [box('.thread'), box('.composer'), box('[data-say]'), box('.who'),
            box('.navgroup')].filter((x) => x !== null)
  })()`)) as { sel: string; h: number; w: number; y: number }[]
  console.log('\n─── phone, the chat (at the top of the page) ───')
  const vh = 844
  for (const b of chat) {
    console.log(
      `  ${b.sel.padEnd(12)} ${String(b.h).padStart(4)}px tall at y=${String(b.y).padStart(4)} · ${String(Math.round((b.h / vh) * 100)).padStart(3)}% of the viewport`,
    )
  }

  /*
    And again after scrolling, which is how it is actually used. The chat is a
    sticky column: at the top of the page it sits where the flow puts it, and
    once the project head has scrolled away it fills the screen. Measuring only
    at scrollTop 0 would report the state nobody types in.
  */
  await pp.evaluate(`document.scrollingElement.scrollTop = 2000`)
  await pp.waitForTimeout(400)
  const scrolled = (await pp.evaluate(`(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { sel, h: Math.round(r.height), y: Math.round(r.top),
               bottom: Math.round(r.bottom) }
    }
    return [box('.thread'), box('.composer'), box('[data-say]'),
            box('.navgroup')].filter((x) => x !== null)
  })()`)) as { sel: string; h: number; y: number; bottom: number }[]
  console.log('\n─── phone, the chat (scrolled, which is how it is used) ───')
  for (const b of scrolled) {
    const off = b.bottom > vh ? '  BELOW THE FOLD' : ''
    console.log(
      `  ${b.sel.padEnd(12)} ${String(b.h).padStart(4)}px · y=${String(b.y).padStart(4)} to ${String(b.bottom).padStart(4)}${off}`,
    )
  }
}

await browser.close()
await phone.close()
server.close()
