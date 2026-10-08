// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * The 18-state screenshot matrix from the 8 October 2026 UX brief (docs/spec/team-hq-ux-overhaul-2026-10-08.md, section 14).
 *   npx tsx scripts/verify/ux-qa-matrix.ts [WxH ...]
 * Writes PNGs to .out/ux/qa/<viewport>/<nn>-<state>.png. CAPTURE ONLY: it passes and fails nothing, the images are judged by
 * opening them. Static server and Chromium, no office; the Document Style form is drawn against a stubbed gateway because it
 * is only shown to a signed-in person.
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'
import { serveStudio } from './serve-studio.ts'

/** SCHEME=dark writes the dark leg to .out/ux/qa-dark/. */
const SCHEME = process.env.SCHEME === 'dark' ? 'dark' : 'light'

declare const document: any
declare const window: any

const PORT = 4657
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const sizes =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['1440x900', '1920x1080', '768x1024', '390x844']
const FAKE = `
  window.__recs = []
  class FakeRec { constructor() { window.__recs.push(this) } start() { setTimeout(() => this.onstart && this.onstart(), 0) } abort() { setTimeout(() => this.onend && this.onend(), 0) } }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec
  window.__say = (list) => { const r = window.__recs[window.__recs.length - 1]; r.onresult({ results: list.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) }) }
`
const errors: string[] = []
for (const sz of sizes) {
  const [w = 1440, h = 900] = sz.split('x').map(Number)
  const dir = `.out/ux/qa${SCHEME === 'dark' ? '-dark' : ''}/${sz}`
  await mkdir(dir, { recursive: true })
  const touch = w < 600
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
  })
  await ctx.addInitScript(FAKE)
  await ctx.addInitScript(seedAppearance(SCHEME))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${sz}: ${e.message}`))
  const shot = async (n: string, name: string): Promise<void> => {
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${dir}/${n}-${name}.png` })
  }
  const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
  await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-menu]')
  await page.waitForTimeout(400)
  await shot('01', 'empty-canvas')
  await page.click('[data-bc-menu]')
  await shot('02', 'hamburger')
  await page.locator('.bcmenulist .bcmenuitem').first().click()
  await page.waitForSelector('[data-bc-board]')
  const path = new URL(page.url()).pathname
  await page.waitForTimeout(700)
  await shot('03', 'populated')
  const stacked = (await page.locator('.bcpanes--stack').count()) > 0
  if (!stacked) {
    const b = await page.evaluate(() => {
      const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
    for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, 250)
    await shot('04', 'zoomed-out')
    await page.click('[data-bc-viewreset]')
    /* A bare point (the free right-hand fifth): a wheel over a scrollable module scrolls it, by design. */
    await page.mouse.move(b.x + b.w * 0.92, b.y + b.h * 0.8)
    for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -250)
    await shot('05', 'zoomed-in')
    await page.click('[data-bc-viewreset]')
    await page.waitForTimeout(300)
    const bare = await page.evaluate(() => {
      const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
      for (let y = r.bottom - 20; y > r.top + 20; y -= 25)
        for (let x = r.right - 20; x > r.left + 20; x -= 25) {
          const e = document.elementFromPoint(x, y)
          if (e && (e.classList.contains('bcstage') || e.classList.contains('bcpanes')))
            return { x, y }
        }
      return null
    })
    if (bare !== null) {
      await page.mouse.move(bare.x, bare.y)
      await page.mouse.down()
      await page.mouse.move(bare.x - 260, bare.y - 140, { steps: 8 })
      await page.mouse.up()
    }
    await shot('06', 'panned')
    await page.click('[data-bc-viewreset]')
    await page.waitForTimeout(300)
    const head = await page.evaluate(() => {
      const r = document.querySelector('[data-mod="schedule"] .bcmodhead').getBoundingClientRect()
      return { x: r.x, y: r.y }
    })
    await page.mouse.move(head.x + 20, head.y + 10)
    await page.mouse.down()
    await page.mouse.move(head.x + 320, head.y - 60, { steps: 8 })
    await page.mouse.up()
    const rz = await page.evaluate(() => {
      const r = document
        .querySelector('[data-mod="contacts"] [data-bc-resize]')
        .getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await page.mouse.move(rz.x, rz.y)
    await page.mouse.down()
    await page.mouse.move(rz.x + 120, rz.y + 60, { steps: 6 })
    await page.mouse.up()
    await shot('07', 'moved-and-resized')
    await page.click('[data-bc-fit]')
  }
  if ((await page.locator('.bcpostit').count()) === 0) {
    await page.locator('.bcnoteempty').first().click()
  } else {
    await page.locator('.bcpostit').first().hover()
    await page
      .locator('.bcpostit [data-bc-note-add]')
      .first()
      .evaluate((el: any) => el.click())
  }
  await page.keyboard.type('Call the roofer before Friday')
  await shot('08', 'postit-created')
  /* the chat */
  if ((await page.locator('.dock [data-docksay]').count()) === 0) await page.click('[data-bc-dock]')
  await page.waitForSelector('.dock [data-docksay]')
  await shot('09', 'chat-short')
  await page.fill(
    '[data-docksay]',
    'Ask the team at Riverside Cafe lunch '.repeat(5) +
      ' and also https://example.com/' +
      'x'.repeat(90),
  )
  await page.locator('.dock [type=submit]').click()
  await page.waitForTimeout(400)
  await page.fill(
    '[data-docksay]',
    'Can we get the first five interviews booked this week, and can Emma confirm which of the two segments she was unsure about so that the avatar document can be signed off before Friday?',
  )
  await page.locator('.dock [type=submit]').click()
  await shot('10', 'chat-long')
  if (!touch) {
    const g = await page.evaluate(() => {
      const r = document.querySelector('.dockgrip').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    await page.mouse.move(g.x + 600, g.y, { steps: 6 })
    await page.mouse.up()
    await shot('11', 'chat-min-width')
    const g2 = await page.evaluate(() => {
      const r = document.querySelector('.dockgrip').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await page.mouse.move(g2.x, g2.y)
    await page.mouse.down()
    await page.mouse.move(g2.x - 460, g2.y, { steps: 6 })
    await page.mouse.up()
    await shot('12', 'chat-expanded')
    await page.dblclick('.dockgrip')
  } else {
    await shot('11', 'chat-min-width-n-a-on-phone')
  }
  await page.fill('[data-docksay]', 'Please')
  await page.click('[data-dock-dictate]')
  await page.evaluate(() =>
    window.__say([
      ['book the venue', true],
      [' for fri', false],
    ]),
  )
  await shot('13', 'dictation-active')
  await page.click('[data-dock-close]')
  /* the look sheet and the sample office strip */
  await page.goto(url(path), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(500)
  await page.locator('[data-bc-pagemenu]').click({ force: true })
  await page.locator('[data-bc-look]').click({ force: true })
  await shot('14', 'how-this-project-looks')
  await page.keyboard.press('Escape')
  await page.goto(url(path), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    try {
      sessionStorage.setItem('hq.sample', '1')
    } catch {
      /* nothing */
    }
  })
  await shot('15', 'sample-office-details-n-a-offline')
  /* the document style form against a stubbed gateway */
  const sctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
  })
  await sctx.addInitScript("try { localStorage.setItem('hq.token', 'stub') } catch {}")
  const sp = await sctx.newPage()
  await sp.route('**/*', async (route) => {
    const u = route.request().url()
    if (!u.includes('hq-api')) return route.continue()
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (route.request().method() === 'POST')
      return route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({ result: { ok: true } }),
      })
    const q = Object.fromEntries(new URL(u).searchParams)
    if (q.section === 'style')
      return route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            scope: 'project',
            profile: { palette: { primary: '#3b4a57' } },
            inherited_from: { 'palette.primary': 'project' },
            vocabulary: {
              fonts: ['Helvetica', 'Times'],
              palette: ['primary', 'accent', 'ink', 'paper', 'wash', 'rule'],
              title_pages: ['standard', 'band'],
            },
          },
        }),
      })
    return route.fulfill({
      status: 500,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'stub' }),
    })
  })
  await sp.goto(url('/'))
  await sp.waitForTimeout(800)
  await sp.evaluate(
    "import('/bc/style.js').then((m) => m.open({ slug: 'legacy', name: 'Legacy Coaching Course' }))",
  )
  await sp.waitForSelector('.bcstyform select')
  await sp.waitForTimeout(300)
  await sp.screenshot({ path: `${dir}/16-document-style.png` })
  await sctx.close()
  /* settings */
  await page.goto(url(`${path}/settings`), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await shot('17', 'project-settings')
  await page.locator('.setfold > summary').click()
  await shot('18', 'automations-and-fold')
  await ctx.close()
}
await browser.close()
server.close()
console.log(errors.length === 0 ? 'captured, no page errors' : errors.join('\n'))
