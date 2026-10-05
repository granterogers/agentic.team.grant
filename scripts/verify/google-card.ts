/*
 * ONE GOOGLE, ONE CARD (HQ-GOOG-001..006), DRIVEN IN A REAL BROWSER WITH A STUBBED OFFICE.
 *   npx tsx scripts/verify/google-card.ts
 * Drive, Calendar and Gmail are one connection made by one consent screen. The Services pane shows ONE Google card:
 * one Connect (or Reconnect), one Disconnect, and the state of each part beneath it. Three scenarios are rendered at
 * 1440 and 390: everything connected, one part dead, nothing connected. Screenshots: .out/ux-google-*.png
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4699
const server = await serveStudio(PORT)
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
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const thrown: string[] = []

const scenarios: Record<string, Record<string, string>> = {
  all: { drive: 'ok', calendar: 'ok', gmail: 'ok' },
  oneDead: { drive: 'ok', calendar: 'dead', gmail: 'ok' },
  none: { drive: 'off', calendar: 'off', gmail: 'off' },
}
const conn = (key: string, state: string): Record<string, unknown> => ({
  key,
  state,
  last: '2 hours ago',
  used:
    key === 'drive'
      ? 'Source documents'
      : key === 'calendar'
        ? 'Your calendar'
        : key === 'gmail'
          ? 'Your mail'
          : 'Module pages',
  detail: state === 'dead' ? 'Google no longer accepts the saved permission' : '',
})

for (const [name, states] of Object.entries(scenarios)) {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    await ctx.addInitScript(() => {
      localStorage.setItem('hq.token', 'stub-token-for-test')
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => {
      thrown.push(e.message)
    })
    await page.route('**/*', async (route) => {
      const u = route.request().url()
      if (!u.includes('hq-api')) return route.continue()
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const section = new URL(u).searchParams.get('section') ?? ''
      if (section === 'studio_settings')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers,
          body: JSON.stringify({
            data: {
              behaviours: [],
              viewer: { operator: true },
              connections: [
                ...Object.entries(states).map(([k, s]) => conn(k, s)),
                conn('notion', 'ok'),
              ],
            },
          }),
        })
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers,
        body: '{"error":"stub"}',
      })
    })
    await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.locator('[data-bc-settings]').first().click()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Services' }).first().click()
    await page.waitForSelector('[data-google-summary]')
    await page.waitForTimeout(400)
    const tag = `${name}-${String(w)}`
    const connects = await page.locator('[data-google-connect]').count()
    const disconnects = await page.locator('[data-disconnect="google"]').count()
    const summary = ((await page.locator('[data-google-summary]').first().innerText()) ?? '').trim()
    const parts = await page
      .locator('.st-svc', { hasText: /Source documents|Your calendar|Your mail/ })
      .count()
    const noButtons = await page
      .locator('.st-svc', { hasText: /Source documents|Your calendar|Your mail/ })
      .locator('button')
      .count()
    if (name === 'all') {
      check(
        `${tag}: one Google card says Connected, with a single Disconnect and no Connect`,
        /Connected/.test(summary) && connects === 0 && disconnects === 1,
        `${summary} c${String(connects)} d${String(disconnects)}`,
      )
    } else if (name === 'oneDead') {
      check(
        `${tag}: one part dead -> the card says Needs attention and offers ONE Reconnect`,
        /Needs attention|Partly/.test(summary) && connects === 1,
        `${summary} c${String(connects)}`,
      )
    } else {
      check(
        `${tag}: nothing connected -> ONE Connect Google, and no Disconnect`,
        /Not connected/.test(summary) && connects === 1 && disconnects === 0,
        `${summary} c${String(connects)} d${String(disconnects)}`,
      )
    }
    check(
      `${tag}: the three parts are listed under the card and carry no buttons of their own`,
      parts === 3 && noButtons === 0,
      `${String(parts)} parts, ${String(noButtons)} buttons`,
    )
    const names = (await page.locator('.st-svc .st-name').allTextContents()).map((t) => t.trim())
    const logos = await page.locator('.st-svc .st-logo svg').count()
    check(
      `${tag}: every part has a name and a mark (Drive, Calendar, Gmail)`,
      ['Google Drive', 'Google Calendar', 'Gmail'].every((n) => names.includes(n)) && logos >= 4,
      `${names.join(' | ')} / ${String(logos)} marks`,
    )
    await page.screenshot({ path: `.out/ux-google-${tag}.png` })
    await ctx.close()
  }
}
check('no page errors', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
void inPage
