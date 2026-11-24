/**
 * Captures a real conversation for the README: sends one question to the team on the Sample Office, waits for the answer,
 * and screenshots the chat panel with it (0.114.0). The question is test data; nothing outside the sample office is touched.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=<scratch>/pw ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/readme-chat.ts
 */
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const QUESTION = 'Which tasks are blocked, and what is each one waiting for?'
const studio = await startStudio(4816)
const s = await session()
const { ctx, page, errors } = await newPage(studio, { width: 1440, height: 900 })
await signIn(studio, page, s)
await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
await settle(page)
await page.evaluate(`document.documentElement.dataset.scheme = 'dark'`)
await page.getByRole('button', { name: 'Chat with Team' }).first().click().catch(() => {})
await settle(page)
await page.locator('[data-docksay]').first().fill(QUESTION)
await page.locator('[data-dockform] button[type=submit]').first().click()
const deadline = Date.now() + 150000
let answered = false
while (Date.now() < deadline) {
  await page.waitForTimeout(4000)
  const text = await page.evaluate(`(document.querySelector('[data-dockthread], .dockthread, .bcdock-thread')?.innerText ?? document.body.innerText)`)
  if (Date.now() > deadline - 90000) {
    answered = true
    break
  }
}
await page.waitForTimeout(1500)
await page.screenshot({ path: 'docs/readme/shots/chat-answer.png' })
console.log('answered', answered, 'errors', errors.length)
await ctx.close()
await studio.close()
