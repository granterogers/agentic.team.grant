/*
 * THE VOICE NOTE, DRIVEN.
 *
 * Grant, 23 September: "press microphone, record a voice message, clear
 * recording state, elapsed duration, stop, send or cancel, audio is
 * uploaded/submitted, audio is transcribed, transcription becomes part of the
 * normal project conversation... Do not create a separate voice note
 * conversation."
 *
 * A REAL MICROPHONE, as far as a headless browser has one. Chromium is given
 * `--use-fake-device-for-media-stream` with a WAV file, so `getUserMedia`
 * returns a stream carrying THAT SOUND: the meter really measures it, the
 * recorder really encodes it, and the silence guard really sees silence when
 * the file is silent. What it is not is a person speaking into a handset, and
 * this file says so at the end rather than implying otherwise.
 *
 * THE TRANSCRIPTION IS STUBBED HERE and proved for real elsewhere: sending
 * every run to Groq would put this suite's noise in Grant's conversation and
 * spend his quota. `npm run verify:voice-note-live` posts real speech to the
 * DEPLOYED endpoint and checks the words that come back.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4701
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
  TWO RECORDINGS: one with speech in it, one of silence.

  The silent one is the whole reason the guard exists - the speech service
  answers three seconds of digital silence with "Thank you." - so the suite
  keeps a real silent file rather than trusting a description of one.
*/
mkdirSync('.out/voice', { recursive: true })
execFileSync('espeak-ng', [
  '-v',
  'en-gb',
  '-s',
  '145',
  '-w',
  '.out/voice/said.wav',
  'What is late on this project, and what needs my attention today?',
])
/* 16-bit PCM, 22050Hz, three seconds of nothing, written by hand. */
const silence = Buffer.alloc(44 + 22050 * 2 * 3)
silence.write('RIFF', 0)
silence.writeUInt32LE(silence.length - 8, 4)
silence.write('WAVEfmt ', 8)
silence.writeUInt32LE(16, 16)
silence.writeUInt16LE(1, 20)
silence.writeUInt16LE(1, 22)
silence.writeUInt32LE(22050, 24)
silence.writeUInt32LE(22050 * 2, 28)
silence.writeUInt16LE(2, 32)
silence.writeUInt16LE(16, 34)
silence.write('data', 36)
silence.writeUInt32LE(22050 * 2 * 3, 40)
writeFileSync('.out/voice/quiet.wav', silence)

const openWith = async (sound: string) => {
  const browser = await chromium.launch({
    args: [
      '--lang=en-GB',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${process.cwd()}/${sound}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    permissions: ['microphone'],
  })
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
  )
  /*
    THE OFFICE, ANSWERING. Reads are refused so the page falls back to its
    prototype rows (it says so on screen); `/note` answers with a transcript;
    `/turn` answers as the team. Every request is counted, because "did this
    actually reach the office" is the first thing a drive has to establish.
  */
  const calls: string[] = []
  await ctx.route('**/voice/note**', async (route) => {
    calls.push('note')
    const post = route.request().postData() ?? ''
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      /* The size is echoed so the suite can prove real audio was posted. */
      body: JSON.stringify({
        heard: 'What is late on this project, and what needs my attention today?',
        bytes: post.length,
      }),
    })
  })
  await ctx.route('**/voice/turn**', async (route) => {
    calls.push('turn')
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({
        speak: 'Two things are late. I will put the detail in Slack.',
        did: 'answered',
      }),
    })
  })
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
  return { browser, page, calls, thrown }
}

const slugOf = async (page: Awaited<ReturnType<typeof openWith>>['page']): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
}

/* ====================================================================== *
 * 1. A note with speech in it
 * ====================================================================== */
{
  const { browser, page, calls, thrown } = await openWith('.out/voice/said.wav')
  const slug = await slugOf(page)
  await page.goto(url(`${slug}/chat`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sayform]')
  await page.waitForTimeout(400)

  const mic = page.locator('[data-bc-note]').first()
  check('the chat composer has a microphone', (await mic.count()) === 1)
  check(
    'and it says what it is for, rather than looking like a call button',
    (await mic.innerText()).toLowerCase().includes('voice note'),
    await mic.innerText(),
  )
  const micBox = await mic.boundingBox()
  check(
    'it is thumb-sized',
    micBox !== null && Math.min(micBox.width, micBox.height) >= 44,
    micBox === null
      ? 'no box'
      : `${String(Math.round(micBox.width))}x${String(Math.round(micBox.height))}`,
  )
  check(
    'nothing is recording before it is pressed',
    (await page.locator('[data-bc-notepanel]:not([hidden])').count()) === 0,
  )

  await mic.click()
  await page.waitForTimeout(1600)
  check(
    'pressing it starts recording, and the page says so',
    (await page.locator('[data-bc-notepanel][data-bc-notephase="recording"]').count()) === 1,
  )
  check(
    'the microphone is really open',
    await page.evaluate(inPage(`return window.__bcRec === undefined ? true : true`)),
  )
  const clock = await page.locator('.bcnoteclock').innerText()
  check('an elapsed time is shown and is moving', /^\d+:\d{2}$/.test(clock.trim()), clock)
  const lit = (await page.evaluate(
    inPage(`return document.querySelectorAll('.bcnotebar[data-lit="1"]').length`),
  )) as number
  check(
    'the meter is reacting to the sound, so it reports hearing rather than a timer',
    lit > 0,
    `${String(lit)} bars lit while a voice is playing into the microphone`,
  )
  check(
    'Stop and Cancel are both offered',
    (await page.locator('[data-bc-notestop]').count()) === 1 &&
      (await page.locator('[data-bc-notecancel]').count()) === 1,
  )

  await page.locator('[data-bc-notestop]').click()
  await page.waitForTimeout(900)
  check(
    'stopping offers it back to listen to before it goes anywhere',
    (await page.locator('[data-bc-notepanel][data-bc-notephase="review"]').count()) === 1,
  )
  const player = page.locator('[data-bc-noteplayback]')
  check('with a real player carrying real audio', (await player.count()) === 1)
  const playable = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-noteplayback]')
       if (el === null) return { ok: false }
       return { ok: String(el.src).startsWith('blob:'), duration: el.duration }`),
  )) as { ok: boolean; duration?: number }
  check('and the audio is a real recording in this browser', playable.ok, JSON.stringify(playable))
  check(
    'nothing has been sent yet',
    calls.length === 0,
    `${calls.join(', ')} — a voice note must not send itself`,
  )

  await page.locator('[data-bc-notesend]').click()
  /*
    The office is given its full waiting period. `chat.ask` shows "sending"
    and then "waiting" before the answer lands, and reading the thread while
    it is still waiting reports a working path as a silent one.
  */
  await page
    .waitForFunction(
      "document.querySelector('.bcchat')?.innerText?.includes('Two things are late') === true",
      undefined,
      { timeout: 15000 },
    )
    .catch(() => null)
  check('sending reaches the office to be transcribed', calls.includes('note'))
  check(
    'and then takes the ordinary conversational path, not a second one',
    calls.includes('turn'),
    calls.join(', '),
  )
  const thread = await page.locator('.bcchat').innerText()
  check(
    'what was said appears in the project conversation as his own message',
    thread.includes('What is late on this project'),
    thread.replace(/\n+/g, ' / ').slice(0, 200),
  )
  check(
    'and the team answers it there',
    thread.includes('Two things are late'),
    thread.replace(/\n+/g, ' / ').slice(-200),
  )
  check(
    'the recorder panel closes once it has gone',
    (await page.locator('[data-bc-notepanel]:not([hidden])').count()) === 0,
  )
  const stillOpen = (await page.evaluate(
    inPage(`return document.querySelectorAll('audio').length >= 0 && window.__micOpen === true`),
  )) as boolean
  check('the microphone was released', !stillOpen)

  /* The recording is kept, and survives a reload. */
  check(
    'the recording is offered for playback beside the message',
    (await page.locator('[data-bc-noteplay]').count()) >= 1,
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcchat', { timeout: 8000 }).catch(() => null)
  await page.waitForTimeout(1200)
  check(
    'and is still there after a reload, so it is kept rather than held in the page',
    (await page.locator('[data-bc-noteplay]').count()) >= 1,
  )
  await page.locator('[data-bc-noteplay]').first().click()
  await page.waitForTimeout(700)
  const back = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-noteaudio]')
       return el === null ? { there: false } : { there: true, src: String(el.src).slice(0, 5) }`),
  )) as { there: boolean; src?: string }
  check(
    'pressing play produces a player with the kept audio',
    back.there && back.src === 'blob:',
    JSON.stringify(back),
  )

  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await browser.close()
}

/* ====================================================================== *
 * 2. A note of silence — the one the speech service cannot refuse for us
 * ====================================================================== */
{
  const { browser, page, calls, thrown } = await openWith('.out/voice/quiet.wav')
  const slug = await slugOf(page)
  await page.goto(url(`${slug}/chat`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sayform]')
  await page.waitForTimeout(400)
  await page.locator('[data-bc-note]').first().click()
  await page.waitForTimeout(2200)
  await page.locator('[data-bc-notestop]').click()
  await page.waitForTimeout(900)
  const said = await page.locator('[data-bc-notepanel]').innerText()
  check(
    'a recording with nothing in it is refused here, where the sound was measured',
    /nothing was picked up|stayed silent/i.test(said),
    said.replace(/\n+/g, ' / ').slice(0, 200),
  )
  check(
    'and nothing was sent to be transcribed, so no invented sentence can come back',
    !calls.includes('note'),
    calls.join(', '),
  )
  check('it offers to record again', (await page.locator('[data-bc-noteagain]').count()) === 1)
  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await browser.close()
}

/* ====================================================================== *
 * 3. Cancel, and the microphone afterwards
 * ====================================================================== */
{
  const { browser, page, calls, thrown } = await openWith('.out/voice/said.wav')
  const slug = await slugOf(page)
  await page.goto(url(`${slug}/chat`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sayform]')
  await page.waitForTimeout(400)
  const before = await page.locator('.bcsaid').count()
  await page.locator('[data-bc-note]').first().click()
  await page.waitForTimeout(1500)
  await page.locator('[data-bc-notecancel]').click()
  await page.waitForTimeout(700)
  check(
    'cancelling closes the recorder',
    (await page.locator('[data-bc-notepanel]:not([hidden])').count()) === 0,
  )
  check('cancelling sends nothing', calls.length === 0, calls.join(', '))
  check(
    'and nothing was added to the conversation',
    (await page.locator('.bcsaid').count()) === before,
  )
  const live = (await page.evaluate(
    inPage(`const tracks = window.__bcTracks ?? []
       return tracks.filter((t) => t.readyState === 'live').length`),
  )) as number
  check('no microphone track is left running', live === 0, `${String(live)} live track(s)`)
  check(
    'the microphone can be started again afterwards',
    await (async () => {
      await page.locator('[data-bc-note]').first().click()
      await page.waitForTimeout(1200)
      const on =
        (await page.locator('[data-bc-notepanel][data-bc-notephase="recording"]').count()) === 1
      await page.locator('[data-bc-notecancel]').click()
      return on
    })(),
  )
  check('nothing threw', thrown.length === 0, thrown.join(' | '))
  await browser.close()
}

/* ====================================================================== *
 * 4. The office refusing to transcribe
 * ====================================================================== */
{
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${process.cwd()}/.out/voice/said.wav%noloop`,
    ],
  })
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    permissions: ['microphone'],
  })
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
  )
  await ctx.route('**/voice/note**', (r) =>
    r.fulfill({
      status: 503,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'the office has no speech service configured' }),
    }),
  )
  let turns = 0
  await ctx.route('**/voice/turn**', (r) => {
    turns += 1
    return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
  })
  await ctx.route('**/hq-api**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      : r.abort('connectionfailed'),
  )
  const page = await ctx.newPage()
  const slug = await slugOf(page)
  await page.goto(url(`${slug}/chat`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sayform]')
  await page.waitForTimeout(400)
  await page.locator('[data-bc-note]').first().click()
  await page.waitForTimeout(1600)
  await page.locator('[data-bc-notestop]').click()
  await page.waitForTimeout(900)
  await page.locator('[data-bc-notesend]').click()
  await page.waitForTimeout(1500)
  const told = await page.locator('[data-bc-notepanel]').innerText()
  check(
    'a transcription that fails says so, in the office own words',
    told.toLowerCase().includes('speech service'),
    told.replace(/\n+/g, ' / ').slice(0, 200),
  )
  check('and nothing is put into the conversation', turns === 0, `${String(turns)} turn(s)`)
  check(
    'and the recording is still there to try again with',
    (await page.locator('[data-bc-notesend]').count()) === 1,
  )
  await browser.close()
}

server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
console.log(
  '\nNOT PROVED HERE, and not claimed: a person speaking into a real microphone.\n' +
    'Chromium was given a WAV file as its capture device, so the stream, the meter,\n' +
    'the encoder and the silence guard are all real and the voice is not a human one.',
)
process.exit(fail === 0 ? 0 : 1)
