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

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium, devices } from 'playwright'

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = Number(process.env.TALK_VERIFY_PORT ?? 8972)
const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

const html = readFileSync('web/hq/index.html')
const server = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
  })
  response.end(html)
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
  const reached = (await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('a,button,[data-tab],[data-section]')]
      .find((e) => e.getAttribute('data-tab') === 'talk' || e.getAttribute('data-section') === 'talk'
        || (e.textContent ?? '').trim().toLowerCase() === 'talk');
    if (!el) return false;
    el.click();
    return true;
  })()`)) as boolean
  await page.waitForTimeout(800)
  return { context, page, reached }
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
  record(
    'call · when the office will not start a call, the button resets',
    `${String(await stateOn(page))} / button="${String(await page.evaluate(`document.getElementById('call').textContent`))}"`,
    !(await stateOn(page)).includes('Connecting') &&
      String(await page.evaluate(`document.getElementById('call').textContent`)).includes('📞'),
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
