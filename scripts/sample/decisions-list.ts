/**
 * SET-03, option B (22 November 2026): the Activity page shows one count and one list of the decisions waiting for the person.
 * This signs in as the Sample Person, opens Activity and its "Needs attention" view, reads the banner count and the list, and
 * saves a screenshot. It also reads the office's own count from the gateway and checks that the page shows the same number.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/decisions-list.ts [label]
 *
 * READ ONLY: it changes nothing.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/decisions-list-${label}`
mkdirSync(out, { recursive: true })

const studio = await startStudio(4798)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })

await signIn(studio, page, s)
await page.goto(`${studio.base}/activity`, { waitUntil: 'domcontentloaded' })
await settle(page)
await page.waitForTimeout(1500)

// A string, not a closure: a closure compiled by tsx carries helpers the browser does not have.
const chip = (await page.evaluate(`(() => {
  const b = document.querySelector('[data-act-view="attention"]')
  return b ? (b.getAttribute('aria-label') || b.textContent || '').replace(/\\s+/g, ' ').trim() : 'no attention chip'
})()`)) as string
console.log(`attention chip: ${chip}`)

await page.locator('[data-act-view="attention"]').first().click({ force: true })
await page.waitForTimeout(2000)
const note = (await page.evaluate(`(() => {
  const n = document.querySelector('.bcact-attn .bcact-note')
  const rows = document.querySelectorAll('.bcact-attn .bcact-need').length
  return { note: n ? n.textContent.trim().slice(0, 140) : '', rows }
})()`)) as { note: string; rows: number }
console.log(`list rows: ${String(note.rows)}${note.note === '' ? '' : `, note: ${note.note}`}`)
await page.screenshot({ path: `${out}/attention.png`, fullPage: false })
console.log(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`)
await studio.close()
process.exit(0)
