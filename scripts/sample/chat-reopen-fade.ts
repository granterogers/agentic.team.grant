/**
 * OTH-02 (stress test, 21 November 2026): after a reload and reopening Chat with Team, the message list was drawn faded for
 * several seconds, as if disabled. This reproduces it on the Sample Office and measures it.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/chat-reopen-fade.ts [label]
 *
 * READ ONLY: it signs in as the Sample Person, loads the project's chat, reloads it, moves away and back, and samples the
 * computed opacity of the thread and its messages over time. It sends nothing and writes nothing.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/chat-reopen-fade-${label}`
mkdirSync(out, { recursive: true })
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const studio = await startStudio(4796)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })

const sample = async (step: string): Promise<Record<string, unknown>> => {
  const readings: Record<string, unknown>[] = []
  let last = 0
  for (const at of [0, 250, 1000, 2000, 4000, 6000]) {
    await sleep(at - last)
    last = at
    // A string, not a closure: a closure compiled by tsx carries helpers the browser does not have.
    const r = (await page.evaluate(`(() => {
      const thread = document.querySelector('.bcchat--full')
      const msg = document.querySelector('.bcchat--full .bcsaid')
      const cs = (el) => (el === null ? 'absent' : getComputedStyle(el).opacity)
      return {
        thread: cs(thread),
        message: cs(msg),
        messages: document.querySelectorAll('.bcchat--full .bcsaid').length,
        busy: thread ? thread.getAttribute('aria-busy') : null,
      }
    })()`)) as Record<string, unknown>
    readings.push({ at, ...r })
  }
  await page.screenshot({ path: `${out}/${step}.png` })
  console.log(`${step}: ${JSON.stringify(readings)}`)
  return { step, readings }
}

const run: Record<string, unknown>[] = []
const chat = `${studio.base}/p/wellness-studio-launch/chat`
await signIn(studio, page, s)
await page.goto(chat, { waitUntil: 'domcontentloaded' })
await settle(page)
run.push(await sample('first-open'))

await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)
run.push(await sample('after-reload'))

await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
await settle(page)
await page.goto(chat, { waitUntil: 'domcontentloaded' })
await settle(page)
run.push(await sample('reopened'))

console.log(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`)
await studio.close()
process.exit(0)
