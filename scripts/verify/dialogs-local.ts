/**
 * The page's own dialogs (confirm and notice), on a phone and a desktop, with no office behind them (P5).
 *   npm run verify:dialogs
 *
 * Local class: a static server and a real Chromium. Both dialogs are opened through the module the product uses
 * (`/settings-ui.js`, and `sure()` from `/office.js`, which is what every destructive control calls) and measured as a person
 * meets them: they name what they ask, the safe answer holds focus, Tab stays inside, Escape and the backdrop close them and
 * put focus back on the control that opened them, the box fits a 390px screen, and every button is 44px to touch. `sure()` is
 * asserted to RESOLVE the person's answer (true for Confirm, false for Cancel and Escape), never the native confirm.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  try {
    const b = await readFile(
      join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, '')),
    )
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/html' })
    res.end(b)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4796, '127.0.0.1', () => r()))
const browser = await chromium.launch()
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

try {
  for (const [label, viewport, touch] of [
    ['phone', { width: 390, height: 844 }, true],
    ['desktop', { width: 1440, height: 900 }, false],
  ] as const) {
    const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch })
    const page = await ctx.newPage()
    const errors: string[] = []
    let native = 0
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('dialog', (d) => {
      native += 1
      void d.dismiss()
    })
    await page.goto('http://127.0.0.1:4796/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-bc-settings]', { timeout: 30000 })
    // a control the dialog is opened FROM, so focus return can be observed
    await page.evaluate(
      "(() => { const b = document.createElement('button'); b.id = 'opener'; b.textContent = 'Opener'; b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:1'; document.body.append(b); b.focus(); })()",
    )
    const minH = touch ? 43.5 : 35.5

    const measure = async (): Promise<{ left: number; right: number; vw: number; h: number[] }> =>
      (await page.evaluate(`(() => {
        var el = document.querySelector('.stg-confirmbox'); var r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, vw: window.innerWidth,
                 h: Array.prototype.map.call(el.querySelectorAll('button'), function (x) { return x.getBoundingClientRect().height; }) };
      })()`)) as { left: number; right: number; vw: number; h: number[] }
    const focusedIn = async (sel: string): Promise<boolean> =>
      (await page.evaluate(
        `document.activeElement === document.querySelector(${JSON.stringify(sel)})`,
      )) === true

    // ---- sure(): resolves the person's answer ------------------------------------------------------------------------
    for (const [how, expected] of [
      ['confirm', true],
      ['cancel', false],
      ['escape', false],
      ['backdrop', false],
    ] as const) {
      await page.evaluate(
        "(async () => { const { sure } = await import('/office.js'); window.__answer = undefined; sure('Archive this thing? Nothing is deleted.', 'Archive it', { title: 'Archive this project?' }).then((v) => { window.__answer = v }) })()",
      )
      await page.waitForSelector('.stg-confirmbox', { timeout: 5000 })
      if (how === 'confirm') {
        const m = await measure()
        check(
          `${label}: sure() opens the page's dialog, titled, and it fits the screen`,
          /Archive this project/.test(await page.locator('.stg-confirmbox h2').innerText()) &&
            m.left >= 0 &&
            m.right <= m.vw,
          `${String(Math.round(m.left))}..${String(Math.round(m.right))} of ${String(m.vw)}`,
        )
        check(
          `${label}: both buttons are tall enough (${touch ? '44' : '36'}px)`,
          m.h.length === 2 && m.h.every((h) => h >= minH),
          m.h.map((h) => String(Math.round(h))).join(','),
        )
        check(
          `${label}: Cancel holds focus (the safe answer is the default)`,
          await focusedIn('.stg-confirmbox [data-no]'),
        )
        const stays = await (async () => {
          for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab')
          return (
            (await page.evaluate("document.activeElement.closest('.stg-confirmbox') !== null")) ===
            true
          )
        })()
        check(`${label}: Tab never leaves it`, stays)
      }
      if (how === 'confirm') await page.locator('.stg-confirmbox [data-yes]').click()
      else if (how === 'cancel') await page.locator('.stg-confirmbox [data-no]').click()
      else if (how === 'escape') await page.keyboard.press('Escape')
      else await page.mouse.click(2, 2)
      await page.waitForFunction('window.__answer !== undefined', null, { timeout: 5000 })
      const got = await page.evaluate('window.__answer')
      check(`${label}: ${how} resolves ${String(expected)}`, got === expected, String(got))
      check(
        `${label}: and focus goes back to the control that opened it (${how})`,
        await focusedIn('#opener'),
      )
      await page.evaluate("document.getElementById('opener').focus()")
    }

    // ---- noticeDialog(): one button, closes, returns focus ---------------------------------------------------------------
    for (const how of ['button', 'escape', 'backdrop'] as const) {
      await page.evaluate(
        "(async () => { const m = await import('/settings-ui.js'); window.__closed = false; m.noticeDialog({ title: 'Could not undo that', body: 'That was changed again since, so it was left as it is.' }).then(() => { window.__closed = true }) })()",
      )
      await page.waitForSelector('.stg-confirmbox', { timeout: 5000 })
      if (how === 'button') {
        const m = await measure()
        check(
          `${label}: the notice names what happened, has ONE button, fits, and is tall enough`,
          /Could not undo that/.test(await page.locator('.stg-confirmbox h2').innerText()) &&
            m.h.length === 1 &&
            m.h[0] !== undefined &&
            m.h[0] >= minH &&
            m.left >= 0 &&
            m.right <= m.vw,
          JSON.stringify(m.h),
        )
        check(
          `${label}: its button holds focus, and Tab stays on it`,
          (await focusedIn('.stg-confirmbox [data-ok]')) &&
            (await (async () => {
              await page.keyboard.press('Tab')
              return focusedIn('.stg-confirmbox [data-ok]')
            })()),
        )
        await page.locator('.stg-confirmbox [data-ok]').click()
      } else if (how === 'escape') await page.keyboard.press('Escape')
      else await page.mouse.click(2, 2)
      await page.waitForFunction('window.__closed === true', null, { timeout: 5000 })
      check(`${label}: ${how} closes the notice and returns focus`, await focusedIn('#opener'))
      await page.evaluate("document.getElementById('opener').focus()")
    }
    check(
      `${label}: no native dialog and no page error`,
      native === 0 && errors.length === 0,
      `${String(native)} native; ${errors.join(' | ').slice(0, 100)}`,
    )
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failed === 0 ? '\nall passed' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
