/**
 * The conversation, behaving — the half no static check can see.
 *
 *   npm run verify:chat
 *
 * Issues #197 and #201. The first piece of "proving the conversation".
 *
 * ## What each existing audit cannot see
 *
 * `verify:layouts` measures boxes. `verify:access` runs axe and asks whether
 * the composer is reachable. `verify:controls` presses everything once.
 * `verify:wired` proves a control is looked up. None of them types a sentence,
 * goes somewhere else, comes back and asks whether it is still there — and a
 * draft lost to a background repaint is invisible to every one of them while
 * being the thing that stops people trusting a page.
 *
 * So this is the behaviour suite: it uses the page the way a person does.
 *
 * Driven against the prototype deliberately. The behaviours here — a draft
 * surviving, the keyboard reaching the composer, the phone column fitting —
 * are the page's own, not the office's, and `verify:history` already drives
 * the real chain through HTTP. A suite needing a live token to prove that
 * typing is remembered would be a suite nobody runs.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4617
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
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

const browser = await chromium.launch()

const openChat = async (page: import('playwright').Page): Promise<void> => {
  await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('.project[data-open="legacy-coaching-course"]').first().click()
  await page.waitForTimeout(500)
  await page.locator('[data-tab="team"]').first().click()
  await page.waitForTimeout(400)
  const sub = page.locator('[data-sub="chat"]')
  if ((await sub.count()) > 0) {
    await sub.first().click()
    await page.waitForTimeout(500)
  }
}

try {
  for (const [label, width, height] of [
    ['desktop', 1440, 900],
    ['phone', 390, 844],
  ] as const) {
    console.log(`\n${label}`)
    const ctx = await browser.newContext({
      viewport: { width, height },
      ...(width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
    })
    const page = await ctx.newPage()
    const thrown: string[] = []
    page.on('pageerror', (e) => thrown.push(e.message))
    await openChat(page)

    // ---------------------------------------------------------------------
    const draft = `half a thought ${Math.random().toString(36).slice(2, 8)}`
    await page.locator('[data-say]').first().fill(draft)
    await page.waitForTimeout(250)

    /*
      A repaint that has nothing to do with the composer. The studio renders on
      a pulse tick, on a write and on every tab change — and the composer is
      rebuilt each time, so before #197 a background refresh silently ate what
      you had typed.
    */
    await page.evaluate(`document.querySelector('[data-tab="documents"]').click()`)
    await page.waitForTimeout(450)
    await page.evaluate(`document.querySelector('[data-tab="team"]').click()`)
    await page.waitForTimeout(450)
    const sub = page.locator('[data-sub="chat"]')
    if ((await sub.count()) > 0) {
      await sub.first().click()
      await page.waitForTimeout(500)
    }

    const kept = await page.evaluate(
      `document.querySelector('[data-say]') === null ? '' : document.querySelector('[data-say]').value`,
    )
    check(
      `${label} — an unsent draft survives leaving the tab and coming back`,
      String(kept) === draft ? 'still there' : `LOST — "${String(kept).slice(0, 30)}"`,
      String(kept) === draft,
    )

    // ---------------------------------------------------------------------
    /*
      And it is cleared by SENDING, or the draft would be restored into the
      empty composer on the very next render and the person would appear to
      have said the same thing twice.
    */
    await page.locator('[data-say]').first().fill(`sent ${draft}`)
    await page.waitForTimeout(200)
    await page
      .locator('[data-composer] button[type="submit"], [data-composer] .btn.primary')
      .first()
      .click({ force: true })
      .catch(() => undefined)
    await page.waitForTimeout(900)
    const afterSend = await page.evaluate(
      `document.querySelector('[data-say]') === null ? 'GONE' : document.querySelector('[data-say]').value`,
    )
    check(
      `${label} — and sending clears it rather than leaving it to come back`,
      afterSend === '' ? 'empty' : `still holds "${String(afterSend).slice(0, 30)}"`,
      afterSend === '',
    )

    // ---------------------------------------------------------------------
    if (width < 500) {
      /*
        #197's measured criterion, asserted rather than eyeballed: the composer
        is fully above the fixed nav once the chat is open. It used to sit at
        y=863 on an 844px screen, with the nav at 779 in front of it.
      */
      await page.evaluate(`document.scrollingElement.scrollTop = 2000`)
      await page.waitForTimeout(400)
      const fits = (await page.evaluate(`(() => {
        const c = document.querySelector('.chatbody .composer')
        const n = document.querySelector('.navgroup')
        if (c === null) return null
        const cr = c.getBoundingClientRect()
        const nr = n === null ? { top: window.innerHeight } : n.getBoundingClientRect()
        return { bottom: Math.round(cr.bottom), navTop: Math.round(nr.top),
                 vh: window.innerHeight }
      })()`)) as { bottom: number; navTop: number; vh: number } | null
      check(
        'phone — the composer sits clear of the bottom navigation',
        fits === null
          ? 'NO COMPOSER'
          : `composer ends at ${String(fits.bottom)}, nav starts at ${String(fits.navTop)}`,
        fits !== null && fits.bottom <= fits.navTop,
      )
    }

    check(`${label} — nothing thrown`, thrown[0] ?? 'none', thrown.length === 0)
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
