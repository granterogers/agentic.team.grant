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
import '../../src/safety/arm.ts'
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
  // The default dashboard's project panel reads it; Basecamp never did.
  connectors: [],
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
  opts: { failFirst?: boolean; delayMs?: number } = {},
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
    if (opts.delayMs !== undefined) await new Promise((r) => setTimeout(r, opts.delayMs))
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({
        speak: opts.delayMs === undefined ? 'Noted.' : `Answer to: ${String(body.said ?? '')}`,
        did: 'answered',
      }),
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
  await page.waitForSelector('[data-bc-go^="/p/provenance-a"]', {
    state: 'attached',
    timeout: 20000,
  })
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
  await go(page, '/basecamp', '[data-bc-go^="/p/"]')
  /*
    What the open dock SHOWS on the portfolio (#416). No project is loaded there, so the dock does not pick one for the
    person (it used to keep B's thread, and before that fall to Unnamed): it offers a choice and has nothing to type into.
  */
  const onPortfolio = (await page.evaluate(
    inPage(
      "return { composer: document.querySelectorAll('#dock [data-dockform]').length, picks: [...document.querySelectorAll('#dock [data-dock-pick]')].map((b) => b.getAttribute('data-dock-pick')), head: (document.querySelector('#dock .dockhead')?.textContent ?? '').replace(/\\s+/g, ' ').trim() }",
    ),
  )) as { composer: number; picks: string[]; head: string }
  const docked = turns.slice(before)
  check('the dock on B states B', who(docked[0]?.project) === 'B', who(docked[0]?.project))
  check(
    'with no project loaded the dock offers a choice of project and nothing to type into',
    onPortfolio.composer === 0 &&
      onPortfolio.picks.includes('provenance-a') &&
      onPortfolio.picks.includes('provenance-b') &&
      /No project open/.test(onPortfolio.head),
    JSON.stringify(onPortfolio),
  )
  check(
    'and nothing reached the office while no project was loaded',
    docked.length === 1,
    `${String(docked.length)} turn(s)`,
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

/* --- 6. sent on A, then straight to B while the answer is in flight ------- */
{
  const turns: Turn[] = []
  const ctx = await newContext(turns, { delayMs: 1500 })
  const page = await ctx.newPage()
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-go^="/p/provenance-a"]', {
    state: 'attached',
    timeout: 20000,
  })
  await go(page, '/basecamp/p/provenance-a/chat', '[data-bc-sayform]')
  const words = 'Where is the venue contract? (switch test)'
  await page.fill('#bc-say', words)
  await page.keyboard.press('Enter')
  await go(page, '/basecamp/p/provenance-b/chat', '[data-bc-sayform]')
  await page.waitForTimeout(2600)
  const onB = (await page.evaluate(
    inPage("return document.querySelector('.bcmain')?.innerText ?? ''"),
  )) as string
  await go(page, '/basecamp/p/provenance-a/chat', '[data-bc-sayform]')
  await page.waitForTimeout(600)
  const onA = (await page.evaluate(
    inPage("return document.querySelector('.bcmain')?.innerText ?? ''"),
  )) as string
  check(
    'a turn sent on A and left mid-flight is stated as A',
    who(turns[0]?.project) === 'A',
    who(turns[0]?.project),
  )
  check(
    "B's Chat never shows A's words or A's answer",
    !onB.includes('switch test'),
    onB.includes('switch test') ? 'B shows it' : 'clean',
  )
  check(
    "and A's Chat has both when he goes back",
    onA.includes(words) && onA.includes(`Answer to: ${words}`),
    `words ${String(onA.includes(words))}, answer ${String(onA.includes(`Answer to: ${words}`))}`,
  )
  await ctx.close()
}

/* --- 7. the live call: Claire's hand-off states the project the call is about */
/*
  The call's own loop-back, as `verify:basecamp-livevoice` builds it: the mint
  and the SDP exchange are answered in the page, and a peer connection plays
  the team. A hand-off is then Claire's tool call arriving over the data
  channel, which `call.js` answers by posting `/voice/turn`. The call is about
  the project it was opened on (section 8 of the brief), so a hand-off after
  navigating away must still state that project, never the page now shown.
*/
const LOOPBACK = `
(() => {
  const real = window.fetch.bind(window)
  window.__teamChannel = null
  window.fetch = async (input, init) => {
    const href = String(typeof input === 'string' ? input : input?.url ?? '')
    if (href.includes('/voice-token')) {
      return new Response(JSON.stringify({ client_secret: 'ephemeral-for-this-test', model: 'gpt-realtime-2.1-mini' }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (href.includes('api.openai.com') && href.includes('/realtime/calls')) {
      const team = new RTCPeerConnection()
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const dest = ctx.createMediaStreamDestination()
      osc.connect(dest)
      osc.start()
      team.addTrack(dest.stream.getAudioTracks()[0], dest.stream)
      team.ondatachannel = (e) => { window.__teamChannel = e.channel }
      await team.setRemoteDescription({ type: 'offer', sdp: String(init?.body ?? '') })
      await team.setLocalDescription(await team.createAnswer())
      await new Promise((resolve) => {
        if (team.iceGatheringState === 'complete') { resolve(true); return }
        team.addEventListener('icegatheringstatechange', () => { if (team.iceGatheringState === 'complete') resolve(true) })
        setTimeout(resolve, 2500)
      })
      return new Response(team.localDescription.sdp, { status: 200, headers: { 'content-type': 'application/sdp' } })
    }
    return real(input, init)
  }
})()
`
{
  const turns: Turn[] = []
  const ctx = await newContext(turns)
  await ctx.addInitScript(LOOPBACK)
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => thrown.push(e.message))
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-go^="/p/provenance-a"]', {
    state: 'attached',
    timeout: 20000,
  })
  await go(page, '/basecamp/p/provenance-a', '[data-bc-voice]')
  await page.locator('[data-bc-voice]').first().click()
  const live = await page
    .waitForFunction(
      'window.__teamChannel !== null && window.__teamChannel.readyState === "open"',
      undefined,
      {
        timeout: 20000,
      },
    )
    .then(() => true)
    .catch(() => false)
  check('the call opened on A reached the loop-back team', live)
  const handOff = async (id: string, said: string) => {
    await page.evaluate(
      inPage(`window.__teamChannel.send(JSON.stringify({ type: 'response.function_call_arguments.done',
        call_id: ${JSON.stringify(id)}, name: 'ask_the_team', arguments: JSON.stringify({ said: ${JSON.stringify(said)} }) }))`),
    )
    await page.waitForTimeout(1500)
  }
  await handOff('c1', 'What still needs doing on the venue?')
  await go(page, '/basecamp/p/provenance-b', '.bcmain')
  await handOff('c2', 'And who is on it?')
  const fromCall = turns.filter((t) => t.said.includes('venue') || t.said.includes('who is on it'))
  check(
    "Claire's hand-off from a call opened on A states A",
    who(fromCall[0]?.project) === 'A',
    fromCall.map((t) => `${who(t.project)}: ${t.said}`).join(' | ') ||
      'no hand-off reached the door',
  )
  check(
    'and still states A after the page moved to B, because the call is about A',
    fromCall.length === 2 && who(fromCall[1]?.project) === 'A',
    fromCall.map((t) => who(t.project)).join(' '),
  )
  check('nothing threw during the call', thrown.length === 0, thrown.slice(0, 2).join(' | '))
  await ctx.close()
}

/* --- 8. an open dock follows the page it is on (#416, which replaced #376) --- */
/*
  The failure: open the dock on B, go back to the portfolio with it still open,
  send. The message was filed under B - correctly, it was B's thread on screen -
  and then the repaint took the dock's project from the PAGE, so the dock
  redrew onto Unnamed and the message just sent disappeared from view.

  The model since #376: an open dock is pinned to the thread it was opened on
  until it is closed. Navigating does not move it; closing and reopening on
  another project does. Every property is read twice - what the dock SHOWS
  immediately before Send and immediately after - and against what the page
  POSTED.
*/
type DockView = { note: string; head: string; said: string[]; waiting: string }
const view = async (page: Page): Promise<DockView> =>
  JSON.parse(
    (await page.evaluate(
      inPage(`const d = document.querySelector('#dock')
        return JSON.stringify({
          note: d?.querySelector('[data-bc-noteproject]')?.getAttribute('data-bc-noteproject') ?? '',
          head: (d?.querySelector('.dockhead')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
          said: [...(d?.querySelectorAll('.msg') ?? [])].map((m) => (m.textContent ?? '').replace(/\\s+/g, ' ').trim()),
          waiting: (d?.querySelector('.waitrow .waitsay')?.textContent ?? '').trim(),
        })`),
    )) as string,
  ) as DockView
const sendInDock = async (page: Page, text: string, settle = 900): Promise<void> => {
  await page.locator('#dock [data-docksay]').fill(text)
  await page.locator('#dock [data-dockform] button[type="submit"]').click()
  await page.waitForTimeout(settle)
}
const has = (v: DockView, text: string): boolean => v.said.some((m) => m.includes(text))
const mineCount = (v: DockView, text: string): number =>
  v.said.filter((m) => m.startsWith('You') && m.includes(text)).length
{
  const turns: Turn[] = []
  const ctx = await newContext(turns)
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => thrown.push(e.message))
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-go^="/p/provenance-b"]', {
    state: 'attached',
    timeout: 20000,
  })
  await go(page, '/basecamp/p/provenance-b', '.bcmain')
  await dock(page, 'Opened on B (dock-376)')

  // Away from any project and back through the picker (#416): the dock asks which project, and choosing OPENS it.
  await go(page, '/basecamp', '[data-bc-go^="/p/"]')
  const before = await view(page)
  check(
    'on the portfolio the dock asks which project and has no composer',
    before.note === '' &&
      /No project open/.test(before.head) &&
      (await page.locator('#dock [data-dockform]').count()) === 0,
    `"${before.head}"`,
  )
  await page.locator('#dock [data-dock-pick="provenance-b"]').click()
  await page.waitForTimeout(900)
  const text1 = 'Sent after choosing B (dock-416)'
  await sendInDock(page, text1)
  const after = await view(page)
  check(
    'choosing B opens B, and the dock is B',
    after.note === 'provenance-b' && /Provenance B/.test(after.head),
    `${after.note} "${after.head}"`,
  )
  check(
    'the message is on screen with the one before it, and the page stated B',
    has(after, text1) &&
      has(after, 'Opened on B (dock-376)') &&
      who(turns.at(-1)?.project) === 'B' &&
      turns.at(-1)?.said === text1,
    `${who(turns.at(-1)?.project)}: ${String(turns.at(-1)?.said)}`,
  )

  // Onto ANOTHER project with the dock still open: it FOLLOWS the page (#416), so nothing is ever filed under a project
  // the person is not looking at, and there is nothing to move.
  await go(page, '/basecamp/p/provenance-a', '.bcmain')
  const onA = await view(page)
  const text2 = 'Sent while looking at A (dock-416)'
  await sendInDock(page, text2)
  const onA2 = await view(page)
  check(
    'navigating to A with the dock open moves the dock to A',
    onA.note === 'provenance-a' &&
      onA2.note === 'provenance-a' &&
      who(turns.at(-1)?.project) === 'A',
    `shows ${onA.note}, then ${onA2.note}, stated ${who(turns.at(-1)?.project)}`,
  )
  check(
    'and its header names the page it is on, with nothing offered to move it',
    /Provenance A/.test(onA2.head) &&
      !/Filed under/.test(onA2.head) &&
      (await page.locator('[data-dock-here]').count()) === 0,
    onA2.head,
  )
  check(
    'and the message is visible there, and the one sent on B is not',
    has(onA2, text2) && !has(onA2, text1),
    onA2.said.join(' | ').slice(0, 300),
  )

  // The voice note composer in the same dock files where the typed one does.
  const beforeNote = turns.length
  await page.locator('#dock [data-bc-note]').first().click()
  await page.waitForTimeout(1600)
  await page.locator('#dock [data-bc-notestop]').click()
  await page.waitForTimeout(900)
  await page.locator('#dock [data-bc-notesend]').click()
  await page.waitForTimeout(2000)
  const afterNote = await view(page)
  const noteTurn = turns.slice(beforeNote)
  check(
    "a voice note from the same dock is stated as the page's project",
    noteTurn.length === 1 && who(noteTurn[0]?.project) === 'A',
    noteTurn.map((t) => `${who(t.project)}: ${t.said}`).join(' | ') || 'no note reached the door',
  )
  check(
    'and it lands in the thread on screen, which is A',
    afterNote.note === 'provenance-a' && has(afterNote, 'What still needs doing on this project?'),
    `${afterNote.note}: ${afterNote.said.slice(-3).join(' | ')}`,
  )

  // Closing and reopening the dock on the same page shows the same project: it is the page's, not a remembered one.
  await page.locator('#dock [data-dock-close]').click()
  await page.waitForTimeout(500)
  await page.locator('[data-bc-dock]:visible').first().click({ timeout: 8000 })
  await page.waitForTimeout(600)
  const reopened = await view(page)
  const text3 = 'Sent after reopening on A (dock-416)'
  await sendInDock(page, text3)
  const reopened2 = await view(page)
  check(
    'closing the dock and opening it again on A shows A',
    reopened.note === 'provenance-a' &&
      reopened2.note === 'provenance-a' &&
      who(turns.at(-1)?.project) === 'A' &&
      has(reopened2, text3) &&
      !has(reopened2, text1),
    `${reopened.note} -> ${reopened2.note}, stated ${who(turns.at(-1)?.project)}`,
  )
  check(
    'one turn per send: five sends (four typed, one voice), five turns, nothing twice',
    turns.length === 5 && new Set(turns.map((t) => t.said)).size === 5,
    turns.map((t) => `${who(t.project)}: ${t.said}`).join(' | '),
  )
  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* --- 9. the dock, pinned, while waiting and when asked again (#375, #376) -- */
{
  const turns: Turn[] = []
  const ctx = await newContext(turns, { delayMs: 2500 })
  const page = await ctx.newPage()
  await page.goto(url('/basecamp/p/provenance-b'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-dock]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.locator('[data-bc-dock]:visible').first().click({ timeout: 8000 })
  await page.waitForTimeout(600)
  const text = 'A slow question asked on B (dock-416)'
  await sendInDock(page, text, 1200)
  const waiting = await view(page)
  check(
    'while the office thinks, the pinned dock says so on the same thread',
    waiting.note === 'provenance-b' && has(waiting, text) && /working on it/.test(waiting.waiting),
    `${waiting.note}: waiting "${waiting.waiting}"`,
  )
  await page.waitForTimeout(2500)
  const answered = await view(page)
  check(
    'and the answer lands there, under the message, once',
    answered.note === 'provenance-b' &&
      has(answered, `Answer to: ${text}`) &&
      mineCount(answered, text) === 1 &&
      turns.length === 1,
    `${answered.note}: ${answered.said.slice(-2).join(' | ')} · turns ${String(turns.length)}`,
  )
  await ctx.close()
}
{
  const turns: Turn[] = []
  const ctx = await newContext(turns, { failFirst: true })
  const page = await ctx.newPage()
  await page.goto(url('/basecamp/p/provenance-b'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-dock]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.locator('[data-bc-dock]:visible').first().click({ timeout: 8000 })
  await page.waitForTimeout(600)
  const text = 'This one fails first, from the dock (dock-416)'
  await sendInDock(page, text, 1200)
  await page.waitForSelector('#dock [data-chat-retry]', { timeout: 10000 })
  await page.locator('#dock [data-chat-retry]').first().click()
  await page.waitForTimeout(1500)
  const after = await view(page)
  check(
    'Try again in the dock resends to B, once',
    turns.length === 2 && turns.every((t) => who(t.project) === 'B' && t.said === text),
    turns.map((t) => `${who(t.project)}: ${t.said}`).join(' | '),
  )
  check(
    'and the dock stays on B with the message and its answer, and no second copy',
    after.note === 'provenance-b' && mineCount(after, text) === 1 && has(after, 'Noted.'),
    `${after.note}: ${after.said.slice(-2).join(' | ')}`,
  )
  await ctx.close()
}

/* --- 10. the portfolio's dock files under Unnamed, on purpose (#149, #376) -- */
/*
  The default dashboard draws a dock button on the portfolio, where there is no
  project: #149 files that under the reserved Unnamed project, and the header
  says so. Pinned, it stays Unnamed when he then opens a project - the choice
  he made by opening it there - until he closes it. (The default dashboard
  draws the dock button on the portfolio only; reopening on another project is
  proved in section 8, in Basecamp.)
*/
{
  const turns: Turn[] = []
  const ctx = await newContext(turns)
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => thrown.push(e.message))
  // The older studio, kept at /classic since #382.
  await page.goto(url('/classic/'), { waitUntil: 'domcontentloaded' })
  // The office's projects have arrived (the first match is a hidden switcher option).
  await page.waitForSelector('[data-open="provenance-a"]', { state: 'attached', timeout: 20000 })
  await page.waitForSelector('[data-dock]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.locator('[data-dock]:visible').first().click({ timeout: 8000 })
  await page.waitForTimeout(500)
  // #416: with no project loaded the dock asks; the general Conversation is one explicit, named choice among them.
  const asking = await view(page)
  const picks = await page.locator('#dock [data-dock-pick]').count()
  check(
    'a dock opened on the portfolio asks which project, offering the general conversation by name',
    /No project open/.test(asking.head) &&
      picks >= 3 &&
      (await page.locator('#dock [data-dock-pick="unnamed"]').count()) === 1 &&
      (await page.locator('#dock [data-dockform]').count()) === 0,
    `"${asking.head}", ${String(picks)} choices`,
  )
  await page.locator('#dock [data-dock-pick="unnamed"]').click()
  await page.waitForTimeout(600)
  const head0 = (await view(page)).head
  await sendInDock(page, 'Asked from the portfolio (dock-416)')
  check(
    'choosing the general conversation files under Unnamed and says so',
    /Conversation/.test(head0) && who(turns[0]?.project) === 'Unnamed',
    `"${head0}", stated ${who(turns[0]?.project)}`,
  )
  await go(page, '/classic/p/provenance-a', '#dock [data-dockform]')
  const onA = await view(page)
  await sendInDock(page, 'Now on A (dock-416)')
  check(
    'opening a project moves the dock to that project, and the message is stated as it',
    /Provenance A/.test(onA.head) &&
      !/Conversation/.test(onA.head) &&
      who(turns[1]?.project) === 'A',
    `"${onA.head}", stated ${who(turns[1]?.project)}`,
  )
  check('nothing threw on the default dashboard', thrown.length === 0, thrown.join(' | '))
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
