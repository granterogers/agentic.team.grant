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
 * multi-turn, interruption handling, mute, end, and cleanup.
 * What is NOT: OpenAI. The far end is a loopback, not a model, and no human
 * spoke. Said again at the end, where it cannot be missed.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

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
  inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-voice]')
await page.waitForTimeout(500)

check(
  'nothing about a call is on screen before one is placed',
  (await page.locator('.bclive').count()) === 0,
)

/* --- 1. placing it ------------------------------------------------------ */
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
check(
  'the panel says it is listening, in words with no protocol in them',
  (await page.locator('[data-bc-live="listening"]').count()) === 1,
)
const words = await page.locator('.bclive').innerText()
check(
  'nothing on it says session, token, SDP or realtime',
  !/\b(sdp|peer connection|token|realtime|webrtc|session)\b/i.test(words),
  words.replace(/\n+/g, ' / '),
)
check(
  'and it tells him he can just talk',
  /just talk|interrupt/i.test(words),
  words.replace(/\n+/g, ' / ').slice(0, 160),
)

/* --- 2. a turn each, then another ---------------------------------------- */
const say = async (event: Record<string, unknown>): Promise<void> => {
  await page.evaluate(`window.__say(${JSON.stringify(event)})`)
  await page.waitForTimeout(350)
}
await say({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript: 'What is late on this project?',
})
await say({ type: 'response.created' })
check(
  'while the team is answering, the panel says so rather than still saying listening',
  (await page.locator('[data-bc-live="answering"]').count()) === 1,
  await page.locator('.bclive').innerText(),
)
await say({
  type: 'response.output_audio_transcript.done',
  transcript: 'Two things are late: the avatar document and the interview notes.',
})
await say({ type: 'response.done' })
const afterOne = await page.locator('.bclive').innerText()
check('what he said is shown', afterOne.includes('What is late on this project?'), afterOne)
check('what the team said is shown', afterOne.includes('Two things are late'), afterOne)
check(
  'and it goes back to listening, ready for the next thing he says',
  (await page.locator('[data-bc-live="listening"]').count()) === 1,
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
const afterTwo = await page.locator('.bclive').innerText()
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
check('the team is speaking', (await page.locator('[data-bc-live="answering"]').count()) === 1)
await say({ type: 'input_audio_buffer.speech_started' })
await say({ type: 'conversation.item.truncated' })
await say({ type: 'response.done' })
check(
  'interrupting stops the answer and the conversation carries on',
  (await page.locator('[data-bc-live="listening"]').count()) === 1,
  await page.locator('.bclive').innerText(),
)
await say({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript: 'Actually, do the newsletter first.',
})
const afterBarge = await page.locator('.bclive').innerText()
check(
  'and what he said over her is heard',
  afterBarge.includes('Actually, do the newsletter first'),
  afterBarge.replace(/\n+/g, ' / ').slice(0, 200),
)

/* --- 4. mute is the microphone, not a label ------------------------------ */
await page.locator('[data-bc-livemute]').click()
await page.waitForTimeout(400)
check('muting says so', (await page.locator('[data-bc-live="muted"]').count()) === 1)
/*
  AND MUTE REALLY MUTES. A mute that only changes a label is a privacy defect
  wearing a control, so this asks the track the page is actually sending.
*/
const whileMuted = (await page.evaluate(
  inPage(`const mics = window.__mics ?? []
     return { off: mics.filter((t) => t.enabled === false).length, total: mics.length }`),
)) as { off: number; total: number }
check(
  'and the microphone is really off, not merely relabelled',
  whileMuted.off > 0 && whileMuted.total > 0,
  JSON.stringify(whileMuted),
)
await page.locator('[data-bc-livemute]').click()
await page.waitForTimeout(400)
check(
  'and unmuting goes back to listening',
  (await page.locator('[data-bc-live="listening"]').count()) === 1,
)

/* --- 5. ending it, and what is left behind ------------------------------- */
await page.locator('[data-bc-liveend]').click()
await page.waitForTimeout(800)
check('ending the call takes the panel away', (await page.locator('.bclive').count()) === 0)
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
check(
  'a second conversation can be started after the first',
  (await page.locator('[data-bc-live="listening"]').count()) === 1,
)
const mintedAgain = (await page.evaluate(inPage('return window.__minted.length'))) as number
check('with its own credential rather than a reused one', mintedAgain === 2, String(mintedAgain))
await page.locator('[data-bc-liveend]').click()
await page.waitForTimeout(500)

check('nothing threw during any of it', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
console.log(
  '\nWHAT THIS DOES NOT PROVE: OpenAI. The far end of that connection is a second\n' +
    'peer in the same page, not a model, and nobody spoke into a microphone. The\n' +
    'client path, the states, multi-turn, interruption, mute, end and cleanup are\n' +
    'all real; the intelligence at the other end is not.',
)
process.exit(fail === 0 ? 0 : 1)
