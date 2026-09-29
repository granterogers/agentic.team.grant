/**
 * How much of the project map can you actually SEE (#278)?
 *
 *   npm run mapview            # desktop
 *   PHONE=1 npm run mapview    # a real touch phone
 *
 * `npm run probe` answers "how big is this box" and `npm run space` answers
 * "which box is spending the room". Neither can answer the question #278 is
 * about, which is how many of the map's cards are inside the viewport at the
 * moment it opens, and whether the controls are sitting on top of them.
 *
 * Every number #278 quotes was assembled by hand from several probe runs. This
 * makes the same reading repeatable, so the fix can be measured against the
 * defect rather than against a memory of it.
 *
 * It reports and fails nothing, like `space` and `probe`.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4613
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
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

const phone = process.env.PHONE === '1'
const browser = await chromium.launch()
const ctx = await browser.newContext(
  phone
    ? {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' +
          ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      }
    : { viewport: { width: 1440, height: 900 } },
)
const page = await ctx.newPage()
page.on('pageerror', (e) => {
  console.error(`THREW: ${e.message}`)
})
await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('.project[data-open="legacy-coaching-course"]').click()
await page.waitForTimeout(900)
/*
  The tab has to be clicked, exactly as `probe.ts` does it.

  The first run of this tool reported port 350x520 and ZERO cards, which reads
  as a map with nothing on it — and `probe` had found twenty-four a minute
  earlier. Opening a project does not land on the map; `TAB=overview` is how
  probe gets there and leaving it out measured a screen the map is not on.
*/
await page.locator('[data-tab="overview"]').click()
await page.waitForTimeout(900)

/*
  A phone opens the Overview on the PANELS since #278, so the map has to be
  asked for. This measure exists to say how the map behaves, not whether it is
  the default — `verify:map` asserts the default, and a measure that silently
  reported the panels' geometry as the map's would be the wrong-payload trap
  this repository has paid for three times.
*/
if ((await page.locator('.planeport').count()) === 0) {
  await page.locator('[data-overview="map"]').first().click({ force: true })
  await page.waitForSelector('.planeport', { timeout: 20_000 })
  await page.waitForTimeout(900)
}

/*
  Passed as a STRING for the reason `probe.ts` gives: this project has no `dom`
  lib, so a closure naming `document` cannot typecheck even though it only ever
  runs in the browser.

  "Visible" is the INTERSECTION of the card with the port, not the card's own
  rect. A clipped element keeps its rect and loses its pixels — CLAUDE.md
  records that costing a drag test an afternoon — so counting rects would
  report every one of the twenty-four as on screen.
*/
const READ = `(() => {
  const port = document.querySelector('.planeport')
  if (port === null) return { error: 'no .planeport on this screen' }
  const pr = port.getBoundingClientRect()
  const field = document.querySelector('[data-field]')
  const cards = [...document.querySelectorAll('.mapcard')]

  const overlap = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0 && h > 0 ? w * h : 0
  }

  const seen = cards.filter((c) => {
    const r = c.getBoundingClientRect()
    // Half of it, so a two-pixel sliver is not "visible".
    return overlap(r, pr) >= r.width * r.height * 0.5
  })

  /*
    Discount the prototype strip, exactly as npm run space does (#188).

    The 81px bar saying "showing invented projects" renders only WITHOUT a
    token, so it is harness furniture Grant never sees — and it pushes
    everything below it down by its own height. Measuring the fold without
    subtracting it reported the zoom controls as 96px off screen when the real
    figure is 18, which would have over-corrected the fix by nearly 80px.

    Subtract the height rather than move the measure, which is the correction
    space.ts already records.
  */
  const strip = document.querySelector('.mockbar')
  const stripH = strip === null ? 0 : Math.round(strip.getBoundingClientRect().height)

  const ctl = document.querySelector('.planectl')
  const cr = ctl === null ? null : ctl.getBoundingClientRect()
  const under = cr === null ? [] : cards.filter((c) => overlap(c.getBoundingClientRect(), cr) > 0)

  const cs = field === null ? null : getComputedStyle(field)
  return {
    port: Math.round(pr.width) + 'x' + Math.round(pr.height),
    field: field === null ? '-' : field.offsetWidth + 'x' + field.offsetHeight,
    k: cs === null ? '-' : cs.getPropertyValue('--pk').trim(),
    pan: cs === null ? '-' : cs.getPropertyValue('--px').trim() + ',' + cs.getPropertyValue('--py').trim(),
    cards: cards.length,
    visible: seen.length,
    controls: cr === null ? 'none' : Math.round(cr.width) + 'x' + Math.round(cr.height)
      + ' at ' + Math.round(cr.x) + ',' + Math.round(cr.y),
    controlsInsidePort: cr === null ? false : overlap(cr, pr) > 0,
    cardsUnderControls: under.length,
    /*
      Is any of this actually ON SCREEN?

      A full-page screenshot shows the whole port however far it runs past the
      fold, which is how a control below the bottom of the phone appears in a
      capture and reads as fine. Only the window's own inner height knows.

      No backticks in this comment: it lives inside a template literal, and one
      here ends the string. CLAUDE.md records that five times and it cost this
      file one run.
    */
    viewport: window.innerWidth + 'x' + window.innerHeight,
    strip: stripH,
    portBelowFold: Math.max(0, Math.round(pr.bottom - stripH - window.innerHeight)),
    controlsBelowFold:
      cr === null ? 0 : Math.max(0, Math.round(cr.bottom - stripH - window.innerHeight)),
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
  }
})()`

const r = (await page.evaluate(READ)) as Record<string, unknown>

/*
  Then DRAG it, because "the plane is pannable" is the answer #278 gets to
  "you can only see four of them" — and an affordance naming a gesture the
  device has switched off is a thing this repository has shipped before.

  A real pointer drag across the port, not a synthetic scroll: `touch-action:
  none` and `setPointerCapture` are what make the handler work, and neither is
  exercised by anything that does not move a pointer.
*/
const box = (await page.locator('.planeport').boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }

/*
  Start on EMPTY plane, which the handler requires and the first draft of this
  tool did not.

  `pointerdown` returns early on `.mapcard`, `.planectl` and `.mapaside` —
  correctly, because dragging a card moves the card. A drag begun on one of
  those moves nothing, and the first run of this tool reported exactly that
  and called the map unreachable. Ask the page which point is free rather than
  guessing a corner.
*/
const FREE = `(() => {
  const port = document.querySelector('.planeport')
  const r = port.getBoundingClientRect()
  for (let dy = 24; dy < r.height - 24; dy += 16) {
    for (let dx = 24; dx < r.width - 24; dx += 16) {
      const el = document.elementFromPoint(r.left + dx, r.top + dy)
      if (el !== null && el.closest('.mapcard, .planectl, .mapaside') === null) {
        return { x: r.left + dx, y: r.top + dy, on: el.className || el.tagName }
      }
    }
  }
  return null
})()`
const start = (await page.evaluate(FREE)) as { x: number; y: number; on: string } | null
if (start === null) {
  console.log('\n  no free pixel in the port to start a drag from — every point is a card')
} else {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  /*
    A BIG drag, not a nudge.

    The first version dragged to a fixed corner, and the free point it started
    from was already near that corner — six pixels of travel, which proved the
    handler fires and nothing about whether the rest of the map is reachable.
    Pull the field a port's width left and half a port up, which is the gesture
    somebody actually makes when four of twenty-four cards are showing.
  */
  await page.mouse.move(start.x - box.width * 0.8, start.y - box.height * 0.5, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}
const after = (await page.evaluate(READ)) as Record<string, unknown>
console.log(`\nmap view — ${phone ? 'phone 390x844 (touch)' : 'desktop 1440x900'}\n`)
for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(20)} ${String(v)}`)
if (typeof r.visible === 'number' && typeof r.cards === 'number' && r.cards > 0) {
  console.log(
    `\n  ${String(r.visible)} of ${String(r.cards)} cards visible on opening` +
      ` (${String(Math.round((r.visible / r.cards) * 100))}%)`,
  )
}
if (r.cardsUnderControls !== 0) {
  console.log(`  the zoom controls sit on ${String(r.cardsUnderControls)} card(s)`)
}

/*
  WHAT THE CARDS LOSE, and where the room they lose it beside is.

  `.mapname` clamps at two lines and `.mapstate` is `white-space: nowrap` with
  the tail ellipsised, so a card can print "read 6 min…" and leave the rest of
  the sentence unreachable. A capture shows the ellipsis; it cannot say whether
  three characters were lost or thirty, and it cannot say whether the card had
  room underneath. Both are measured here, per card, because the answer decides
  whether this is a wording problem, a width problem or nothing at all.
*/
const CARDS = `(() => {
  const out = []
  for (const c of document.querySelectorAll('.mapcard')) {
    const name = c.querySelector('.mapname')
    const says = c.querySelector('.mapsays')
    const cr = c.getBoundingClientRect()
    const used = [...c.children].reduce((n, el) => {
      const r = el.getBoundingClientRect()
      return Math.max(n, r.bottom - cr.top)
    }, 0)
    out.push({
      name: name === null ? '' : name.textContent.trim().slice(0, 40),
      nameLost: name === null ? 0 : Math.max(0, name.scrollHeight - name.clientHeight),
      says: says === null ? '' : says.textContent.trim(),
      saysLost: says === null ? 0 : Math.max(0, says.scrollWidth - says.clientWidth),
      spare: Math.round(cr.height - used - 22),
    })
  }
  return out
})()`
const cards = (await page.evaluate(CARDS)) as Array<{
  name: string
  nameLost: number
  says: string
  saysLost: number
  spare: number
}>
const cutName = cards.filter((c) => c.nameLost > 0)
const cutSays = cards.filter((c) => c.saysLost > 0)
console.log(
  `\n  ${String(cutName.length)} of ${String(cards.length)} card NAMES are clipped, ` +
    `${String(cutSays.length)} state lines are cut short`,
)
for (const c of cutSays.slice(0, 6)) {
  console.log(
    `    "${c.name}" — loses ${String(c.saysLost)}px of "${c.says}", ` +
      `${String(c.spare)}px spare below`,
  )
}

console.log(
  `\n  after one drag from ${start === null ? 'nowhere free' : `${String(Math.round(start.x))},${String(Math.round(start.y))} (on ${start.on})`}` +
    ` — pan ${String(after.pan)}, ${String(after.visible)} of ${String(after.cards)} visible`,
)
if (String(after.pan) === String(r.pan)) {
  console.log('  THE DRAG MOVED NOTHING — the rest of the map is unreachable by gesture here')
}

await browser.close()
server.close()
