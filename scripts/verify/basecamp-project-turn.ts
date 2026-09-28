/*
 * THE PAGE SAYS WHICH PROJECT A TURN CAME FROM (#373).
 *
 *   npm run verify:basecamp-project-turn
 *
 * The frontend half of #373. `chat.js` posted `{ said, session, to, also }`
 * to `/voice/turn`, so every Team HQ message and voice note reached the office
 * with no project, and the office had to guess where it belonged. The page
 * knows exactly which project's thread it is writing into, and says so now:
 * `project` is that thread's id. The backend half, and what the office does
 * with it, is `scripts/isolated/project-provenance.ts`.
 *
 * A fake office (`window.HQ_API`, the seam office.js already reads) with
 * three projects — A, B and the reserved Unnamed — and a recorded voice door.
 * Nothing leaves this machine. Every property is read from what the page
 * actually POSTED, never from what the screen says.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { type BrowserContext, chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4702
const API_PORT = 4703
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const A = 'aaaaaaaa-0373-4000-8000-00000000000a'
const B = 'bbbbbbbb-0373-4000-8000-00000000000b'
const U = 'cccccccc-0373-4000-8000-00000000000c'
const who = (id: unknown): string =>
  id === A ? 'A' : id === B ? 'B' : id === U ? 'Unnamed' : id === undefined ? '(none)' : String(id)
const projectRow = (id: string, slug: string, name: string) => ({
  id,
  slug,
  name,
  purpose: `${name}, for the #373 check. Nothing here is Grant's.`,
  tasks: [],
  documents: [],
  contacts: [],
  sources: [],
  activity: [],
  waiting: [],
  modules: [],
  requests: [],
})

const office = createServer((req, res) => {
  let raw = ''
  req.on('data', (c: Buffer) => {
    raw += c.toString()
  })
  req.on('end', () => {
    void raw
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'content-type': 'application/json',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }
    const u = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET' && u.searchParams.get('section') === 'studio') {
      res.writeHead(200, cors)
      res.end(
        JSON.stringify({
          data: {
            generated_at: new Date().toISOString(),
            crew: [
              { slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' },
            ],
            projects: [
              projectRow(A, 'provenance-a', 'Provenance A'),
              projectRow(B, 'provenance-b', 'Provenance B'),
              projectRow(U, 'unnamed', 'Unnamed'),
            ],
          },
        }),
      )
      return
    }
    res.writeHead(200, cors)
    res.end(JSON.stringify(req.method === 'GET' ? { data: [] } : { result: { ok: true } }))
  })
})
await new Promise<void>((r) => office.listen(API_PORT, '127.0.0.1', () => r()))

mkdirSync('.out/voice', { recursive: true })
execFileSync('espeak-ng', [
  '-v',
  'en-gb',
  '-s',
  '145',
  '-w',
  '.out/voice/project-note.wav',
  'What still needs doing on this project?',
])

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${process.cwd()}/.out/voice/project-note.wav%noloop`,
  ],
})

type Turn = { project: unknown; said: string; session: string; page: string }
const newContext = async (
  turns: Turn[],
  opts: { failFirst?: boolean } = {},
): Promise<BrowserContext> => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
  })
  await ctx.addInitScript(
    `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
     try { localStorage.setItem('hq.token', 'provenance-token') } catch {}`,
  )
  let failed = false
  await ctx.route('**/voice*/turn**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      project?: unknown
      said?: string
      session?: string
    }
    turns.push({
      project: body.project,
      said: String(body.said ?? ''),
      session: String(body.session ?? ''),
      page: route.request().frame()?.url() ?? '',
    })
    if (opts.failFirst === true && !failed) {
      failed = true
      await route.fulfill({
        status: 502,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'the office is not answering right now' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ speak: 'Noted.', did: 'answered' }),
    })
  })
  await ctx.route('**/voice*/note**', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ heard: 'What still needs doing on this project?' }),
    }),
  )
  return ctx
}

/* In-app navigation: a reload is a new visit, and the point is ONE visit. */
const go = async (page: Page, path: string, sel: string): Promise<void> => {
  await page.evaluate(
    inPage(
      `history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate'))`,
    ),
  )
  await page.waitForSelector(sel, { timeout: 15000 })
  await page.waitForTimeout(500)
}
const say = async (page: Page, text: string): Promise<void> => {
  await page.fill('#bc-say', text)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
}
const dock = async (page: Page, text: string): Promise<void> => {
  const state = (await page.evaluate(
    inPage(
      `return { buttons: [...document.querySelectorAll('[data-bc-dock]')].map((b) => b.getBoundingClientRect().width + 'x' + b.getBoundingClientRect().height + ':' + (b.closest('[hidden]') ? 'hidden' : 'shown')), open: document.querySelector('#dock')?.className ?? 'no dock', path: location.pathname }`,
    ),
  )) as unknown
  if (process.env.DEBUG_DOCK) console.log('dock state', JSON.stringify(state))
  /* Open it only when it is shut: after a send the dock stays open and its
     button is hidden, which is the product working. */
  if ((await page.locator('#dock [data-docksay]:visible').count()) === 0) {
    await page.locator('[data-bc-dock]:visible').first().click({ timeout: 8000 })
    await page.waitForTimeout(600)
  }
  await page.locator('#dock [data-docksay]').fill(text)
  await page.locator('#dock [data-dockform] button[type="submit"]').click()
  await page.waitForTimeout(900)
}

/* --- 1. typed Chat: the same words from A and from B, interleaved -------- */
{
  const turns: Turn[] = []
  const ctx = await newContext(turns)
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => thrown.push(e.message))
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-go^="/basecamp/p/provenance-a"]', { timeout: 20000 })
  for (const [slug, n] of [
    ['provenance-a', 1],
    ['provenance-b', 1],
    ['provenance-a', 2],
    ['provenance-b', 2],
  ] as const) {
    await go(page, `/basecamp/p/${slug}/chat`, '[data-bc-sayform]')
    await say(page, n === 1 ? 'What still needs doing?' : `And after that? (${slug} ${String(n)})`)
  }
  check('the page reached the door four times', turns.length === 4, String(turns.length))
  check(
    'the same words from A and from B are stated as A and as B',
    who(turns[0]?.project) === 'A' &&
      who(turns[1]?.project) === 'B' &&
      turns[0]?.said === turns[1]?.said,
    turns
      .slice(0, 2)
      .map((t) => `${who(t.project)}: ${t.said}`)
      .join(' | '),
  )
  check(
    'interleaved A B A B are stated A B A B',
    turns.map((t) => who(t.project)).join(' ') === 'A B A B',
    turns.map((t) => who(t.project)).join(' '),
  )
  check('all four are one visit (one session)', new Set(turns.map((t) => t.session)).size === 1)

  /* --- 2. the dock, on a project and on the portfolio -------------------- */
  const before = turns.length
  await go(page, '/basecamp/p/provenance-b', '.bcmain')
  await dock(page, 'From the dock on B')
  await go(page, '/basecamp', '[data-bc-go^="/basecamp/p/"]')
  await dock(page, 'From the dock on the portfolio')
  const docked = turns.slice(before)
  check('the dock on B states B', who(docked[0]?.project) === 'B', who(docked[0]?.project))
  check(
    'the dock on the portfolio states Unnamed, where #149 files it — never the last project open',
    who(docked[1]?.project) === 'Unnamed',
    who(docked[1]?.project),
  )
  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* --- 3. a voice note, recorded on A --------------------------------------- */
{
  const turns: Turn[] = []
  const ctx = await newContext(turns)
  const page = await ctx.newPage()
  await page.goto(url('/basecamp/p/provenance-a/chat'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sayform]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.locator('[data-bc-note]').first().click()
  await page.waitForTimeout(1600)
  await page.locator('[data-bc-notestop]').click()
  await page.waitForTimeout(900)
  await page.locator('[data-bc-notesend]').click()
  await page.waitForTimeout(2000)
  check(
    'a voice note recorded on A reaches the door stated as A',
    turns.length === 1 && who(turns[0]?.project) === 'A',
    turns.map((t) => `${who(t.project)}: ${t.said}`).join(' | '),
  )
  await ctx.close()
}

/* --- 4. Try again after a failure keeps the project ------------------------ */
{
  const turns: Turn[] = []
  const ctx = await newContext(turns, { failFirst: true })
  const page = await ctx.newPage()
  await page.goto(url('/basecamp/p/provenance-b/chat'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sayform]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await say(page, 'This one fails first')
  await page.waitForSelector('[data-bc-chatretry]', { timeout: 10000 })
  await page.locator('[data-bc-chatretry]').first().click()
  await page.waitForTimeout(1500)
  check(
    'the retry of a failed turn on B is stated as B again',
    turns.length === 2 && turns.every((t) => who(t.project) === 'B'),
    turns.map((t) => who(t.project)).join(' '),
  )
  await ctx.close()
}

/* --- 5. two tabs, two projects, sending at once --------------------------- */
{
  const turns: Turn[] = []
  const ctx = await newContext(turns)
  const tabA = await ctx.newPage()
  const tabB = await ctx.newPage()
  await tabA.goto(url('/basecamp/p/provenance-a/chat'), { waitUntil: 'domcontentloaded' })
  await tabB.goto(url('/basecamp/p/provenance-b/chat'), { waitUntil: 'domcontentloaded' })
  await tabA.waitForSelector('[data-bc-sayform]', { timeout: 20000 })
  await tabB.waitForSelector('[data-bc-sayform]', { timeout: 20000 })
  await tabA.waitForTimeout(500)
  await tabA.fill('#bc-say', 'Sent from tab A')
  await tabB.fill('#bc-say', 'Sent from tab B')
  await Promise.all([tabA.keyboard.press('Enter'), tabB.keyboard.press('Enter')])
  await tabA.waitForTimeout(1500)
  const fromA = turns.find((t) => t.said === 'Sent from tab A')
  const fromB = turns.find((t) => t.said === 'Sent from tab B')
  check(
    'two tabs on two projects each state their own, whichever is focused',
    who(fromA?.project) === 'A' && who(fromB?.project) === 'B',
    `A tab -> ${who(fromA?.project)}, B tab -> ${who(fromB?.project)}`,
  )
  await ctx.close()
}

await browser.close()
await server.close()
office.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exitCode = fail === 0 ? 0 : 1
