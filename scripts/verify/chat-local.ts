// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate, which the project's TypeScript has no DOM library for
/**
 * Team Chat dock: compact layout, wrapping, horizontal resize, live dictation wiring (8 October 2026).
 *   npx tsx scripts/verify/chat-local.ts
 *
 * Local class: static server, Chromium, no office. The browser's SpeechRecognition is replaced by a controllable fake
 * BEFORE the page loads, so this proves the page's wiring (button, live text, stop, Send behaviour, release) and NOT that a
 * real microphone is captured: that is a manual check recorded in the log.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any
declare const getComputedStyle: any

const PORT = 4655
const server = await serveStudio(PORT)
const browser = await chromium.launch()
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const FAKE = `
  window.__recs = []
  class FakeRec {
    constructor() { this.started = false; this.aborted = false; window.__recs.push(this) }
    start() { this.started = true; setTimeout(() => this.onstart && this.onstart(), 0) }
    abort() { this.aborted = true; this.started = false; setTimeout(() => this.onend && this.onend(), 0) }
  }
  window.SpeechRecognition = FakeRec
  window.webkitSpeechRecognition = FakeRec
  window.__say = (list) => {
    const r = window.__recs[window.__recs.length - 1]
    r.onresult({ results: list.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) })
  }
`
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(FAKE)
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
const url = `http://127.0.0.1:${String(PORT)}/`

const open = async (): Promise<void> => {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem').first().click()
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(400)
  await page.click('[data-bc-dock]')
  await page.waitForSelector('.dock [data-docksay]')
}
const dockW = (): Promise<number> =>
  page.evaluate(() => document.querySelector('.dock').getBoundingClientRect().width)

try {
  await open()
  /* ----------------------------------------------------------- compactness and wrapping */
  const m = await page.evaluate(() => {
    const d = document.querySelector('.dock').getBoundingClientRect()
    const t = document.querySelector('.dock .thread').getBoundingClientRect()
    const msg = document.querySelector('.dock .msg p')
    return {
      w: d.width,
      threadW: t.width,
      font: Number.parseFloat(getComputedStyle(msg).fontSize),
      pad: Number.parseFloat(getComputedStyle(document.querySelector('.dock .thread')).paddingLeft),
    }
  })
  check(
    'the dock is compact: 340px wide, 13.5px messages, small padding',
    Math.abs(m.w - 340) < 1 && m.font <= 14 && m.pad <= 10,
    JSON.stringify(m),
  )

  const long =
    'Ask the team at Riverside Cafe lunch '.repeat(6) +
    'Supercalifragilisticexpialidocious'.repeat(5) +
    ' https://example.com/' +
    'a'.repeat(120)
  await page.fill('[data-docksay]', long)
  const grown = await page.evaluate(
    () => document.querySelector('[data-docksay]').getBoundingClientRect().height,
  )
  check(
    'the composer grows with long text instead of clipping it',
    grown > 60 && grown <= 152,
    `${String(Math.round(grown))}px`,
  )
  await page.locator('.dock [type=submit]').click()
  await page.waitForTimeout(500)
  const wrap = await page.evaluate(() => {
    const th = document.querySelector('.dock .thread')
    const mine = [...document.querySelectorAll('.dock .msg.mine p')].pop()
    return {
      sw: th.scrollWidth,
      cw: th.clientWidth,
      text: mine ? mine.textContent : '',
      mw: mine ? mine.getBoundingClientRect().right : 0,
      tr: th.getBoundingClientRect().right,
    }
  })
  check(
    'a long message with an unbroken string does not overflow the thread',
    wrap.sw <= wrap.cw + 1,
    `${String(wrap.sw)} vs ${String(wrap.cw)}`,
  )
  check(
    'the whole message text is present, not truncated',
    wrap.text.includes('Riverside Cafe lunch') && wrap.text.includes('a'.repeat(120)),
  )
  check('the bubble stays inside the thread', wrap.mw <= wrap.tr + 1)
  const ph = await page.getAttribute('[data-docksay]', 'placeholder')
  check('the composer placeholder is short enough to show whole', (ph ?? '').length <= 20, ph ?? '')

  /* ----------------------------------------------------------- horizontal resize */
  const grip = await page.evaluate(() => {
    const r = document.querySelector('.dockgrip').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x - 160, grip.y, { steps: 8 })
  await page.mouse.up()
  const wide = await dockW()
  check(
    'dragging the grip left widens the dock by the drag',
    Math.abs(wide - 500) < 3,
    `${String(Math.round(wide))}px`,
  )
  const pad = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.body).paddingRight),
  )
  check('the page makes room for the wider dock', Math.abs(pad - wide) < 2, `${String(pad)}`)
  const sendEdge = await page.evaluate(() => ({
    s: document.querySelector('.dock [type=submit]').getBoundingClientRect().right,
    d: document.querySelector('.dock').getBoundingClientRect().right,
  }))
  check('the composer controls are not clipped at the wider width', sendEdge.s <= sendEdge.d)
  const g2 = await page.evaluate(() => {
    const r = document.querySelector('.dockgrip').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.move(g2.x, g2.y)
  await page.mouse.down()
  await page.mouse.move(g2.x + 900, g2.y, { steps: 8 })
  await page.mouse.up()
  const narrow = await dockW()
  check(
    'there is a sensible minimum width',
    Math.abs(narrow - 280) < 2,
    `${String(Math.round(narrow))}px`,
  )
  const noClip = await page.evaluate(() => {
    const d = document.querySelector('.dock').getBoundingClientRect()
    return [...document.querySelectorAll('.dock .crow > *')].map((e) => {
      const r = e.getBoundingClientRect()
      return [e.className || e.tagName, Math.round(r.left - d.left), Math.round(d.right - r.right)]
    })
  })
  check(
    'the composer controls are not clipped at the minimum width',
    noClip.every((c) => (c[1] as number) >= 0 && (c[2] as number) >= 0),
    JSON.stringify(noClip),
  )
  await page.focus('.dockgrip')
  await page.keyboard.press('ArrowLeft')
  check('the arrow keys resize it too', (await dockW()) > narrow + 10)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-dock]')
  if ((await page.locator('.dock [data-docksay]').count()) === 0) await page.click('[data-bc-dock]')
  await page.waitForSelector('.dock [data-docksay]')
  check('the width is remembered after a reload', Math.abs((await dockW()) - narrow - 20) < 3)
  await page.dblclick('.dockgrip')
  check('double press resets the width', Math.abs((await dockW()) - 340) < 2)

  /* ----------------------------------------------------------- live dictation wiring */
  check(
    'the microphone is a dictation button, not a recorder',
    (await page.locator('.dock [data-dock-dictate]').count()) === 1 &&
      (await page.locator('.dock [data-bc-note]').count()) === 0,
  )
  await page.fill('[data-docksay]', 'Please')
  await page.click('[data-dock-dictate]')
  await page.waitForTimeout(100)
  check(
    'pressing the microphone starts listening and says so',
    (await page.getAttribute('[data-dock-dictate]', 'aria-pressed')) === 'true' &&
      ((await page.textContent('[data-dockdic]')) ?? '').includes('Listening'),
  )
  await page.evaluate(() => window.__say([['book the', false]]))
  check(
    'interim words appear in the composer after the typed text',
    (await page.inputValue('[data-docksay]')) === 'Please book the',
  )
  await page.evaluate(() =>
    window.__say([
      ['book the venue', true],
      [' for friday', false],
    ]),
  )
  check(
    'revised words replace themselves, none repeated',
    (await page.inputValue('[data-docksay]')) === 'Please book the venue for friday',
  )
  check(
    'the provisional words are shown in the status line',
    ((await page.textContent('[data-dockdic]')) ?? '').includes('for friday'),
  )
  const before = await page.locator('.dock .msg.mine').count()
  await page.locator('.dock [type=submit]').click()
  await page.waitForTimeout(300)
  check(
    'Send while listening stops dictation and does not send',
    (await page.getAttribute('[data-dock-dictate]', 'aria-pressed')) === 'false' &&
      (await page.locator('.dock .msg.mine').count()) === before,
  )
  check(
    'the dictated text is left in the box for editing',
    (await page.inputValue('[data-docksay]')) === 'Please book the venue for friday',
  )
  check(
    'the recogniser was aborted, so the microphone is released',
    await page.evaluate(() => window.__recs[window.__recs.length - 1].aborted === true),
  )
  await page.fill('[data-docksay]', 'Please book the venue for Friday evening')
  await page.locator('.dock [type=submit]').click()
  await page.waitForTimeout(400)
  check(
    'a second Send sends it as an ordinary message',
    (await page.locator('.dock .msg.mine').count()) === before + 1,
  )

  /* a repaint while listening must not lose the stream */
  await page.click('[data-dock-dictate]')
  await page.evaluate(() => window.__say([['hello there', false]]))
  await page.evaluate(() => {
    window.__boxBefore = document.querySelector('[data-docksay]')
    document.querySelector('[data-bc-layouts]').click()
  })
  await page.locator('[data-preset]').first().click()
  await page.waitForTimeout(500)
  const replaced = await page.evaluate(
    () => window.__boxBefore !== document.querySelector('[data-docksay]'),
  )
  await page.evaluate(() => window.__say([['hello there friend', false]]))
  check(
    'a repaint while listening replaces the textarea and dictation follows it',
    replaced &&
      (await page.inputValue('[data-docksay]')) === 'hello there friend' &&
      (await page.getAttribute('[data-dock-dictate]', 'aria-pressed')) === 'true',
    `replaced ${String(replaced)}`,
  )
  await page.click('[data-dock-close]')
  await page.waitForTimeout(200)
  check(
    'closing the dock releases the microphone',
    await page.evaluate(() => window.__recs[window.__recs.length - 1].aborted === true),
  )
  await page.click('[data-bc-dock]')
  await page.waitForSelector('.dock [data-docksay]')
  check(
    'and the button is idle again when reopened',
    (await page.getAttribute('[data-dock-dictate]', 'aria-pressed')) === 'false',
  )

  /* permission denial */
  await page.click('[data-dock-dictate]')
  await page.evaluate(() => {
    const r = window.__recs[window.__recs.length - 1]
    r.onerror({ error: 'not-allowed' })
    r.onend()
  })
  await page.waitForTimeout(150)
  const said = (await page.textContent('[data-dockdic]')) ?? ''
  check(
    'permission denial shows an actionable sentence and goes idle',
    /refused/i.test(said) &&
      (await page.getAttribute('[data-dock-dictate]', 'aria-pressed')) === 'false',
    said,
  )
} finally {
  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  server.close()
}
console.log(failed === 0 ? '\nALL GREEN' : `\n${String(failed)} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
