/**
 * The project map, driven (#25).
 *
 *   npm run verify:map
 *
 * Grant's direction asks for eight behaviours by number, and a screenshot
 * proves none of them. This presses each one in a real browser:
 *
 *   1  compact items he can move around and organise naturally
 *   2  meaningful relationships as connection lines
 *   3  adding a service leads through the real setup
 *   4  click an agent, a service, a task or a document to reach it
 *   5  details in context, without losing his place
 *   6  tasks and documents reachable without crowding the overview
 *   7  live states: working, connected, completed, needs attention
 *   8  smooth movement, zoom controls, and arrangements that persist
 *
 * ## What this checks that a capture cannot
 *
 * That the lines MOVE with the card. A map whose cards drag and whose lines
 * stay where they were is worse than one with no lines at all, and it looks
 * perfect in a screenshot taken before anybody touched it.
 *
 * And that an arrangement survives a reload, which is the only way to tell a
 * saved layout from a computed one that happens to look the same.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'

const ROOT = 'web/studio'
const PORT = 4641
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

let dragStartedAt = ''
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(`try{localStorage.setItem('hq.token','audit')}catch(e){}`)
await context.addInitScript(seedAppearance('dark'))
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))

const openProject = async (): Promise<void> => {
  await page.goto(`http://127.0.0.1:${String(PORT)}/`)
  await page.waitForSelector('.rail', { timeout: 20_000 })
  await page.waitForTimeout(2200)
  const card = page.locator('.homego[data-open], .project[data-open]').first()
  if ((await card.count()) > 0) await card.click({ force: true })
  await page.waitForTimeout(1200)
  await page.locator('[data-tab="overview"]').first().click({ force: true })
  await page.waitForTimeout(1400)
}

await openProject()

console.log('#25 — the project map, pressed rather than looked at\n')

// --- 1. it is the Overview, not a tab of its own ---------------------------
{
  const there = await page.locator('[data-plane]').count()
  check(
    'opening a project opens the map, with no extra navigation',
    there > 0 ? 'the plane is the Overview' : 'NO PLANE ON THE OVERVIEW',
    there > 0,
  )
  const cards = await page.locator('.mapcard').count()
  check('and it has cards on it', `${String(cards)} card(s)`, cards > 3)
}

// --- the type floor, at the scale he actually lands on ----------------------
{
  /*
    The one a capture cannot answer and a static check gets wrong.

    Zoom multiplies every font size on the plane, so the 12px floor has to be
    measured against the RENDERED size — the card name at 14px inside a field at
    0.8 is 11.2px on the glass, and `verify:ui` reads the CSS value and sees 14.

    Measured HERE, immediately after opening, and the position in the file is
    the assertion. A first draft ran it at the end, after the zoom checks had
    pressed fit, and reported 8.9px about a scale the person had chosen — a
    true number about the wrong moment, which is worse than no number. What
    must never be below the floor is the view the product picks on its own.
  */
  const smallest = await page.evaluate(`(() => {
    const field = document.querySelector('[data-field]')
    if (!field) return 99
    const k = Number.parseFloat(getComputedStyle(field).transform.split(',')[0].replace('matrix(', '')) || 1
    let min = 99
    for (const el of field.querySelectorAll('.mapname, .mapstate, .mapsays')) {
      const size = Number.parseFloat(getComputedStyle(el).fontSize) * k
      if (size < min) min = size
    }
    return Math.round(min * 10) / 10
  })()`)
  check(
    'no text on the map is below the 12px floor at the scale it opens on',
    `smallest rendered ${String(smallest)}px`,
    Number(smallest) >= 11.9,
  )
}

// --- 7. live states, in words as well as colour ----------------------------
{
  const states = (await page.locator('.mapcard .mapstate').allTextContents()).map(
    (t) => t.trim().split(/\s+/)[0],
  )
  const kinds = new Set(states)
  check(
    'every card says its state in words, not only in colour',
    `${String(states.length)} card(s), ${[...kinds].slice(0, 5).join(', ')}`,
    states.length > 0 && states.every((s) => (s ?? '').length > 0),
  )
  const live = await page.locator('.mapcard .mapstate.t-go, .mapcard .mapstate.t-warn').count()
  check('and at least one of them is a live state', `${String(live)} live`, live > 0)
}

// --- 2. relationships, drawn ------------------------------------------------
{
  const lines = await page.locator('.mapline').count()
  check('relationships are drawn as lines', `${String(lines)} line(s)`, lines > 0)
}

// --- 1 + 8. moving a card, and the lines moving with it ---------------------
{
  const card = page.locator('.mapcard').first()
  const id = await card.getAttribute('data-node')
  const before = await card.evaluate((el) =>
    (el as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue('--x'),
  )
  dragStartedAt = before
  const linked = page.locator(`.mapline[data-edge*="${id ?? ''}"]`).first()
  const hadLine = (await linked.count()) > 0
  const lineBefore = hadLine ? await linked.getAttribute('d') : null

  const box = await card.boundingBox()
  if (box === null) {
    check('a card can be dragged', 'THE CARD HAS NO BOX', false)
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 70, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await card.evaluate((el) =>
      (el as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue('--x'),
    )
    check(
      'a card can be dragged, and it stays where it was dropped',
      `${before || '0px'} to ${after || '0px'}`,
      before !== after,
    )
    if (hadLine) {
      const lineAfter = await linked.getAttribute('d')
      check(
        'and the lines attached to it move with it',
        lineBefore === lineAfter ? 'THE LINE DID NOT MOVE' : 'redrawn',
        lineBefore !== lineAfter,
      )
    } else {
      console.log('  --   the first card has no line attached; the moving-line check needs one')
    }
  }
}

// --- 8. the arrangement survives a reload -----------------------------------
{
  const card = page.locator('.mapcard').first()
  const id = await card.getAttribute('data-node')
  const moved = await card.evaluate((el) =>
    (el as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue('--x'),
  )
  await page.waitForTimeout(900)
  await openProject()
  const again = page.locator(`.mapcard[data-node="${id ?? ''}"]`)
  const now =
    (await again.count()) > 0
      ? await again.evaluate((el) =>
          (el as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue('--x'),
        )
      : '(gone)'
  /*
    And it must have MOVED first.

    A first draft asserted only that the position was the same after a reload.
    On a run where the drag had silently failed, the card was at its computed
    position before and after, the check went green, and it was green about a
    feature that was not working. A saved arrangement is only evidence of
    saving if it differs from the one the studio would have computed.
  */
  check(
    'the arrangement is still there after a reload',
    `${moved || '0px'} then ${now}`,
    now === moved && moved !== '' && moved !== dragStartedAt,
  )
}

// --- 5. details in context --------------------------------------------------
{
  const card = page.locator('.mapcard').nth(1)
  await card.click({ force: true })
  await page.waitForTimeout(700)
  const aside = page.locator('[data-aside]')
  check(
    'clicking a card opens its details',
    (await aside.count()) > 0 ? 'the panel is open' : 'NOTHING OPENED',
    (await aside.count()) > 0,
  )
  const planeStillThere = await page.locator('[data-plane] .mapcard').count()
  check(
    'and the map is still on screen behind it, so his place is kept',
    `${String(planeStillThere)} card(s) still drawn`,
    planeStillThere > 3,
  )
  const doors = await page.locator('[data-aside] [data-map-go]').count()
  check('the panel offers a way to the real thing', `${String(doors)} door(s)`, doors > 0)
  await page.locator('[data-aside-close]').click({ force: true })
  await page.waitForTimeout(500)
  check(
    'and it closes',
    (await page.locator('[data-aside]').count()) === 0 ? 'closed' : 'STILL OPEN',
    (await page.locator('[data-aside]').count()) === 0,
  )
}

// --- 4. a door that actually goes somewhere ---------------------------------
{
  /*
    Fit first, which is what a person does.

    The automatic view never zooms out below 1.0, so on a map four columns wide
    the documents are off the right-hand edge when it opens. A force-click on a
    card outside the clipped port lands on the plane and pans it — so the suite
    reported "no door on a document card" about a card it had never managed to
    press. Pressing fit is the affordance for exactly this and it is one click.
  */
  await page.locator('[data-zoom="fit"]').click({ force: true })
  await page.waitForTimeout(500)
  await page.locator('.mapcard.k-document').first().click({ force: true })
  await page.waitForTimeout(600)
  const door = page.locator('[data-aside] [data-map-go="doc"]').first()
  if ((await door.count()) === 0) {
    check('a document card reaches the document', 'NO DOOR ON A DOCUMENT CARD', false)
  } else {
    await door.click({ force: true })
    await page.waitForTimeout(1500)
    const onDocs = await page
      .locator('[data-tab="documents"][aria-current="true"], .gallery')
      .count()
    check(
      'a document card reaches the documents, and the viewer if it can',
      onDocs > 0 ? 'landed on Documents' : 'WENT NOWHERE',
      onDocs > 0,
    )
  }
}

// --- 3. adding a source leads to the real setup -----------------------------
{
  /*
    Escape first, because the step above opened a document and the viewer is a
    DIALOG (it took a focus trap in #25's own run). `force: true` skips
    Playwright's actionability checks; it does not move the click past an
    overlay that is genuinely in front, so the navigation silently did nothing
    and the next check reported a missing button about a screen it was not on.
  */
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await page.locator('[data-tab="overview"]').first().click({ force: true })
  await page.waitForTimeout(1200)
  const add = page.locator('[data-overview-add]')
  check(
    'the map offers a way to add a source',
    (await add.count()) > 0 ? 'it does' : 'IT DOES NOT',
    (await add.count()) > 0,
  )
  if ((await add.count()) > 0) {
    await add.click({ force: true })
    await page.waitForTimeout(1200)
    const onSources = await page
      .locator('.source, [data-attach], [data-tab="sources"][aria-current="true"]')
      .count()
    check(
      'and it leads to the real setup rather than a gesture on the canvas',
      onSources > 0 ? 'landed on Sources' : 'WENT NOWHERE',
      onSources > 0,
    )
  }
}

// --- 8. zoom ----------------------------------------------------------------
{
  await page.locator('[data-tab="overview"]').first().click({ force: true })
  await page.waitForTimeout(1200)
  const field = page.locator('[data-field]')
  const before = await field.evaluate((el) =>
    (el as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue('--pk'),
  )
  await page.locator('[data-zoom="in"]').click({ force: true })
  await page.waitForTimeout(400)
  const after = await field.evaluate((el) =>
    (el as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue('--pk'),
  )
  check('zoom in changes the scale', `${before} to ${after}`, before !== after)
  await page.locator('[data-zoom="fit"]').click({ force: true })
  await page.waitForTimeout(500)
  /*
    Asserted as the PROPERTY — everything is on screen — rather than as a
    number. The first draft demanded a scale between 0.85 and 1.2, which was
    the automatic view's floor copied into a check about the button, and it
    went red the moment the two were correctly separated. CLAUDE.md has four
    instances of this correction already.
  */
  const everything = (await page.evaluate(`(() => {
    const port = document.querySelector('[data-plane]').getBoundingClientRect()
    const cards = [...document.querySelectorAll('.mapcard')]
    const out = cards.filter((c) => {
      const b = c.getBoundingClientRect()
      return b.left < port.left - 1 || b.right > port.right + 1 ||
             b.top < port.top - 1 || b.bottom > port.bottom + 1
    })
    return { total: cards.length, out: out.length }
  })()`)) as { total: number; out: number }
  check(
    'and fit puts every card inside the port',
    `${String(everything.total - everything.out)} of ${String(everything.total)} on screen`,
    everything.out === 0,
  )
}

check(
  'no page error anywhere in the run',
  errors.length === 0 ? 'none' : errors.slice(0, 2).join(' · '),
  errors.length === 0,
)

await browser.close()
server.close()

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
