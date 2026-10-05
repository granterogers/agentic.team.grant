/**
 * An expired Google connection reads as a Reconnect state, and a Google that was never connected still reads as Connect.
 *   npx tsx scripts/p5/google-reconnect.ts      (local files only; no call to the office)
 *
 * Drives the real Settings page with the Drive connection put into each state through the page's own store, then reads
 * what a person would: the button, its words, the explanation, and what a person who is not the operator is told. Each
 * property has its control: the dead state must say Reconnect, the missing state must NOT, so a page that says Reconnect
 * for everything fails here.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  try {
    const body = await readFile(
      join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, '')),
    )
    res.writeHead(200, {
      'content-type':
        TYPES[extname(path) === '' ? '.html' : extname(path)] ?? 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4797, '127.0.0.1', () => r()))

const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
// The office is unreachable on purpose: this page is judged on the state it is handed, not on what answers.
await page.route(/\.supabase\.co\//, (route) => route.abort())
await page.goto('http://127.0.0.1:4797/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-settings]', { timeout: 30000 })
await page.waitForTimeout(1500)

const setup = async (state: string, operator: boolean): Promise<void> => {
  // A string: this file is Node, and neither the page's types nor its modules are in scope for the compiler.
  await page.evaluate(`(async () => {
    const m = await import('/settings.js')
    for (const c of m.CONNECTIONS) if (c.key === 'drive') c.state = ${JSON.stringify(state)}
    m.VIEWER.operator = ${String(operator)}
  })()`)
}
const read = async (): Promise<{
  text: string
  buttons: string[]
  connect: number
}> => {
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForSelector('#settings .stg-navitem', { timeout: 15000 })
  await page.locator('#settings [data-setting="connections"]').click({ force: true })
  await page.waitForTimeout(500)
  // A string, not a function: this file is Node, and the page's types are not in scope here.
  const out = (await page.evaluate(`(() => {
    const root = document.querySelector('#settings')
    const rows = [...root.querySelectorAll('.st-svc')].filter((r) => /drive/i.test(r.textContent ?? ''))
    return {
      text: rows.map((r) => r.innerText).join('\\n'),
      buttons: rows.flatMap((r) => [...r.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())),
      connect: root.querySelectorAll('[data-google-connect]').length,
    }
  })()`)) as { text: string; buttons: string[]; connect: number }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  return out
}

await setup('dead', true)
const dead = await read()
check(
  'an expired Google offers Reconnect Google',
  dead.buttons.includes('Reconnect Google'),
  dead.buttons.join(' | '),
)
check('and that button is the consent flow', dead.connect > 0)
check(
  'and says in plain words what happened and that nothing is lost',
  /no longer accepts the permission/i.test(dead.text) &&
    /nothing already read is lost/i.test(dead.text),
  dead.text.replace(/\s+/g, ' ').slice(0, 120),
)
check('it is not described as set up outside Team HQ', !/set up outside/i.test(dead.text))

await setup('missing', true)
const missing = await read()
check(
  'a Google that was never connected still says Connect Google, not Reconnect',
  missing.buttons.includes('Connect Google') && !missing.buttons.includes('Reconnect Google'),
  missing.buttons.join(' | '),
)

await setup('dead', false)
const other = await read()
check(
  'a person who is not the operator is told who reconnects it, with no button',
  other.connect === 0 && /whoever runs this Team HQ/i.test(other.text),
  other.text.replace(/\s+/g, ' ').slice(0, 120),
)

check('no page errors', errors.length === 0, errors.join('; ').slice(0, 120))
await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\ngoogle-reconnect: ${results.length - failed.length}/${results.length}`)
if (failed.length > 0) process.exitCode = 1
