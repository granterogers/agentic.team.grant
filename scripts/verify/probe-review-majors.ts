/**
 * Regression checks for the three MAJOR findings of the independent review of 33cd99c2, in real Chromium against the
 * local prototype. Each finding has a check that fails on the pre-fix tree (the control) and passes on the fixed one.
 *
 *   npx tsx scripts/verify/probe-review-majors.ts
 *
 * 1. A type stamp stays on one line and is not clipped on a compact tile (the Team Chat narrows the dashboard).
 * 2. A tile that shows a real preview draws only the picture: no type stamp is visible beside it.
 * 3. "Follow the system" with a dark OS draws the dark document paper.
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

try {
  /* 1 and 2: the dashboard tiles (compact) with the chat open, then the Docs grid (real previews). */
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page
    .locator('[data-bc-menu-open]:visible, [data-bc-menu]:visible')
    .first()
    .click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]:visible').first().click({ force: true })
  await page.waitForTimeout(1400)

  /* The wrap shows when the Team Chat narrows the dashboard, so the tiles are measured with the chat open. */
  const dockToggle = page.locator('[data-bc-dock]:visible').first()
  if ((await dockToggle.count()) > 0) await dockToggle.click({ force: true })
  await page.waitForTimeout(900)

  const stamps = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.bccompact .bcftypeword')).map((w) => {
      const h = w.getBoundingClientRect().height
      const lh =
        parseFloat(getComputedStyle(w).lineHeight) || parseFloat(getComputedStyle(w).fontSize) * 1.2
      return { lines: Math.round(h / lh), clipped: w.scrollWidth > w.clientWidth + 1 }
    }),
  )
  check('compact stamps are drawn', stamps.length > 0, `${String(stamps.length)} stamp(s)`)
  check(
    'compact stamps stay on one line',
    stamps.every((s) => s.lines <= 1),
    `lines per stamp: ${JSON.stringify(stamps.map((s) => s.lines).slice(0, 6))}`,
  )
  check(
    'compact stamps are not clipped',
    stamps.every((s) => !s.clipped),
    `${String(stamps.filter((s) => s.clipped).length)} clipped`,
  )

  await page
    .locator('[data-bc-expand="documents"]:visible')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(5500)
  const real = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.bcthumb.has-real'))
    const stampsBeside = tiles.filter((t) =>
      Array.from(t.children).some(
        (c) =>
          !c.classList.contains('realpage') &&
          c.tagName !== 'IMG' &&
          getComputedStyle(c).display !== 'none' &&
          c.getBoundingClientRect().width > 0,
      ),
    ).length
    return { tiles: tiles.length, stampsBeside }
  })
  check(
    'real previews are present in the Docs grid (the control needs one)',
    real.tiles > 0,
    `${String(real.tiles)} real preview(s)`,
  )
  check(
    'a real preview draws no type stamp beside it',
    real.stampsBeside === 0,
    `${String(real.stampsBeside)} with a stamp still visible`,
  )
  await context.close()

  /*
    3: "Follow the system" stored, OS dark. A fresh visitor gets Light by design, so the choice is stored explicitly.
    The paper token must be the dark sheet.
  */
  const sys = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  await sys.addInitScript(() => {
    localStorage.setItem(
      'studio.appearance',
      JSON.stringify({
        v: 3,
        palette: 'slate',
        texture: 'none',
        own: null,
        ownName: '',
        scheme: 'system',
        density: 'comfortable',
        look: 'porcelain',
        glass: 'soft',
        depth: 'soft',
      }),
    )
  })
  const sysPage = await sys.newPage()
  await sysPage.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await sysPage.waitForTimeout(1200)
  const paper = await sysPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bc-paper').trim(),
  )
  const scheme = await sysPage.evaluate(
    () => document.documentElement.getAttribute('data-scheme') ?? 'none',
  )
  check(
    'system dark: the document paper is the dark sheet',
    paper === '#252b31',
    `scheme=${scheme} paper=${paper}`,
  )
  await sys.close()

  /* Control: an explicit light choice under a dark OS keeps the light paper. */
  const lightChoice = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  await lightChoice.addInitScript(() => {
    localStorage.setItem(
      'studio.appearance',
      JSON.stringify({
        v: 3,
        palette: 'slate',
        texture: 'none',
        own: null,
        ownName: '',
        scheme: 'light',
        density: 'comfortable',
        look: 'porcelain',
        glass: 'soft',
        depth: 'soft',
      }),
    )
  })
  const lightPage = await lightChoice.newPage()
  await lightPage.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await lightPage.waitForTimeout(1200)
  const lightPaper = await lightPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bc-paper').trim(),
  )
  check(
    'control: an explicit light choice keeps the light paper',
    lightPaper !== '#252b31',
    `paper=${lightPaper}`,
  )
  await lightChoice.close()
} finally {
  await browser.close()
  await close()
}

if (failures > 0) {
  console.log(`${String(failures)} check(s) failed`)
  process.exit(1)
}
console.log('ALL REVIEW-MAJOR CHECKS PASS')
