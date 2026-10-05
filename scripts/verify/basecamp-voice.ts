/*
 * THE MICROPHONE, TRACED END TO END.
 *
 * Grant, 22 September: "The microphone control next to Chat with Team
 * currently appears to do nothing. This is a functional defect. Wire the
 * microphone button into the intended pure voice conversation with the Agentic
 * Team using the OpenAI voice/realtime interface. Trace the interaction
 * end-to-end: button → voice interface/session → microphone/audio permissions
 * → connection → conversation → cleanup/end state. Do not merely attach a
 * click handler that does not result in a usable voice session... Provide
 * sensible loading, permission, connecting, active, error and disconnected
 * states where applicable."
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, said plainly because the difference
 * matters:
 *
 *  - it CAN prove the whole chain up to the network: the press mints a
 *    session against the office's voice-token endpoint, asks the browser for
 *    the microphone, and reports each state on screen. Chromium is given a
 *    fake microphone and permission is granted, so the permission step is
 *    real rather than skipped;
 *  - it CANNOT prove a conversation with OpenAI. That needs the deployed
 *    voice-token function, a real key and a peer connection to api.openai.com,
 *    none of which exist in a sandbox. Those steps are exercised against a
 *    stub so that the office's own contract is checked, and the run ledger
 *    says they are live-only. Reporting that as verified would be the exact
 *    thing the brief forbids.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4683
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

/*
  A FAKE MICROPHONE, AND PERMISSION FOR IT. Without these Chromium has no
  audio device at all, so `getUserMedia` rejects and the permission step is
  never exercised - the check would pass for the wrong reason, which is the
  shape this repository calls a vacuous pass.
*/
const browser = await chromium.launch({
  args: ['--lang=en-GB', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  permissions: ['microphone'],
})
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

/*
  THE OFFICE'S OWN ENDPOINTS, stubbed at the network rather than in the code.

  `voice-token` is what the studio asks for a session; the shape it must
  return is `client_secret` and `model`, and stubbing it here is what makes
  the contract checkable at all in a sandbox. The SDP exchange with OpenAI is
  refused deliberately, so the ERROR path is the one exercised end to end -
  which is the state Grant is most likely to meet on a preview with no key.
*/
let minted = 0
let sdpTried = 0
await ctx.route('**/functions/v1/voice-token', async (route) => {
  minted += 1
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ client_secret: 'stub-secret-not-a-real-key', model: 'gpt-realtime' }),
  })
})
await ctx.route('https://api.openai.com/**', async (route) => {
  sdpTried += 1
  await route.fulfill({ status: 401, contentType: 'text/plain', body: 'no key in a sandbox' })
})

/*
  WATCHING THE MICROPHONE REQUEST, without changing it.

  The wrapper records that `getUserMedia` was called and keeps the tracks it
  handed back, then delegates to the real one - so the product takes exactly
  the path it would take unobserved, and the cleanup check can ask whether a
  track is still live. A stub that RETURNED a fake stream would be testing the
  stub.
*/
await ctx.addInitScript(`(() => {
  window.__micAsked = false
  window.__micTracks = []
  const md = navigator.mediaDevices
  if (md === undefined) return
  const real = md.getUserMedia.bind(md)
  md.getUserMedia = async (...args) => {
    window.__micAsked = true
    const stream = await real(...args)
    for (const t of stream.getTracks()) window.__micTracks.push(t)
    return stream
  }
})()`)

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(400)

/* --- 1. the control, and its prominence --------------------------------- */
const mic = page.locator('[data-bc-voice]').first()
const chat = page.locator('[data-bc-dock]:visible').first()
const micBox = await mic.boundingBox()
const chatBox = await chat.boundingBox()
check('the microphone is on the project head', micBox !== null)
check('and so is Chat with Team', chatBox !== null)
if (micBox !== null && chatBox !== null) {
  check(
    'the two are the same height, as sibling actions',
    Math.abs(micBox.height - chatBox.height) <= 4,
    `mic ${String(Math.round(micBox.height))}px, chat ${String(Math.round(chatBox.height))}px`,
  )
  check(
    'and the microphone meets the 44px touch floor',
    micBox.height >= 44 && micBox.width >= 44,
    `${String(Math.round(micBox.width))}x${String(Math.round(micBox.height))}`,
  )
  check(
    'they sit beside each other rather than in different places',
    Math.abs(micBox.y - chatBox.y) < 30 && micBox.x - (chatBox.x + chatBox.width) < 40,
    `chat ends at ${String(Math.round(chatBox.x + chatBox.width))}, mic starts at ${String(Math.round(micBox.x))}`,
  )
}
check(
  'the two are visually distinct: one is round, the other is not',
  (await page.evaluate(
    inPage(`const m = document.querySelector('[data-bc-voice]')
       const c = document.querySelector('[data-bc-dock]')
       return getComputedStyle(m).borderRadius !== getComputedStyle(c).borderRadius`),
  )) === true,
)

/* --- 2. pressing it starts the real chain ------------------------------- */
check(
  'the microphone says nothing before it is pressed',
  await page.locator('[data-bc-callsay]').isHidden(),
)
/*
  WATCHED FROM THE PRESS, not sampled afterwards.

  The connecting state is real and is also SHORT when the chain fails - here
  it is a stubbed mint, a fake microphone and an immediate 401 - so a check
  that looked 600ms later found the control already back at rest and reported
  a correct product as broken. What matters is that the state EXISTED, so it
  is watched from the moment of the press.
*/
const seenSaid: string[] = []
/*
  WHAT "IT SAYS SOMETHING" MEANS AFTER §4.

  This sampled the status line sixty times a second and required the word
  connecting to appear in it. §4 moved that onto the icon on purpose: while a
  call is up the microphone carries the state and a line repeating it is the
  surface the section forbids, so the line is empty by design until the call
  settles. Requiring words there now would be requiring the defect back.

  The claim is unchanged -- pressing it must not do nothing visible -- so the
  sampler watches BOTH: the icon's own state and its accessible name, which is
  where a person and a screen reader respectively now learn what is happening.
*/
let seenPressed = false
const seenStates: string[] = []
const watch = globalThis.setInterval(() => {
  void (async () => {
    seenPressed =
      seenPressed || (await mic.getAttribute('aria-pressed').catch(() => null)) === 'true'
    const state = (await mic.getAttribute('data-bc-mic').catch(() => null)) ?? ''
    if (state !== '' && !seenStates.includes(state)) seenStates.push(state)
    const label = (await mic.getAttribute('aria-label').catch(() => null)) ?? ''
    if (label !== '' && !seenSaid.includes(label)) seenSaid.push(label)
    const words = await page
      .locator('[data-bc-callsay]')
      .innerText()
      .catch(() => '')
    if (words !== '' && !seenSaid.includes(words)) seenSaid.push(words)
  })()
}, 60)
await mic.click()
await page.waitForTimeout(1200)
globalThis.clearInterval(watch)
check(
  'pressing it says it is connecting, rather than doing nothing visible',
  seenStates.some((w) => w !== 'idle') ||
    seenSaid.some((w) => /connect|microphone|listening|talking/i.test(w)),
  `states ${seenStates.join(' → ') || '(none)'} · words ${seenSaid.join(' → ') || '(nothing at all)'}`,
)
check('and the control showed it was no longer idle', seenPressed)

/* --- 3. the office was actually asked for a session --------------------- */
await page.waitForTimeout(1500)
check(
  'the press reached the office voice endpoint',
  minted > 0,
  'nothing asked for a session, so the button is not wired to the voice path at all',
)

/* --- 4. the microphone was actually asked for --------------------------- */
const askedMic = (await page.evaluate(inPage(`return window.__micAsked === true`))) as boolean
check(
  'and the browser was asked for the microphone',
  askedMic,
  'getUserMedia was never called, so the permission step does not exist',
)

/* --- 5. a refusal is reported, not swallowed ---------------------------- */
await page.waitForTimeout(2500)
const after = await page.locator('[data-bc-callsay]').innerText()
check(
  'a session that cannot be established says so on screen',
  after.trim() !== '' && !/^connecting/i.test(after.trim()),
  `the last thing it said was "${after}"`,
)
check(
  'the SDP exchange with the realtime service was attempted',
  sdpTried > 0,
  'the chain stopped before the connection, so this is not the OpenAI realtime path',
)

/* --- 6. and the control comes back to rest ------------------------------ */
check(
  'the control returns to idle after a failure rather than claiming a call',
  (await mic.getAttribute('aria-pressed')) === 'false',
  `aria-pressed is ${String(await mic.getAttribute('aria-pressed'))}`,
)

/* --- 7. ending a call cleans up ----------------------------------------- */
/*
  The live path cannot be reached here, so the cleanup contract is checked
  where it IS reachable: pressing again while connecting must cancel, and must
  leave no microphone track running - which is the defect this repository
  already paid for once, as a microphone assigned to a call nobody is on.
*/
await mic.click()
await page.waitForTimeout(500)
await mic.click()
await page.waitForTimeout(800)
const live = (await page.evaluate(
  inPage(`return (window.__micTracks ?? []).filter((t) => t.readyState === 'live').length`),
)) as number
check(
  'cancelling a connecting call leaves no microphone running',
  live === 0,
  `${String(live)} live track(s)`,
)

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
console.log(
  '\nNOT PROVED HERE, and not claimed: a real conversation. That needs the ' +
    'deployed voice-token function, a live key and a peer connection to ' +
    'api.openai.com. This exercises the chain up to and including the SDP ' +
    'request, with the office endpoint and the realtime service stubbed.',
)
process.exit(fail === 0 ? 0 : 1)
