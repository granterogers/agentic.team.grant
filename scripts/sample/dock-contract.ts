/**
 * The page's project is the project (#416), proved on the real page as the Sample. Sends nothing, spends nothing.
 *   npm run sample:dock
 *
 * Opens the team dock three ways and reads what it offers: on the home screen (no project loaded: a choice and nothing to
 * type into), after choosing a project (the dock is that project), and after navigating to another project with the dock
 * still open (it follows the page, and offers nothing to move it).
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { rows, sampleOffice, session } from './lib.ts'

const out = '.out/dock-contract'
mkdirSync(out, { recursive: true })
const PHONE = process.env.PHONE === '1'
let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const office = (await sampleOffice()).officeId
const named = (
  await rows(
    `select slug, name from public.projects where office_id = '${office}' and status = 'active' and slug <> 'unnamed' order by name limit 2`,
  )
).map((r) => ({ slug: String(r.slug), name: String(r.name) }))
const [first, second] = named
if (first === undefined || second === undefined)
  throw new Error('the Sample needs two active projects')

const studio = await startStudio(4796)
const s = await session()
try {
  const { page, errors } = await newPage(
    studio,
    PHONE ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    PHONE,
  )
  await signIn(studio, page, s)
  const head = async (): Promise<string> =>
    String(
      await page
        .locator('#dock .dockhead')
        .first()
        .innerText()
        .catch(() => ''),
    )
      .replace(/\s+/g, ' ')
      .trim()
  const openDock = async (): Promise<void> => {
    if (
      await page
        .locator('#dock .dockhead')
        .isVisible()
        .catch(() => false)
    )
      return
    await page.locator('[data-bc-dock]:visible').first().click({ force: true, timeout: 8000 })
    await page.waitForSelector('#dock .dockhead', { state: 'visible', timeout: 10000 })
    await page.waitForTimeout(700)
  }

  // 1. No project loaded.
  await page.goto(`${studio.base}/`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  await openDock()
  const picks = (await page.evaluate(
    "[...document.querySelectorAll('#dock [data-dock-pick]')].map((e) => e.getAttribute('data-dock-pick'))",
  )) as string[]
  check(
    'home: the dock says no project is open',
    /No project open/.test(await head()),
    await head(),
  )
  check(
    'home: it offers every active project and the general conversation, and nothing to type into',
    picks.includes(first.slug) &&
      picks.includes(second.slug) &&
      picks.includes('unnamed') &&
      (await page.locator('#dock [data-dockform]').count()) === 0,
    picks.join(','),
  )
  await page.screenshot({ path: `${out}/1-home-picker.png` })

  // 2. Choose a project: it is opened and the dock is that project.
  await page.locator(`#dock [data-dock-pick="${first.slug}"]`).click()
  await page.waitForTimeout(1500)
  check(
    'choosing a project opens it and the dock is that project',
    (await head()).includes(first.name) && /\/p\//.test(new URL(page.url()).pathname),
    `${await head()} @ ${new URL(page.url()).pathname}`,
  )
  // The property is that the composer belongs to THIS project, not the placeholder's wording: Team HQ's dock is in note mode
  // ("Message the team…") and the form carries the project it writes to. The header above already names the project.
  check(
    'the composer is there, and it is addressed to this project',
    (await page.locator('#dock [data-docksay]').count()) === 1 &&
      (await page.locator('#dock [data-dockform]').getAttribute('data-bc-noteproject')) ===
        first.slug,
    `project=${String(await page.locator('#dock [data-dockform]').getAttribute('data-bc-noteproject'))}`,
  )
  await page.screenshot({ path: `${out}/2-first-project.png` })

  // 3. Navigate to another project with the dock still open: it follows.
  await page.goto(`${studio.base}/p/${second.slug}`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  await openDock()
  check(
    'on another project the dock is that project, with nothing offered to move it',
    (await head()).includes(second.name) && (await page.locator('[data-dock-here]').count()) === 0,
    await head(),
  )
  await page.screenshot({ path: `${out}/3-second-project.png` })

  // 4. Back to a screen with no project: the dock asks again, it does not keep the last one.
  await page.goto(`${studio.base}/tasks`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  await openDock()
  check(
    'on a screen with no project the dock asks again rather than keeping the last one',
    /No project open/.test(await head()),
    await head(),
  )
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
} finally {
  await studio.close()
}
console.log(failed === 0 ? '\nDOCK CONTRACT: PASS' : `\nDOCK CONTRACT: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
