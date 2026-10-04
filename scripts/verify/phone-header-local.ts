/**
 * The phone header keeps the project's NAME (P5), measured on the real page and stylesheet with no office behind it.
 *   npm run verify:phone-header
 *
 * Local class: a static server and a real Chromium, nothing from production. A stored token makes the page draw the SIGNED-IN
 * header (the text Sign out button is the thing that once squeezed the name to 0px), and the unreachable office leaves it in
 * place, which is how this repository's other local suites get a writer. The prototype project "Legacy Coaching Course" is the
 * subject. Asserted at 320, 360, 390 and 430px: the name is at least 40px wide, the header does not overflow the screen, and
 * every control in it is 44px to touch; and at 1440px the desktop header still says "Sign out" in words.
 * A control: with the phone rules removed the same measurement must come out red (checked by hand, recorded in HANDOFF).
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
  const file = join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const b = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(b)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4799, '127.0.0.1', () => r()))
const browser = await chromium.launch()
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const MEASURE = `(() => {
  var box = function (s) { var e = document.querySelector(s); if (!e) return null; var r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) } };
  var top = document.querySelector('.bctop');
  var controls = Array.prototype.slice.call(top.querySelectorAll('button')).filter(function (b) { return b.offsetParent !== null; }).map(function (b) { var r = b.getBoundingClientRect(); return { label: (b.getAttribute('aria-label') || b.textContent || '').slice(0, 24), h: Math.round(r.height), w: Math.round(r.width) }; });
  return { name: box('.bcjumpname'), top: top.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth, vw: window.innerWidth,
           signoutText: (document.querySelector('.bcsignout .bcsotext') || {}).textContent || '', signoutTextShown: !!document.querySelector('.bcsignout .bcsotext') && getComputedStyle(document.querySelector('.bcsignout .bcsotext')).display !== 'none', controls: controls };
})()`
try {
  for (const [width, touch] of [
    [320, true],
    [360, true],
    [390, true],
    [430, true],
    [1440, false],
  ] as const) {
    const ctx = await browser.newContext({
      viewport: { width, height: width > 600 ? 900 : 844 },
      hasTouch: touch,
      isMobile: touch,
    })
    await ctx.addInitScript(
      "try { localStorage.setItem('hq.token', 'local-only-not-a-credential') } catch {}",
    )
    const page = await ctx.newPage()
    await page.goto('http://127.0.0.1:4799/p/legacy-coaching-course/overview', {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForSelector('.bcsignout', { timeout: 20000 })
    // Measured the moment the writer header is drawn: with no office behind it the page may drop the stored token a moment
    // later (and then draws no Sign out), so a reading taken after a pause would be of a different header.
    const m = (await page.evaluate(MEASURE)) as {
      name: { w: number } | null
      scroll: number
      vw: number
      signoutTextShown: boolean
      controls: { label: string; h: number; w: number }[]
    }
    if (width < 600) {
      check(
        `${String(width)}px: the project name is shown, at least 40px wide`,
        (m.name?.w ?? 0) >= 40,
        String(m.name?.w),
      )
      check(
        `${String(width)}px: the header does not widen the page`,
        m.scroll <= m.vw,
        `${String(m.scroll)} of ${String(m.vw)}`,
      )
      check(
        `${String(width)}px: every header control is 44px to touch`,
        m.controls.length >= 5 && m.controls.every((c) => c.h >= 43.5),
        m.controls.map((c) => `${c.label}:${String(c.h)}`).join(' '),
      )
      check(
        `${String(width)}px: Sign out is an icon (its name is still Sign out)`,
        !m.signoutTextShown,
      )
    } else {
      check(
        `${String(width)}px: the desktop header still says Sign out in words`,
        m.signoutTextShown,
      )
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failed === 0 ? '\nall passed' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
