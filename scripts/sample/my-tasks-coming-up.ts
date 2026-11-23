/**
 * My Tasks shows the to-dos due later or with no date, under "Coming up" (stress test of 23 November 2026).
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/my-tasks-coming-up.ts [label]
 *
 * READ ONLY: signs in as the Sample Person, opens My Tasks, counts the rows under each heading, and saves a screenshot.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/my-tasks-coming-up-${label}`
mkdirSync(out, { recursive: true })

const studio = await startStudio(4800)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })

await signIn(studio, page, s)
await page.goto(`${studio.base}/tasks`, { waitUntil: 'domcontentloaded' })
await settle(page)
await page.waitForTimeout(2500)

// A string, not a closure: a closure compiled by tsx carries helpers the browser does not have.
const counts = (await page.evaluate(`(() => {
  const heads = Array.from(document.querySelectorAll('h2.bcsubhead')).map((h) => h.textContent.trim())
  const comingUp = document.querySelector('[data-bc-coming-list]')
  return { heads, comingUp: comingUp ? comingUp.querySelectorAll('.bcitem').length : -1 }
})()`)) as { heads: string[]; comingUp: number }
console.log(`headings: ${counts.heads.join(' | ') || 'none'}`)
console.log(`coming up rows: ${String(counts.comingUp)}`)
await page.screenshot({ path: `${out}/my-tasks.png`, fullPage: false })
console.log(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`)
await studio.close()
process.exit(0)
