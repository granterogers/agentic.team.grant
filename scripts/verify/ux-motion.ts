/*
 * THE SPATIAL MOTION, INSPECTED FRAME BY FRAME IN A REAL BROWSER.
 *
 *   npx tsx scripts/verify/ux-motion.ts
 *
 * Grant, 4 October 2026: a card expands FROM its dashboard position into its maximised
 * state, settles back TOWARDS the originating card on restore, and the zoom feels fluid.
 * The earlier suites proved the maximised module opens and closes and that Back works;
 * they could not say what the motion between the two states looks like.
 *
 * Every animation the page starts is intercepted, paused at once, and then scrubbed to
 * fixed fractions of its own duration, so the frame at 0, 25, 50, 75 and 100% is a
 * REPEATABLE rendering that can be measured and looked at (.out/ux-motion-*.png) rather
 * than a lucky screenshot taken while the page happened to be moving. Asserted:
 *   - open:  frame 0 is the card's own rectangle, frame 100% is the dialog's resting
 *            rectangle, and the box grows monotonically in between (no overshoot, no jump)
 *   - close: the ghost starts as the dialog and settles onto the card's rectangle, and
 *            the real dialog is gone at once (the page under it is live again)
 *   - zoom:  the stage scale passes through the values between the old and new zoom
 *   - reduced motion: no animation is created at all and the dialog is simply there
 * Browser code travels as a string: tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4689
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
type R = { x: number; y: number; w: number; h: number }
const near = (a: R, b: R, tol = 3): boolean =>
  Math.abs(a.x - b.x) <= tol &&
  Math.abs(a.y - b.y) <= tol &&
  Math.abs(a.w - b.w) <= tol &&
  Math.abs(a.h - b.h) <= tol

const FREEZE = `
  window.__anims = []
  window.__freeze = false
  const orig = Element.prototype.animate
  Element.prototype.animate = function (k, o) {
    const a = orig.call(this, k, o)
    if (window.__freeze) {
      a.pause()
      a.currentTime = 0
      window.__anims.push({ a, el: this, dur: typeof o === 'number' ? o : o.duration })
    }
    return a
  }
  // The ghost removes itself after a fallback timeout. Scrubbing and screenshotting take longer than that, so while
  // frozen the fallback is stretched; the real removal on finish is what the suite asserts separately.
  const st = window.setTimeout
  window.setTimeout = function (fn, ms, ...rest) {
    return st.call(window, fn, window.__freeze && ms === 500 ? 60000 : ms, ...rest)
  }
`
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const thrown: string[] = []

type Page = import('playwright').Page
const session = async (reduced: boolean, size = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({
    viewport: size,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  })
  await ctx.addInitScript(FREEZE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  const slug = (await page.evaluate(
    inPage(
      `const el = document.querySelector('[data-bc-go^="/p/"]'); return el ? el.dataset.bcGo : ''`,
    ),
  )) as string
  await page.evaluate(
    inPage(
      `for (const k of Object.keys(localStorage)) if (k.startsWith('bc.')) localStorage.removeItem(k); return true`,
    ),
  )
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(500)
  return { ctx, page }
}
const rectOfSel = async (page: Page, sel: string): Promise<R | null> =>
  (await page.evaluate(
    inPage(
      `const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }`,
    ),
  )) as R | null
const scrub = async (page: Page, f: number): Promise<void> => {
  await page.evaluate(
    inPage(`for (const x of window.__anims) { x.a.currentTime = ${String(f)} * x.dur } return true`),
  )
}
const pct = (f: number): string => String(Math.round(f * 100)).padStart(3, '0')

/* ------------------------------------------------------------- open + close, motion welcome */
{
  const { ctx, page } = await session(false)
  const card = await rectOfSel(page, '.bcstage [data-mod="schedule"]')
  await page.evaluate(inPage('window.__freeze = true; return true'))
  await page.locator('[data-mod="schedule"]').hover()
  await page.locator('[data-bc-max="schedule"]').click()
  await page.waitForSelector('.bcexp .bcexpbox')
  await page.waitForTimeout(120)
  const n = (await page.evaluate(inPage('return window.__anims.length'))) as number
  check('opening a module starts the entrance animations', n >= 1, String(n))
  const frames: R[] = []
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    await scrub(page, f)
    await page.waitForTimeout(40)
    const r = await rectOfSel(page, '.bcexp .bcexpbox')
    if (r !== null) frames.push(r)
    await page.screenshot({ path: `.out/ux-motion-open-${pct(f)}.png` })
  }
  await page.evaluate(
    inPage('for (const x of window.__anims) x.a.finish(); window.__freeze = false; return true'),
  )
  await page.waitForTimeout(80)
  const rest = await rectOfSel(page, '.bcexp .bcexpbox')
  check(
    "frame 0 of the entrance is the card's own rectangle (it grows FROM the card)",
    card !== null && frames[0] !== undefined && near(frames[0], card, 4),
    JSON.stringify({ card, frame0: frames[0] }),
  )
  check(
    "frame 100% is the dialog's resting rectangle",
    rest !== null && frames[4] !== undefined && near(frames[4], rest, 3),
    JSON.stringify({ rest, frame100: frames[4] }),
  )
  const widths = frames.map((r) => r.w)
  const heights = frames.map((r) => r.h)
  const mono = (a: number[]): boolean => a.every((v, i) => i === 0 || (a[i - 1] ?? 0) <= v + 0.5)
  check(
    'it grows monotonically between the two (no jump, no overshoot)',
    mono(widths) && mono(heights) && (widths[4] ?? 0) > (widths[0] ?? 0) * 1.5,
    JSON.stringify({ widths: widths.map(Math.round), heights: heights.map(Math.round) }),
  )
  check(
    'the intermediate frames stay inside the viewport (nothing flies off screen)',
    frames.every((r) => r.x > -2 && r.y > -2 && r.x + r.w < 1442 && r.y + r.h < 902),
    JSON.stringify(frames.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)])),
  )

  // close: Escape. The real dialog goes at once; a ghost settles back onto the card.
  await page.evaluate(inPage('window.__anims.length = 0; window.__freeze = true; return true'))
  const dialogRect = await rectOfSel(page, '.bcexp .bcexpbox')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check(
    'closing removes the real dialog at once (the page under it is live again)',
    (await page.locator('[data-bc-expanded]').count()) === 0,
  )
  const ghostN = (await page.evaluate(inPage('return window.__anims.length'))) as number
  check('a ghost animation settles back towards the card', ghostN >= 1, String(ghostN))
  const gframes: R[] = []
  const gopacity: number[] = []
  // 99.5% rather than 100%: at the very end the ghost has finished and removed itself, which is correct.
  for (const f of [0, 0.5, 0.995]) {
    await scrub(page, f)
    await page.waitForTimeout(40)
    const g = (await page.evaluate(
      inPage(
        `const x = window.__anims.find((q) => q.el.getAttribute('aria-hidden') === 'true') ?? window.__anims[0]; if (!x) return null; const r = x.el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, o: Number(getComputedStyle(x.el).opacity) }`,
      ),
    )) as (R & { o: number }) | null
    if (g !== null) {
      gframes.push(g)
      gopacity.push(g.o)
    }
    await page.screenshot({ path: `.out/ux-motion-close-${pct(f)}.png` })
  }
  const cardAfter = await rectOfSel(page, '.bcstage [data-mod="schedule"]')
  check(
    'the ghost starts as the dialog and, at 99.5% of the ease-in, is within 20px of the originating card',
    dialogRect !== null &&
      cardAfter !== null &&
      gframes[0] !== undefined &&
      gframes[2] !== undefined &&
      near(gframes[0], dialogRect, 4) &&
      near(gframes[2], cardAfter, 20),
    JSON.stringify({ dialogRect, cardAfter, gframes }),
  )
  check(
    'the ghost stays solid while it travels (the dashboard never shows through it) and fades only on arrival',
    gopacity.length === 3 && (gopacity[1] ?? 0) >= 0.99 && (gopacity[2] ?? 1) < 0.5,
    JSON.stringify(gopacity),
  )
  check(
    'and it shrinks monotonically on the way',
    gframes.length === 3 &&
      (gframes[0]?.w ?? 0) >= (gframes[1]?.w ?? 0) - 0.5 &&
      (gframes[1]?.w ?? 0) >= (gframes[2]?.w ?? 0) - 0.5,
    JSON.stringify(gframes.map((r) => Math.round(r.w))),
  )
  await page.evaluate(
    inPage('for (const x of window.__anims) x.a.finish(); window.__freeze = false; return true'),
  )
  await page.waitForTimeout(150)
  check(
    'the ghost removes itself when it has finished',
    ((await page.evaluate(
      inPage(`return document.querySelectorAll('[aria-hidden="true"].bcexpbox').length`),
    )) as number) === 0,
  )

  /* zoom: a CSS transition, scrubbed through the document's animation list */
  const zStart = (await page.evaluate(
    inPage(`return getComputedStyle(document.querySelector('.bcstage')).transform`),
  )) as string
  await page.locator('[data-bc-zoom="out"]').click()
  const zMid = (await page.evaluate(
    inPage(
      `const t = document.getAnimations().filter((a) => a.transitionProperty === 'transform'); if (!t.length) return null; for (const a of t) { a.pause(); a.currentTime = 110 } return getComputedStyle(document.querySelector('.bcstage')).transform`,
    ),
  )) as string | null
  await page.screenshot({ path: '.out/ux-motion-zoom-mid.png' })
  await page.evaluate(inPage('for (const a of document.getAnimations()) a.finish(); return true'))
  await page.waitForTimeout(100)
  const zEnd = (await page.evaluate(
    inPage(`return getComputedStyle(document.querySelector('.bcstage')).transform`),
  )) as string
  const scaleOf = (m: string | null): number => {
    if (m === null || m === 'none') return 1
    const v = /matrix\(([^)]+)\)/.exec(m)?.[1]?.split(',').map(Number)
    return v?.[0] ?? 1
  }
  const s0 = scaleOf(zStart)
  const s1 = scaleOf(zMid)
  const s2 = scaleOf(zEnd)
  check(
    'zooming out is animated: the stage scale is between the old and the new value mid-transition',
    zMid !== null && s2 < s0 && s1 <= s0 && s1 >= s2 - 0.0001,
    JSON.stringify({ s0, s1, s2 }),
  )
  await ctx.close()
}

/* ------------------------------------------------------------- reduced motion */
{
  const { ctx, page } = await session(true)
  await page.evaluate(inPage('window.__freeze = true; return true'))
  await page.locator('[data-mod="schedule"]').hover()
  await page.locator('[data-bc-max="schedule"]').click()
  await page.waitForSelector('.bcexp .bcexpbox')
  await page.waitForTimeout(200)
  check(
    'reduced motion: opening creates no animation and the dialog is simply there',
    ((await page.evaluate(inPage('return window.__anims.length'))) as number) === 0,
  )
  await page.screenshot({ path: '.out/ux-motion-reduced-open.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check(
    'reduced motion: closing creates no ghost and no animation',
    ((await page.evaluate(inPage('return window.__anims.length'))) as number) === 0 &&
      (await page.locator('[data-bc-expanded]').count()) === 0,
  )
  await ctx.close()
}

/* ------------------------------------------------------------- phone: the same origin-to-dialog contract */
{
  const { ctx, page } = await session(false, { width: 390, height: 844 })
  // On a phone the modules are stacked far below the fold: bring the card on screen first, THEN measure it,
  // because the origin of the motion is where the card is when the press lands.
  await page.locator('[data-mod="schedule"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const card = await rectOfSel(page, '[data-mod="schedule"]')
  await page.evaluate(inPage('window.__freeze = true; return true'))
  const opener = page.locator('[data-bc-max="schedule"], [data-mod="schedule"] [data-bc-expand]').first()
  await opener.click({ force: true })
  await page.waitForSelector('.bcexp .bcexpbox')
  await page.waitForTimeout(120)
  await scrub(page, 0)
  await page.waitForTimeout(40)
  const f0 = await rectOfSel(page, '.bcexp .bcexpbox')
  await page.screenshot({ path: '.out/ux-motion-phone-open-000.png' })
  await scrub(page, 0.5)
  await page.waitForTimeout(40)
  await page.screenshot({ path: '.out/ux-motion-phone-open-050.png' })
  await page.evaluate(
    inPage('for (const x of window.__anims) x.a.finish(); window.__freeze = false; return true'),
  )
  await page.waitForTimeout(80)
  const rest = await rectOfSel(page, '.bcexp .bcexpbox')
  check(
    'phone: the entrance also starts from the card and ends in the dialog (inside the 390px viewport)',
    card !== null && f0 !== null && rest !== null && near(f0, card, 5) && rest.x >= -1 && rest.x + rest.w <= 391,
    JSON.stringify({ card, f0, rest }),
  )
  await ctx.close()
}

check('no page errors during any of it', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
