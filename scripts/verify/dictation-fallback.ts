// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * A browser WITHOUT speech recognition (Firefox, an old Safari, a web app on the Home Screen), and one whose engine refuses
 * to start, drawn in a real browser (#439). Typing and the separate live voice conversation must be untouched; the dictation
 * button must be off with its reason where a phone can read it; and nothing may throw.
 *   npx tsx scripts/verify/dictation-fallback.ts
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const server = await serveStudio(4679)
const browser = await chromium.launch()
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}
const errors: string[] = []

const open = async (init: string, label: string) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(init)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await page.goto('http://127.0.0.1:4679/', { waitUntil: 'domcontentloaded' })
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem').first().click()
  await page.waitForSelector('[data-bc-board]')
  await page.click('[data-bc-dock]')
  await page.waitForSelector('.dock [data-docksay]')
  await page.waitForTimeout(400)
  return { ctx, page }
}

/* 1. no SpeechRecognition at all */
{
  const { ctx, page } = await open(
    'delete window.SpeechRecognition; delete window.webkitSpeechRecognition',
    'none',
  )
  const btn = page.locator('.dock [data-dock-dictate]')
  check('the dictation button is drawn', (await btn.count()) === 1)
  check('and it is disabled', await btn.isDisabled())
  const said = (await page.locator('.dock [data-dockdic]').innerText()).trim()
  check(
    'the reason is written where a phone can read it, not only in a title',
    /cannot transcribe|secure connection/i.test(said),
    said,
  )
  check(
    'the title gives the same reason',
    /cannot transcribe|secure connection/i.test((await btn.getAttribute('title')) ?? ''),
  )
  await page.fill('[data-docksay]', 'typed instead')
  check('typing still works', (await page.inputValue('[data-docksay]')) === 'typed instead')
  check(
    'the separate live voice conversation control is still there and enabled',
    (await page.locator('[data-bc-voice]').count()) > 0 &&
      (await page.locator('[data-bc-voice]').first().isEnabled()),
  )
  await ctx.close()
}

/* 2. an engine that exists and throws on start() */
{
  const { ctx, page } = await open(
    `class Boom { start() { throw new Error('InvalidStateError') } abort() {} }
     window.SpeechRecognition = Boom; window.webkitSpeechRecognition = Boom`,
    'throws',
  )
  const btn = page.locator('.dock [data-dock-dictate]')
  check('with an engine present the button is enabled', await btn.isEnabled())
  await btn.click()
  await page.waitForTimeout(300)
  check('pressing it does not leave it red', (await btn.getAttribute('aria-pressed')) === 'false')
  const said = (await page.locator('.dock [data-dockdic]').innerText()).trim()
  check('it says it could not start', /could not start/i.test(said), said)
  await ctx.close()
}

/* 3. an engine that never answers: the watchdog */
{
  const { ctx, page } = await open(
    `class Mute { start() {} abort() {} }
     window.SpeechRecognition = Mute; window.webkitSpeechRecognition = Mute`,
    'mute',
  )
  const btn = page.locator('.dock [data-dock-dictate]')
  await btn.click()
  check('while waiting it is pressed', (await btn.getAttribute('aria-pressed')) === 'true')
  await page.waitForTimeout(9000)
  check('after the watchdog it lets go', (await btn.getAttribute('aria-pressed')) === 'false')
  const said = (await page.locator('.dock [data-dockdic]').innerText()).trim()
  check('and says the browser did not answer', /did not (start|answer)/i.test(said), said)
  await ctx.close()
}

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
server.close()
let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail === '' ? '' : ` - ${c.detail}`}`)
}
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
