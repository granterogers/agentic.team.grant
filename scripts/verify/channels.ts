/**
 * The five states a conversation surface can be in, drawn.
 *
 *   npm run verify:channels
 *
 * Issue #198's middle section. Its acceptance criteria are about WORDING and
 * DISTINGUISHABILITY, which is unusual and is the point: never-connected must
 * read as an invitation and not an error, connected-but-idle must look
 * different from never connected, and degraded must be distinguishable from
 * disconnected. Those are not things a schema check can see.
 *
 * ## Why this suite exists rather than a screenshot
 *
 * The block draws NOTHING without data — deliberately, because inventing
 * "connected" is #90's defect in the reassuring direction, and the reassuring
 * direction is the worse one. So `npm run shots` runs without a token and
 * correctly captures an empty space, and no capture can ever show these
 * states. A suite that injects the payload is the only way to look at them.
 *
 * The payload injected is the shape `app.conversation_channels()` really
 * returns, taken from a live call rather than imagined — including the
 * `unchecked` state, which exists because Voice has no probe and 0348 reported
 * it as healthy on the strength of never having been looked at.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { press } from './press.ts'

const ROOT = 'web/studio'
const PORT = 4621
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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
  All five, plus `here`. Every branch of the RPC's CASE is represented, because
  a suite that only saw the states this office happens to be in today would go
  quiet the moment one changed — and `never` and `disconnected` are precisely
  the two nobody will see until something breaks.
*/
const PAYLOAD = [
  {
    channel: 'slack',
    label: 'Slack',
    state: 'carrying',
    messages: 47,
    last_at: new Date().toISOString(),
    recent_failures: 0,
    last_error: null,
    says: 'Connected and carrying the conversation.',
  },
  {
    channel: 'telegram',
    label: 'Telegram',
    state: 'degraded',
    messages: 75,
    last_at: new Date().toISOString(),
    recent_failures: 9,
    last_error: 'chat_not_found',
    says: 'Connected, but the provider is refusing messages. Nothing is lost; they are waiting.',
  },
  {
    channel: 'voice',
    label: 'Voice',
    state: 'unchecked',
    messages: 81,
    last_at: new Date().toISOString(),
    recent_failures: 0,
    last_error: null,
    says: 'Carrying messages, but nothing here checks the credential.',
  },
  {
    channel: 'email',
    label: 'Email',
    state: 'never',
    messages: 0,
    last_at: null,
    recent_failures: 0,
    last_error: null,
    says: 'Not connected yet. Connect it and the office can reach you there.',
  },
  {
    channel: 'sms',
    label: 'Text messages',
    state: 'disconnected',
    messages: 12,
    last_at: new Date().toISOString(),
    recent_failures: 0,
    last_error: null,
    says: 'Not connected any more. Everything already said is kept — reconnect and it carries on.',
  },
  {
    channel: 'teamhq',
    label: 'This dashboard',
    state: 'here',
    messages: 3,
    last_at: new Date().toISOString(),
    recent_failures: 0,
    last_error: null,
    says: 'You are reading it.',
  },
]

const browser = await chromium.launch()
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
    await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)

    /*
      Pushed into the module's own exported array, which is what the hydration
      writes into — so what renders afterwards is the page's own renderer over
      the office's own shape, and nothing about the drawing is stubbed.
    */
    await page.evaluate(`(async () => {
      const s = await import('/settings.js')
      s.CONVO_CHANNELS.length = 0
      s.CONVO_CHANNELS.push(...${JSON.stringify(PAYLOAD)})
    })()`)

    /*
      Settings is PRESSED, because reaching it is a real interaction and
      `press` exists for this page's particular difficulties. The pane inside
      it is then switched by dispatching the click in the page.

      Deliberate, and worth saying why rather than looking like a shortcut: a
      hit-tested press on the pane tab reported success and left `aria-selected`
      on "team" — the sheet re-lays-out under the pointer as it opens. Whether
      those tabs can be pressed is `verify:controls`'s question and it presses
      all of them; this suite's question is what the pane DRAWS, and getting to
      it must not be the thing that fails.
    */
    const opened = await press(page, '[data-settings]')
    await page.waitForTimeout(700)
    check(`${label} — Settings can be opened`, opened ? 'opened' : 'NOT REACHED', opened)
    await page.evaluate(`document.querySelector('[data-setting="channels"]')?.click()`)
    await page.waitForTimeout(900)
    /*
      Printed rather than only counted, and it is the reason this suite works.

      "The Channels tab does nothing" was the symptom for three runs; the cause
      was `when.words is not a function`, from a local `const when` shadowing
      the module import — thrown while the sheet was building its template, so
      `innerHTML` was never assigned and the previous pane stayed on screen. A
      bare count could not have said that, which is the rule CLAUDE.md already
      states about discarding an actionability log.
    */
    if (thrown.length > 0) console.log(`    threw: ${thrown.slice(0, 2).join(' || ')}`)

    const seen = (await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.conv')]
      return rows.map((r) => ({
        cls: r.className,
        name: (r.querySelector('.convbody b')?.textContent ?? '').trim(),
        says: (r.querySelector('.convbody .t-meta')?.textContent ?? '').trim(),
        word: (r.querySelector('.convword')?.textContent ?? '').trim(),
        dot: (() => {
          const d = r.querySelector('.convdot')
          if (d === null) return ''
          const cs = getComputedStyle(d)
          return cs.backgroundColor + '|' + cs.borderColor
        })(),
        h: Math.round(r.getBoundingClientRect().height),
        w: Math.round(r.getBoundingClientRect().width),
      }))
    })()`)) as {
      cls: string
      name: string
      says: string
      word: string
      dot: string
      h: number
      w: number
    }[]

    check(
      `${label} — every state is drawn`,
      `${String(seen.length)} of ${String(PAYLOAD.length)}`,
      seen.length === PAYLOAD.length,
    )
    if (seen.length !== PAYLOAD.length) {
      await ctx.close()
      continue
    }

    check(
      `${label} — each one says which state it is in, in a word`,
      seen.map((s) => s.word).join(' · '),
      seen.every((s) => s.word !== ''),
    )

    /*
      Distinguishable, which is the criterion — not merely present. Six
      identical words would satisfy "has a word" and satisfy nothing #198 asked
      for, and it is exactly the assertion-shape this repository has corrected
      four times: assert the property, not the presence.
    */
    check(
      `${label} — and no two states say the same word`,
      `${String(new Set(seen.map((s) => s.word)).size)} distinct`,
      new Set(seen.map((s) => s.word)).size === seen.length,
    )
    check(
      `${label} — nor the same sentence`,
      `${String(new Set(seen.map((s) => s.says)).size)} distinct`,
      new Set(seen.map((s) => s.says)).size === seen.length,
    )

    /*
      Never-connected reads as an invitation, not an error. Asserted on the
      words, because that is the whole of the difference — the state name is
      for the code.
    */
    const never = seen.find((s) => s.cls.includes('c-never'))
    check(
      `${label} — never connected invites rather than alarms`,
      never === undefined ? 'MISSING' : `"${never.says}"`,
      never !== undefined &&
        /connect it|not connected yet/i.test(never.says) &&
        !/error|fail|broken|problem/i.test(never.says),
    )

    /*
      Disconnected keeps the history and says so. 0014's canonical-store claim
      made visible: losing a surface must not look like losing the
      conversation.
    */
    const gone = seen.find((s) => s.cls.includes('c-disconnected'))
    check(
      `${label} — disconnected promises the history is kept`,
      gone === undefined ? 'MISSING' : `"${gone.says}"`,
      gone !== undefined && /kept|carries on/i.test(gone.says),
    )

    /*
      Degraded is not disconnected. The two are one word apart in English and
      opposite in what they ask of a person — one means wait, the other means
      go and reconnect something.
    */
    const bad = seen.find((s) => s.cls.includes('c-degraded'))
    check(
      `${label} — degraded is distinguishable from disconnected`,
      bad === undefined || gone === undefined ? 'MISSING' : `"${bad.word}" vs "${gone.word}"`,
      bad !== undefined && gone !== undefined && bad.word !== gone.word && bad.dot !== gone.dot,
    )

    /*
      And the state is not carried by colour alone. Every row has a word as
      well as a dot, which is checked above; this checks the other half — that
      the dots really do differ, so the colour is adding information rather
      than being the only channel OR being decorative.
    */
    check(
      `${label} — the dots differ as well as the words`,
      `${String(new Set(seen.map((s) => s.dot)).size)} distinct dots`,
      new Set(seen.map((s) => s.dot)).size >= 4,
    )

    /*
      And nothing is a sliver. A row whose height collapses is the #67 shape:
      not overflow, not small type, not bad contrast, and invisible to every
      audit that is not a person looking.
    */
    const shortest = Math.min(...seen.map((s) => s.h))
    check(`${label} — no row has collapsed`, `shortest ${String(shortest)}px`, shortest >= 44)

    check(`${label} — nothing thrown`, thrown[0] ?? 'none', thrown.length === 0)
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exitCode = 1
