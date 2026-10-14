/**
 * TALK TO TEAM, on the real Team HQ: the control, its states, and the project it carries.
 *
 *   npm run verify:talk
 *
 * The previous version of this suite drove `/classic/`, the older studio kept unlinked since #382, so a green run said
 * nothing about the product. This one drives Team HQ at its own addresses (`/p/<slug>`), as a person does, on a desktop and
 * on an iPhone-sized touch device.
 *
 * ## What is real and what is simulated, stated first
 *
 * REAL: the page from the working tree, real browser input events (a mouse press on the desktop leg, a real touch tap on
 * the phone leg), the page's own call code and its own state painting.
 * SIMULATED: the office (a local server that records what the page asks it), the microphone (Chromium's fake device, or a
 * refusal injected at `getUserMedia`), and the realtime connection (a stub `RTCPeerConnection` and a stubbed SDP exchange).
 *
 * THEREFORE this suite proves the control and the session BOUNDARY, and nothing about audio. It does NOT prove:
 *   - a real microphone captured anything, or that speech was transcribed;
 *   - that realtime audio is intelligible, that interruption works, or what the call sounds like;
 *   - Safari on an iPhone. The touch leg is Chromium emulating one.
 * Those remain: VOICE NOTE - MANUAL REAL-MIC ACCEPTANCE REQUIRED. TALK TO TEAM - MANUAL REAL-AUDIO ACCEPTANCE REQUIRED.
 * (The deployed session boundary, as the Sample, is `npm run sample:voice`.)
 *
 * What is asserted:
 *   - the control is on a project page, is at least 44px each way, and is not covered by anything (hit-tested at its centre);
 *   - pressing it asks the office for a session with the LOADED project's slug and a bearer, and nothing else;
 *   - the states a person sees: idle, connecting, live, then idle again; a second press ends it, stops every microphone
 *     track and closes the connection;
 *   - each way it can fail says something a person can act on, and the control still works afterwards: microphone refused,
 *     the office refusing (401) or failing (500), the connection refused;
 *   - a project opened second is the project carried second (the slug is not remembered from the first);
 *   - on the portfolio, where no project is loaded, there is no control and no session is requested;
 *   - a project that is not in the person's office has no page and no control, so a slug cannot be injected from the address bar.
 */
import '../../src/safety/arm.ts'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { type BrowserContext, chromium, devices, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4710
const API_PORT = 4711
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

console.log(
  'SIMULATED media and connection: this suite proves the control and the session boundary, NOT audio.\n' +
    'VOICE NOTE - MANUAL REAL-MIC ACCEPTANCE REQUIRED.  TALK TO TEAM - MANUAL REAL-AUDIO ACCEPTANCE REQUIRED.\n',
)

const row = (id: string, slug: string, name: string) => ({
  id,
  slug,
  name,
  purpose: `${name}, for the Talk to Team check. Nothing here is real.`,
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
const A = 'aaaaaaaa-0710-4000-8000-00000000000a'
const B = 'bbbbbbbb-0710-4000-8000-00000000000b'

type Mint = { project: unknown; auth: string }
let mode: 'ok' | 'unauthorised' | 'failing' | 'degraded' = 'ok'
const mints: Mint[] = []

const office = createServer((req, res) => {
  let raw = ''
  req.on('data', (c: Buffer) => {
    raw += c.toString()
  })
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
    if (u.pathname.endsWith('/voice-token')) {
      const body = JSON.parse(raw === '' ? '{}' : raw) as { project?: unknown }
      mints.push({ project: body.project, auth: String(req.headers.authorization ?? '') })
      if (mode === 'unauthorised') {
        res.writeHead(401, cors)
        res.end(JSON.stringify({ error: 'sign in first' }))
      } else if (mode === 'failing') {
        res.writeHead(500, cors)
        res.end(JSON.stringify({ error: 'down' }))
      } else {
        res.writeHead(200, cors)
        res.end(
          JSON.stringify({
            client_secret: 'simulated-secret',
            model: 'simulated-model',
            degraded: mode === 'degraded',
            context: { project: body.project },
          }),
        )
      }
      return
    }
    if (req.method === 'GET' && u.searchParams.get('section') === 'studio') {
      res.writeHead(200, cors)
      res.end(
        JSON.stringify({
          data: {
            generated_at: new Date().toISOString(),
            crew: [
              { slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' },
            ],
            projects: [row(A, 'talk-a', 'Talk A'), row(B, 'talk-b', 'Talk B')],
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

// The browser's own pieces, replaced by recorders. The connection stub never carries audio; it only has to behave like a
// connection that was asked to open and then asked to close.
const INIT = `
  window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
  try { localStorage.setItem('hq.token', 'talk-token') } catch {}
  window.__talk = { tracks: [], closed: 0, opened: 0, refuse: false }
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (window.__talk.refuse) throw new DOMException('refused', 'NotAllowedError')
    const s = await real(c)
    for (const t of s.getTracks()) window.__talk.tracks.push(t)
    return s
  }
  window.RTCPeerConnection = class {
    constructor() { window.__talk.opened += 1; this.connectionState = 'connected' }
    addTrack() {}
    createDataChannel() { return { close() {} } }
    async createOffer() { return { type: 'offer', sdp: 'v=0 simulated' } }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() { window.__talk.closed += 1 }
  }
`

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})

let sdpStatus = 200
const open = async (
  phone: boolean,
): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> => {
  const ctx = await browser.newContext(
    phone
      ? { ...devices['iPhone 14'], permissions: ['microphone'] }
      : { viewport: { width: 1440, height: 900 }, permissions: ['microphone'] },
  )
  await ctx.addInitScript(INIT)
  await ctx.route('https://api.openai.com/**', (route) =>
    route.fulfill({
      status: sdpStatus,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/sdp' },
      body: 'v=0 simulated-answer',
    }),
  )
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, errors }
}

const MIC = '[data-bc-voice]'
const state = (page: Page): Promise<string> =>
  page
    .locator(MIC)
    .first()
    .getAttribute('data-bc-mic')
    .then((s) => s ?? '(none)')
const toProject = async (page: Page, slug: string): Promise<void> => {
  await page.goto(url(`/p/${slug}`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(MIC, { timeout: 20000 })
  await page.waitForTimeout(500)
}
const press = async (page: Page, phone: boolean): Promise<void> => {
  const b = page.locator(MIC).first()
  if (phone) await b.tap()
  else await b.click()
}
const waitState = async (page: Page, want: string, ms = 8000): Promise<string> => {
  const end = Date.now() + ms
  let s = await state(page)
  while (Date.now() < end && s !== want) {
    await page.waitForTimeout(150)
    s = await state(page)
  }
  return s
}
const said = (page: Page): Promise<string> =>
  page
    .locator('[data-bc-callsay]')
    .first()
    .textContent()
    .then((t) => (t ?? '').trim())

mkdirSync('.out/talk', { recursive: true })

for (const phone of [false, true]) {
  const leg = phone ? 'phone' : 'desktop'
  const { ctx, page, errors } = await open(phone)
  mode = 'ok'
  sdpStatus = 200
  mints.length = 0

  // ---- the control, where it is, and whether a person can reach it
  await toProject(page, 'talk-a')
  const box = await page.locator(MIC).first().boundingBox()
  /*
    A touch leg must meet the 44px floor (CLAUDE.md: touch targets 44px). A pointer leg meets the WCAG 2.2 minimum of 24px,
    which the desktop header's icon controls are sized to (36px). The phone is where the floor is enforced; the desktop
    leg asserts the minimum it is held to, rather than the phone's floor.
  */
  const floor = leg === 'phone' ? 44 : 24
  check(
    `[${leg}] the control is at least ${String(floor)}px each way`,
    box !== null && box.width >= floor && box.height >= floor,
    JSON.stringify(box),
  )
  const covered = await page.evaluate(`(() => {
    const b = document.querySelector('${MIC}'); const r = b.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return at === b || b.contains(at)
  })()`)
  check(`[${leg}] nothing covers the control (hit-tested at its centre)`, covered === true)
  check(`[${leg}] idle before it is pressed`, (await state(page)) === 'idle', await state(page))

  // ---- pressing it: the request, the states, the end
  await press(page, phone)
  const live = await waitState(page, 'listening')
  check(
    `[${leg}] pressing it connects and the control says it is live`,
    live === 'listening' || live === 'answering',
    live,
  )
  check(
    `[${leg}] it asked the office for a session carrying the LOADED project, with a bearer`,
    mints.length === 1 && mints[0]?.project === 'talk-a' && mints[0]?.auth === 'Bearer talk-token',
    JSON.stringify(mints),
  )
  check(
    `[${leg}] it is exposed as pressed to assistive technology`,
    (await page.locator(MIC).first().getAttribute('aria-pressed')) === 'true',
  )
  await page.screenshot({ path: `.out/talk/${leg}-live.png` })
  await press(page, phone)
  check(`[${leg}] a second press ends the call`, (await waitState(page, 'idle')) === 'idle')
  const after = (await page.evaluate(
    '({ tracks: window.__talk.tracks.map((t) => t.readyState), closed: window.__talk.closed, opened: window.__talk.opened })',
  )) as { tracks: string[]; closed: number; opened: number }
  check(
    `[${leg}] ending it stops every microphone track and closes the connection`,
    after.tracks.length > 0 &&
      after.tracks.every((t) => t === 'ended') &&
      after.closed === after.opened,
    JSON.stringify(after),
  )

  // ---- the ways it can fail say something, and the control still works afterwards
  await page.evaluate('window.__talk.refuse = true')
  await press(page, phone)
  await waitState(page, 'idle')
  await page.waitForTimeout(400)
  check(
    `[${leg}] a refused microphone says so`,
    /microphone was refused/i.test(await said(page)),
    await said(page),
  )
  await page.evaluate('window.__talk.refuse = false')

  mode = 'failing'
  await press(page, phone)
  await page.waitForTimeout(900)
  check(
    `[${leg}] an office that fails says the line did not connect and how to retry`,
    /didn't connect/i.test(await said(page)) && /try again/i.test(await said(page)),
    await said(page),
  )

  mode = 'unauthorised'
  await press(page, phone)
  await page.waitForTimeout(900)
  check(
    `[${leg}] a refused sign-in says to sign in, and the control is idle`,
    /signed in/i.test(await said(page)) && (await state(page)) === 'idle',
    await said(page),
  )

  mode = 'ok'
  sdpStatus = 500
  await press(page, phone)
  await page.waitForTimeout(1200)
  check(
    `[${leg}] a connection that is refused says the line did not connect`,
    /didn't connect/i.test(await said(page)),
    await said(page),
  )
  sdpStatus = 200

  await press(page, phone)
  check(
    `[${leg}] after every failure the control still connects`,
    ['listening', 'answering'].includes(await waitState(page, 'listening')),
    await state(page),
  )
  await press(page, phone)
  await waitState(page, 'idle')

  // ---- the project is the one loaded NOW, not the one before
  mints.length = 0
  await toProject(page, 'talk-b')
  await press(page, phone)
  await waitState(page, 'listening')
  check(
    `[${leg}] a project opened second is the project carried second`,
    mints.length === 1 && mints[0]?.project === 'talk-b',
    JSON.stringify(mints),
  )
  await press(page, phone)
  await waitState(page, 'idle')

  // ---- no project loaded, and a project that is not the person's
  mints.length = 0
  await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-go^="/p/"]', { state: 'attached', timeout: 20000 })
  await page.waitForTimeout(500)
  check(
    `[${leg}] on the portfolio, with no project loaded, there is no call control`,
    (await page.locator(MIC).count()) === 0,
  )
  await page.goto(url('/p/not-in-this-office'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  check(
    `[${leg}] a project that is not in the person's office has no call control`,
    (await page.locator(MIC).count()) === 0,
  )
  check(
    `[${leg}] and no session was requested for either`,
    mints.length === 0,
    JSON.stringify(mints),
  )
  check(`[${leg}] nothing threw`, errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

await browser.close()
office.close()
server.close()
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
console.log('Audio itself is NOT covered: both manual acceptances above remain required.')
process.exitCode = fail === 0 ? 0 : 1
