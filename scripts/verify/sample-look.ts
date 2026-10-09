// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * The Sample Office as a visitor sees it, drawn against a FAKE gateway this file serves (no production, no token of
 * ours): a sample session (`hq.session` with `sample: true`), one project with a long made-up description, and the
 * "How this project looks" sheet. Captures at the four brief viewports into .out/ux/sample/ and ASSERTS the property the
 * brief asked for: the description and the sheet are compact, nothing overflows sideways and nothing is clipped.
 *   npx tsx scripts/verify/sample-look.ts
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const API_PORT = 4671
const LONG =
  'Harvest Lane is a made-up neighbourhood café used to show how the team works. It has a lunch menu, a small events ' +
  'calendar, a supplier list, a launch budget and a handful of open tasks. Everything here is invented so that nothing ' +
  'you change is saved, and nothing in it belongs to a real business or a real person. Ask the team anything about it: ' +
  'what is overdue, what the launch costs, who is waiting on whom, or what to do first this week.'
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'content-type': 'application/json',
}
const office = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  const section = url.searchParams.get('section')
  res.writeHead(200, cors)
  if (section === 'studio') {
    res.end(
      JSON.stringify({
        data: {
          generated_at: new Date().toISOString(),
          crew: [{ slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' }],
          projects: [
            {
              slug: 'harvest-lane',
              name: 'Harvest Lane Café',
              purpose: LONG,
              tasks: [],
              documents: [],
              contacts: [],
              sources: [],
              activity: [],
              waiting: [],
              modules: [],
              requests: [],
            },
          ],
        },
      }),
    )
    return
  }
  res.end(JSON.stringify({ data: [], result: { ok: true } }))
})
await new Promise<void>((r) => office.listen(API_PORT, '127.0.0.1', () => r()))
const server = await serveStudio(4672)
const browser = await chromium.launch()
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}
const errors: string[] = []
for (const sz of ['1440x900', '1920x1080', '768x1024', '390x844']) {
  const [w = 1440, h = 900] = sz.split('x').map(Number)
  const dir = '.out/ux/sample'
  await mkdir(dir, { recursive: true })
  const touch = w < 600
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
  })
  await ctx.addInitScript(
    `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
     try { localStorage.setItem('hq.session', JSON.stringify({ access_token: 'a.b.' + 'x'.repeat(70), refresh_token: 'r', expires_at: Date.now() + 36000000, sample: true })) } catch {}`,
  )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${sz}: ${e.message}`))
  await page.goto('http://127.0.0.1:4672/p/harvest-lane', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${dir}/${sz}-1-project.png` })
  const bar = await page.locator('.bcsamplebar').count()
  check(`${sz}: the Sample strip is drawn`, bar === 1, String(bar))
  if (bar === 1) {
    const hgt = await page
      .locator('.bcsamplebar')
      .evaluate((e: any) => e.getBoundingClientRect().height)
    check(`${sz}: the strip is compact`, hgt <= (w < 600 ? 120 : 64), `${hgt}px`)
  }
  const over = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )
  check(`${sz}: no sideways overflow on the project page`, Number(over) <= 0, `${over}px`)
  const menu = page.locator('[data-bc-pagemenu]')
  if ((await menu.count()) > 0) {
    await menu.click({ force: true })
    await page.locator('[data-bc-look]').click({ force: true })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}/${sz}-2-look.png` })
    const mark = page.locator('[data-icon-picker] button').first()
    if ((await mark.count()) > 0) await mark.click({ force: true })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${dir}/${sz}-3-look-mark-chosen.png` })
    const box = await page.evaluate(
      `(() => { const s = document.querySelector('#viewer .sheet'); if (!s) return null; const r = s.getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight } })()`,
    )
    const b = box as { w: number; h: number; vw: number; vh: number } | null
    check(`${sz}: the sheet is drawn`, b !== null)
    if (b !== null) {
      check(`${sz}: the sheet fits the window`, b.w <= b.vw && b.h <= b.vh, JSON.stringify(b))
    }
  } else check(`${sz}: the project menu exists`, false)
  await ctx.close()
}
await browser.close()
server.close()
office.close()
let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail === '' ? '' : ` - ${c.detail}`}`)
}
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} passed`)
if (errors.length > 0) console.log(errors.join('\n'))
process.exit(bad === 0 && errors.length === 0 ? 0 : 1)
