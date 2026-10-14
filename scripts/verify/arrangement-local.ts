// @ts-nocheck: the code the page runs is written against the browser's DOM, which this project's type setup does not load
// (the tsconfig has no DOM library, on purpose). The file is checked by running it, which is what the verifier is for.
/*
 * Drag, resize and the saved layout, on the Team HQ board, in a real Chromium, against a mocked office. Nothing from
 * production. (The earlier suite, scripts/verify/arrangement.ts, read the production database through the Management API
 * and drove /classic/, which main no longer serves. This is its local replacement.)
 *   npm run verify:arrangement-local
 *
 * What it asserts, at desktop 1440 x 900 (the phone board is stacked and offers no drag or resize, by design):
 *   A. what the office holds is what is drawn: a placed module at the office's position is drawn there
 *   B. a drag leaves the browser: the save is a dashboard_layout_set request whose panel moved
 *   C. a resize leaves the browser: the save carries the new width
 *   D. a second device with no local copy draws what the office now holds, and the office holds a moved copy
 * Control: ARRANGEMENT_CONTROL=local-only makes the office refuse to keep any save, which is what a page that keeps the
 * arrangement only in its own browser looks like from outside. B, C and D must then go red.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright'

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
    // A dotless path is a route of the single page, so it gets the shell.
    if (extname(path) === '') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(await readFile('web/studio/index.html'))
      return
    }
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4795, '127.0.0.1', () => r()))

const ORIGIN = 'http://127.0.0.1:4795'
const SIGNIN = 'https://signin.test/mock/signin'
const GATEWAY = 'https://gw.test/mock/hq-api'
const SLUG = 'legacy-coaching-course'
const PLANTED = { x: 40, y: 40, w: 420, h: 300 }
const session = JSON.stringify({
  access_token: 'writer-token-for-tests',
  refresh_token: 'refresh-for-tests',
  expires_at: Date.now() + 60 * 60 * 1000,
})

/** The office's copy of the board: what the gateway returns as layout_board, and what a save replaces. */
type Panels = Record<string, unknown>[]
const planted = (): Panels => [
  {
    id: '__workspace',
    v: 2,
    hasMods: true,
    zoom: 1,
    pan: { x: 0, y: 0 },
    layouts: {},
    postits: [],
    gone: {},
    seeded: true,
    bg: null,
  },
  { id: 'tasks', ...PLANTED, z: 1, tint: null, placed: true },
]

// Run with ARRANGEMENT_CONTROL=local-only to see the checks go red: the office never keeps a save.
const LOCAL_ONLY = process.env.ARRANGEMENT_CONTROL === 'local-only'

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const browser = await chromium.launch()

/** A writer's browser with the office held in `office.panels`, and every save it makes captured in `saves`. */
async function openDevice(
  office: { panels: Panels },
  saves: Record<string, unknown>[],
  options: { withLocalCopy: boolean; width: number; mobile: boolean },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.mobile ? 844 : 900 },
    isMobile: options.mobile,
    hasTouch: options.mobile,
  })
  await context.addInitScript(
    ({ signin, gateway, sess, local }) => {
      const w = window as unknown as Record<string, string>
      w.HQ_SIGNIN = signin
      w.HQ_API = gateway
      if (localStorage.getItem('hq.session') === null) localStorage.setItem('hq.session', sess)
      if (!local) {
        // A second device: nothing of this board is stored in its browser.
        for (const k of Object.keys(localStorage))
          if (k.startsWith('bc.')) localStorage.removeItem(k)
      }
    },
    { signin: SIGNIN, gateway: GATEWAY, sess: session, local: options.withLocalCopy },
  )
  await context.route(`${SIGNIN}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, said: 'not in this check' }),
    }),
  )
  await context.route(`${GATEWAY}*`, async (route) => {
    const url = new URL(route.request().url())
    const section = url.searchParams.get('section') ?? ''
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (section === 'studio') {
      return json(200, {
        data: {
          projects: [
            {
              id: 'legacy-id',
              slug: SLUG,
              name: 'Legacy Coaching Course',
              brief: 'A brief long enough to read as the brief of a real project.',
              status: 'active',
              layout_board: office.panels,
            },
          ],
          crew: [],
          appearance: null,
          avatar_base: '',
        },
      })
    }
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
      if (body.action === 'dashboard_layout_set' && !LOCAL_ONLY) {
        // The page sends { action, args }: the arguments are what the office stores.
        const args = (body.args ?? {}) as Record<string, unknown>
        saves.push({ action: body.action, ...args })
        if (Array.isArray(args.p_panels)) office.panels = args.p_panels as Panels
      }
      return json(200, { result: { ok: true } })
    }
    return json(200, { data: {} })
  })
  await context.route('https://**', (route) => route.abort())
  const page = await context.newPage()
  return { context, page }
}

/** The module's box relative to the stage, in board units (zoom 1, pan 0 read as pixels). */
const boxOf = (page: Page) =>
  page.evaluate(() => {
    const m = document.querySelector('[data-mod="tasks"]') as HTMLElement | null
    const stage = document.querySelector('.bcstage') as HTMLElement | null
    if (m === null || stage === null) return null
    const r = m.getBoundingClientRect()
    const s = stage.getBoundingClientRect()
    return {
      x: Math.round(r.left - s.left),
      y: Math.round(r.top - s.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    }
  })

/** A press and drag with the mouse, in steps, the way a pointer moves. */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i += 1)
    await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10)
  await page.mouse.up()
}

const centreOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox()
  if (box === null) return null
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const SAVE_WAIT_MS = 9000
const waitForSave = (saves: Record<string, unknown>[], before: number) =>
  new Promise<boolean>((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (saves.length > before) return resolve(true)
      if (Date.now() - started > SAVE_WAIT_MS) return resolve(false)
      setTimeout(tick, 150)
    }
    tick()
  })

for (const [label, width, mobile] of [['desktop', 1440, false]] as const) {
  const office = { panels: planted() }
  const saves: Record<string, unknown>[] = []
  const { context, page } = await openDevice(office, saves, {
    withLocalCopy: true,
    width,
    mobile,
  })
  await page.goto(`${ORIGIN}/p/${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page
    .waitForFunction(() => document.querySelector('[data-mod="tasks"]') !== null, null, {
      timeout: 12000,
    })
    .catch(() => undefined)

  // A. What the office holds is what is drawn.
  const first = await boxOf(page)
  check(
    `${label}: A. the office's placed module is drawn at the office's position`,
    first !== null && Math.abs(first.x - PLANTED.x) <= 3 && Math.abs(first.y - PLANTED.y) <= 3,
    first === null
      ? 'no module drawn'
      : `drawn at ${String(first.x)},${String(first.y)} size ${String(first.w)}x${String(first.h)}`,
  )

  // B. A drag leaves the browser as a save that moves the panel.
  const before = saves.length
  const grip = await centreOf(page, '[data-mod="tasks"] .bcmodhead')
  if (grip === null) {
    check(`${label}: B. the module has a header to drag`, false, 'no header')
  } else {
    await drag(page, grip, 120, 60)
    const saved = await waitForSave(saves, before)
    const moved = saves.at(-1)?.p_panels as Panels | undefined
    const tasks = moved?.find((p) => p.id === 'tasks') as { x?: number; y?: number } | undefined
    check(
      `${label}: B. a drag is saved to the office as a moved panel`,
      saved &&
        tasks !== undefined &&
        Math.abs((tasks.x ?? 0) - PLANTED.x) > 20 &&
        saves.at(-1)?.action === 'dashboard_layout_set',
      saved
        ? `saved ${JSON.stringify((moved ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h }))).slice(0, 220)}`
        : 'no save arrived',
    )
  }

  // C. A resize leaves the browser as a save that carries the new width.
  const beforeResize = saves.length
  const handle = await centreOf(page, '[data-mod="tasks"] [data-bc-resize]')
  if (handle === null) {
    check(`${label}: C. the module has a resize handle`, false, 'no handle')
  } else {
    await drag(page, handle, 100, 0)
    const saved = await waitForSave(saves, beforeResize)
    const resized = saves.at(-1)?.p_panels as Panels | undefined
    const tasks = resized?.find((p) => p.id === 'tasks') as { w?: number } | undefined
    check(
      `${label}: C. a resize is saved to the office with the new width`,
      saved && (tasks?.w ?? 0) > PLANTED.w + 20,
      saved ? `saved w ${String(tasks?.w)}` : 'no save arrived',
    )
  }
  await context.close()

  // D. A second device, with nothing stored in its browser, draws what the office now holds.
  const second = await openDevice(office, [], { withLocalCopy: false, width, mobile })
  await second.page.goto(`${ORIGIN}/p/${SLUG}`, { waitUntil: 'domcontentloaded' })
  await second.page
    .waitForFunction(() => document.querySelector('[data-mod="tasks"]') !== null, null, {
      timeout: 12000,
    })
    .catch(() => undefined)
  await second.page.waitForTimeout(800)
  const elsewhere = await boxOf(second.page)
  const officeTasks = office.panels.find((p) => p.id === 'tasks') as
    | { x?: number; w?: number }
    | undefined
  // The office must hold a MOVED copy, or this proves nothing: a planted position would pass for any second device.
  const officeMoved = officeTasks !== undefined && (officeTasks.x ?? PLANTED.x) !== PLANTED.x
  check(
    `${label}: D. a second device draws the office's saved position, not the planted one`,
    officeMoved &&
      elsewhere !== null &&
      officeTasks !== undefined &&
      Math.abs(elsewhere.x - (officeTasks.x ?? -999)) <= 3 &&
      Math.abs(elsewhere.w - (officeTasks.w ?? -999)) <= 3,
    elsewhere === null
      ? 'no module drawn'
      : `drawn at ${String(elsewhere.x)} width ${String(elsewhere.w)}; office holds x ${String(officeTasks?.x)} w ${String(officeTasks?.w)}`,
  )
  await second.context.close()
}

await browser.close()
server.close()
console.log(
  failed === 0
    ? '\nArrangement, locally: every check passed.'
    : `\nArrangement, locally: ${String(failed)} check(s) FAILED.`,
)
process.exitCode = failed === 0 ? 0 : 1
