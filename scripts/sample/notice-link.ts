/**
 * The button on an operational notice goes somewhere that works (#413).
 *   npm run sample:notice-link
 *
 * "Reconnect Google" opens `<base>/?settings=connections`. This proves the destination from the person's side: signed in as
 * the Sample, on a phone, the address opens Settings on the Connections tab with Google on it, and the address bar is
 * cleaned. Signed out, it shows nothing of any office. A tab that is not on the allow-list is ignored. Reads only.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const out = '.out/notice-link'
mkdirSync(out, { recursive: true })
let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const studio = await startStudio(4795)
const s = await session()
try {
  // Signed in, on a phone.
  const phone = await newPage(studio, { width: 390, height: 844 }, true)
  await signIn(studio, phone.page, s)
  await phone.page.goto(`${studio.base}/?settings=connections`, { waitUntil: 'domcontentloaded' })
  await settle(phone.page)
  await phone.page
    .waitForFunction(
      "document.querySelector('#settings')?.innerText.includes('Google')",
      undefined,
      {
        timeout: 25000,
      },
    )
    .catch(() => null)
  await phone.page.waitForTimeout(800)
  const text = String(
    await phone.page.evaluate("document.querySelector('#settings')?.innerText ?? ''"),
  )
  await phone.page.screenshot({ path: `${out}/phone-signed-in.png` })
  check('signed in: Settings opens by itself', text !== '')
  check(
    'signed in: it is the Connections tab, with Google on it',
    /Google/.test(text) && /Connect|Reconnect|connected/i.test(text),
  )
  check(
    'the address bar is cleaned of the parameter',
    !new URL(phone.page.url()).searchParams.has('settings'),
    phone.page.url().replace(studio.base, ''),
  )
  check('no page errors', phone.errors.length === 0, phone.errors.slice(0, 2).join(' || '))

  // A tab nobody is allowed to name is ignored: the page opens as it always does.
  await phone.page.goto(`${studio.base}/?settings=evil`, { waitUntil: 'domcontentloaded' })
  await settle(phone.page)
  const ignored = await phone.page
    .locator('#settings')
    .isVisible()
    .catch(() => false)
  check('an unknown tab name opens nothing', !ignored)

  // Signed out: a fresh browser with no session.
  const stranger = await newPage(studio, { width: 390, height: 844 }, true)
  await stranger.page.goto(`${studio.base}/?settings=connections`, {
    waitUntil: 'domcontentloaded',
  })
  await stranger.page.waitForTimeout(4000)
  const body = String(await stranger.page.evaluate('document.body.innerText'))
  await stranger.page.screenshot({ path: `${out}/phone-signed-out.png` })
  const seen = await (await import('./lib.ts')).rows(
    `select name from public.projects where office_id = app.operator_office() and not is_fixture and char_length(name) > 8 limit 6`,
  )
  const settingsOpen = await stranger.page
    .locator('#settings')
    .isVisible()
    .catch(() => false)
  check('signed out: Settings does not open over the invented example office', !settingsOpen)
  const leaked = seen.map((r) => String(r.name)).filter((n) => body.includes(n))
  check(
    'signed out: none of the operator office is on the page',
    leaked.length === 0,
    leaked.join(', '),
  )
} finally {
  await studio.close()
}
console.log(failed === 0 ? '\nNOTICE LINK: PASS' : `\nNOTICE LINK: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
