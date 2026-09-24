/**
 * Talk to Team, driven the way a person drives it.
 *
 *   npm run verify:talk
 *
 * ## Why this exists
 *
 * Grant: *"I believe Talk to Team is broken on mobile. Desktop is unverified.
 * Do not consider this resolved simply because the component renders."*
 *
 * That last sentence is the specification for this file. Rendering is the
 * cheapest thing a component does and the only thing the previous checks could
 * have caught, because the previous checks never opened a browser at all.
 *
 * So this one types into the box with a real keyboard, submits it with a real
 * tap on a real touchscreen, and asserts on what comes back — including what
 * comes back when the office is down, when the microphone is refused, and when
 * the call will not connect. A surface is not working because its happy path
 * works; it is working when its unhappy paths say something useful and it can
 * be used again afterwards.
 *
 * ## What is real and what is stubbed
 *
 * The page is the real page from the working tree. The interactions are real
 * browser input events. What is stubbed is `/voice/turn`, so each of the
 * office's possible answers — answered, delegated, failed, unreachable — can
 * be provoked on demand rather than waited for.
 *
 * The office side is not stubbed away entirely: the last check reaches the
 * DEPLOYED voice endpoint over the network and proves it is live and refuses
 * an unauthenticated caller. It deliberately does not present the dashboard
 * token — that credential goes to Grant on Telegram and never into a terminal
 * (§15) — and the full instruction-to-answer round trip is covered where it
 * belongs, in `verify:cross-interface` and `verify:scenario-a`.
 *
 * ## Why the mobile checks are not "the same checks at a smaller size"
 *
 * Two of them can only fail on a phone. An input under 16px makes iOS Safari
 * zoom the whole page the moment it is focused, which reads as the layout
 * breaking; and a control under the touch floor is only a problem for a thumb.
 * Both are asserted here rather than left to `verify:ui`, because this is the
 * one surface Grant named.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = Number(process.env.TALK_VERIFY_PORT ?? 8972)
const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

/*
  The studio, whole (#68, ADR-0019).

  The call moved out of `web/hq/index.html` into `web/studio/call.js` and the
  studio is what is served at the root now. A check still pointed at the old
  file would be testing a page nobody can open — the pattern CLAUDE.md names
  after three instances of it in one day.

  A directory rather than a string, because the studio is a page plus thirty
  files. The ids it drives by — call, talkstate, askform, asktext, asksend,
  turns, typeinstead — were kept on the new markup deliberately, so what this
  suite asserts did not have to be rewritten alongside what it tests. A retarget
  that rewrites its own assertions is a retarget that quietly loses one.
*/
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
const server = createServer((request, response) => {
  let file = join('web/studio', decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) {
    response.writeHead(404)
    response.end('not here')
    return
  }
  const body = readFileSync(file)
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
  })
  response.end(body)
})
await new Promise<void>((resolve) => server.listen(PORT, resolve))

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })

/**
 * A page on the Talk tab, with the office answering however this test needs.
 *
 * `mode` is read from `window.__MODE` at request time rather than baked in, so
 * one page can be walked through several office behaviours in sequence — which
 * is the point: the interesting question is whether the surface still works
 * after a failure, and that cannot be asked by a fresh page per case.
 */
const openTalk = async (device: Record<string, unknown>) => {
  const context = await browser.newContext({ ...device })
  const page = await context.newPage()
  await page.addInitScript(`
    /*
      NAME AN OFFICE, rather than relying on one being written into the page.

      Every module under web/studio used to fall back to one project's gateway,
      so a suite that named none still got a URL with /voice/turn on the end and
      the stub below matched it. ADR-0048 removed the fallback: a page nothing
      has configured resolves to the empty string and refuses honestly, which is
      the point, and it left this suite posting to the page's own origin and
      reporting "nothing reached the office" about a page that had nowhere to
      reach. The seam is window.HQ_API, the same one every other suite uses.

      An address that cannot exist, because nothing here is meant to leave the
      browser: window.fetch is replaced two lines below.
    */
    window.HQ_API = 'https://office.invalid/functions/v1/hq-api';
    try { localStorage.setItem('hq.token', 'verify-talk'); } catch (e) {}
    window.__MODE = 'answered';
    window.__ASKED = [];
    window.__MINT = 'ok';
    window.__MIC = 'ok';
    const passThrough = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input);
      const reply = (body, status) => new Response(JSON.stringify(body),
        { status: status || 200, headers: { 'content-type': 'application/json' } });

      if (url.includes('/voice/turn')) {
        window.__ASKED.push(JSON.parse(String(init && init.body)));
        if (window.__MODE === 'down') return reply({ error: 'the office is not answering' }, 503);
        if (window.__MODE === 'offline') throw new TypeError('Failed to fetch');
        if (window.__MODE === 'delegated') return reply({ did: 'delegated', speak: 'Right — I will put that to Emma and come back to you.' });
        return reply({ did: 'answered', speak: 'Two projects, and one decision waiting on you.' });
      }
      if (url.includes('voice-token')) {
        if (window.__MINT === 'down') return new Response('no', { status: 503 });
        return reply({ client_secret: 'ek_test', model: 'gpt-realtime', degraded: window.__MINT === 'degraded' });
      }
      if (url.includes('hq-api')) return reply({ data: {} });
      return reply({});
    };
    // The microphone, without needing a device or a permission prompt.
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.__MIC === 'refused') {
        const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e;
      }
      // A track the page can stop, so hangUp() has something real to clean up.
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator(); osc.connect(dest); osc.start();
      /*
        Every stream this stub ever handed out, kept (#102).

        The check that matters is not "did the page call stop on the stream it
        is holding" — it is "is ANY microphone this page opened still live".
        Those are different questions, and the bug was precisely the gap
        between them: closing the call sheet dropped the reference, so the page
        held nothing, stopped nothing, and the device kept recording.

        A page that has lost track of a stream cannot be asked about it. The
        stub can.
      */
      window.__MICS = window.__MICS || [];
      window.__MICS.push(dest.stream);
      return dest.stream;
    };
  `)
  await page.goto(`http://127.0.0.1:${String(PORT)}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForTimeout(1_500)
  // Reached the way a person reaches it — via the menu — and matched the same
  // three ways `verify:ui` matches, because the label a person reads ("Talk to
  // the team") is not the section name the code uses ("talk").
  /*
    The call is a sheet now, not a tab.

    Reached through the command bar, which is where the call PANEL lives since
    #214.

    The microphone in the rail no longer opens anything. Grant: *"When Call the
    Team is pressed: do not open a modal/dialog. Start the team voice/audio
    session directly."* So a test that drives this suite by clicking it would
    place a real call and then measure a dialog that is deliberately not there.

    The panel is still the surface these checks are about - the transcript and
    the typed fallback - and it opens from the command bar, ranked like every
    other row. Driving it this way also means the command bar's own routing is
    exercised on every talk run, which nothing else did.
  */
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.locator('[data-cmd-input]').fill('call panel')
  await page.waitForTimeout(300)
  /*
    A REAL press, not `element.click()`.

    The command bar's rows are wired on `mousedown`, deliberately - it preserves
    focus in the input so a mouse press behaves exactly like Enter. A synthetic
    `click()` dispatches no mousedown, so it silently does nothing and the check
    below reports a missing panel about a row that works perfectly.
  */
  const row = page.locator('[data-cmd-row]').filter({ hasText: 'The call panel' }).first()
  const reached = (await row.count()) > 0
  if (reached) await row.click({ force: true })
  await page.waitForTimeout(800)
  return { context, page, reached }
}

/**
 * Open the typing fallback.
 *
 * Grant: *"i dont need to see the text .. just the voice is fine"*. So the
 * transcript is gone and typing lives behind a disclosure — it is still the
 * only way through when a microphone is refused, which is why it is behind a
 * summary rather than deleted.
 *
 * Every typing check below therefore opens it first, the way a person would.
 * The check that it is CLOSED to begin with is a separate assertion, because
 * "the page does not show him text he did not ask for" is the requirement and
 * a helper that quietly opens it would hide a regression in exactly that.
 */
const openTyping = async (page: Awaited<ReturnType<typeof openTalk>>['page']): Promise<void> => {
  await page.evaluate(`(() => {
    const d = document.getElementById('typeinstead');
    if (d) d.open = true;
  })()`)
  await page.waitForTimeout(150)
}

/** The turns list, newest first, as the reader sees it. */
const turnsOn = async (page: Awaited<ReturnType<typeof openTalk>>['page']): Promise<string[]> =>
  (await page.evaluate(
    `[...document.querySelectorAll('#turns .turn')].map((t) => t.className.trim() + '|' + (t.textContent ?? '').trim())`,
  )) as string[]

const stateOn = async (page: Awaited<ReturnType<typeof openTalk>>['page']): Promise<string> =>
  String(
    await page.evaluate(`(document.getElementById('talkstate') || {}).textContent || ''`),
  ).trim()

// ===========================================================================
// On a phone, with a thumb
// ===========================================================================

{
  const { context, page, reached } = await openTalk(devices['iPhone 14'])
  record(
    'mobile · the Talk tab opens from the menu',
    reached ? 'reached' : 'no menu item opens it',
    reached,
  )

  /*
    Voice first, and no wall of text.

    Grant, after the call finally connected: *"i dont need to see the text ..
    just the voice is fine"*. The transcript used to be the bulk of this view.
  */
  const voiceFirst = (await page.evaluate(`(() => {
    const d = document.getElementById('typeinstead');
    const call = document.getElementById('call');
    const turns = document.querySelectorAll('#turns .turn').length;
    return { closed: !!d && !d.open, hasCall: !!call, turns };
  })()`)) as { closed: boolean; hasCall: boolean; turns: number }
  record(
    'mobile · the call is the page — no transcript until he asks for one',
    voiceFirst.hasCall
      ? `typing ${voiceFirst.closed ? 'folded away' : 'OPEN by default'}, ${String(voiceFirst.turns)} turns shown`
      : 'no call button at all',
    voiceFirst.hasCall && voiceFirst.closed && voiceFirst.turns === 0,
  )

  await openTyping(page)

  const shape = (await page.evaluate(`(() => {
    const box = document.getElementById('asktext');
    const send = document.getElementById('asksend');
    const call = document.getElementById('call');
    if (!box || !send || !call) return { missing: true };
    const r = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      missing: false,
      fontPx: Number.parseFloat(getComputedStyle(box).fontSize),
      box: r(box), send: r(send), call: r(call),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`)) as {
    missing: boolean
    fontPx: number
    box: { w: number; h: number }
    send: { w: number; h: number }
    call: { w: number; h: number }
    overflow: boolean
  }

  record(
    'mobile · the box, Send and the phone button are all present',
    shape.missing ? 'one of them is missing from the DOM' : 'all three',
    !shape.missing,
  )
  // Under 16px and iOS Safari zooms the page on focus. It is the single most
  // common way a form "breaks on mobile" without anybody having broken it.
  record(
    'mobile · the input is at least 16px, so iOS does not zoom on focus',
    `${String(shape.fontPx)}px`,
    shape.fontPx >= 16,
  )
  const tappable = shape.box.h >= 44 && shape.send.h >= 44 && shape.call.h >= 44
  record(
    'mobile · every control clears the 44px touch floor',
    `box ${String(shape.box.h)}, send ${String(shape.send.h)}, call ${String(shape.call.h)}`,
    tappable,
  )
  record(
    'mobile · the tab does not overflow sideways',
    shape.overflow ? 'it does' : 'no overflow',
    !shape.overflow,
  )

  // --- typing and submitting, by touch -------------------------------------
  //
  // `tap()`, not `click()`. A touchscreen dispatches a different event
  // sequence, and a handler bound only to `click` behaves differently under it.
  await page.locator('#asktext').tap()
  await page.locator('#asktext').fill('what is waiting on me')
  await page.locator('#asksend').tap()
  await page.waitForTimeout(600)

  let turns = await turnsOn(page)
  record(
    'mobile · a tapped message is sent and answered',
    turns.length >= 2
      ? turns.slice(0, 2).join('  //  ').slice(0, 120)
      : `only ${String(turns.length)} turn(s)`,
    turns.length >= 2 &&
      turns.some((t) => t.includes('one decision waiting')) &&
      turns.some((t) => t.includes('what is waiting on me')),
  )

  const asked = (await page.evaluate(`window.__ASKED`)) as { said?: string; session?: string }[]
  record(
    'mobile · the office receives the words and a session',
    asked[0] === undefined
      ? 'nothing reached the office'
      : `said="${String(asked[0].said)}" session=${String(asked[0].session).slice(0, 6)}…`,
    asked[0]?.said === 'what is waiting on me' &&
      typeof asked[0]?.session === 'string' &&
      asked[0].session.length > 3,
  )
  record(
    'mobile · the box is cleared, so the next message is not a duplicate',
    String(await page.evaluate(`document.getElementById('asktext').value`)) === ''
      ? 'empty'
      : 'still holds the last message',
    String(await page.evaluate(`document.getElementById('asktext').value`)) === '',
  )

  // --- the keyboard's send key ---------------------------------------------
  await page.locator('#asktext').fill('and after that')
  await page.locator('#asktext').press('Enter')
  await page.waitForTimeout(600)
  record(
    'mobile · the keyboard send key submits too',
    ((await page.evaluate(`window.__ASKED.length`)) as number) === 2
      ? 'submitted'
      : 'nothing happened',
    ((await page.evaluate(`window.__ASKED.length`)) as number) === 2,
  )

  // --- an empty submission is not a message --------------------------------
  await page.locator('#asktext').fill('   ')
  await page.locator('#asksend').tap()
  await page.waitForTimeout(400)
  record(
    'mobile · whitespace is not sent to the office',
    `${String((await page.evaluate(`window.__ASKED.length`)) as number)} calls after an empty submit`,
    ((await page.evaluate(`window.__ASKED.length`)) as number) === 2,
  )

  // --- delegated is visibly different from answered ------------------------
  await page.evaluate(`window.__MODE = 'delegated'`)
  await page.locator('#asktext').fill('get the team to look at the market')
  await page.locator('#asksend').tap()
  await page.waitForTimeout(600)
  turns = await turnsOn(page)
  record(
    'mobile · work handed to the team is marked as handed over',
    turns[0]?.startsWith('turn delegated') === true
      ? 'marked delegated'
      : `first turn is "${String(turns[0]).slice(0, 40)}"`,
    turns[0]?.startsWith('turn delegated') === true,
  )
  record(
    'mobile · and it says where the answer will arrive',
    await stateOn(page),
    (await stateOn(page)).toLowerCase().includes('slack'),
  )

  // --- the office is down ---------------------------------------------------
  await page.evaluate(`window.__MODE = 'down'`)
  await page.locator('#asktext').fill('anything urgent')
  await page.locator('#asksend').tap()
  await page.waitForTimeout(600)
  turns = await turnsOn(page)
  record(
    'mobile · an office error is shown as an error, not swallowed',
    String(turns[0]).slice(0, 90),
    turns[0]?.includes('bad') === true && turns[0].toLowerCase().includes('could not reach'),
  )
  // The failure that matters most: a surface stuck on "Thinking…" is a surface
  // the user believes is still working.
  record(
    'mobile · and the surface is usable again afterwards',
    await stateOn(page),
    !(await stateOn(page)).includes('Thinking'),
  )

  // --- the network is gone --------------------------------------------------
  await page.evaluate(`window.__MODE = 'offline'`)
  await page.locator('#asktext').fill('are we still there')
  await page.locator('#asksend').tap()
  await page.waitForTimeout(600)
  turns = await turnsOn(page)
  record(
    'mobile · a dropped connection is reported rather than hanging',
    String(turns[0]).slice(0, 90),
    turns[0]?.includes('bad') === true && !(await stateOn(page)).includes('Thinking'),
  )

  // --- and it recovers ------------------------------------------------------
  await page.evaluate(`window.__MODE = 'answered'`)
  await page.locator('#asktext').fill('try again')
  await page.locator('#asksend').tap()
  await page.waitForTimeout(600)
  turns = await turnsOn(page)
  record(
    'mobile · the next message after a failure works',
    String(turns[0]).slice(0, 70),
    turns[0]?.includes('one decision waiting') === true,
  )

  await context.close()
}

// ===========================================================================
// The call, and the ways it does not start
// ===========================================================================
//
// The SDP exchange itself reaches OpenAI and is not something a check should
// drive. What IS checkable, and what actually strands a user, is every step
// before it: the mint, the microphone, and whether the button comes back.

{
  const { context, page } = await openTalk(devices['iPhone 14'])

  await page.evaluate(`window.__MINT = 'down'`)
  await page.locator('#call').tap()
  await page.waitForTimeout(1_200)
  /*
    Asserted on the STATE, not on an emoji.

    The old page's button was the character 📞 and hanging up rewrote its text,
    so "did it reset" could be read off `textContent`. The studio's is an SVG
    microphone — setting text on it would delete the icon — and the reset is a
    class coming off plus the label going back.

    That is the better assertion anyway: it was always the state that mattered,
    and the emoji was how the state happened to be drawn. A check written
    against a rendering detail fails when the rendering improves.
  */
  const callReset = async () =>
    (await page.evaluate(
      `(() => {
        const b = document.getElementById('call');
        return (b.classList.contains('ringing') ? 'ringing' : 'idle')
          + '/' + (b.getAttribute('aria-label') || '');
      })()`,
    )) as string
  record(
    'call · when the office will not start a call, the button resets',
    `${String(await stateOn(page))} / button=${await callReset()}`,
    !(await stateOn(page)).includes('Connecting') && (await callReset()).startsWith('idle/'),
  )

  await page.evaluate(`window.__MINT = 'ok'; window.__MIC = 'refused'`)
  await page.locator('#call').tap()
  await page.waitForTimeout(1_200)
  const refusedMessage = await stateOn(page)
  record(
    'call · a refused microphone says how to fix it',
    refusedMessage,
    refusedMessage.toLowerCase().includes('microphone') &&
      refusedMessage.toLowerCase().includes('allow'),
  )
  record(
    'call · and the phone button is pressable again',
    String(await page.evaluate(`document.getElementById('call').className`)),
    !String(await page.evaluate(`document.getElementById('call').className`)).includes('on'),
  )

  await context.close()
}

// ===========================================================================
// Desktop — unverified until now, in Grant's words
// ===========================================================================

{
  const { context, page, reached } = await openTalk({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  })
  record('desktop · the Talk tab opens', reached ? 'reached' : 'no control opens it', reached)

  await openTyping(page)
  await page.locator('#asktext').click()
  await page.locator('#asktext').fill('what is everyone doing')
  await page.locator('#asksend').click()
  await page.waitForTimeout(600)
  const turns = await turnsOn(page)
  record(
    'desktop · a clicked message is sent and answered',
    turns.length >= 2 ? String(turns[0]).slice(0, 70) : `only ${String(turns.length)} turn(s)`,
    turns.length >= 2 && turns[0]?.includes('one decision waiting') === true,
  )
  record(
    'desktop · the newest turn is at the top, where it is read',
    String(turns[0]).slice(0, 50),
    turns[0]?.includes('one decision waiting') === true &&
      String(turns[1]).includes('what is everyone doing'),
  )
  await context.close()
}

/*
  Stop, and the silence that must follow it.

  Grant: *"also stop talking doesnt work"*.

  Two separate faults, and the checks below separate them because the fixes
  are in different places. Closing the peer connection stopped audio ARRIVING
  and did nothing about the audio already handed to the `<audio>` element,
  which played out its buffer — several seconds of Claire finishing her
  sentence after he pressed stop. And the element was scoped inside the
  connect block, so nothing outside it could pause it anyway.

  This is the one check in the file that needs the call to have CONNECTED, so
  the peer connection is stubbed: a real one cannot complete a handshake
  against a stubbed SDP endpoint, and the thing under test is not WebRTC — it
  is what the page does with the data channel and the speaker when he says
  stop. What is asserted is exactly what a listener would notice: the server
  is told to stop generating, the audio it already sent is discarded, and the
  element is paused.
*/
{
  const { context, page } = await openTalk(devices['iPhone 14'])

  await page.evaluate(`(() => {
    window.__SENT = [];
    window.__PAUSED = 0;
    const RealAudio = window.Audio;
    window.Audio = function () {
      const a = new RealAudio();
      const pause = a.pause.bind(a);
      a.pause = () => { window.__PAUSED += 1; pause(); };
      return a;
    };
    window.RTCPeerConnection = function () {
      const self = this;
      this.connectionState = 'connected';
      this.ontrack = null;
      this.onconnectionstatechange = null;
      this.addTrack = () => {};
      this.close = () => { self.connectionState = 'closed'; };
      this.createDataChannel = () => {
        const ch = {
          readyState: 'open',
          send: (m) => window.__SENT.push(JSON.parse(m).type),
          close: () => { ch.readyState = 'closed'; },
          onmessage: null,
        };
        // How the checks below play a server event into the page, which is the
        // only way to put the call into the state stop has to get it out of.
        window.__EMIT = (ev) => { if (ch.onmessage) ch.onmessage({ data: JSON.stringify(ev) }); };
        return ch;
      };
      this.createOffer = async () => ({ type: 'offer', sdp: 'v=0' });
      this.setLocalDescription = async () => {};
      this.setRemoteDescription = async () => {};
    };
  })()`)

  await page.locator('#call').tap()
  // Longer than the other call checks: this one waits for the whole connect
  // sequence — microphone, offer, SDP exchange — rather than for it to fail
  // early, and the stubbed AudioContext is the slowest part of it.
  await page.waitForTimeout(2_500)
  const onCall = await stateOn(page)
  record(
    'call · a connected call says so',
    onCall.slice(0, 60),
    onCall.toLowerCase().includes('on a call'),
  )

  // She is mid-answer. Without this the page has nothing to cancel, and a
  // `response.cancel` sent into silence comes back as an error event — which
  // Grant would see as "something went wrong on the call" every time he took
  // a breath. That is why `answering` is tracked at all.
  await page.evaluate(`window.__EMIT({ type: 'response.created' })`)
  await page.waitForTimeout(100)

  /*
    A breath is not an interruption.

    Grant: *"its cutting out a lot when she talks"*. The first version of the
    barge-in fix cancelled the response on every `input_audio_buffer.
    speech_started`, which is the VAD's suspicion rather than a fact — on a
    speakerphone it fires on her own voice, on a breath, on a chair — so she
    was chopped off mid-word several times a sentence.

    So this asserts the shape of the fix rather than its existence: a
    speech_started sends NOTHING, and it is `conversation.item.truncated` — the
    server saying it HAS cut her off — that drops the queued audio. Checked
    before the stop-button assertions because it must hold while she is still
    talking.
  */
  await page.evaluate(`window.__SENT = []`)
  await page.evaluate(`window.__EMIT({ type: 'input_audio_buffer.speech_started' })`)
  await page.waitForTimeout(150)
  const onBreath = (await page.evaluate(`window.__SENT`)) as string[]
  record(
    'call · a breath does not cut her off mid-word',
    onBreath.length === 0 ? 'nothing sent' : `sent ${onBreath.join(', ')}`,
    onBreath.length === 0,
  )

  await page.evaluate(`window.__EMIT({ type: 'conversation.item.truncated' })`)
  await page.waitForTimeout(150)
  const onReal = (await page.evaluate(`window.__SENT`)) as string[]
  record(
    'call · but a real interruption drops the audio still queued',
    onReal.join(', ') || '(nothing sent)',
    onReal.includes('output_audio_buffer.clear'),
  )

  // Re-armed, because the truncation above cleared it: the stop checks below
  // need a response actually in flight to cancel.
  await page.evaluate(`window.__SENT = []`)
  await page.evaluate(`window.__EMIT({ type: 'response.created' })`)
  await page.waitForTimeout(100)

  await page.locator('#call').tap()
  await page.waitForTimeout(500)

  const sent = (await page.evaluate(`window.__SENT`)) as string[]
  const paused = (await page.evaluate(`window.__PAUSED`)) as number
  record(
    'call · stop tells the server to stop generating',
    sent.join(', ') || '(nothing was sent)',
    sent.includes('response.cancel'),
  )
  record(
    'call · and discards the audio it had already sent',
    sent.includes('output_audio_buffer.clear') ? 'cleared' : 'never cleared — she plays on',
    sent.includes('output_audio_buffer.clear'),
  )
  record(
    'call · and pauses the speaker, so she stops mid-word',
    `paused ${String(paused)}x`,
    paused >= 1,
  )
  const after = await stateOn(page)
  record(
    'call · and the button offers to call again',
    after.slice(0, 60),
    after.toLowerCase().includes('call again') || after.toLowerCase().includes('press the phone'),
  )

  /*
    The one that would have caught #102.

    Grant: *"Turning voice off must stop microphone capture and ongoing voice
    playback."* Every check above this line passed while the microphone stayed
    open, because they all ask what the page SENT or what the page SHOWS, and a
    leaked audio track is neither. It is a device that is still recording after
    the interface says it is not, and the only external sign is the browser's
    own indicator.

    `live` counts tracks that are not 'ended' across every stream the stub ever
    handed out — including any the page has forgotten about, which is the whole
    point.
  */
  const liveTracks = (await page.evaluate(
    `(window.__MICS || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState !== 'ended').length`,
  )) as number
  record(
    'call · and the microphone is actually released, not merely forgotten',
    liveTracks === 0
      ? 'no live track remains'
      : `${String(liveTracks)} track(s) STILL RECORDING after stop`,
    liveTracks === 0,
  )

  /*
    And again from the state that used to leak, through the control Grant
    actually uses (#101, then #214).

    Closing the panel is not hanging up - the call is meant to survive it, and
    that is what stranded a microphone before #101. What changed with #214 is
    what happens next: the rail's button no longer REOPENS the panel, it ends
    the call, because Grant asked for a toggle and not a door.

    So the sequence is the one a person performs: place a call, close the panel,
    press the microphone in the rail. That must end the call and release the
    device, with no panel involved at any point in the stop.
  */
  await page.locator('#call').tap()
  await page.waitForTimeout(400)
  await page.locator('#viewer .close').tap()
  await page.waitForTimeout(300)
  const railLive = await page.evaluate(
    `document.querySelectorAll('[data-call].ringing, [data-call].connecting').length > 0`,
  )
  record(
    'call · the rail keeps showing a live call after the panel is closed',
    railLive === true ? 'still shown as live' : 'THE RAIL FORGOT THE CALL',
    railLive === true,
  )
  await page.locator('[data-call]').first().tap()
  await page.waitForTimeout(500)
  const afterRoundTrip = (await page.evaluate(
    `(window.__MICS || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState !== 'ended').length`,
  )) as number
  record(
    'call · pressing the rail microphone ends the call and releases the device',
    afterRoundTrip === 0
      ? 'no live track remains'
      : `${String(afterRoundTrip)} track(s) STILL RECORDING`,
    afterRoundTrip === 0,
  )
  const railIdle = await page.evaluate(
    `document.querySelectorAll('[data-call].ringing, [data-call].connecting').length === 0`,
  )
  record(
    'call · and the rail says so, without a panel being open',
    railIdle === true ? 'back to idle' : 'THE RAIL STILL SAYS LIVE',
    railIdle === true,
  )

  /*
    The toggle, from a cold start and with no panel at all.

    This is #214's actual claim: the most prominent control in the product
    places a call on the first press and ends it on the second, and nothing
    opens. Everything above reached the microphone through the panel, so without
    this the one interaction Grant asked for would be the one nothing tests.
  */
  await page.locator('[data-call]').first().tap()
  await page.waitForTimeout(600)
  const startedBare = await page.evaluate(
    `document.querySelectorAll('[data-call].ringing, [data-call].connecting').length > 0
       && !document.body.classList.contains('behind')`,
  )
  record(
    'call · the rail microphone places a call on its own, opening nothing',
    startedBare === true ? 'live, and no sheet opened' : 'IT DID NOT START, OR IT OPENED A DIALOG',
    startedBare === true,
  )
  await page.locator('[data-call]').first().tap()
  await page.waitForTimeout(500)
  const stoppedBare = (await page.evaluate(
    `(window.__MICS || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState !== 'ended').length`,
  )) as number
  record(
    'call · and the second press genuinely stops it',
    stoppedBare === 0 ? 'device released' : `${String(stoppedBare)} track(s) STILL RECORDING`,
    stoppedBare === 0,
  )

  await context.close()
}

await browser.close()
server.close()

// ===========================================================================
// The deployed endpoints behind the surface
// ===========================================================================
//
// Two questions, asked two ways, because neither answers the other.
//
// "Is it deployed?" is asked of the Management API, which knows. The first
// version of this check asked the endpoint itself and read a 401 as an answer;
// it is not one. Supabase's gateway rejects an unauthenticated request BEFORE
// the function runs, so a 401 is returned identically by a healthy function, a
// broken function, and a function that was never deployed at all. A check that
// cannot tell those three apart is not a check.
//
// "Is it guarded?" is then asked over the real network. No credential is
// presented — the dashboard token goes to Grant on Telegram and never into a
// terminal (§15) — so this proves the door is shut, and the office side of the
// round trip stays where it is covered: verify:cross-interface, verify:scenario-a.

const accessToken = process.env.SUPABASE_ACCESS_TOKEN
if (accessToken === undefined || accessToken === '') {
  record(
    'the voice functions are deployed',
    'SUPABASE_ACCESS_TOKEN is not set, so this was not asked',
    false,
  )
} else {
  try {
    const listed = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const functions = (await listed.json()) as { slug?: string; status?: string }[]
    const state = (slug: string): string =>
      functions.find((f) => f.slug === slug)?.status ?? 'not deployed'
    const voice = state('voice')
    const mint = state('voice-token')
    record(
      'both voice functions are deployed and active',
      `voice=${voice} voice-token=${mint}`,
      voice === 'ACTIVE' && mint === 'ACTIVE',
    )
  } catch (error) {
    record(
      'both voice functions are deployed and active',
      `could not ask: ${(error as Error).message}`,
      false,
    )
  }
}

try {
  const guarded = await fetch(`https://${REF}.supabase.co/functions/v1/voice/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ said: 'unauthenticated probe', session: 'verify-talk' }),
  })
  record(
    'and a caller with no token is refused over the real network',
    `http ${String(guarded.status)}`,
    guarded.status === 401,
  )
} catch (error) {
  record(
    'and a caller with no token is refused over the real network',
    `unreachable: ${(error as Error).message}`,
    false,
  )
}

/*
  The preflight, from the page's real origin.

  Grant: *"talk to the team does not work 'failed to fetch' in either desktop
  or mobile."* The phone button had been dead for weeks. `VOICE_ALLOWED_ORIGIN`
  held a single origin — the voice proof-of-concept's Vercel URL — while the
  page had moved to `ai-team-hq.vercel.app`, so the browser refused every
  preflight before any JavaScript ran, and `fetch` threw `TypeError: Failed to
  fetch`, which is what a browser says for a CORS refusal and is
  indistinguishable, from the page, from being offline.

  Every existing check passed throughout. The deploy probe minted a credential
  happily, because a server-side `fetch` sends no `Origin` and is therefore not
  subject to the thing that was broken. That is the lesson worth encoding: a
  probe that does not do what a browser does certifies the wrong thing.

  So this one sends the `Origin` and asserts on the header the browser would
  actually enforce — and asserts the other direction too, because an endpoint
  that hands a credential to any page that asks is a different bug with the
  same green tick. It takes no authentication, so origin is the only thing
  between a stranger's page and a session minted on Grant's OpenAI key.
*/
const MINT = `https://${REF}.supabase.co/functions/v1/voice-token`
const PAGE_ORIGIN = 'https://ai-team-hq.vercel.app'

const allowOriginFor = async (origin: string): Promise<string> => {
  const response = await fetch(MINT, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  })
  return response.headers.get('access-control-allow-origin') ?? '(none)'
}

try {
  const allowed = await allowOriginFor(PAGE_ORIGIN)
  record(
    'the browser is allowed to mint a call credential from the real page',
    `allow-origin=${allowed}`,
    allowed === PAGE_ORIGIN || allowed === '*',
  )
} catch (error) {
  record(
    'the browser is allowed to mint a call credential from the real page',
    `unreachable: ${(error as Error).message}`,
    false,
  )
}

try {
  const allowed = await allowOriginFor('https://not-our-page.example.com')
  record(
    'and a page that is not ours is refused the same credential',
    `allow-origin=${allowed}`,
    allowed !== 'https://not-our-page.example.com' && allowed !== '*',
  )
} catch (error) {
  record(
    'and a page that is not ours is refused the same credential',
    `unreachable: ${(error as Error).message}`,
    false,
  )
}

// ===========================================================================

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)

process.exit(passed === checks.length ? 0 : 1)
