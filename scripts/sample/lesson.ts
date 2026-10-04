/**
 * Teaching through chat, as the Sample Person: taught -> stored -> shown -> persists -> retracted -> persists.
 *   npm run sample:lesson
 *
 * One paid model call at most. A harmless fictional preference is taught in Team Chat (there is no Add Lesson button, on
 * purpose). The facts are read from the database, never from a wording list: the lesson row is in the Sample's office, the
 * Settings memory pane lists it, it is still there after a reload, "Forget this rule" appends a retraction, and after
 * another reload it is gone from the pane and from lessons_live. Grant's live lesson count must not move.
 */
import { mkdirSync } from 'node:fs'
import { closeSettings, newPage, openSettings, signIn, startStudio } from './browser.ts'
import { rows, sampleOffice, session } from './lib.ts'

const out = '.out/lesson'
mkdirSync(out, { recursive: true })
const office = await sampleOffice()
const O = office.officeId
const PHONE = process.env.PHONE === '1'
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))
let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`)
}
const liveFor = async (o: string): Promise<{ id: string; body: string }[]> =>
  (
    await rows(
      `select l.lesson_id::text id, l.body from public.lessons l where l.office_id = '${o}' and l.row_kind <> 'retraction' and not l.is_fixture and exists (select 1 from public.lessons_live v where v.lesson_id = l.lesson_id) order by l.created_at`,
    )
  ).map((r) => ({ id: String(r.id), body: String(r.body) }))

const grantBefore = (await liveFor(await grantOffice())).length
async function grantOffice(): Promise<string> {
  return String((await rows('select app.operator_office()::text o'))[0]?.o)
}
const sampleBefore = await liveFor(O)
console.log(`lessons live before: sample ${sampleBefore.length}, grant ${grantBefore}`)

const studio = await startStudio(4794)
const s = await session()
const { page, errors } = await newPage(
  studio,
  PHONE ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  PHONE,
)
try {
  await signIn(studio, page, s)
  // Resumable: a run that taught the lesson and then failed later leaves it live; reuse it rather than pay for another call.
  let learned: { id: string; body: string } | undefined = sampleBefore.find((l) =>
    /conclusion first/i.test(l.body),
  )
  if (learned === undefined) {
    await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => null)
    await sleep(3500)
    if (
      !(await page
        .locator('[data-docksay]')
        .isVisible()
        .catch(() => false))
    )
      await page.locator('[data-bc-dock]').first().click()
    await page.waitForSelector('[data-docksay]', { state: 'visible', timeout: 15000 })
    const words = 'From now on, when you answer me about the studio, give me the conclusion first.'
    await page.fill('[data-docksay]', words)
    await page.keyboard.press('Enter')
    const end = Date.now() + 240000
    while (Date.now() < end && learned === undefined) {
      await sleep(6000)
      const now = await liveFor(O)
      learned = now.find((l) => !sampleBefore.some((b) => b.id === l.id))
    }
  } else console.log('  (reusing the lesson already taught by an earlier run)')
  check(
    'teaching in chat stored a lesson in the Sample office',
    learned !== undefined,
    learned?.body.slice(0, 90),
  )
  await page.screenshot({ path: `${out}/1-taught.png` })
  if (learned === undefined) throw new Error('nothing was learned; stopping before anything else')
  const id = learned.id
  const keyword = /conclusion/i.test(learned.body)
  check('the stored rule is about the preference taught', keyword, learned.body.slice(0, 120))

  const paneHas = async (): Promise<boolean> => {
    await page.goto(`${studio.base}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => null)
    await sleep(2500)
    // On a phone the open conversation covers the screen; a person closes it before reaching for Settings.
    const shut = page.locator('[data-dock-close]:visible').first()
    if (await shut.isVisible().catch(() => false)) {
      await shut.click({ force: true })
      await sleep(700)
    }
    await openSettings(page, 'memory').catch(async (e: unknown) => {
      await page.screenshot({ path: `${out}/settings-failed.png` })
      throw e
    })
    // The pane fills after the section answers. Judge presence only once it shows SOME lesson (the Sample holds others), or
    // an absence check passes because the list had not drawn yet.
    const any = page.locator('#settings [data-retract]')
    await any.first().waitFor({ state: 'attached', timeout: 25000 })
    return (await page.locator(`#settings [data-retract="${id}"]`).count()) > 0
  }
  check('Settings > What it has learned shows it', await paneHas())
  await page.screenshot({ path: `${out}/2-shown.png` })
  await closeSettings(page)
  check('after a reload it is still shown', await paneHas())

  await page.locator(`#settings [data-retract="${id}"]`).click({ force: true })
  await page.locator('.stg-confirm [data-yes]').click({ force: true, timeout: 8000 })
  await sleep(3500)
  const live = await liveFor(O)
  check('retraction took it out of lessons_live', !live.some((l) => l.id === id))
  const trail = await rows(
    `select count(*) n from public.lessons where office_id = '${O}' and (lesson_id = '${id}' or supersedes = '${id}')`,
  )
  check(
    'nothing was deleted: the trail keeps both rows',
    Number(trail[0]?.n) >= 2,
    `rows ${trail[0]?.n}`,
  )
  await page.screenshot({ path: `${out}/3-retracted.png` })
  await closeSettings(page)
  check('after another reload it is gone from the pane', !(await paneHas()))
  await page.screenshot({ path: `${out}/4-after-reload.png` })
  await closeSettings(page)
} finally {
  await studio.close()
}
const grantAfter = (await liveFor(await grantOffice())).length
check(
  "Grant's live lesson count is unchanged",
  grantAfter === grantBefore,
  `${grantBefore} -> ${grantAfter}`,
)
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
console.log(failed === 0 ? '\nLESSON: PASS' : `\nLESSON: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
