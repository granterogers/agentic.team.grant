// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * Two real browsers ("devices") against one fake office, through the page's real persistence path (#439, P1 data integrity).
 *
 * The fake office is a SERVER speaking the gateway's contract: `section=studio` returns each project with its saved Team HQ
 * arrangement (`layout_board`), and `dashboard_layout_set` stores the array it is given, last writer wins, exactly like the
 * real one. Each browser is its own context with its own localStorage. A note typed on one must reach the other, and no note may be
 * lost, whatever order the saves land in. Run:  npx tsx scripts/verify/canvas-devices.ts
 */
import '../../src/safety/arm.ts'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any

const API_PORT = 4676
let stored = null as any[] | null
const writes: string[] = []
let slow = 0
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'content-type': 'application/json',
}
const office = createServer((req, res) => {
  let raw = ''
  req.on('data', (c: Buffer) => {
    raw += c.toString()
  })
  req.on('end', () => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET') {
      const section = url.searchParams.get('section')
      res.writeHead(200, cors)
      if (section === 'studio') {
        res.end(
          JSON.stringify({
            data: {
              generated_at: new Date().toISOString(),
              crew: [
                { slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' },
              ],
              projects: [
                {
                  slug: 'riverside',
                  name: 'Riverside',
                  purpose: 'A made-up project for the two-device check.',
                  tasks: [],
                  documents: [],
                  contacts: [],
                  sources: [],
                  activity: [],
                  waiting: [],
                  modules: [],
                  requests: [],
                  layout_board: stored,
                },
              ],
            },
          }),
        )
        return
      }
      res.end(JSON.stringify({ data: [] }))
      return
    }
    const body = JSON.parse(raw === '' ? '{}' : raw) as { action?: string; args?: any }
    if (body.action === 'dashboard_layout_set') {
      const panels = body.args?.p_panels as any[]
      const reply = (): void => {
        stored = panels
        const meta = panels.find((m) => m.id === '__workspace')
        writes.push((meta?.postits ?? []).map((n: any) => n.text).join('|'))
        res.writeHead(200, cors)
        res.end(JSON.stringify({ result: { ok: true } }))
      }
      if (slow > 0) setTimeout(reply, slow)
      else reply()
      return
    }
    res.writeHead(200, cors)
    res.end(JSON.stringify({ result: { ok: true } }))
  })
})
await new Promise<void>((r) => office.listen(API_PORT, '127.0.0.1', () => r()))
const server = await serveStudio(4677)
const browser = await chromium.launch()
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}
const errors: string[] = []

const open = async (label: string) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(
    `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
     try { localStorage.setItem('hq.token', 'devices-token') } catch {}`,
  )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await page.goto('http://127.0.0.1:4677/p/riverside', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(800)
  return { ctx, page }
}
const noteTexts = (page: any): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.bcpostit .bcpostittext')]
      .map((e: any) => String(e.value ?? e.textContent ?? ''))
      .filter((t: string) => t !== '')
      .sort(),
  )
const addNote = async (page: any, text: string): Promise<void> => {
  if ((await page.locator('.bcpostit').count()) === 0)
    await page.locator('.bcnoteempty').first().click()
  else {
    await page.locator('.bcpostit').first().hover()
    await page
      .locator('.bcpostit [data-bc-note-add]')
      .first()
      .evaluate((el: any) => el.click())
  }
  await page.keyboard.type(text)
  await page.locator('[data-bc-board]').click({ position: { x: 5, y: 5 }, force: true })
}

const A = await open('A')
const B = await open('B')
check(
  'the office is reached as a signed-in writer',
  (await A.page.locator('.bcpostit, .bcnoteempty').count()) > 0,
)

/* Both devices type a note at the same moment: saves cross at the office. */
slow = 300
await Promise.all([addNote(A.page, 'note from A'), addNote(B.page, 'note from B')])
await A.page.waitForTimeout(1500)
check('the office was written to', writes.length >= 1, writes.join(' / '))
/* No reload on either side: the page's own check after its save, its once-a-minute check, and its redraw must do the work. */
await A.page.waitForTimeout(75_000)
const inOffice = (((stored ?? []).find((m: any) => m.id === '__workspace')?.postits ?? []) as any[])
  .map((n) => n.text)
  .sort()
check(
  'the office holds both notes without anyone reloading',
  inOffice.includes('note from A') && inOffice.includes('note from B'),
  JSON.stringify(inOffice),
)
console.log('office writes, in order:', JSON.stringify(writes))
const ta = await noteTexts(A.page)
const tb = await noteTexts(B.page)
check(
  'device A shows both notes without a reload',
  ta.includes('note from A') && ta.includes('note from B'),
  JSON.stringify(ta),
)
check(
  'device B shows both notes without a reload',
  tb.includes('note from A') && tb.includes('note from B'),
  JSON.stringify(tb),
)

/* A reload is just another device arriving: both notes are there, none twice. */
await B.page.reload({ waitUntil: 'domcontentloaded' })
await B.page.waitForSelector('[data-bc-board]')
await B.page.waitForTimeout(1500)
const after = await noteTexts(B.page)
check(
  'after a reload each note appears exactly once',
  after.filter((t) => t === 'note from A').length === 1 &&
    after.filter((t) => t === 'note from B').length === 1,
  JSON.stringify(after),
)
check('no page errors on either device', errors.length === 0, errors.join(' | '))

await A.ctx.close()
await B.ctx.close()
await browser.close()
server.close()
office.close()
let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail === '' ? '' : ` - ${c.detail}`}`)
}
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
