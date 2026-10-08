// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * The DEPLOYED review copy, exercised as an application in real Chromium (#439).
 *   npm run trust:proxy-ca && npx tsx scripts/verify/preview-app.ts [https://team-hq-ux-review.vercel.app]
 *
 * What is real and what is not, stated once:
 *  - REAL: the page, every script and stylesheet, served by Vercel from the deployed commit, and its own `config.js`.
 *  - STAND-IN: the office. The page is pointed at a gateway this file serves on 127.0.0.1 through `window.HQ_API`, the seam every
 *    harness here uses and which `config.js` defers to. So this contacts NO production service and mints NO session: the production
 *    sign-in function allows only the production page's origin, so a browser on the preview cannot sign in (see the log). The stand-in
 *    answers with the page's own mock projects, remembers the arrangement the page saves, and can refuse (401) or vanish.
 * What it proves is therefore the deployed APPLICATION's behaviour over a gateway of the right shape, not the live office's data.
 *
 * Each assertion is recorded as pass, fail, n/a (cannot apply here, with the reason) or env (the environment failed to load a
 * resource; counted separately and never as a pass). Only `pass` counts as passing.
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any
declare const localStorage: any

const base = (process.argv[2] ?? 'https://team-hq-ux-review.vercel.app').replace(/\/$/, '')
const OUT = '.out/preview-app'
await mkdir(OUT, { recursive: true })

/* The page's own mock projects, read from the local prototype, become the stand-in office's answer. */
const local = await serveStudio(4693)
const lb = await chromium.launch()
const lp = await lb.newPage()
await lp.goto('http://127.0.0.1:4693/', { waitUntil: 'domcontentloaded' })
const mock = JSON.parse(
  (await lp.evaluate(
    `import('/data.js').then((m) => JSON.stringify({ projects: m.PROJECTS, crew: m.CREW.map((c) => ({ slug: c.staffSlug ?? c.slug, name: c.name, role: c.role, state: 'idle', expertise: c.expertise ?? [] })) }))`,
  )) as string,
) as { projects: any[]; crew: any[] }
await lb.close()
local.close()

/* ---- the stand-in office ---- */
const layouts: Record<string, any[]> = {}
const writes: { slug: string; panels: any[] }[] = []
let mode: 'ok' | 'refuse' = 'ok'
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'content-type': 'application/json',
}
const PORT = 4694
const office = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }
  if (mode === 'refuse') {
    res.writeHead(401, cors)
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'POST') {
    let raw = ''
    req.on('data', (c) => {
      raw += String(c)
    })
    req.on('end', () => {
      const b = JSON.parse(raw || '{}') as { action?: string; args?: any }
      if (b.action === 'dashboard_layout_set') {
        const slug = String(b.args?.p_slug)
        layouts[slug] = b.args?.p_panels ?? []
        writes.push({ slug, panels: layouts[slug] ?? [] })
      }
      res.writeHead(200, cors)
      res.end(JSON.stringify({ result: { ok: true } }))
    })
    return
  }
  res.writeHead(200, cors)
  if (url.searchParams.get('section') === 'studio') {
    res.end(
      JSON.stringify({
        data: {
          generated_at: new Date().toISOString(),
          crew: mock.crew,
          projects: mock.projects.map((p) => ({ ...p, layout_board: layouts[p.slug] })),
        },
      }),
    )
    return
  }
  if (url.searchParams.get('section') === 'style') {
    res.end(
      JSON.stringify({
        data: {
          scope: 'project',
          profile: { palette: { primary: '#3b4a57' } },
          inherited_from: { 'palette.primary': 'project' },
          vocabulary: {
            fonts: ['Helvetica', 'Times'],
            palette: ['primary', 'accent', 'ink', 'paper', 'wash', 'rule'],
            title_pages: ['standard', 'band'],
          },
        },
      }),
    )
    return
  }
  res.end(JSON.stringify({ data: {} }))
})
await new Promise<void>((r) => office.listen(PORT, '127.0.0.1', () => r()))

type Verdict = 'pass' | 'fail' | 'n/a' | 'env'
const results: { name: string; v: Verdict; detail: string }[] = []
const rec = (name: string, v: Verdict, detail = ''): void => {
  results.push({ name, v, detail })
}
const check = (name: string, ok: boolean, detail = ''): void =>
  rec(name, ok ? 'pass' : 'fail', detail)

const browser = await chromium.launch()
const SESSION = `try { localStorage.setItem('hq.session', JSON.stringify({ access_token: 'a.b.' + 'x'.repeat(70), refresh_token: 'r', expires_at: Date.now() + 36000000 })) } catch {}`
const gw = `window.HQ_API = 'http://127.0.0.1:${String(PORT)}/hq-api'`
const FAKE_REC = `
  window.__recs = []
  class R { constructor() { window.__recs.push(this) } start() { setTimeout(() => this.onstart && this.onstart(), 0) } abort() { setTimeout(() => this.onend && this.onend(), 0) } }
  window.SpeechRecognition = R; window.webkitSpeechRecognition = R`

const open = async (
  w: number,
  h: number,
  opts: { session?: boolean; scheme?: 'light' | 'dark' } = {},
) => {
  const touch = w < 600
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
  })
  const env: string[] = []
  const errors: string[] = []
  await ctx.addInitScript(gw)
  await ctx.addInitScript(FAKE_REC)
  if (opts.session !== false) await ctx.addInitScript(SESSION)
  if (opts.scheme !== undefined)
    await ctx.addInitScript(
      `try { localStorage.setItem('studio.appearance', JSON.stringify({ scheme: '${opts.scheme}' })) } catch {}`,
    )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => {
    /* A failure on the preview's own files with no x-vercel-id was not sent by Vercel: the sandbox proxy. Environmental. */
    if (r.status() >= 400 && r.url().startsWith(base) && r.headers()['x-vercel-id'] === undefined)
      env.push(`${String(r.status())} ${r.url()}`)
  })
  return { ctx, page, env, errors }
}

const ready = async (page: Page, path = '/'): Promise<void> => {
  /* The sandbox proxy sometimes cuts a script transfer (no x-vercel-id): one more load, and the load is counted as environmental by `open`. */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(base + path, { waitUntil: 'domcontentloaded' })
    const ok = await page
      .waitForSelector('[data-bc-menu]', { timeout: 20000 })
      .then(() => true)
      .catch(() => false)
    if (ok) break
    if (attempt === 2) throw new Error(`the page did not start after three loads: ${path}`)
  }
  await page.waitForTimeout(900)
}
const stageView = (page: Page): Promise<{ x: number; y: number; zoom: number } | null> =>
  page.evaluate(() => {
    const t = document.querySelector('.bcstage')
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(
      t?.style.transform ?? '',
    )
    return m === null ? null : { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
  })
const bare = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
    return { x: r.x + r.width * 0.92, y: r.y + r.height * 0.85 }
  }) as Promise<{ x: number; y: number }>
const overflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) as Promise<number>
const pickProject = async (page: Page, nth: number): Promise<string> => {
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem').nth(nth).click()
  await page.waitForSelector('[data-bc-board]', { timeout: 15000 })
  await page.waitForTimeout(800)
  return new URL(page.url()).pathname
}

/* ===== 1. authentication boundary: no session means no workspace ===== */
{
  const { ctx, page, errors } = await open(1440, 900, { session: false })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const text = (await page.evaluate(() => document.body.innerText)) as string
  check('signed out: the entry is shown, not a workspace', /Explore a Sample Office/.test(text))
  check(
    'signed out: no board and none of the example office is drawn',
    (await page.locator('[data-bc-board]').count()) === 0 && !/Legacy Coaching/.test(text),
  )
  await page.screenshot({ path: `${OUT}/01-signed-out.png` })
  check('signed out: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* ===== 2. the workspace, desktop, light ===== */
const desk = await open(1440, 900, { scheme: 'light' })
{
  const { page, ctx } = desk
  await ready(page)
  await page.screenshot({ path: `${OUT}/02-home-desktop-light.png` })
  const first = await pickProject(page, 0)
  check('project selection opens a project address', /\/p\//.test(first), first)
  const second = await pickProject(page, 1)
  check('a second project is a different address', second !== first, `${first} / ${second}`)
  await page.goBack()
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(600)
  check('browser Back returns to the first project', new URL(page.url()).pathname === first)
  await page.screenshot({ path: `${OUT}/03-project-desktop-light.png` })
  check('a project shows its modules', (await page.locator('[data-mod]').count()) >= 3)
  check('no sideways overflow on the project', (await overflow(page)) <= 1)

  /* infinite canvas: zoom and pan */
  const b = await bare(page)
  const v0 = await stageView(page)
  await page.mouse.move(b.x, b.y)
  for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -250)
  await page.waitForTimeout(400)
  const v1 = await stageView(page)
  check(
    'wheel zooms in about the pointer',
    (v1?.zoom ?? 0) > (v0?.zoom ?? 9),
    `${String(v0?.zoom)} -> ${String(v1?.zoom)}`,
  )
  await page.screenshot({ path: `${OUT}/04-zoomed-in.png` })
  await page.mouse.move(b.x, b.y)
  await page.mouse.down()
  await page.mouse.move(b.x - 200, b.y - 90, { steps: 8 })
  await page.mouse.up()
  const v2 = await stageView(page)
  check(
    'dragging the empty canvas pans it',
    v1 !== null && v2 !== null && (Math.abs(v2.x - v1.x) > 100 || Math.abs(v2.y - v1.y) > 40),
    `${JSON.stringify(v1)} -> ${JSON.stringify(v2)}`,
  )
  await page.click('[data-bc-viewreset]')
  await page.waitForTimeout(400)

  /* dragging and resizing a module, then persistence through the office */
  const before = (await page.evaluate(() => {
    const r = document.querySelector('[data-mod="contacts"]').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })) as { x: number; y: number; w: number; h: number }
  const head = (await page.evaluate(() => {
    const r = document.querySelector('[data-mod="contacts"] .bcmodhead').getBoundingClientRect()
    return { x: r.x + 20, y: r.y + 8 }
  })) as { x: number; y: number }
  await page.mouse.move(head.x, head.y)
  await page.mouse.down()
  /* Up and across, so the resize handle (bottom-right) stays inside the 900px viewport: a press outside it cannot land. */
  await page.mouse.move(head.x + 90, head.y - 60, { steps: 8 })
  await page.mouse.up()
  const rz = (await page.evaluate(() => {
    const r = document
      .querySelector('[data-mod="contacts"] [data-bc-resize]')
      .getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })) as { x: number; y: number }
  await page.mouse.move(rz.x, rz.y)
  await page.mouse.down()
  await page.mouse.move(rz.x + 80, rz.y + 40, { steps: 6 })
  await page.mouse.up()
  const after = (await page.evaluate(() => {
    const r = document.querySelector('[data-mod="contacts"]').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })) as { x: number; y: number; w: number; h: number }
  check(
    'a module can be dragged',
    Math.abs(after.x - before.x) > 40 || Math.abs(after.y - before.y) > 20,
  )
  check(
    'a module can be resized',
    Math.abs(after.w - before.w) > 30 || Math.abs(after.h - before.h) > 15,
  )

  /* Post-it: create, edit */
  if ((await page.locator('.bcpostit').count()) === 0)
    await page.locator('.bcnoteempty').first().click()
  else {
    await page.locator('.bcpostit').first().hover()
    await page
      .locator('.bcpostit [data-bc-note-add]')
      .first()
      .evaluate((el: any) => el.click())
  }
  await page.keyboard.type('Call the roofer before Friday')
  await page.locator('[data-bc-board]').click({ position: { x: 5, y: 5 }, force: true })
  await page.waitForTimeout(600)
  const notes = (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('.bcpostit .bcpostittext')]
        .map((e: any) => String(e.value ?? ''))
        .filter((t: string) => t !== ''),
    ) as Promise<string[]>
  check(
    'a Post-it can be created and typed into',
    (await notes()).includes('Call the roofer before Friday'),
  )
  const noteEl = page
    .locator('.bcpostit .bcpostittext', { hasText: '' })
    .filter({ hasNot: page.locator('x') })
  const target = (await noteEl.count()) > 0 ? noteEl.last() : null
  if (target !== null) {
    await target.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' (edited)')
    await page.locator('[data-bc-board]').click({ position: { x: 5, y: 5 }, force: true })
    await page.waitForTimeout(500)
  }
  check(
    'and edited afterwards',
    (await notes()).some((t) => t.includes('(edited)')),
  )

  /* persistence: the arrangement reached the office, and a reload restores it */
  await page.waitForTimeout(3500)
  const slug = first.split('/')[2] ?? ''
  check(
    'the arrangement was saved to the office',
    (layouts[slug] ?? []).length > 0,
    `${String(writes.length)} writes`,
  )
  await page.goto(base + first, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(900)
  const restored = (await page.evaluate(() => {
    const r = document.querySelector('[data-mod="contacts"]').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })) as { x: number; y: number; w: number; h: number }
  check(
    'a reload restores the module where it was put',
    Math.abs(restored.x - after.x) < 3 && Math.abs(restored.w - after.w) < 3,
    `${JSON.stringify(after)} -> ${JSON.stringify(restored)}`,
  )
  check(
    'and the Post-it',
    (await notes()).some((t) => t.includes('(edited)')),
  )
  /* a second browser profile with no local state learns it from the office alone */
  const other = await open(1440, 900, { scheme: 'light' })
  await ready(other.page, first)
  await other.page.waitForSelector('[data-bc-board]')
  await other.page.waitForTimeout(900)
  const onOther = (await other.page.evaluate(() => {
    const r = document.querySelector('[data-mod="contacts"]').getBoundingClientRect()
    return { w: r.width }
  })) as { w: number }
  check(
    'a fresh browser gets the arrangement from the office',
    Math.abs(onOther.w - after.w) < 3,
    `${String(after.w)} vs ${String(onOther.w)}`,
  )
  await other.ctx.close()

  /* compact Team Chat, long message wrapping */
  if ((await page.locator('.dock [data-docksay]').count()) === 0) await page.click('[data-bc-dock]')
  await page.waitForSelector('.dock [data-docksay]')
  const dockW = (await page.evaluate(
    () => document.querySelector('.dock').getBoundingClientRect().width,
  )) as number
  check(
    'Team Chat is compact on a desktop',
    dockW <= 460 && dockW >= 240,
    `${String(Math.round(dockW))}px`,
  )
  await page.fill(
    '[data-docksay]',
    `Ask the team at Riverside Cafe lunch ${'x'.repeat(0)}${'and again '.repeat(8)} https://example.com/${'x'.repeat(90)}`,
  )
  await page.locator('.dock [type=submit]').click()
  await page.waitForTimeout(700)
  const wrap = (await page.evaluate(() => {
    const d = document.querySelector('.dock')
    return {
      dock: d.getBoundingClientRect().width,
      scroll: d.scrollWidth,
      page: document.documentElement.scrollWidth - window.innerWidth,
    }
  })) as { dock: number; scroll: number; page: number }
  check(
    'a long message and a long link wrap inside the dock',
    wrap.scroll <= wrap.dock + 1 && wrap.page <= 1,
    JSON.stringify(wrap),
  )
  await page.screenshot({ path: `${OUT}/05-chat-long-desktop.png` })
  const g = (await page.evaluate(() => {
    const r = document.querySelector('.dockgrip').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })) as { x: number; y: number }
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  await page.mouse.move(g.x - 200, g.y, { steps: 6 })
  await page.mouse.up()
  const dockW2 = (await page.evaluate(
    () => document.querySelector('.dock').getBoundingClientRect().width,
  )) as number
  check(
    'the dock can be resized',
    dockW2 > dockW + 60,
    `${String(Math.round(dockW))} -> ${String(Math.round(dockW2))}`,
  )
  await page.click('[data-dock-close]')

  /* Document Style, How this project looks, Settings */
  await page.locator('[data-bc-pagemenu]').click({ force: true })
  await page.locator('[data-bc-look]').click({ force: true })
  await page.waitForTimeout(500)
  const sheet = await page.evaluate(
    `(() => { const s = document.querySelector('#viewer .sheet'); if (!s) return null; const r = s.getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight } })()`,
  )
  const sh = sheet as { w: number; h: number; vw: number; vh: number } | null
  check(
    'How this project looks opens and fits the window',
    sh !== null && sh.w <= sh.vw && sh.h <= sh.vh,
    JSON.stringify(sh),
  )
  await page.screenshot({ path: `${OUT}/06-how-this-project-looks.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.locator('[data-bc-pagemenu]').click({ force: true })
  await page.locator('[data-bc-style]').first().click({ force: true })
  await page.waitForTimeout(700)
  const sty = (await page.evaluate(() => {
    const h = document.querySelector('.bcstyh')
    let s = h
    while (s?.parentElement && s.getBoundingClientRect().height < 150) s = s.parentElement
    const r = s?.getBoundingClientRect()
    return r
      ? {
          w: r.width,
          h: r.height,
          vw: window.innerWidth,
          vh: window.innerHeight,
          title: h.textContent,
        }
      : null
  })) as { w: number; h: number; vw: number; vh: number; title: string } | null
  await page.screenshot({ path: `${OUT}/07-document-style.png` })
  check(
    'Document Style opens, is drawn (not empty) and fits the window',
    sty !== null && sty.w > 100 && sty.h > 100 && sty.w <= sty.vw && sty.h <= sty.vh,
    JSON.stringify(sty),
  )
  await page.keyboard.press('Escape')
  const errs = desk.errors
  check('no page errors across the desktop session', errs.length === 0, errs.join(' | '))
  if (desk.env.length > 0) rec('every preview file loaded', 'env', desk.env.join(' | '))
  await ctx.close()
}

/* ===== 3. appearance: dark, through the stored choice the page itself reads ===== */
{
  const d = await open(1440, 900, { scheme: 'dark' })
  await ready(d.page)
  const shown = await d.page.evaluate(() => document.documentElement.dataset.scheme ?? '')
  check('dark is drawn when chosen', shown === 'dark', shown)
  await pickProject(d.page, 0)
  await d.page.screenshot({ path: `${OUT}/08-project-desktop-dark.png` })
  check('dark: no sideways overflow', (await overflow(d.page)) <= 1)
  check('dark: no page errors', d.errors.length === 0, d.errors.join(' | '))
  await d.ctx.close()
}

/* ===== 4. responsive: phone and tablet ===== */
for (const [label, w, h] of [
  ['phone', 390, 844],
  ['tablet', 768, 1024],
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    const p = await open(w, h, { scheme })
    await ready(p.page)
    await pickProject(p.page, 0)
    await p.page.screenshot({ path: `${OUT}/09-${label}-${scheme}.png` })
    check(
      `${label} ${scheme}: no sideways overflow`,
      (await overflow(p.page)) <= 1,
      `${String(await overflow(p.page))}px`,
    )
    if ((await p.page.locator('.dock [data-docksay]').count()) === 0)
      await p.page.click('[data-bc-dock]')
    await p.page.waitForSelector('.dock [data-docksay]')
    await p.page.screenshot({ path: `${OUT}/10-${label}-${scheme}-chat.png` })
    check(
      `${label} ${scheme}: chat open, no sideways overflow`,
      (await overflow(p.page)) <= 1,
      `${String(await overflow(p.page))}px`,
    )
    check(`${label} ${scheme}: no page errors`, p.errors.length === 0, p.errors.join(' | '))
    await p.ctx.close()
  }
}

/* ===== 5. error states ===== */
{
  const r = await open(1440, 900, { scheme: 'light' })
  await ready(r.page)
  await pickProject(r.page, 0)
  mode = 'refuse'
  await r.page.reload({ waitUntil: 'domcontentloaded' })
  await r.page.waitForTimeout(4000)
  const text = (await r.page.evaluate(() => document.body.innerText)) as string
  await r.page.screenshot({ path: `${OUT}/11-office-refuses.png` })
  check(
    'a refused credential is not shown as a working office or as invented projects',
    !/Legacy Coaching/.test(text) && (await r.page.locator('[data-mod]').count()) === 0,
    text.replace(/\s+/g, ' ').slice(0, 120),
  )
  mode = 'ok'
  await r.ctx.close()

  const down = await open(1440, 900, { scheme: 'light' })
  await down.ctx.route(`http://127.0.0.1:${String(PORT)}/**`, (route) => route.abort())
  await down.page.goto(base, { waitUntil: 'domcontentloaded' })
  await down.page.waitForTimeout(5000)
  const t2 = (await down.page.evaluate(() => document.body.innerText)) as string
  await down.page.screenshot({ path: `${OUT}/12-office-unreachable.png` })
  check(
    'an unreachable office draws no invented projects and does not claim there is nothing',
    !/Legacy Coaching/.test(t2) && !/No projects yet/i.test(t2),
    t2.replace(/\s+/g, ' ').slice(0, 140),
  )
  await down.ctx.close()
}

/* ===== not applicable here, said plainly ===== */
rec(
  'signing in on the preview with a real person or the Sample',
  'n/a',
  'the production sign-in function allows only the production page origin; not changed',
)
rec(
  'real data from the live office',
  'n/a',
  'a stand-in gateway is used; nothing is read from or written to production',
)
rec(
  'real-microphone dictation and real touch pinch',
  'n/a',
  'needs a person and a device; the manual test document covers it',
)

await browser.close()
office.close()
const tally: Record<Verdict, number> = { pass: 0, fail: 0, 'n/a': 0, env: 0 }
for (const r of results) {
  tally[r.v] += 1
  const tag = r.v === 'pass' ? 'pass' : r.v === 'fail' ? 'FAIL' : r.v === 'n/a' ? 'n/a ' : 'env '
  console.log(`${tag}  ${r.name}${r.detail === '' ? '' : ` - ${r.detail}`}`)
}
console.log(
  `\n${String(tally.pass)} passed, ${String(tally.fail)} failed, ${String(tally['n/a'])} not applicable, ${String(tally.env)} environmental (of ${String(results.length)} recorded; only "passed" counts as passing)`,
)
process.exit(tally.fail === 0 ? 0 : 1)
