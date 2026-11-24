/**
 * Enter in a to-do title saves the task in place, without a page reload (stress test of 23 November 2026, 0.102.0).
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/todo-enter-saves.ts [label]
 *
 * Runs on the Sample Office only, where the task is a visitor's own test item. It types a title, presses Enter, and checks the
 * address did not change to a title query and that the new task is on the page.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/todo-enter-${label}`
mkdirSync(out, { recursive: true })
const TITLE = `Verify Enter saves ${Date.now().toString(36)}`

const studio = await startStudio(4801)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })

await signIn(studio, page, s)
await page.goto(`${studio.base}/p/wellness-studio-launch/tasks`, { waitUntil: 'domcontentloaded' })
await settle(page)

// Open the add form for the first list that has one, the same way a person does, if it is hidden.
const opened = await page.evaluate(`(() => {
  const f = document.querySelector('[data-bc-taskform]')
  if (!f) return 'no form'
  if (f.hidden) {
    const opener = document.querySelector('[data-bc-addtask]')
    if (opener) opener.click()
  }
  return f.hidden ? 'still hidden' : 'open'
})()`)
console.log(`add form: ${String(opened)}`)
await page.waitForTimeout(500)

const before = page.url()
const title = page.locator('[data-bc-taskform]:not([hidden]) input[name="title"]').first()
if ((await title.count()) === 0) {
  console.log('FAIL no visible to-do title field to test')
  await studio.close()
  process.exit(1)
}
await title.fill(TITLE)
await title.press('Enter')
await page.waitForTimeout(3000)

const after = page.url()
const reloaded = after !== before && after.includes('title=')
const shown = (await page.locator(`text=${TITLE}`).count()) > 0
console.log(`address after Enter: ${after.replace(studio.base, '')}`)
console.log(`${reloaded ? 'FAIL' : 'ok  '} the page did not reload to a title query`)
console.log(`${shown ? 'ok  ' : 'FAIL'} the new task is on the page`)
await page.screenshot({ path: `${out}/after-enter.png` })
console.log(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`)
await studio.close()
process.exit(reloaded || !shown ? 1 : 0)
