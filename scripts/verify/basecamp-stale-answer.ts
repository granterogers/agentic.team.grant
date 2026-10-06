/*
 * A QUESTION ANSWERED ELSEWHERE IS NOT ANSWERED AGAIN BY THE PAGE'S SAY-SO.
 *
 *   npm run verify:basecamp-stale-answer
 *
 * Integration pass, 28 September 2026 — a cross-boundary defect neither
 * remediation branch could see alone.
 *
 * The backend branch made approval questions REACH Grant's chat (ledger R46)
 * and let him answer them there in a word (R33), and 0596 made a second answer
 * wait for the first and then return the existing reply
 * `{ok: false, already: true, state, resolution}`. So one question is now
 * routinely open on two surfaces at once: the Telegram message and the
 * dashboard's "Waiting for you" record, which does not refresh itself.
 *
 * Both dashboard surfaces wrapped the press in `attempt(…, 'Answered.')`, and
 * `attempt` says its done-sentence for ANY result that did not throw. So when
 * he says "No" on Telegram and later presses "Yes" on the dashboard, the page
 * says "Answered. The team has it." — while the office has done what "No"
 * meant and nothing at all with the press. The frontend and the backend
 * disagree about what happened, and the page is the one that is wrong.
 *
 * Fake office throughout: every request to the gateway is fulfilled here, so
 * nothing reaches any office. The property asserted is that the page repeats
 * the answer the office HOLDS, and does not claim this press was taken.
 */
import '../../src/safety/arm.ts'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4697
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

/* The answer somebody else already gave: deliberately NOT the one pressed. */
const HELD = 'Not now — recorded elsewhere'

const browser = await chromium.launch()

type Reply = 'already' | 'taken'
const open = async (
  reply: Reply,
): Promise<{ page: Page; answered: string[]; close: () => Promise<void> }> => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
  )
  const answered: string[] = []
  await ctx.route('**/turn**', (r) => r.abort('connectionfailed'))
  await ctx.route('**/hq-api**', async (route) => {
    const body = route.request().postData() ?? ''
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return
    }
    /* Reads fail, so the page draws its prototype rows — which carry a waiting
       item on purpose (#151). Writes are answered here. */
    if (!body.includes('"action"')) {
      await route.abort('connectionfailed')
      return
    }
    const parsed = JSON.parse(body) as { action?: string; args?: { p_answer?: string } }
    if (parsed.action === 'answer_blocker') answered.push(String(parsed.args?.p_answer ?? ''))
    const result =
      parsed.action !== 'answer_blocker'
        ? { ok: true }
        : reply === 'already'
          ? { ok: false, already: true, state: 'resolved', resolution: HELD }
          : { ok: true, answer: parsed.args?.p_answer ?? '' }
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ result }),
    })
  })
  const page = await ctx.newPage()
  return { page, answered, close: () => ctx.close() }
}

const slug = await (async (): Promise<string> => {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(400)
  const s = (await p.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
  await ctx.close()
  return s
})()
check('the portfolio names a project', slug !== '', slug)

/* Open the waiting record, press its first option, and read what the page says. */
const press = async (
  reply: Reply,
): Promise<{ told: string; stillOpen: boolean; pressed: string; answered: string[] }> => {
  const { page, answered, close } = await open(reply)
  await page.goto(url(`${slug}/team`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-waitopen]', { timeout: 15000 })
  await page.locator('[data-bc-waitopen]').first().click()
  await page.waitForSelector('[data-bc-waitanswer]', { timeout: 5000 })
  const btn = page.locator('[data-bc-waitanswer]').first()
  const pressed = (await btn.getAttribute('data-bc-waitanswer')) ?? ''
  /* EVERY sentence written while the press is handled, not just what is left
     afterwards: the record closes on success, and a check that reads the
     screen after it has closed passes whatever was said (it did, first run). */
  await page.evaluate(
    inPage(`window.__said = []
       new MutationObserver(() => {
         for (const el of document.querySelectorAll('[role=status], [data-said], .bcsaidhere')) {
           const t = (el.textContent ?? '').trim()
           if (t !== '' && !window.__said.includes(t)) window.__said.push(t)
         }
       }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })`),
  )
  await btn.click()
  await page.waitForTimeout(1200)
  const told = (await page.evaluate(
    inPage(`return [...window.__said, document.querySelector('.bcmain')?.innerText ?? '']
       .join(' | ').replace(/\\s+/g, ' ')`),
  )) as string
  const stillOpen = (await page.locator('[data-bc-waitform]').count()) > 0
  await close()
  return { told, stillOpen, pressed, answered }
}

/* THE DEFECT. */
const stale = await press('already')
check('the press reached the office', stale.answered.length === 1, stale.answered.join(', '))
check(
  'an already-answered question is NOT reported as answered by this press',
  !/Answered\. The team has it\./.test(stale.told),
  stale.told.slice(0, 240),
)
check(
  'the page says it was already answered, with the answer the office holds',
  /already answered/i.test(stale.told) && stale.told.includes(HELD),
  stale.told.slice(0, 240),
)
check(
  'and it does not claim the pressed answer was taken',
  !new RegExp(`answered\\W+${stale.pressed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(
    stale.told,
  ) || stale.pressed === HELD,
  `pressed ${stale.pressed}`,
)

check('and the record stays open, so that sentence is on the screen to be read', stale.stillOpen)

/* THE CONTROL: an ordinary answer still reads as taken, and closes the record. */
const taken = await press('taken')
check(
  'CONTROL: an answer the office takes is still acknowledged',
  taken.answered.length === 1 && !taken.stillOpen,
  `answered ${taken.answered.join(', ')}; still open ${String(taken.stillOpen)}`,
)
check(
  'CONTROL: and is not described as already answered',
  !/already answered/i.test(taken.told),
  taken.told.slice(0, 200),
)

await browser.close()
await server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exitCode = fail === 0 ? 0 : 1
