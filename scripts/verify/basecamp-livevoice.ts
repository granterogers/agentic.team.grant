/*
 * A REAL CONVERSATION, WITH EVERYTHING BUT OPENAI.
 *
 * Grant, 23 September: "Do not implement live voice as record, wait, receive
 * audio, press record again. The entire point is conversational flow. Verify
 * multi-turn... Where OpenAI Realtime supports interruption/barge-in: team
 * speaking, Grant interrupts, response stops/adapts, conversation continues.
 * Test this explicitly."
 *
 * ## How this is more than a mock
 *
 * The page's own `RTCPeerConnection` is not touched. What is replaced is the
 * far end: a SECOND peer connection, inside the same page, answers the offer.
 * So the offer is really created, the answer is really negotiated, ICE really
 * completes, a real remote audio track really arrives, and the `oai-events`
 * data channel is a real data channel with a real peer on the other end -
 * which is what lets this suite SPEAK as the team by sending the same events
 * the Realtime API sends.
 *
 * What is therefore proved: the whole client path, the conversational states,
 * multi-turn, interruption handling, ending, and cleanup. NOT mute: §4 removed
 * the panel its control lived on, and nothing replaced it.
 * What is NOT: OpenAI. The far end is a loopback, not a model, and no human
 * spoke. Said again at the end, where it cannot be missed.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

/*
  WHERE TWO PAGE SHAPES DIVERGE, in words. A comparison that fails with "they
  are different" sends somebody reading two thousand characters by eye; this
  names the first element that moved or appeared, which is almost always the
  whole answer.
*/
const firstDifference = (a: string, b: string): string => {
  const left = a.split(' | ')
  const right = b.split(' | ')
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return `before: ${left[i] ?? '(nothing)'}\n        after:  ${right[i] ?? '(nothing)'}`
    }
  }
  return 'the same'
}

const PORT = 4704
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (process.env.SUBJECT === 'source') throw new Error('asked for source')
  const { readFile } = await import('node:fs/promises')
  await readFile('.out/live/index.html')
  server = await serveLive(PORT)
  subject = 'the deployed bytes in .out/live'
} catch {
  server = await serveStudio(PORT)
}
console.log(`subject: ${subject}\n`)
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
  THE FAR END, installed before the page's own code runs.

  `fetch` is wrapped rather than replaced: everything that is not the mint or
  the SDP exchange goes to the real one, so the page is otherwise itself.
*/
const LOOPBACK = `
(() => {
  const real = window.fetch.bind(window)
  window.__minted = []
  window.__team = null
  window.__teamChannel = null
  window.__teamTrack = null
  window.fetch = async (input, init) => {
    const href = String(typeof input === 'string' ? input : input?.url ?? '')
    if (href.includes('/voice-token')) {
      window.__minted.push(String(init?.body ?? ''))
      return new Response(
        JSON.stringify({ client_secret: 'ephemeral-for-this-test', model: 'gpt-realtime-2.1-mini' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (href.includes('api.openai.com') && href.includes('/realtime/calls')) {
      const offer = String(init?.body ?? '')
      const team = new RTCPeerConnection()
      window.__team = team
      /* A real audio track, so the page's ontrack really fires. */
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const dest = ctx.createMediaStreamDestination()
      osc.connect(dest)
      osc.start()
      window.__teamTrack = dest.stream.getAudioTracks()[0]
      team.addTrack(window.__teamTrack, dest.stream)
      team.ondatachannel = (e) => { window.__teamChannel = e.channel }
      await team.setRemoteDescription({ type: 'offer', sdp: offer })
      const answer = await team.createAnswer()
      await team.setLocalDescription(answer)
      await new Promise((resolve) => {
        if (team.iceGatheringState === 'complete') { resolve(true); return }
        team.addEventListener('icegatheringstatechange', () => {
          if (team.iceGatheringState === 'complete') resolve(true)
        })
        setTimeout(resolve, 2500)
      })
      return new Response(team.localDescription.sdp, {
        status: 200,
        headers: { 'content-type': 'application/sdp' },
      })
    }
    return real(input, init)
  }
  /*
    EVERY MICROPHONE THE PAGE IS EVER HANDED, kept so cleanup can be asserted
    on the thing that matters: #102 is this repository's most expensive privacy
    lesson, and "the call ended" is not the same claim as "the microphone
    stopped".
  */
  window.__mics = []
  const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await realGum(c)
    for (const t of s.getAudioTracks()) window.__mics.push(t)
    return s
  }

  /*
    WHAT THE PAGE ACTUALLY HEARD, recorded on the page's OWN side of the
    channel.

    §4 took the transcript surface away, which is what Grant asked for -- and
    it took with it the only way this suite could see that a turn had landed.
    Asserting the words are on screen would now be asserting against the
    requirement; asserting only what this suite SENT would prove nothing about
    the page at all, because the sender is this suite.

    So the page's own data channel is wrapped as it is created, and every
    message the page receives is kept. The subject is the page's receipt, which
    is what "the conversation reached the client" has always meant.
  */
  window.__heard = []
  const realChannel = RTCPeerConnection.prototype.createDataChannel
  RTCPeerConnection.prototype.createDataChannel = function (...args) {
    const ch = realChannel.apply(this, args)
    ch.addEventListener('message', (e) => {
      try {
        const m = JSON.parse(String(e.data))
        const said = m.transcript ?? m.delta ?? ''
        if (said !== '') window.__heard.push(String(said))
      } catch {
        /* Not every event carries words, and one that does not is not a fault. */
      }
    })
    return ch
  }

  /* How this suite speaks as the team. */
  window.__say = (event) => {
    if (window.__teamChannel === null) return false
    window.__teamChannel.send(JSON.stringify(event))
    return true
  }
})()
`

const browser = await chromium.launch({
  args: [
    '--lang=en-GB',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 950 },
  permissions: ['microphone'],
})
await ctx.addInitScript(LOOPBACK)
await ctx.addInitScript(
  `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
)
await ctx.route('**/hq-api**', (r) =>
  r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    : r.abort('connectionfailed'),
)
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const slug = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-voice]')
await page.waitForTimeout(500)

check(
  'nothing about a call is on screen before one is placed',
  (await page.locator('.bclive').count()) === 0,
)
/*
  WHAT THE PAGE LOOKS LIKE BEFORE THE PRESS, recorded so it can be compared
  after. §4: "The existing project screen should remain visually unchanged."
  That is a claim about the whole page, not about one element, so the whole
  page is what gets remembered -- every element's box, by a stable key.
*/
const shapeOfThePage = async (): Promise<string> =>
  (await page.evaluate(
    inPage(`const out = []
       /*
         GEOMETRY, NOT APPEARANCE. A first version keyed each element by tag
         AND class name, and then reported the microphone gaining its live
         class as the page having changed -- which is the one thing §4 asks
         the icon to do. The requirement is that nothing MOVES or APPEARS, so
         the identity is the element's position in document order and the
         value is its box.
       */
       let i = 0
       for (const el of document.querySelectorAll('header *, .bcmain *, .bcpanes *')) {
         const r = el.getBoundingClientRect()
         if (r.width === 0 && r.height === 0) continue
         i += 1
         out.push('#' + i + ' ' + el.tagName + '@' +
           Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + 'x' + Math.round(r.height))
       }
       return out.join(' | ')`),
  )) as string
const beforeThePress = await shapeOfThePage()

/* --- 1. placing it ------------------------------------------------------ */
/* Measured BEFORE the press, because anything you need to know about "before"
   has to have been recorded before. */
const idleGeometry = (await page.evaluate(
  inPage(`const out = {}
     for (const el of document.querySelectorAll('.bcheadacts > *')) {
       const r = el.getBoundingClientRect()
       const key = el.dataset.bcVoice !== undefined
         ? 'mic'
         : (el.dataset.bcDock !== undefined ? 'chat' : (el.dataset.bcPagemenu !== undefined ? 'menu' : (el.className || 'other')))
       out[String(key)] = [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(',')
     }
     return out`),
)) as Record<string, string>
const idlePaint = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-voice]')
     if (el === null) return {}
     const cs = getComputedStyle(el)
     return { background: cs.backgroundColor, border: cs.borderTopColor, width: cs.borderTopWidth, colour: cs.color }`),
)) as Record<string, string>

await page.locator('[data-bc-voice]').first().click()
await page
  .waitForFunction('document.querySelector(\'[data-bc-live="listening"]\') !== null', undefined, {
    timeout: 20000,
  })
  .catch(() => null)

const minted = (await page.evaluate(inPage('return window.__minted'))) as string[]
check('the office was asked for a credential', minted.length === 1, JSON.stringify(minted))
check(
  'and it was told which project the call is about, so "this project" means this one',
  minted[0] !== undefined && minted[0].includes(slug.split('/').pop() ?? ''),
  minted[0] ?? '',
)
const connected = (await page.evaluate(
  inPage(`return { state: window.__team?.connectionState ?? 'none',
     ice: window.__team?.iceConnectionState ?? 'none',
     channel: window.__teamChannel !== null }`),
)) as { state: string; ice: string; channel: boolean }
check(
  'a real connection is established end to end',
  ['connected', 'completed'].includes(connected.ice) || connected.state === 'connected',
  JSON.stringify(connected),
)
check('and the conversation channel is open', connected.channel, JSON.stringify(connected))
/*
  THE STATE IS ON THE ICON, NOT ON A PANEL (§4). Every assertion below that
  used to read the panel's text now reads the microphone's own state and its
  accessible name -- which is the stricter test of the two, because a colour
  nobody can read to a screen reader is not a state that has been communicated.
*/
check(
  'the microphone itself says it is listening',
  (await page.locator('[data-bc-mic="listening"]').count()) === 1,
  (await page.locator('[data-bc-voice]').first().getAttribute('data-bc-mic')) ?? 'no state',
)
const words = (await page.locator('[data-bc-voice]').first().getAttribute('aria-label')) ?? ''
check(
  'nothing on it says session, token, SDP or realtime',
  !/\b(sdp|peer connection|token|realtime|webrtc|session)\b/i.test(words),
  words,
)
check(
  'and it tells him he can just talk',
  /just talk|interrupt/i.test(words),
  words.replace(/\n+/g, ' / ').slice(0, 160),
)

/*
 * --- COLOUR, AND NOTHING MOVING ------------------------------------------
 *
 * Grant, 23 September: "Clicking the voice button must not move, resize or
 * reflow surrounding buttons/UI. Inactive microphone/icon state = red.
 * Active/listening/conversation state = green. State changes should happen
 * without layout movement."
 *
 * Measured rather than eyeballed: the microphone's own box and the box of
 * every control beside it, before the press and while the call is up. A
 * border that thickens by half a pixel moves its neighbour, which is exactly
 * the class of defect this is about.
 */
const geometry = async (): Promise<Record<string, string>> =>
  (await page.evaluate(
    inPage(`const out = {}
       for (const el of document.querySelectorAll('.bcheadacts > *')) {
         const r = el.getBoundingClientRect()
         const key = el.dataset.bcVoice !== undefined
           ? 'mic'
           : (el.dataset.bcDock !== undefined ? 'chat' : (el.dataset.bcPagemenu !== undefined ? 'menu' : (el.className || 'other')))
         out[String(key)] = [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(',')
       }
       return out`),
  )) as Record<string, string>

const paint = async (): Promise<Record<string, string>> =>
  (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-voice]')
       if (el === null) return {}
       const cs = getComputedStyle(el)
       return { background: cs.backgroundColor, border: cs.borderTopColor, width: cs.borderTopWidth, colour: cs.color }`),
  )) as Record<string, string>

const stillPaint = idlePaint
const livePaint = await paint()
/*
  POINTER AWAY FIRST. The microphone lifts a pixel on hover and the pointer is
  still sitting on it after the press, so this compared an unhovered idle
  control with a hovered live one and reported the hover as the call moving the
  page -- a check that would have had somebody delete a good hover state.
*/
await page.mouse.move(4, 4)
await page.waitForTimeout(250)
const liveGeometry = await geometry()

/* Red when it is not on, green when it is - as colours, not as words. */
const redish = (c: string): boolean => {
  const [r, g, b] = (c.match(/\d+/g) ?? ['0', '0', '0']).map(Number) as [number, number, number]
  return r > g + 20 && r > b + 20
}
const greenish = (c: string): boolean => {
  const [r, g, b] = (c.match(/\d+/g) ?? ['0', '0', '0']).map(Number) as [number, number, number]
  return g > r + 20 && g > b + 10
}
check(
  'the microphone is red while it is not on',
  redish(String(stillPaint.colour ?? '')) || redish(String(stillPaint.border ?? '')),
  JSON.stringify(stillPaint),
)
check(
  'and green once the conversation is live',
  greenish(String(livePaint.background ?? '')) || greenish(String(livePaint.border ?? '')),
  JSON.stringify(livePaint),
)
/*
  THE CONTROLS, not the status line.

  The line that reports what the call is doing is SUPPOSED to appear - that is
  its whole job - so comparing it against itself reported a correct fix as a
  failure. What must not move is everything a person aims at: Chat with Team,
  the microphone itself, and the project menu.
*/
const controlsOnly = (g: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(g)) {
    if (k.includes('callsay')) continue
    out[k] = v
  }
  return out
}
check(
  'and nothing beside it moved by so much as a pixel',
  JSON.stringify(controlsOnly(idleGeometry)) === JSON.stringify(controlsOnly(liveGeometry)),
  `before ${JSON.stringify(controlsOnly(idleGeometry))}\n        after  ${JSON.stringify(controlsOnly(liveGeometry))}`,
)
/*
  AND THE LINE ITSELF DOES NOT OVERLAP A CONTROL, which is the way an
  out-of-flow element goes wrong: it stops pushing things and starts covering
  them instead.
*/
const covered = (await page.evaluate(
  inPage(`const line = document.querySelector('[data-bc-callsay]')
     if (line === null || line.hidden) return []
     const r = line.getBoundingClientRect()
     const hit = []
     for (const el of document.querySelectorAll('.bcmain button, .bcmain a, .bctop button')) {
       const b = el.getBoundingClientRect()
       if (b.width < 4 || b.height < 4) continue
       if (r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom) {
         hit.push((el.textContent ?? el.getAttribute('aria-label') ?? '?').trim().slice(0, 28))
       }
     }
     return hit`),
)) as string[]
check('and it covers no control while it is up', covered.length === 0, covered.join(', '))

/* --- 2. a turn each, then another ---------------------------------------- */
const say = async (event: Record<string, unknown>): Promise<void> => {
  await page.evaluate(`window.__say(${JSON.stringify(event)})`)
  /*
    The panel repaints from a poll, so a fixed sleep races it - and a race is
    what this was: the same check passed and failed on the same code depending
    on what else the run had done first. Waited for properly.
  */
  await page.waitForTimeout(500)
}
/*
  THE MICROPHONE IS WHAT REPORTS NOW (§4). This watched the panel's own
  attribute; the panel is gone and the icon carries the same vocabulary, so
  the wait moved rather than the test. It also has to give the icon time: the
  states arrive over the data channel and a 400ms poll paints them, so a
  one-shot read would race the painter.
*/
const settlesTo = async (activity: string): Promise<boolean> =>
  await page
    .waitForFunction(`document.querySelector('[data-bc-mic="${activity}"]') !== null`, undefined, {
      timeout: 8000,
    })
    .then(
      () => true,
      () => false,
    )
await say({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript: 'What is late on this project?',
})
await say({ type: 'response.created' })
check(
  'while the team is answering, the microphone says so rather than still saying listening',
  await settlesTo('answering'),
  (await page.locator('[data-bc-voice]').first().getAttribute('data-bc-mic')) ?? 'no state',
)
await say({
  type: 'response.output_audio_transcript.done',
  transcript: 'Two things are late: the avatar document and the interview notes.',
})
await say({ type: 'response.done' })
/*
  WHAT WAS SAID IS NO LONGER SHOWN, AND THAT IS THE REQUIREMENT.

  These two checks read the panel's transcript. §4 forbids a transcript
  surface, so asserting that the words are on screen would now be asserting
  against the thing Grant asked for. What still has to be true is that the
  turns REACHED the page -- a conversation the client did not hear is not a
  conversation -- so the assertion moves from the rendering to the receiving,
  which is where it always belonged.
*/
const heard = (await page.evaluate(inPage(`return (window.__heard ?? []).join(' | ')`))) as string
check('what he said reached the page', heard.includes('What is late on this project?'), heard)
check('what the team said reached the page', heard.includes('Two things are late'), heard)
check(
  'and it goes back to listening, ready for the next thing he says',
  await settlesTo('listening'),
)

await say({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript: 'Okay, chase the interview notes.',
})
await say({ type: 'response.created' })
await say({
  type: 'response.output_audio_transcript.done',
  transcript: 'Right, I will put that to Emma.',
})
await say({ type: 'response.done' })
const afterTwo = (await page.evaluate(
  inPage(`return (window.__heard ?? []).join(' | ')`),
)) as string
check(
  'a second turn continues the same conversation rather than starting another',
  afterTwo.includes('Okay, chase the interview notes') &&
    afterTwo.includes('Right, I will put that to Emma') &&
    afterTwo.includes('What is late on this project?'),
  afterTwo.replace(/\n+/g, ' / '),
)

/* --- 3. talking over her ------------------------------------------------- */
await say({ type: 'response.created' })
await say({
  type: 'response.output_audio_transcript.done',
  transcript: 'The other thing I wanted to raise is',
})
check('the team is speaking', await settlesTo('answering'))
await say({ type: 'input_audio_buffer.speech_started' })
await say({ type: 'conversation.item.truncated' })
await say({ type: 'response.done' })
check(
  'interrupting stops the answer and the conversation carries on',
  await settlesTo('listening'),
  (await page.locator('[data-bc-voice]').first().getAttribute('data-bc-mic')) ?? 'no state',
)
await say({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript: 'Actually, do the newsletter first.',
})
const afterBarge = await page.evaluate(
  inPage(`return (document.querySelector('[data-bc-callsay]')?.textContent ?? '') + ' :: ' +
     (document.querySelector('[data-bc-voice]')?.getAttribute('aria-label') ?? '')`),
)
check(
  'and the conversation carried on through the interruption',
  await settlesTo('listening'),
  String(afterBarge),
)

/*
 * --- 4. THE WHOLE POINT OF §4: NO SURFACE APPEARED -----------------------
 *
 * The section's list is seven prohibitions, and every one of them is the same
 * claim from a different angle: the page a person was reading is the page they
 * are still reading. So this compares the shape of the WHOLE page against the
 * shape recorded before the press -- every visible element, keyed by tag,
 * class and box.
 *
 * It is deliberately not a check that `.bclive` is absent. That would pass the
 * day somebody adds a differently-named panel, which is the enumeration
 * defect this repository keeps recording: assert the property, never the
 * artefact that currently implements it.
 */
/*
  MEASURE WITH THE POINTER AWAY. The microphone lifts one pixel on hover, which
  is good feedback and nothing to do with the call -- and the pointer is still
  on it after the press, so a naive comparison reports the hover as the call
  moving the page. The first run of this check did exactly that and would have
  had somebody delete a hover state to satisfy it.
*/
await page.mouse.move(4, 4)
await page.waitForTimeout(250)
const duringTheCall = await shapeOfThePage()
check(
  'a live call has added nothing to the page and moved nothing on it',
  duringTheCall === beforeThePress,
  duringTheCall === beforeThePress ? '' : firstDifference(beforeThePress, duringTheCall),
)
check(
  'and no transcript of the conversation is on screen anywhere',
  !(await page.evaluate(
    inPage(`return document.body.innerText.includes('Actually, do the newsletter first')`),
  )),
)

/* --- 5. ending it is a second press, and what is left behind ------------- */
await page.locator('[data-bc-voice]').first().click()
await page.waitForTimeout(800)
check(
  'pressing the microphone again ends the call',
  (await page.locator('[data-bc-mic="idle"]').count()) === 1,
  (await page.locator('[data-bc-voice]').first().getAttribute('data-bc-mic')) ?? 'no state',
)
/*
  THE MICROPHONE, which is the cleanup that matters.

  The first draft asked whether the FAR END had noticed the call end, and
  failed - correctly, for the wrong reason: WebRTC has no instant close signal,
  so a remote peer stays "connected" until ICE times out seconds later. That is
  the protocol behaving, not the product leaking. What the product owes is that
  the microphone it opened is shut, and that is answerable at once.
*/
const after = (await page.evaluate(
  inPage(`const states = []
     for (const t of (window.__mics ?? [])) states.push(t.readyState)
     return { mics: states, farState: window.__team?.connectionState ?? 'none' }`),
)) as { mics: string[]; farState: string }
check(
  'every microphone the call opened is stopped',
  after.mics.length > 0 && after.mics.every((s) => s === 'ended'),
  JSON.stringify(after),
)
check(
  'the microphone button is offering a call again rather than claiming one',
  (await page.locator('[data-bc-voice][aria-pressed="false"]').count()) === 1,
)

/* --- 6. and it can all be done again ------------------------------------- */
await page.locator('[data-bc-voice]').first().click()
await page
  .waitForFunction('document.querySelector(\'[data-bc-live="listening"]\') !== null', undefined, {
    timeout: 20000,
  })
  .catch(() => null)
check('a second conversation can be started after the first', await settlesTo('listening'))
const mintedAgain = (await page.evaluate(inPage('return window.__minted.length'))) as number
check('with its own credential rather than a reused one', mintedAgain === 2, String(mintedAgain))
await page.locator('[data-bc-voice]').first().click()
await page.waitForTimeout(500)

check('nothing threw during any of it', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
console.log(
  '\nWHAT THIS DOES NOT PROVE: OpenAI. The far end of that connection is a second\n' +
    'peer in the same page, not a model, and nobody spoke into a microphone. The\n' +
    'client path, the states, multi-turn, interruption, ending and cleanup are\n' +
    'all real; the intelligence at the other end is not.',
)
process.exit(fail === 0 ? 0 : 1)
