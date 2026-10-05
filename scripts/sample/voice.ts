/**
 * Voice, as the Sample Person: the Team Chat voice note, and the separate realtime "Talk to Team" session.
 *   npm run sample:voice [label]
 *
 * WHAT IS GENUINELY EXERCISED, and what is not, because a PASS here must not be read as more than it is:
 *
 *  Voice note (record -> transcribe -> an ordinary chat message), driven through the real page and the real gateway:
 *    - real: the microphone button, the permission path, the recorder, the loudness meter, stop, send, cancel, the silence
 *      guard, the playable recording, the message landing in the project's thread, the thread surviving a reload.
 *    - SUBSTITUTED: the microphone is Chromium's fake device playing a generated tone (no person speaks), and the office's
 *      transcription call (`/note`) is answered by this harness with a fixed sentence, so no speech-to-text quota is spent
 *      and nothing a model would invent is attributed to the Sample. Real transcription of real speech is
 *      `npm run verify:voice-note-live`, against the deployed endpoint, and is not repeated here.
 *    - sent: one harmless question that the cheap canonical path answers (no model call, no job).
 *
 *  Talk to Team (live natural conversation), the session boundary only:
 *    - real: the deployed `voice-token` mints ONE short-lived session as the Sample (one metered mint, no audio flows), and a
 *      stranger is refused before anything is spent.
 *    - asserted: the session is bound to the Sample's office (its brief carries the Sample's own project, and a project that
 *      exists only in another office gets none), and the page's call control exists and is reachable on a phone.
 *    - NOT exercised: audio in either direction, the realtime connection, tool calls during a call. Nobody can claim
 *      realtime voice PASS from this file and it does not.
 *
 * Nothing contacts a person: no email, Slack, Telegram or call. The session secret is never printed.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { newPage as _unused, startStudio } from './browser.ts'
import { ENDPOINT, lit, rows, sampleOffice, session } from './lib.ts'

void _unused
const label = process.argv[2] ?? 'now'
const out = `.out/voice-${label}`
mkdirSync(out, { recursive: true })
mkdirSync('.out/voice', { recursive: true })
const office = await sampleOffice()
const O = office.officeId
const s = await session()

const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---- Talk to Team: the session boundary ------------------------------------------------------------------------------
const TOKEN_URL = ENDPOINT.replace(/\/hq-api\/?$/, '/voice-token')
const mint = async (
  bearer: string,
  project: string,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      origin: 'https://ai-team-hq.vercel.app',
    },
    body: JSON.stringify({ project }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const foreign = String(
  (
    await rows(
      `select slug from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' limit 1`,
    )
  )[0]?.slug ?? '',
)
{
  const stranger = await mint('not-a-session', 'japan-spring-trip')
  check('a stranger cannot mint a call', stranger.status === 401, `http ${stranger.status}`)
  const mine = await mint(s.access_token, 'japan-spring-trip')
  check(
    'the Sample can open a call session',
    mine.status === 200 && typeof mine.body.client_secret === 'string',
    `http ${mine.status}`,
  )
  const ctx = (mine.body.context ?? {}) as { project?: string; project_brief?: boolean }
  check(
    'and it carries the Sample’s own project brief',
    ctx.project === 'japan-spring-trip' && ctx.project_brief === true,
    JSON.stringify(ctx),
  )
  check(
    'and the session is not degraded (tools were attached)',
    mine.body.degraded === false &&
      Array.isArray(mine.body.tools) &&
      (mine.body.tools as unknown[]).length > 0,
  )
  if (foreign !== '') {
    // Naming a project that exists only in another office must not bring that office into the call. What the lookup returns
    // for an unknown name is the Sample's own office-wide picture; assert that none of Grant's project names is in it.
    const grantNames = (
      await rows(
        `select name from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and char_length(name) > 6`,
      )
    ).map((r) => String(r.name))
    const looked = String(
      (await rows(`select app.voice_lookup(${lit(O)}::uuid, ${lit(foreign)})::text v`))[0]?.v ?? '',
    )
    const leak = grantNames.find((n) => looked.toLowerCase().includes(n.toLowerCase()))
    check(
      'naming a project that exists only in another office brings none of that office into the call',
      looked.length > 0 && leak === undefined,
      leak ?? `${grantNames.length} of Grant's project names checked`,
    )
  }
  mine.body.client_secret = '(withheld)'
}

// ---- the voice note ---------------------------------------------------------------------------------------------------
// A loud tone and a silent file, generated here so the repository carries no audio.
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=330:duration=6',
  '-af',
  'volume=0.9',
  '.out/voice/tone.wav',
])
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'anullsrc=r=16000:cl=mono',
  '-t',
  '4',
  '.out/voice/silence.wav',
])

const studio = await startStudio(4789)
await studio.browser.close()
const run = async (
  sound: string,
  scenario: (page: Page, notes: { posted: number }) => Promise<void>,
): Promise<void> => {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${process.cwd()}/${sound}%noloop`,
    ],
  })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await ctx.grantPermissions(['microphone'])
  await ctx.addInitScript(`window.HQ_API = ${JSON.stringify(ENDPOINT)}`)
  const page = await ctx.newPage()
  const notes = { posted: 0 }
  await page.route(/\/note$/, async (route) => {
    notes.posted += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ heard: 'What projects do we have?' }),
    })
  })
  const frag = `access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}&expires_in=3000`
  await page.goto('about:blank')
  await page.goto(`${studio.base}/#${frag}`, { waitUntil: 'domcontentloaded' })
  try {
    await scenario(page, notes)
  } finally {
    await browser.close()
  }
}
const open = async (page: Page): Promise<void> => {
  await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => null)
  await sleep(3500)
  await page.locator('[data-bc-dock]').first().click()
  await page.waitForSelector('[data-docksay]', { state: 'visible', timeout: 15000 })
  await sleep(800)
}
// the static server was closed above with the browser; start our own tiny one again for the page loads
const again = studio
try {
  await run('.out/voice/tone.wav', async (page, notes) => {
    await open(page)
    check(
      'the microphone control is there on a phone and is at least 44px',
      await page
        .locator('#dock [data-bc-note]')
        .evaluate((e) => e.getBoundingClientRect().height >= 43.5),
    )
    await page.locator('#dock [data-bc-note]').click()
    await page.waitForSelector('#dock [data-bc-notestop]', { timeout: 15000 })
    await sleep(2500)
    await page.screenshot({ path: `${out}/note-recording.png` })
    check(
      'while recording it says so and offers stop and cancel',
      (await page.locator('#dock [data-bc-notecancel]').count()) > 0,
    )
    await page.locator('#dock [data-bc-notestop]').click()
    await page.waitForSelector('#dock [data-bc-notesend]', { timeout: 20000 })
    await page.screenshot({ path: `${out}/note-recorded.png` })
    check(
      'after stopping the recording is playable before it is sent',
      (await page.locator('#dock [data-bc-noteplayback], #dock audio').count()) > 0,
    )
    await page.locator('#dock [data-bc-notecancel]').click()
    await sleep(800)
    check(
      'cancel throws it away and sends nothing',
      notes.posted === 0 && (await page.locator('#dock [data-bc-notesend]').count()) === 0,
      `${notes.posted} transcription call(s)`,
    )
    await page.locator('#dock [data-bc-note]').click()
    await page.waitForSelector('#dock [data-bc-notestop]', { timeout: 15000 })
    await sleep(2500)
    await page.locator('#dock [data-bc-notestop]').click()
    await page.waitForSelector('#dock [data-bc-notesend]', { timeout: 20000 })
    await page.locator('#dock [data-bc-notesend]').click()
    await page.waitForFunction(
      "document.querySelector('#dock [data-dockthread]')?.innerText.includes('What projects do we have')",
      undefined,
      { timeout: 30000 },
    )
    check(
      'sending puts the words in the project conversation as an ordinary message',
      notes.posted === 1,
    )
    await sleep(4000)
    await page.screenshot({ path: `${out}/note-sent.png` })
    const thread = (await page.locator('#dock [data-dockthread]').innerText()).replace(/\s+/g, ' ')
    check(
      'and the office answered it',
      /project/i.test(thread.split('What projects do we have')[1] ?? ''),
      thread.slice(-160),
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(4000)
    if (
      !(await page
        .locator('[data-docksay]')
        .isVisible()
        .catch(() => false))
    )
      await page.locator('[data-bc-dock]').first().click()
    await sleep(1500)
    check(
      'after a reload the conversation is still there',
      (await page.locator('#dock [data-dockthread]').innerText()).includes(
        'What projects do we have',
      ),
    )
    const live = await page.evaluate(`navigator.mediaDevices.enumerateDevices().then(() => true)`)
    check(
      'and the microphone was released (no live recording is left)',
      live === true && (await page.locator('#dock [data-bc-notestop]').count()) === 0,
    )
  })
  await run('.out/voice/silence.wav', async (page, notes) => {
    await open(page)
    await page.locator('#dock [data-bc-note]').click()
    await page.waitForSelector('#dock [data-bc-notestop]', { timeout: 15000 })
    await sleep(2500)
    await page.locator('#dock [data-bc-notestop]').click()
    await sleep(2500)
    await page.screenshot({ path: `${out}/note-silence.png` })
    const text = (await page.locator('#dock').innerText()).replace(/\s+/g, ' ')
    check(
      'a silent recording is refused in words and nothing is sent for transcription',
      notes.posted === 0 && /hear|silen|nothing|louder|closer/i.test(text),
      `${notes.posted} call(s); ${text.slice(-120)}`,
    )
  })
  // the call control, reachable on a phone
  const browser = await chromium.launch()
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await c.addInitScript(`window.HQ_API = ${JSON.stringify(ENDPOINT)}`)
  const p = await c.newPage()
  const frag = `access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}&expires_in=3000`
  await p.goto('about:blank')
  await p.goto(`${again.base}/#${frag}`, { waitUntil: 'domcontentloaded' })
  await p.goto(`${again.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
  await p.waitForLoadState('networkidle').catch(() => null)
  await sleep(3500)
  const mic = p
    .locator(
      '[data-bc-mic], [data-call], button[aria-label*="call" i], button[aria-label*="Talk" i]',
    )
    .first()
  const there = (await mic.count()) > 0
  check('the Talk to Team control is on the project page on a phone', there)
  if (there) {
    const box = await mic.boundingBox()
    check(
      'and it is at least 44px',
      box !== null && box.height >= 43.5 && box.width >= 43.5,
      JSON.stringify(box),
    )
    await p.screenshot({ path: `${out}/talk-control.png` })
  }
  await browser.close()
} finally {
  await again.close()
}
const mine = Number(
  (
    await rows(
      `select count(*) n from public.jobs j where j.office_id = '${O}' and j.created_at > now() - interval '15 minutes'`,
    )
  )[0]?.n ?? 0,
)
console.log(
  `\njobs the Sample's office created in the last 15 minutes: ${mine} (a canonical answer creates none)`,
)
const failed = results.filter((r) => !r.ok)
console.log(
  `sample:voice ${label}: ${results.length - failed.length}/${results.length}   (images in ${out})`,
)
console.log(
  'NOT exercised: audio to or from a realtime call; real speech through transcription (see verify:voice-note-live).',
)
if (failed.length > 0) process.exitCode = 1
