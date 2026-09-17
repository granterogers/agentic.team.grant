/**
 * The microphone is released, and this asserts it rather than believing it.
 *
 *   npm run verify:dictation
 *
 * Issue #196. Its acceptance criteria name this suite in as many words:
 * *"the microphone is released when recording stops, and this is asserted by a
 * check rather than assumed"*. That wording is there because of #102, the one
 * privacy defect in Grant's UX review of the studio — turning voice off did
 * not stop the microphone. A comment claiming a property is worth nothing
 * without a check behind it; 0317's header said importing twice imports one
 * document and it did not, for five migrations.
 *
 * ## Why a stub rather than a real microphone
 *
 * Headless Chromium has no microphone and no speech service, so the real
 * recogniser can never run here. A suite that therefore skipped the layer
 * would be the `verify:search` mistake — it read a token from the environment,
 * reported NOT CHECKED, and the defect lived in precisely the layer it
 * skipped.
 *
 * So `SpeechRecognition` is replaced before the page loads with a stub that
 * counts one thing honestly: how many times the microphone was opened and how
 * many times it was closed. Everything else — the button, the state, the text
 * landing in the composer, the teardown on a repaint — is the product's own
 * code running unmodified. What is faked is the browser's speech service,
 * which is the only part that cannot exist in this room.
 *
 * The stub is deliberately STRICTER than the real API in one place: opening
 * while already open throws, so a second `start()` that the page failed to
 * guard shows up as an error rather than as a quietly leaked microphone.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { press } from './press.ts'

const ROOT = 'web/studio'
const PORT = 4619
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

/*
  The stub. `__mic.open` is the number of microphones currently held; the suite
  asserts it is zero at every point where a person has stopped, navigated or
  sent. `opened` and `closed` are cumulative so a leak that is later balanced
  by an unrelated close cannot hide inside a single number.
*/
const STUB = `
window.__mic = { open: 0, opened: 0, closed: 0, live: null }
class FakeRecognition extends EventTarget {
  constructor () { super(); this.continuous = false; this.interimResults = false; this.lang = '' }
  start () {
    if (window.__mic.open > 0) throw new Error('already started')
    window.__mic.open += 1
    window.__mic.opened += 1
    window.__mic.live = this
  }
  #end () {
    if (window.__mic.open === 0) return
    window.__mic.open -= 1
    window.__mic.closed += 1
    window.__mic.live = null
    this.dispatchEvent(new Event('end'))
  }
  stop () { this.#end() }
  abort () { this.#end() }
}
window.SpeechRecognition = FakeRecognition
window.webkitSpeechRecognition = FakeRecognition

// What the speech service would have heard. Shaped like the real event: an
// indexed, array-like results list whose entries are array-like alternatives.
window.__say = (words, final) => {
  const r = window.__mic.live
  if (r === null) return false
  const alt = { transcript: words, confidence: 0.9 }
  const one = { 0: alt, length: 1, isFinal: final === true }
  const list = { 0: one, length: 1 }
  const e = new Event('result')
  e.resultIndex = 0
  e.results = list
  r.dispatchEvent(e)
  return true
}
`

const browser = await chromium.launch()

const openChat = async (page: import('playwright').Page): Promise<void> => {
  await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('.project[data-open="legacy-coaching-course"]').first().click()
  await page.waitForTimeout(500)
  await page.locator('[data-tab="team"]').first().click()
  await page.waitForTimeout(400)
  const sub = page.locator('[data-sub="chat"]')
  if ((await sub.count()) > 0) {
    await sub.first().click()
    await page.waitForTimeout(500)
  }
}

const mics = async (
  page: import('playwright').Page,
): Promise<{
  open: number
  opened: number
  closed: number
}> => (await page.evaluate(`window.__mic`)) as { open: number; opened: number; closed: number }

try {
  for (const [label, width, height] of [
    ['desktop', 1440, 900],
    ['phone', 390, 844],
  ] as const) {
    console.log(`\n${label}`)
    const ctx = await browser.newContext({
      viewport: { width, height },
      ...(width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
    })
    await ctx.addInitScript(STUB)
    const page = await ctx.newPage()
    const thrown: string[] = []
    page.on('pageerror', (e) => thrown.push(e.message))
    await openChat(page)

    // --- the control exists, is reachable, and is big enough ---------------
    const mic = page.locator('[data-dictate]').first()
    check(
      `${label} — the composer has a dictation control`,
      (await mic.count()) > 0 ? 'present' : 'MISSING',
      (await mic.count()) > 0,
    )

    const box = await mic.boundingBox()
    const w = Math.round(box?.width ?? 0)
    const h = Math.round(box?.height ?? 0)
    /*
      44 on a phone is the rule verify:layouts enforces on `pointer: coarse`,
      and #196 says in as many words that a microphone is the control a thumb
      reaches for while walking. The desktop leg holds it to the same number
      rather than a smaller one, because there is no reason for it to be
      smaller and a shared floor is one number to remember.
    */
    check(
      `${label} — and it is at least 44 by 44`,
      `${String(w)} by ${String(h)}`,
      w >= 44 && h >= 44,
    )

    const named = await mic.getAttribute('aria-label')
    check(
      `${label} — with a name a screen reader can say`,
      named === null ? 'NONE' : named,
      typeof named === 'string' && named.trim() !== '',
    )

    /*
      The disclosure, before the press rather than after it. In Chrome the
      audio goes to Google to be transcribed, and this is the only place a
      person is told so.
    */
    const title = (await mic.getAttribute('title')) ?? ''
    check(
      `${label} — and it says where the audio goes before you press it`,
      title === '' ? 'NO TITLE' : `"${title.slice(0, 46)}…"`,
      /transcrib/i.test(title),
    )

    // --- nothing is holding the microphone before anybody presses anything -
    let m = await mics(page)
    check(
      `${label} — the microphone is not open before it is asked for`,
      `open ${String(m.open)}`,
      m.open === 0,
    )

    // --- pressing it opens exactly one microphone --------------------------
    const pressed = await press(page, '[data-dictate]')
    check(
      `${label} — the control can actually be pressed`,
      pressed ? 'reached it' : 'NEVER REACHABLE',
      pressed,
    )
    await page.waitForTimeout(250)
    m = await mics(page)
    check(
      `${label} — pressing it opens the microphone, once`,
      `open ${String(m.open)}, opened ${String(m.opened)} in total`,
      m.open === 1 && m.opened === 1,
    )
    check(
      `${label} — and the control says it is live`,
      `aria-pressed ${String(await mic.getAttribute('aria-pressed'))}`,
      (await mic.getAttribute('aria-pressed')) === 'true',
    )

    // --- speech becomes editable text, and is not sent ---------------------
    await page.evaluate(`window.__say('the interview corpus needs a second pass', true)`)
    await page.waitForTimeout(250)
    const said = String(
      await page.evaluate(
        `document.querySelector('[data-say]') === null ? '' : document.querySelector('[data-say]').value`,
      ),
    )
    check(
      `${label} — what was said lands in the composer as editable text`,
      said === '' ? 'NOTHING' : `"${said.slice(0, 40)}"`,
      said.includes('second pass'),
    )

    /*
      And it is still sitting there — #196 is explicit that speech is never
      sent without him seeing it. A thread that has grown by one while the
      composer still holds the words would mean it had been sent as well.
    */
    const stillThere = String(
      await page.evaluate(
        `document.querySelector('[data-say]') === null ? '' : document.querySelector('[data-say]').value`,
      ),
    )
    check(
      `${label} — and nothing was sent on his behalf`,
      stillThere === said ? 'still in the box, unsent' : 'THE BOX CHANGED',
      stillThere === said && stillThere !== '',
    )

    // --- pressing again releases it ----------------------------------------
    await press(page, '[data-dictate]')
    await page.waitForTimeout(300)
    m = await mics(page)
    check(
      `${label} — pressing it again RELEASES the microphone`,
      `open ${String(m.open)}, closed ${String(m.closed)}`,
      m.open === 0 && m.closed === 1,
    )
    check(
      `${label} — and the control stops claiming to be live`,
      `aria-pressed ${String(await mic.getAttribute('aria-pressed'))}`,
      (await mic.getAttribute('aria-pressed')) === 'false',
    )
    check(
      `${label} — the words survive the microphone closing`,
      `"${String(
        await page.evaluate(
          `document.querySelector('[data-say]') === null ? '' : document.querySelector('[data-say]').value`,
        ),
      ).slice(0, 40)}"`,
      String(
        await page.evaluate(
          `document.querySelector('[data-say]') === null ? '' : document.querySelector('[data-say]').value`,
        ),
      ).includes('second pass'),
    )

    // --- leaving the tab mid-dictation releases it -------------------------
    /*
      This is the one that #102 is actually about. A person who starts
      dictating and then goes to look at a document has not stopped dictating
      in any way the page was told about — and the recogniser holds a reference
      to a textarea that no longer exists, so the words go nowhere while the
      microphone stays open on a screen with no recording indicator on it.
    */
    await page.locator('[data-say]').first().fill('')
    await press(page, '[data-dictate]')
    await page.waitForTimeout(250)
    check(
      `${label} — dictating again`,
      `open ${String((await mics(page)).open)}`,
      (await mics(page)).open === 1,
    )

    await page.evaluate(`document.querySelector('[data-tab="documents"]').click()`)
    await page.waitForTimeout(500)
    m = await mics(page)
    check(
      `${label} — walking away from the conversation releases the microphone`,
      `open ${String(m.open)} after leaving the tab`,
      m.open === 0,
    )

    // --- and sending releases it -------------------------------------------
    await page.locator('[data-tab="team"]').first().click()
    await page.waitForTimeout(400)
    const sub2 = page.locator('[data-sub="chat"]')
    if ((await sub2.count()) > 0) {
      await sub2.first().click()
      await page.waitForTimeout(500)
    }
    await press(page, '[data-dictate]')
    await page.waitForTimeout(250)
    await page.evaluate(`window.__say('send this one', true)`)
    await page.waitForTimeout(200)
    await page
      .locator('[data-composer] button[type="submit"], [data-composer] .btn.primary')
      .first()
      .click({ force: true })
    await page.waitForTimeout(900)
    m = await mics(page)
    check(
      `${label} — sending the message releases the microphone`,
      `open ${String(m.open)} after Send`,
      m.open === 0,
    )

    /*
      The balance, which is the assertion the individual ones add up to: every
      microphone this suite opened was closed. A leak that each separate check
      happened to miss cannot survive this one.
    */
    check(
      `${label} — every microphone opened during this run was closed`,
      `${String(m.opened)} opened, ${String(m.closed)} closed`,
      m.opened === m.closed && m.opened > 0,
    )

    check(
      `${label} — nothing thrown`,
      thrown.length === 0 ? 'none' : thrown.slice(0, 2).join(' · '),
      thrown.length === 0,
    )
    await ctx.close()
  }

  // --- honest degradation --------------------------------------------------
  /*
    A browser that cannot transcribe. Firefox is the real one, and a phone
    hitting the page over plain http is the easy one to meet by accident.

    #196: *"the control is absent or disabled with a reason, never present and
    silently dead"*. Disabled with the reason is the better of the two — an
    absent control teaches nothing about why.
  */
  console.log('\na browser that cannot transcribe')
  const bare = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await bare.addInitScript(
    `delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
     Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true })
     Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true })`,
  )
  const bp = await bare.newPage()
  await openChat(bp)
  const bmic = bp.locator('[data-dictate]').first()
  const present = (await bmic.count()) > 0
  const disabled = present ? await bmic.isDisabled() : false
  const reason = present ? ((await bmic.getAttribute('title')) ?? '') : ''
  check(
    'the control is not present and silently dead',
    present ? (disabled ? 'present and disabled' : 'PRESENT AND ENABLED') : 'absent',
    !present || disabled,
  )
  check(
    'and it says why, in words a person can act on',
    reason === '' ? (present ? 'NO REASON GIVEN' : 'n/a — absent') : `"${reason.slice(0, 52)}"`,
    !present || /browser|https|secure/i.test(reason),
  )
  await bare.close()
} finally {
  await browser.close()
  server.close()
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exitCode = 1
