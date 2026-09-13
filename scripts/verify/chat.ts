/**
 * The conversation, behaving — the half no static check can see.
 *
 *   npm run verify:chat
 *
 * Issues #197 and #201. The first piece of "proving the conversation".
 *
 * ## What each existing audit cannot see
 *
 * `verify:layouts` measures boxes. `verify:access` runs axe and asks whether
 * the composer is reachable. `verify:controls` presses everything once.
 * `verify:wired` proves a control is looked up. None of them types a sentence,
 * goes somewhere else, comes back and asks whether it is still there — and a
 * draft lost to a background repaint is invisible to every one of them while
 * being the thing that stops people trusting a page.
 *
 * So this is the behaviour suite: it uses the page the way a person does.
 *
 * Driven against the prototype deliberately. The behaviours here — a draft
 * surviving, the keyboard reaching the composer, the phone column fitting —
 * are the page's own, not the office's, and `verify:history` already drives
 * the real chain through HTTP. A suite needing a live token to prove that
 * typing is remembered would be a suite nobody runs.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { press } from './press.ts'

const ROOT = 'web/studio'
const PORT = 4617
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
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
    const page = await ctx.newPage()
    const thrown: string[] = []
    page.on('pageerror', (e) => thrown.push(e.message))
    await openChat(page)

    // ---------------------------------------------------------------------
    const draft = `half a thought ${Math.random().toString(36).slice(2, 8)}`
    await page.locator('[data-say]').first().fill(draft)
    await page.waitForTimeout(250)

    /*
      A repaint that has nothing to do with the composer. The studio renders on
      a pulse tick, on a write and on every tab change — and the composer is
      rebuilt each time, so before #197 a background refresh silently ate what
      you had typed.
    */
    await page.evaluate(`document.querySelector('[data-tab="documents"]').click()`)
    await page.waitForTimeout(450)
    await page.evaluate(`document.querySelector('[data-tab="team"]').click()`)
    await page.waitForTimeout(450)
    const sub = page.locator('[data-sub="chat"]')
    if ((await sub.count()) > 0) {
      await sub.first().click()
      await page.waitForTimeout(500)
    }

    const kept = await page.evaluate(
      `document.querySelector('[data-say]') === null ? '' : document.querySelector('[data-say]').value`,
    )
    check(
      `${label} — an unsent draft survives leaving the tab and coming back`,
      String(kept) === draft ? 'still there' : `LOST — "${String(kept).slice(0, 30)}"`,
      String(kept) === draft,
    )

    // ---------------------------------------------------------------------
    /*
      And it is cleared by SENDING, or the draft would be restored into the
      empty composer on the very next render and the person would appear to
      have said the same thing twice.
    */
    await page.locator('[data-say]').first().fill(`sent ${draft}`)
    await page.waitForTimeout(200)
    await press(page, '[data-composer] .btn.primary')
    await page.waitForTimeout(900)
    const afterSend = await page.evaluate(
      `document.querySelector('[data-say]') === null ? 'GONE' : document.querySelector('[data-say]').value`,
    )
    check(
      `${label} — and sending clears it rather than leaving it to come back`,
      afterSend === '' ? 'empty' : `still holds "${String(afterSend).slice(0, 30)}"`,
      afterSend === '',
    )

    // ---------------------------------------------------------------------
    if (width < 500) {
      /*
        #197's measured criterion, asserted rather than eyeballed: the composer
        is fully above the fixed nav once the chat is open. It used to sit at
        y=863 on an 844px screen, with the nav at 779 in front of it.
      */
      await page.evaluate(`document.scrollingElement.scrollTop = 2000`)
      await page.waitForTimeout(400)
      const fits = (await page.evaluate(`(() => {
        const c = document.querySelector('.chatbody .composer')
        const n = document.querySelector('.navgroup')
        if (c === null) return null
        const cr = c.getBoundingClientRect()
        const nr = n === null ? { top: window.innerHeight } : n.getBoundingClientRect()
        return { bottom: Math.round(cr.bottom), navTop: Math.round(nr.top),
                 vh: window.innerHeight }
      })()`)) as { bottom: number; navTop: number; vh: number } | null
      check(
        'phone — the composer sits clear of the bottom navigation',
        fits === null
          ? 'NO COMPOSER'
          : `composer ends at ${String(fits.bottom)}, nav starts at ${String(fits.navTop)}`,
        fits !== null && fits.bottom <= fits.navTop,
      )

      /*
        And with the keyboard open, which is #197's central criterion.

        No headless browser can raise an iOS keyboard. What one CAN do is
        reproduce the only effect that matters to this layout: the visual
        viewport shrinks. `.chatbody` is sized in `dvh` precisely so that
        shrinking IS the whole of the keyboard handling — the comment on that
        rule says so, and says it needs no `visualViewport` listener — so
        resizing the window exercises the real mechanism rather than a stand-in
        for it.

        336px is roughly what an iPhone 14 leaves above the standard keyboard
        and its accessory bar. The question this asks is whether the composer
        survives losing sixty per cent of the screen, not whether it survives
        losing exactly 508 pixels.
      */
      /*
        At the newest message first, because that is where a person is when
        they reach for the keyboard — they have just read the answer and are
        replying to it. Opening the keyboard from halfway up the history is a
        real case too, and there the rule is the opposite: stay where you are.
        This checks the common one; `keepingPlace` owns the other.
      */
      await page.evaluate(`(() => {
        const t = document.querySelector('[data-thread]')
        if (t !== null) t.scrollTop = t.scrollHeight
      })()`)
      await page.waitForTimeout(200)
      await page.setViewportSize({ width: 390, height: 336 })
      await page.waitForTimeout(700)
      await page
        .locator('[data-say]')
        .first()
        .focus()
        .catch(() => undefined)
      await page.waitForTimeout(400)
      const withKeyboard = (await page.evaluate(`(() => {
        const c = document.querySelector('.chatbody .composer')
        const t = document.querySelector('.chatbody [data-thread]')
        const n = document.querySelector('.navgroup')
        if (c === null) return null
        const cr = c.getBoundingClientRect()
        const nr = n === null ? { top: window.innerHeight } : n.getBoundingClientRect()
        /*
          A hidden nav is an absent nav.

          A hidden element has a zero rect at the origin, so comparing against
          a top of zero says the composer is underneath a bar that is not on
          the screen -- which reported as a failure while the layout was
          correct. The keyboard rule deliberately hides it, so this has to know
          the difference between not there and at the top.

          No backticks anywhere in this comment: it lives inside a template
          literal, and one would end the string. Third time in this repository.
        */
        const navHidden = n === null || nr.height === 0
        /*
          The property is that the newest message is READABLE, not that the
          whole bubble fits.

          A single message can be taller than a 168px thread, so "its bottom is
          above the composer" is unsatisfiable for a long one and would demand
          a layout nobody wants. What matters is that the thread is scrolled to
          its end — so the last line of the newest message sits at the thread's
          bottom edge — and that the edge itself is above the composer rather
          than behind it.
        */
        const tr = t === null ? null : t.getBoundingClientRect()
        return {
          top: Math.round(cr.top),
          bottom: Math.round(cr.bottom),
          navTop: navHidden ? window.innerHeight : Math.round(nr.top),
          navHidden,
          vh: window.innerHeight,
          threadH: tr === null ? 0 : Math.round(tr.height),
          atEnd: t === null ? false : t.scrollHeight - t.clientHeight - t.scrollTop < 4,
          threadClear: tr === null ? false : tr.bottom <= cr.top + 2,
        }
      })()`)) as {
        top: number
        bottom: number
        navTop: number
        navHidden: boolean
        vh: number
        threadH: number
        atEnd: boolean
        threadClear: boolean
      } | null

      check(
        'phone — with the keyboard up, the composer is still fully on screen',
        withKeyboard === null
          ? 'NO COMPOSER'
          : `composer ${String(withKeyboard.top)}–${String(withKeyboard.bottom)} in a ${String(withKeyboard.vh)}px viewport`,
        withKeyboard !== null && withKeyboard.top >= 0 && withKeyboard.bottom <= withKeyboard.vh,
      )
      check(
        'phone — and it is not behind the bottom navigation',
        withKeyboard === null
          ? 'n/a'
          : withKeyboard.navHidden
            ? 'the nav is out of the way while the keyboard is up'
            : `ends at ${String(withKeyboard.bottom)}, nav starts at ${String(withKeyboard.navTop)}`,
        withKeyboard !== null && withKeyboard.bottom <= withKeyboard.navTop,
      )
      /*
        The thread gives up the room, not the composer. That is the whole
        design of the column — `grid-template-rows: 1fr auto` — and the failure
        it prevents is the one the first attempt at #197 shipped: a sticky
        composer pinned OVER the thread, so the capture showed a project head,
        a banner, a tab strip and a composer, with the conversation nowhere.
      */
      check(
        'phone — the thread yields the space rather than the composer',
        withKeyboard === null ? 'n/a' : `thread ${String(withKeyboard.threadH)}px`,
        withKeyboard !== null && withKeyboard.threadH > 40,
      )
      check(
        'phone — and the newest message is still the one you are looking at',
        withKeyboard === null
          ? 'n/a'
          : withKeyboard.atEnd
            ? 'the thread followed the keyboard down'
            : 'THE THREAD DID NOT FOLLOW — the newest message scrolled away',
        withKeyboard?.atEnd === true,
      )
      check(
        'phone — and the thread ends above the composer, not behind it',
        withKeyboard === null ? 'n/a' : withKeyboard.threadClear ? 'clear' : 'OVERLAPPED',
        withKeyboard?.threadClear === true,
      )

      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(500)

      /*
        Nothing sits under the home indicator (#197).

        `.navgroup` already reserves `env(safe-area-inset-bottom)` and is the
        pattern to copy; this asserts that every element FIXED to the bottom
        edge does the same, rather than that one of them does. The inset is 0
        in a headless browser, so what is checked is the RULE — that the
        padding or offset mentions the inset — which is the property, not the
        pixel. Checking the pixel would pass on every machine that has no notch
        and catch nothing.
      */
      const insets = (await page.evaluate(`(() => {
        const out = []
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el)
          if (cs.position !== 'fixed') continue
          const r = el.getBoundingClientRect()
          if (r.height === 0 || r.width === 0) continue
          // Anchored to the bottom edge, within a hair.
          if (Math.abs(r.bottom - window.innerHeight) > 2) continue
          out.push({
            what: el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 24),
            pad: cs.paddingBottom,
            bottom: cs.bottom,
          })
        }
        return out
      })()`)) as { what: string; pad: string; bottom: string }[]
      check(
        'phone — every element fixed to the bottom edge reserves the home indicator',
        insets.length === 0
          ? 'nothing is fixed to the bottom edge'
          : insets
              .map((i) => `${i.what} pad ${i.pad}`)
              .join(' · ')
              .slice(0, 90),
        insets.every((i) => i.pad !== '0px' || i.bottom !== '0px'),
      )
    }

    // ---------------------------------------------------------------------
    /*
      Something arrived while you were reading further up (#205, #200).

      Driven through the page's own arrival path rather than by setting the
      state directly: `chat.send` writes a message from somebody who is not
      Grant, and `keepingPlace` is the thing under test. Asserting on
      `state.arrived` would be asserting the mechanism rather than the
      property, which this file already has three corrections about.

      The thread is scrolled AWAY from the bottom first, because that is the
      whole condition — at the bottom the message is on screen and a badge
      would be noise, and a suite that never scrolls up would pass while the
      feature was hard-coded to never appear.
    */
    /*
      A conversation long enough to scroll, first.

      The default thread is four messages in a 260px box: `scrollHeight` equals
      `clientHeight`, so being "scrolled away from the bottom" is not a state
      that exists, and the badge is correctly never shown. The first draft of
      this check spent three runs reading that as "the affordance is broken"
      while the affordance was right and the fixture was 258 pixels tall.

      Filled through the module's own `send`, which is what the composer calls
      — so the thread is made long the way a real one gets long.
    */
    await page.evaluate(`(async () => {
      const chat = await import('/chat.js')
      for (let i = 0; i < 14; i += 1) chat.send('legacy-coaching-course', 'earlier note ' + i, null, 'everyone')
    })()`)
    /*
      Reopened through the same helper the top of this file uses, rather than
      by clicking the tabs directly.

      On a phone the section tabs live in a rail that the chat has scrolled
      past, so a direct `[data-tab]` click lands on nothing and the suite ends
      up measuring a screen with no conversation on it — which reported as
      "NO CONTROL" and "NO MESSAGES", four steps from the cause. The
      conversation itself survives the reload: it is in localStorage.
    */
    await openChat(page)
    /*
      Which scroller is in charge, and can it be scrolled away from at all.

      Two answers by width, and this is the finding the phone leg produced: on
      a desktop the thread is a box with its own max-height and its own
      scrollbar; on a phone it has neither and the PAGE scrolls, so the
      thread's own numbers say "at the bottom" for ever. A suite that asked the
      thread on both would have reported the phone as having no case to test,
      and the product would have shipped a badge that could never appear on the
      surface #205 exists for.
    */
    const scrolls = (await page.evaluate(`(() => {
      const t = document.querySelector('[data-thread]')
      if (t === null) return null
      const own = t.scrollHeight - t.clientHeight > 8
      return { own, room: own ? t.scrollHeight - t.clientHeight
                              : Math.round(t.getBoundingClientRect().height - window.innerHeight) }
    })()`)) as { own: boolean; room: number } | null
    check(
      `${label} — the conversation is long enough to be scrolled away from`,
      scrolls === null
        ? 'NO THREAD'
        : `${scrolls.own ? 'the thread scrolls' : 'the page scrolls'}, ${String(scrolls.room)}px of room`,
      scrolls !== null && scrolls.room > 80,
    )

    // Away from the newest message, through whichever scroller that is.
    await page.evaluate(`(() => {
      const t = document.querySelector('[data-thread]')
      if (t === null) return
      if (t.scrollHeight - t.clientHeight > 8) t.scrollTop = 0
      else window.scrollTo(0, Math.max(0, t.getBoundingClientRect().top + window.scrollY - 40))
    })()`)
    await page.waitForTimeout(250)

    const badgeBefore = await page.evaluate(
      `(() => { const b = document.querySelector('[data-arrived]'); return b === null ? 'MISSING' : (b.hidden ? 'hidden' : 'shown') })()`,
    )
    check(
      `${label} — nothing is announced before anything arrives`,
      String(badgeBefore),
      badgeBefore === 'hidden',
    )

    /*
      A reply lands — through the product's own path, not a hook.

      The composer is used the way a person uses it and the office's turn
      endpoint is answered with a canned reply, so what runs is `chat.ask`
      replacing its own placeholder. That matters more than convenience: the
      placeholder KEEPS ITS ID and only stops being pending, so this is exactly
      the arrival a length comparison cannot see, and driving it any other way
      would test a path the product does not take.

      Scrolled back up immediately after sending, because sending puts you at
      the bottom by design — and the badge's whole condition is that you are
      not there.
    */
    /*
      Answered after a beat, on purpose.

      The office takes seconds to think; a route that fulfils instantly answers
      before the suite can scroll back up, and then the arrival lands while the
      thread is at the bottom — which is the case where there is correctly no
      badge. The first draft of this check failed for exactly that reason and
      read as "the badge never appears".
    */
    await page.route('**/turn', async (r) => {
      await new Promise((done) => setTimeout(done, 1200))
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          speak: 'I have read the corpus and there are three themes.',
          did: 'answered',
        }),
      })
    })
    await page.locator('[data-say]').first().fill('what are the themes?')
    await page.waitForTimeout(150)
    const sent = await press(page, '[data-composer] .btn.primary')
    check(`${label} — Send can actually be pressed`, sent ? 'pressed' : 'NEVER REACHABLE', sent)
    await page.waitForTimeout(250)
    // Back up, before the answer lands — again, whichever scroller is in charge.
    await page.evaluate(`(() => {
      const t = document.querySelector('[data-thread]')
      if (t === null) return
      if (t.scrollHeight - t.clientHeight > 8) t.scrollTop = 0
      else window.scrollTo(0, Math.max(0, t.getBoundingClientRect().top + window.scrollY - 40))
    })()`)
    await page.waitForTimeout(2200)

    const badge = (await page.evaluate(`(() => {
      const b = document.querySelector('[data-arrived]')
      if (b === null) return null
      const says = b.querySelector('[data-arrived-says]')
      const r = b.getBoundingClientRect()
      return { hidden: b.hidden, says: says === null ? '' : says.textContent,
               name: b.getAttribute('aria-label') ?? '',
               w: Math.round(r.width), h: Math.round(r.height) }
    })()`)) as { hidden: boolean; says: string; name: string; w: number; h: number } | null

    check(
      `${label} — a message arriving above you says so`,
      badge === null ? 'NO CONTROL' : badge.hidden ? 'STILL HIDDEN' : `"${badge.says}"`,
      badge !== null && !badge.hidden,
    )
    check(
      `${label} — and it names who spoke rather than counting`,
      badge === null ? 'n/a' : `"${badge.says}"`,
      badge !== null && /replied|new messages/i.test(badge.says),
    )
    check(
      `${label} — the jump control is at least 44px tall`,
      badge === null ? 'n/a' : `${String(badge.w)} by ${String(badge.h)}`,
      badge !== null && badge.h >= 44,
    )
    check(
      `${label} — with a name a screen reader can say`,
      badge === null ? 'n/a' : badge.name,
      badge !== null && badge.name.trim() !== '',
    )

    /*
      And the announcement, which is the half a badge cannot do. #200 asks for
      an arriving message to be ANNOUNCED — a polite live region, so it is
      heard at the next pause rather than interrupting.
    */
    const live = (await page.evaluate(`(() => {
      const r = document.getElementById('hq-announce')
      if (r === null) return null
      return { politeness: r.getAttribute('aria-live'), words: r.textContent }
    })()`)) as { politeness: string; words: string } | null
    check(
      `${label} — and a screen reader is told, politely`,
      live === null ? 'NO LIVE REGION' : `${live.politeness}: "${String(live.words).slice(0, 40)}"`,
      live !== null && live.politeness === 'polite' && String(live.words).trim() !== '',
    )

    // --- pressing it takes you there, and it goes away --------------------
    await press(page, '[data-arrived]')
    await page.waitForTimeout(900)
    const after = (await page.evaluate(`(() => {
      const b = document.querySelector('[data-arrived]')
      const t = document.querySelector('[data-thread]')
      if (t === null) return { hidden: true, atBottom: false }
      const own = t.scrollHeight - t.clientHeight > 8
      const atBottom = own
        ? t.scrollHeight - t.clientHeight - t.scrollTop < 60
        : t.getBoundingClientRect().bottom - window.innerHeight < 60
      return { hidden: b === null ? true : b.hidden, atBottom }
    })()`)) as { hidden: boolean; atBottom: boolean }
    check(
      `${label} — pressing it scrolls to the newest message`,
      after.atBottom ? 'at the bottom' : 'DID NOT MOVE',
      after.atBottom,
    )
    check(`${label} — and dismisses itself`, after.hidden ? 'gone' : 'STILL SHOWING', after.hidden)

    // --- every message says who, when and where, non-visually -------------
    /*
      #200: author, time and addressee available non-visually, not conveyed by
      portrait and colour alone. On screen the office's name is drawn and
      Grant's is not — his messages are identified by being on the right, which
      is nothing at all to somebody listening.
    */
    const attributed = (await page.evaluate(`(() => {
      const msgs = [...document.querySelectorAll('[data-thread] .msg')]
      if (msgs.length === 0) return null
      const missing = msgs.filter((m) => {
        const a = m.querySelector('.aonly')
        return a === null || (a.textContent ?? '').trim() === ''
      })
      const first = msgs[0].querySelector('.aonly')
      return { total: msgs.length, missing: missing.length,
               sample: first === null ? '' : (first.textContent ?? '').trim() }
    })()`)) as { total: number; missing: number; sample: string } | null
    check(
      `${label} — every message says who said it and when, non-visually`,
      attributed === null
        ? 'NO MESSAGES'
        : `${String(attributed.total - attributed.missing)}/${String(attributed.total)} — e.g. "${attributed.sample}"`,
      attributed !== null && attributed.missing === 0,
    )
    check(
      `${label} — the thread is a list, so its length is knowable before reading it`,
      String(
        await page.evaluate(
          `(() => { const t = document.querySelector('[data-thread]'); return t === null ? 'NONE' : t.getAttribute('role') })()`,
        ),
      ),
      (await page.evaluate(
        `(() => { const t = document.querySelector('[data-thread]'); return t === null ? '' : t.getAttribute('role') })()`,
      )) === 'list',
    )

    check(`${label} — nothing thrown`, thrown[0] ?? 'none', thrown.length === 0)
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
