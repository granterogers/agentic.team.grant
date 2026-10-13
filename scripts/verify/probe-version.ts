/**
 * The build version on the Team HQ home screen, at desktop and phone widths, read from the page.
 *
 *   npx tsx scripts/verify/probe-version.ts
 *
 * Read-only; serves web/studio locally. The version must come from package.json (through config.js), appear in the top right of
 * the home screen only, and draw nothing when config.js carries no version: that control strips the line and must find no badge.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const record = (check: string, ok: boolean, detail: unknown) => results.push({ check, ok, detail })
const packageVersion = String(
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version,
)

const badge = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.bcver')
    const header = document.querySelector<HTMLElement>('.bctop')
    const board = document.querySelector<HTMLElement>('.bcvoid')
    const title = document.querySelector<HTMLElement>('.bchere')
    if (el === null || header === null || board === null) return null
    const r = el.getBoundingClientRect()
    const b = board.getBoundingClientRect()
    const fontSize = Number.parseFloat(getComputedStyle(el).fontSize)
    return {
      text: el.textContent?.trim() ?? '',
      fontSize,
      // Top right of the home board: in its top band and against its right edge, within the viewport.
      inTopRight:
        r.top >= b.top &&
        r.top < b.top + 40 &&
        r.right <= b.right &&
        r.right > b.right - 40 &&
        r.right <= window.innerWidth,
      headerOverflows: header.scrollWidth > header.clientWidth + 1,
      // The header's own title is not clipped (the badge must not take its room).
      titleClipped: title !== null && title.scrollWidth > title.clientWidth + 1,
      signOutVisible: (() => {
        const so = document.querySelector<HTMLElement>('.bcsignout')
        if (so === null) return true
        const sr = so.getBoundingClientRect()
        return sr.right <= window.innerWidth && sr.width > 0
      })(),
    }
  })

const open = async (page: Page) => {
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
}

const runAt = async (label: 'desktop' | 'phone') => {
  const size = label === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
  const context = await browser.newContext({
    viewport: size,
    isMobile: label === 'phone',
    hasTouch: label === 'phone',
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page)
  const home = await badge(page)
  record(
    `${label}: the home screen shows the package version in the top right`,
    home !== null && home.text === `v${packageVersion}` && home.inTopRight,
    { home, packageVersion },
  )
  record(
    `${label}: the version is small and at the 12px type floor`,
    home !== null && home.fontSize === 12,
    { fontSize: home?.fontSize },
  )
  record(
    `${label}: the header still fits and Sign out is on screen with the version`,
    home !== null && !home.headerOverflows && home.signOutVisible,
    home,
  )
  await page.screenshot({
    path: join(process.cwd(), '.out', 'probe', `version-home-${label}.png`),
  })

  // The signed-in header also draws Sign out (the local prototype has no session, so it is absent above). Its markup is put
  // beside the version here, with the same classes, to measure whether the header still fits on a phone.
  if (label === 'phone') {
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(() => {
        if (document.querySelector('.bcsignout') === null) {
          const right = document.querySelector('.bctop .bcright')
          right?.insertAdjacentHTML(
            'beforeend',
            '<button type="button" class="bcbtn bcsignout" aria-hidden="true" tabindex="-1"><svg class="bcsoicon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 8l4 4-4 4"/><path d="M20 12H9"/></svg><span class="bcsotext">Sign out</span></button>',
          )
        }
      })
      await page.waitForTimeout(300)
      const signedIn = await badge(page)
      record(
        `phone ${String(width)}px: with Sign out drawn, the header title is not clipped, the header fits and Sign out is reachable`,
        signedIn !== null &&
          !signedIn.titleClipped &&
          !signedIn.headerOverflows &&
          signedIn.signOutVisible,
        signedIn,
      )
      await page.screenshot({
        path: join(process.cwd(), '.out', 'probe', `version-signedin-phone-${String(width)}.png`),
      })
    }
  }

  // Once a project is open the badge is not drawn: it is a home-screen mark, not a page footer.
  await page
    .locator('[data-bc-menu-open]')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(400)
  await page
    .locator('[data-bc-go*="/p/"]')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(1200)
  const inProject = await page.locator('.bcver').count()
  record(`${label}: inside a project the version is not drawn`, inProject === 0, { inProject })
  record(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3))
  await context.close()
}

// Control: a config.js without a version must draw no badge and no "undefined".
const control = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await control.route('**/config.js', async (route) => {
  const body = readFileSync(join(process.cwd(), 'web', 'studio', 'config.js'), 'utf8')
  await route.fulfill({
    contentType: 'application/javascript',
    body: body.replace(/^window\.HQ_VERSION.*$/m, ''),
  })
})
const cp = await control.newPage()
await open(cp)
const withoutVersion = await cp.evaluate(() => ({
  badges: document.querySelectorAll('.bcver').length,
  undefinedText: document.querySelector('.bctop')?.textContent?.includes('undefined') === true,
}))
record(
  'control: with no version in config.js, no badge is drawn and nothing says undefined',
  withoutVersion.badges === 0 && !withoutVersion.undefinedText,
  withoutVersion,
)
await control.close()

try {
  await runAt('desktop')
  await runAt('phone')
} finally {
  await browser.close()
  close()
}

for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.check}`, JSON.stringify(r.detail))
const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0
    ? `ALL ${String(results.length)} CHECKS PASS`
    : `${String(failed)} of ${String(results.length)} FAILED`,
)
process.exitCode = failed === 0 ? 0 : 1
