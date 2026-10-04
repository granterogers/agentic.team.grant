/**
 * The confirmation dialog, on a phone and a desktop, as the Sample Person (P5).
 *   npm run sample:confirm-ux
 *
 * Every destructive control that used to open the browser's own confirm now opens the in-page dialog. This presses ARCHIVE
 * on a baseline project and only ever Cancels or Escapes, so nothing is changed, and measures what a person meets:
 * the dialog names what it asks, Cancel holds focus, Tab stays inside it, Escape and Cancel both leave the project exactly
 * as it was and put focus back on the control that was pressed, and on a 390px phone the box fits and both buttons are at
 * least 44px tall. A native browser dialog anywhere fails the run. Nothing is archived, nothing is sent.
 */
import { mkdirSync } from 'node:fs'
import { newPage, signIn, startStudio } from './browser.ts'
import { lit, rows, sampleOffice, session } from './lib.ts'

const out = '.out/confirm-ux'
mkdirSync(out, { recursive: true })
const O = (await sampleOffice()).officeId
const s = await session()
const studio = await startStudio(4781)
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const status = async (): Promise<string> =>
  String(
    (
      await rows(
        `select status from public.projects where office_id = ${lit(O)}::uuid and slug = 'wellness-studio-launch'`,
      )
    )[0]?.status,
  )

try {
  for (const [label, viewport, touch] of [
    ['phone', { width: 390, height: 844 }, true],
    ['desktop', { width: 1440, height: 900 }, false],
  ] as const) {
    const { ctx, page, errors } = await newPage(studio, viewport, touch)
    let native = 0
    page.on('dialog', (d) => {
      native += 1
      void d.dismiss()
    })
    await signIn(studio, page, s)
    await page.goto(`${studio.base}/p/wellness-studio-launch/settings`, {
      waitUntil: 'domcontentloaded',
    })
    await page.locator('[data-setpane="project"]').click({ timeout: 30000 })
    const archive = page.locator('[data-archive]')
    await archive.waitFor({ state: 'visible', timeout: 15000 })
    const before = await status()

    await archive.click()
    const box = page.locator('.stg-confirmbox')
    await box.waitFor({ state: 'visible', timeout: 8000 })
    check(
      `${label}: the dialog names what it asks`,
      (await box.locator('h2').innerText()).includes('Archive this project'),
    )
    check(
      `${label}: Cancel holds focus (the safe answer is the default)`,
      await box.locator('[data-no]').evaluate((el) => el === document.activeElement),
    )
    const m = await box.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const b = [...el.querySelectorAll('button')].map((x) => x.getBoundingClientRect().height)
      return { left: r.left, right: r.right, vw: window.innerWidth, buttons: b }
    })
    check(
      `${label}: the box fits the screen`,
      m.left >= 0 && m.right <= m.vw,
      `${String(Math.round(m.left))}..${String(Math.round(m.right))} of ${String(m.vw)}`,
    )
    check(
      `${label}: both buttons are tall enough to press (${touch ? '44' : '36'}px)`,
      m.buttons.length === 2 && m.buttons.every((h) => h >= (touch ? 43.5 : 35.5)),
      m.buttons.map((h) => String(Math.round(h))).join(','),
    )
    await page.screenshot({ path: `${out}/${label}-archive.png` })
    // Tab stays inside: two buttons, so three Tabs return to where it began
    const start = await page.evaluate(
      () => document.activeElement?.getAttribute('data-no') !== null,
    )
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab')
    const stays = await page.evaluate(
      () => document.activeElement?.closest('.stg-confirmbox') !== null,
    )
    check(`${label}: Tab never leaves the dialog`, start && stays)
    await page.keyboard.press('Escape')
    await box.waitFor({ state: 'detached', timeout: 5000 })
    check(
      `${label}: Escape closes it and puts focus back on Archive`,
      await archive.evaluate((el) => el === document.activeElement),
    )
    check(`${label}: and the project is untouched`, (await status()) === before, before)

    await archive.click()
    await box.waitFor({ state: 'visible', timeout: 8000 })
    await box.locator('[data-no]').click()
    await box.waitFor({ state: 'detached', timeout: 5000 })
    check(`${label}: Cancel leaves the project untouched too`, (await status()) === before)
    check(`${label}: no native browser dialog was shown`, native === 0, String(native))
    check(`${label}: no error on the page`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await studio.close()
}
console.log(failed === 0 ? '\nall passed' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
