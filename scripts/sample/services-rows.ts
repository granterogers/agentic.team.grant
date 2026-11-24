/**
 * SET-08 (stress test, 21 November 2026): Gmail and Google were separate rows with the same status. This opens Global
 * Settings › Services on the Sample Office, counts the Google rows, and saves a screenshot for a person to look at.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/services-rows.ts [label]
 *
 * READ ONLY: it signs in as the Sample Person, opens Settings, and reads the rows. It changes nothing.
 */
import { mkdirSync } from 'node:fs'
import { newPage, openSettings, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/services-rows-${label}`
mkdirSync(out, { recursive: true })

const studio = await startStudio(4797)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })

await signIn(studio, page, s)
await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
await settle(page)
await openSettings(page, 'connections')
await page.waitForTimeout(800)

// A string, not a closure: a closure compiled by tsx carries helpers the browser does not have.
const names =
  (await page.evaluate(`(() => Array.from(document.querySelectorAll('#settings article.svc-tile[data-tile]'))
  .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90)))()`)) as string[]
const googleRows = names.filter((t) => /google|gmail|drive|calendar/i.test(t))
console.log(`service rows read: ${String(names.length)}`)
for (const row of googleRows) console.log(`  google-related: ${row}`)
console.log(`google-related rows: ${String(googleRows.length)}`)
await page.screenshot({ path: `${out}/services.png`, fullPage: false })
console.log(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`)
await studio.close()
process.exit(0)
