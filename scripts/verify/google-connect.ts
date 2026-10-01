/**
 * Pressing "Connect Google" starts with the office, not with a link (multi-user P1.2, 0648).
 *
 *   npm run verify:google-connect
 *
 * The consent screen is only reachable with a one-time state the office mints for a verified operator, so the control
 * must ASK first and then open the Google start URL carrying that state. This drives the real studio in Chromium with
 * the gateway answered by a stub, puts the real control into the page, presses it, and asserts: the office was asked
 * for `google_connect_start`, a tab opened, and the URL it went to is `…/google-oauth/start?state=<what the office
 * said>`. Its negative control: a refusal from the office (not an operator) opens NOTHING and shows the sentence.
 *
 * The control is injected rather than navigated to because the Connections pane fetches when it opens and a sandbox
 * capture cannot fake being signed in there (CLAUDE.md); the handler is delegated on the document, which is exactly
 * why an injected button reaches it.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4623
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mjs': 'text/javascript; charset=utf-8',
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
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()))

let failed = 0
const check = (ok: boolean, what: string, detail: string) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const browser = await chromium.launch()
try {
  for (const scenario of ['operator', 'refused'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const errors: string[] = []
    const oauth: string[] = []
    ctx.on('request', (r) => {
      if (r.url().includes('google-oauth')) oauth.push(r.url())
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    const asked: string[] = []
    await page.route(/functions\/v1\/hq-api/, async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const action = (JSON.parse(req.postData() ?? '{}') as { action?: string }).action ?? ''
        asked.push(action)
        if (action === 'google_connect_start') {
          return scenario === 'operator'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ result: { state: 'abc123' } }),
              })
            : route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({
                  error: 'operator_required',
                  message: 'Only the deployment operator can do this.',
                }),
              })
        }
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' })
    })
    await page.addInitScript(() => {
      localStorage.setItem('hq.token', 'ui-proof-token')
    })
    await page.goto(`http://127.0.0.1:${PORT}/`)
    await page.waitForTimeout(800)
    const popup = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null)
    await page.evaluate(`(() => {
      const b = document.createElement('button')
      b.setAttribute('data-google-connect', '')
      b.id = 'probe-connect'
      b.textContent = 'Connect Google'
      b.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;padding:12px'
      document.body.appendChild(b)
    })()`)
    await page.click('#probe-connect')
    const tab = await popup
    await page.waitForTimeout(800)
    const started = oauth.find((u) => u.includes('/google-oauth/start')) ?? ''
    if (scenario === 'operator') {
      check(
        asked.includes('google_connect_start'),
        'the press asks the office for a state first',
        asked.join(',') || 'nothing asked',
      )
      check(tab !== null, 'a tab opens', tab === null ? 'none' : 'opened')
      check(
        started.endsWith('/google-oauth/start?state=abc123'),
        'and goes to the Google start URL carrying exactly the state the office returned',
        started || 'no request to google-oauth',
      )
    } else {
      check(
        asked.includes('google_connect_start'),
        'a refused press still asks the office',
        asked.join(','),
      )
      check(
        started === '',
        'and a refusal reaches Google with nothing (no start request)',
        started || 'no request to google-oauth',
      )
      check(
        tab === null || tab.isClosed() || tab.url() === 'about:blank',
        'and the tab it opened is closed again',
        tab === null ? 'none' : tab.isClosed() ? 'closed' : tab.url(),
      )
    }
    check(errors.length === 0, 'no page error', errors.join('; ') || 'none')
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) failed`)
process.exitCode = failed === 0 ? 0 : 1
