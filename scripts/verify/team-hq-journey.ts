/*
 * TEAM HQ IS THE PRODUCT AT EVERY ADDRESS (#382).
 *
 *   npm run verify:team-hq-journey
 *
 * Until #382 the newer project workspace was reachable only under a /basecamp
 * prefix; the root and every plain link rendered the older studio, so manual
 * testing landed Grant in the interface he had asked to retire. This drives
 * the journey he takes - sign in, Team HQ, a project, its workspace - on a
 * desktop and on a phone, and asserts at every step that the screen is Team
 * HQ (its shell, never the older studio's rail), that the address is the
 * canonical one, and that nothing a person can see says "Basecamp".
 *
 * A fake office (the `window.HQ_API` seam) with projects A, B and the reserved
 * Unnamed, a fake sign-in function and a recorded conversation door. Nothing
 * leaves this machine: no Telegram, no Slack, no real office.
 */
import '../../src/safety/arm.ts'
import { createServer } from 'node:http'
import { type BrowserContext, chromium, devices, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4722
const API_PORT = 4723
const server = await serveStudio(PORT)
const ORIGIN = `http://127.0.0.1:${String(PORT)}`
const url = (p: string): string => `${ORIGIN}${p}`

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

const A = 'aaaaaaaa-0382-4000-8000-00000000000a'
const B = 'bbbbbbbb-0382-4000-8000-00000000000b'
const U = 'cccccccc-0382-4000-8000-00000000000c'
const who = (id: unknown): string =>
  id === A ? 'A' : id === B ? 'B' : id === U ? 'Unnamed' : id === undefined ? '(none)' : String(id)
const projectRow = (id: string, slug: string, name: string) => ({
  id,
  slug,
  name,
  purpose: `${name}, for the #382 journey. Nothing here is Grant's.`,
  tasks: [],
  documents: [],
  contacts: [],
  sources: [],
  activity: [],
  waiting: [],
  modules: [],
  requests: [],
  connectors: [],
})

/* How long the office takes to answer with its projects; section 6 slows it down. */
let studioDelay = 0
const studioBody = (): string =>
  JSON.stringify({
    data: {
      generated_at: new Date().toISOString(),
      crew: [{ slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' }],
      projects: [
        projectRow(A, 'journey-a', 'Journey A'),
        projectRow(B, 'journey-b', 'Journey B'),
        projectRow(U, 'unnamed', 'Unnamed'),
      ],
    },
  })
const office = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
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
      setTimeout(() => {
        res.writeHead(200, cors)
        res.end(studioBody())
      }, studioDelay)
      return
    }
    res.writeHead(200, cors)
    res.end(JSON.stringify(req.method === 'GET' ? { data: [] } : { result: { ok: true } }))
  })
})
await new Promise<void>((r) => office.listen(API_PORT, '127.0.0.1', () => r()))

const browser = await chromium.launch()

type Turn = { project: unknown; said: string }
type Seen = { turns: Turn[]; signin: { back?: string; action?: string }[]; errors: string[] }
const newContext = async (
  seen: Seen,
  opts: { signedIn: boolean; phone?: boolean },
): Promise<BrowserContext> => {
  const ctx = await browser.newContext(
    opts.phone === true ? { ...devices['iPhone 14'] } : { viewport: { width: 1440, height: 900 } },
  )
  await ctx.addInitScript(
    `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
     ${opts.signedIn ? "try { localStorage.setItem('hq.token', 'journey-token') } catch {}" : ''}`,
  )
  const json = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
  await ctx.route('**/signin**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      back?: string
      action?: string
    }
    seen.signin.push(body)
    await route.fulfill({
      status: 200,
      headers: json,
      body: JSON.stringify(
        body.action === 'whoami'
          ? { ok: true, email: 'journey@example.invalid' }
          : { ok: true, said: 'Check your email for a link to sign in.' },
      ),
    })
  })
  await ctx.route('**/voice*/turn**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      project?: unknown
      said?: string
    }
    seen.turns.push({ project: body.project, said: String(body.said ?? '') })
    await route.fulfill({
      status: 200,
      headers: json,
      body: JSON.stringify({ speak: 'Noted.', did: 'answered' }),
    })
  })
  return ctx
}

/* What the screen IS, read the way a person would meet it. */
type Screen = {
  path: string
  hash: string
  experience: string
  teamHq: number
  rail: number
  title: string
  basecamp: string[]
  classicLinks: number
  projectLinks: number
}
const screen = async (page: Page): Promise<Screen> =>
  JSON.parse(
    (await page.evaluate(
      inPage(`
        const words = []
        const say = (where, v) => { if (typeof v === 'string' && /basecamp/i.test(v)) words.push(where + ': ' + v.slice(0, 80)) }
        say('title', document.title)
        say('text', document.body.innerText)
        say('address', location.href)
        for (const el of document.querySelectorAll('*')) {
          for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'href', 'data-bc-go', 'value'])
            if (el.hasAttribute(a)) say(el.tagName.toLowerCase() + '[' + a + ']', el.getAttribute(a))
        }
        const links = [...document.querySelectorAll('[href], [data-bc-go]')]
          .map((el) => el.getAttribute('data-bc-go') ?? el.getAttribute('href') ?? '')
        return JSON.stringify({
          path: location.pathname,
          hash: location.hash,
          experience: document.documentElement.dataset.experience ?? 'none',
          teamHq: document.querySelectorAll('.bctop, .bcpanes, .bcmain').length,
          rail: document.querySelectorAll('.rail').length,
          title: document.title,
          basecamp: words,
          classicLinks: links.filter((l) => l.startsWith('/classic')).length,
          projectLinks: links.filter((l) => l.startsWith('/p/')).length,
        })`),
    )) as string,
  ) as Screen
const isTeamHq = (s: Screen): boolean => s.experience === 'basecamp' && s.teamHq > 0 && s.rail === 0
const describe = (s: Screen): string =>
  `${s.path}${s.hash} experience=${s.experience} teamHq=${String(s.teamHq)} rail=${String(s.rail)} basecamp=${String(s.basecamp.length)} classicLinks=${String(s.classicLinks)}`
const clean = (s: Screen): boolean =>
  s.basecamp.length === 0 && s.classicLinks === 0 && !/basecamp/i.test(s.title)
const settle = async (page: Page, ms = 900): Promise<void> => {
  await page.waitForTimeout(ms)
}
const open = async (page: Page, path: string): Promise<Screen> => {
  await page.goto(url(path), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bctop, .bcpanes, .bcmain, .rail', { timeout: 20000 })
  await settle(page, 1200)
  return screen(page)
}
/* A press, the way a person makes it: the visible link to that address. */
const press = async (page: Page, to: string): Promise<Screen> => {
  await page.locator(`[data-bc-go="${to}"]:visible`).first().click({ timeout: 10000 })
  await settle(page)
  return screen(page)
}
const everyScreen: Screen[] = []

for (const phone of [false, true]) {
  const leg = phone ? 'phone' : 'desktop'
  console.log(`\n--- ${leg} ---`)
  const seen: Seen = { turns: [], signin: [], errors: [] }

  /* --- 1. signed out: the root is Team HQ, and signing in comes back to it -- */
  {
    const ctx = await newContext(seen, { signedIn: false, phone })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => seen.errors.push(e.message))
    const out = await open(page, '/')
    everyScreen.push(out)
    check(
      `${leg}: signed out, / is Team HQ, not the older studio`,
      isTeamHq(out) && out.path === '/',
      describe(out),
    )
    const form = page.locator('[data-bc-signinform]:visible')
    if ((await form.count()) > 0) {
      await page.fill('#bc-email', 'journey@example.invalid')
      await page.locator('[data-bc-signin]:visible').first().click()
      await settle(page)
      const link = seen.signin.find((s) => s.action === 'link')
      check(
        `${leg}: the sign-in link returns to Team HQ at the root`,
        link?.back === `${ORIGIN}/`,
        `back = ${String(link?.back)}`,
      )
    } else {
      check(
        `${leg}: the signed-out root offers a way to sign in`,
        false,
        'no [data-bc-signinform] on screen',
      )
    }

    // Arriving from the email: a fresh page load with the session in the fragment.
    const fromEmail = await ctx.newPage()
    fromEmail.on('pageerror', (e) => seen.errors.push(e.message))
    const landed = await open(
      fromEmail,
      '/#access_token=journey-access&refresh_token=journey-refresh&expires_in=3600',
    )
    everyScreen.push(landed)
    check(
      `${leg}: arriving from the sign-in email lands in Team HQ, fragment cleared`,
      isTeamHq(landed) && landed.path === '/' && landed.hash === '',
      describe(landed),
    )
    const stored = (await fromEmail.evaluate(
      inPage("return Object.keys(localStorage).filter((k) => /session|token/i.test(k)).join(',')"),
    )) as string
    check(`${leg}: and the session is kept`, stored !== '', stored || 'nothing stored')
    await ctx.close()
  }

  /* --- 2. signed in: Team HQ -> a project -> its workspace, and between projects */
  {
    const ctx = await newContext(seen, { signedIn: true, phone })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => seen.errors.push(e.message))
    const home = await open(page, '/')
    everyScreen.push(home)
    check(
      `${leg}: / is the Team HQ portfolio, with its projects`,
      isTeamHq(home) && home.path === '/' && home.projectLinks > 0,
      describe(home),
    )
    const onA = await press(page, '/p/journey-a')
    everyScreen.push(onA)
    check(
      `${leg}: choosing a project opens its Team HQ workspace`,
      isTeamHq(onA) && onA.path === '/p/journey-a',
      describe(onA),
    )

    for (const tool of [
      'chat',
      'tasks',
      'schedule',
      'documents',
      'sources',
      'contacts',
      'activity',
      'team',
    ]) {
      const s = await open(page, `/p/journey-a/${tool}`)
      everyScreen.push(s)
      check(
        `${leg}: /p/journey-a/${tool} is Team HQ at that address`,
        isTeamHq(s) && s.path === `/p/journey-a/${tool}`,
        describe(s),
      )
    }

    // Between projects: back to the portfolio, then B. Never the older studio.
    const back = await press(page, '/')
    const onB = await press(page, '/p/journey-b')
    everyScreen.push(back, onB)
    check(
      `${leg}: moving to another project stays in Team HQ`,
      isTeamHq(back) && isTeamHq(onB) && onB.path === '/p/journey-b',
      `${describe(back)} then ${describe(onB)}`,
    )

    // Refresh keeps the place.
    await open(page, '/p/journey-b/tasks')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bctop, .bcpanes, .bcmain, .rail', { timeout: 20000 })
    await settle(page, 1200)
    const reloaded = await screen(page)
    check(
      `${leg}: a refresh on a project tool comes back to the same project and tool`,
      isTeamHq(reloaded) && reloaded.path === '/p/journey-b/tasks',
      describe(reloaded),
    )

    // Back walks Team HQ's own history.
    await open(page, '/p/journey-a')
    await press(page, '/p/journey-a/documents')
    await page.goBack()
    await settle(page)
    const wentBack = await screen(page)
    check(
      `${leg}: Back returns within Team HQ`,
      isTeamHq(wentBack) && wentBack.path === '/p/journey-a',
      describe(wentBack),
    )

    /* --- 3. old addresses land on their Team HQ equivalents -------------- */
    const old: [string, string][] = [
      ['/basecamp', '/'],
      ['/basecamp/', '/'],
      ['/basecamp/p/journey-a', '/p/journey-a'],
      ['/basecamp/p/journey-a/documents', '/p/journey-a/documents'],
      ['/basecamp/p/journey-b/chat', '/p/journey-b/chat'],
      ['/basecamp/tasks', '/tasks'],
      ['/studio/', '/'],
      ['/studio/p/journey-b/team', '/p/journey-b/team'],
      // The older studio's own project links, which used the same scheme.
      ['/p/journey-a/overview', '/p/journey-a'],
      ['/p/journey-a/team', '/p/journey-a/team'],
      ['/activity', '/activity'],
      ['/p/a-project-that-is-gone/tasks', '/'],
    ]
    for (const [from, to] of old) {
      const s = await open(page, from)
      everyScreen.push(s)
      check(
        `${leg}: ${from} resolves to Team HQ at ${to}`,
        isTeamHq(s) && s.path === to,
        describe(s),
      )
    }

    /* --- 4. the dock and the project Chat say which project they are ----- */
    const before = seen.turns.length
    await open(page, '/p/journey-a')
    await page.locator('[data-bc-dock]:visible').first().click({ timeout: 8000 })
    await settle(page, 600)
    await page.locator('#dock [data-docksay]').fill(`Journey from the dock on A (${leg})`)
    await page.locator('#dock [data-dockform] button[type="submit"]').click()
    await settle(page)
    // In-app navigation: on a phone the open dock covers the page's own links.
    for (const to of ['/', '/p/journey-b']) {
      await page.evaluate(
        inPage(
          `history.pushState({}, '', ${JSON.stringify(to)}); dispatchEvent(new PopStateEvent('popstate'))`,
        ),
      )
      await settle(page)
    }
    const dockNote = (await page.evaluate(
      inPage(
        "return document.querySelector('#dock [data-bc-noteproject]')?.getAttribute('data-bc-noteproject') ?? ''",
      ),
    )) as string
    await page.locator('#dock [data-docksay]').fill(`Journey from the dock, looking at B (${leg})`)
    await page.locator('#dock [data-dockform] button[type="submit"]').click()
    await settle(page)
    await page.locator('#dock [data-dock-close]').click()
    await settle(page, 400)
    await open(page, '/p/journey-b/chat')
    await page.fill('#bc-say', `Journey from B's Chat (${leg})`)
    await page.keyboard.press('Enter')
    await settle(page)
    const mine = seen.turns.slice(before)
    check(
      `${leg}: the dock opened on A states A, and stays on A after moving to B`,
      who(mine[0]?.project) === 'A' && who(mine[1]?.project) === 'A' && dockNote === 'journey-a',
      mine.map((t) => `${who(t.project)}: ${t.said}`).join(' | '),
    )
    check(
      `${leg}: B's project Chat states B`,
      who(mine[2]?.project) === 'B' && mine.length === 3,
      mine.map((t) => `${who(t.project)}: ${t.said}`).join(' | '),
    )

    /* --- 5. the older studio is kept, and only where nothing links ------- */
    const classic = await open(page, '/classic')
    check(
      `${leg}: the older studio is still reachable at /classic, and only there`,
      classic.experience === 'none' && classic.rail > 0 && classic.path === '/classic',
      describe(classic),
    )
    await ctx.close()
  }

  /* --- 6. a refresh before the office has answered keeps the project -- */
  /*
    Until the office's projects land, a link to a real project cannot
    resolve, and the page shows the portfolio meanwhile. It used to write "/"
    into the address while it did, so a refresh in that window - five seconds
    on a slow answer, measured live - reloaded "/" and the project was lost.
  */
  {
    studioDelay = 3000
    const ctx = await newContext(seen, { signedIn: true, phone })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => seen.errors.push(e.message))
    await page.goto(url('/p/journey-b/tasks'), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bctop, .bcpanes, .bcmain', { timeout: 20000 })
    await settle(page, 800)
    const waiting = (await page.evaluate('location.pathname')) as string
    check(
      `${leg}: while the office has not answered, the address is still the project's`,
      waiting === '/p/journey-b/tasks',
      `address ${waiting} before the projects landed`,
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bctop, .bcpanes, .bcmain', { timeout: 20000 })
    await settle(page, 4200)
    const after = await screen(page)
    check(
      `${leg}: a refresh before the office answered still lands on that project`,
      isTeamHq(after) && after.path === '/p/journey-b/tasks',
      describe(after),
    )
    // And a dead link still ends on the portfolio once it has been tried.
    await page.goto(url('/p/a-project-that-is-gone/tasks'), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bctop, .bcpanes, .bcmain', { timeout: 20000 })
    await settle(page, 4200)
    const gone = await screen(page)
    check(
      `${leg}: a link to a gone project still ends on the portfolio`,
      isTeamHq(gone) && gone.path === '/',
      describe(gone),
    )
    studioDelay = 0
    await ctx.close()
  }

  check(`${leg}: nothing threw`, seen.errors.length === 0, seen.errors.slice(0, 3).join(' | '))
}

/* --- across every Team HQ screen this pass opened ------------------------- */
const teamHqScreens = everyScreen.filter(isTeamHq)
const dirty = teamHqScreens.filter((s) => !clean(s))
check(
  `no Team HQ screen says "Basecamp" or links to the older studio (${String(teamHqScreens.length)} screens)`,
  dirty.length === 0,
  dirty
    .slice(0, 4)
    .map(
      (s) =>
        `${s.path}: ${s.basecamp.slice(0, 2).join(' ; ')} classicLinks=${String(s.classicLinks)}`,
    )
    .join(' | '),
)
check(
  'the browser title names Team HQ',
  teamHqScreens.every((s) => /Team HQ/.test(s.title) && !/Studio/.test(s.title)),
  [...new Set(teamHqScreens.map((s) => s.title))].join(' | '),
)

await browser.close()
await server.close()
office.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exitCode = fail === 0 ? 0 : 1
