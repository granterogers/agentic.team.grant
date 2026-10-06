/**
 * The logged-out -> Sample Office -> sign up / sign in journey, in a real browser, as a visitor does it.
 *
 *   npx tsx scripts/sample/public-ui.ts [label] [--page=https://ai-team-hq.vercel.app] [--chat] [--widths=desktop,phone]
 *
 * Without --page it serves the working tree's web/studio on 127.0.0.1 (`?welcome=1` asks for the entry screen a local
 * server does not show by itself). With --page it drives the DEPLOYED page (the browser needs `npm run trust:proxy-ca`).
 * Either way the office behind it is the real one: the real `signin` function mints the visitor's session (the harness only
 * adds the allowed page origin to that one request, because a local page is not an allowed origin) and the real gateway
 * answers every read.
 *
 * It writes nothing to any office. `--chat` sends ONE question through the real worker and reads the answer back; without it
 * no model is called. Captures go to .out/public-<label>/ and every one is meant to be opened and looked at.
 */
import '../../src/safety/require-production-writes.ts'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright'
import { REF } from '../p4/lib.ts'

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const label =
  process.argv[2] !== undefined && !process.argv[2].startsWith('--') ? process.argv[2] : 'now'
const PAGE = arg('page')
const withChat = process.argv.includes('--chat')
const out = `.out/public-${label}`
mkdirSync(out, { recursive: true })
const SIGNIN = `https://${REF}.supabase.co/functions/v1/signin`
const API = `https://${REF}.supabase.co/functions/v1/hq-api`
const ALLOWED_ORIGIN = 'https://ai-team-hq.vercel.app'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const PORT = 4799
const server =
  PAGE === undefined
    ? createServer(async (req, res) => {
        const path = (req.url ?? '/').split('?')[0] ?? '/'
        try {
          const body = await readFile(
            join(
              arg('root') ?? 'web/studio',
              extname(path) === '' ? 'index.html' : path.replace(/^\//, ''),
            ),
          )
          res.writeHead(200, {
            'content-type':
              TYPES[extname(path) === '' ? '.html' : extname(path)] ?? 'application/octet-stream',
          })
          res.end(body)
        } catch {
          res.writeHead(404)
          res.end('not here')
        }
      })
    : null
if (server !== null) await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()))
const BASE = PAGE ?? `http://127.0.0.1:${PORT}`
const ENTRY = PAGE === undefined ? `${BASE}/?welcome=1` : `${BASE}/`

const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const FORBIDDEN =
  /tenant|workspace|organi[sz]ation|office[_ ]?id|\btoken\b|\bRLS\b|supabase|basecamp|p_visitor|guest member/i

const WIDTHS: Record<string, { width: number; height: number; touch: boolean }> = {
  desktop: { width: 1440, height: 900, touch: false },
  phone: { width: 390, height: 844, touch: true },
}
const chosen = (arg('widths') ?? 'desktop,phone').split(',')

const prepare = async (context: BrowserContext): Promise<void> => {
  // A local page is not an allowed origin for `signin`; add the allowed one to that single request and nothing else.
  if (PAGE === undefined) {
    await context.addInitScript(`window.HQ_API = ${JSON.stringify(API)}`)
    await context.route(/\/functions\/v1\/signin/, async (route) => {
      const req = route.request()
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const real = await fetch(SIGNIN, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
        body: req.postData() ?? '{}',
      })
      return route.fulfill({
        status: real.status,
        contentType: 'application/json',
        headers: cors,
        body: await real.text(),
      })
    })
  }
}
const storageKeys = async (p: Page): Promise<string[]> =>
  (await p.evaluate(`Object.keys(localStorage).concat(Object.keys(sessionStorage))`)) as string[]
const sampleFlag = async (p: Page): Promise<boolean | null> =>
  (await p.evaluate(
    `(() => { try { const s = JSON.parse(localStorage.getItem('hq.session') || 'null'); return s === null ? null : s.sample === true } catch { return null } })()`,
  )) as boolean | null

const browser = await chromium.launch()
for (const name of chosen) {
  const vp = WIDTHS[name]
  if (vp === undefined) continue
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch && vp.width < 600,
  })
  await prepare(context)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  // The sandbox's proxy can hand a browser an HTML error page the real service never sent. Name what answered, so a
  // sandbox fault is never reported as the product failing (and a real one is never excused as the sandbox).
  page.on('response', (r) => {
    const url = r.url()
    const type = r.headers()['content-type'] ?? ''
    const ours = url.startsWith(BASE)
    if (!ours && !url.includes('/functions/v1/')) return
    // Vercel stamps x-vercel-id on every response; a page file without it, or a 5xx, did not come from the product.
    const notFromVercel = PAGE !== undefined && ours && r.headers()['x-vercel-id'] === undefined
    const bad = r.status() >= 400 || (r.status() === 200 && type.includes('text/html') && !ours)
    if (bad || notFromVercel) {
      console.log(
        `  ! ${String(r.status())} ${type} ${new URL(url).pathname} (x-vercel-id: ${r.headers()['x-vercel-id'] ?? 'none'}, sb-request-id: ${r.headers()['sb-request-id'] ?? 'none'})`,
      )
    }
  })
  page.on('requestfailed', (q) => {
    console.log(
      `  ! request failed ${new URL(q.url()).pathname}: ${q.failure()?.errorText ?? 'unknown'}`,
    )
  })
  const tag = name

  // ---- A. a visitor who is not signed in -------------------------------------------------------------------------------
  await page.goto(ENTRY, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcentrycard', { timeout: 30000 })
  await page.waitForTimeout(500)
  const card = await page.locator('.bcentrycard').innerText()
  check(
    `${tag}: the first screen offers Explore the Sample Office`,
    (await page.locator('[data-bc-sample-start]').count()) === 1,
    '',
  )
  check(
    `${tag}: and Sign in / Create account`,
    (await page.locator('[data-bc-entry-tab]').count()) === 2,
    '',
  )
  check(
    `${tag}: no internal noun a visitor should never read`,
    !FORBIDDEN.test(card),
    card.match(FORBIDDEN)?.[0] ?? '',
  )
  const box = await page.locator('[data-bc-sample-start]').boundingBox()
  check(
    `${tag}: the Explore button is on the first screen, no scrolling`,
    box !== null && box.y + box.height <= vp.height,
    `y ${String(Math.round(box?.y ?? -1))} of ${String(vp.height)}`,
  )
  await page.screenshot({ path: `${out}/${tag}-1-entry.png`, fullPage: true })

  // ---- B. entering ------------------------------------------------------------------------------------------------------
  await page.locator('[data-bc-sample-start]').click()
  await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
  await page
    .waitForFunction("(document.body.innerText || '').includes('Riverside')", undefined, {
      timeout: 60000,
    })
    .catch(() => null)
  await page.waitForTimeout(1500)
  // Said first and by name: if the office did not answer, the page shows its invented example projects, and every check
  // below would describe THEM. That is a failed read, not a statement about the Sample.
  check(
    `${tag}: the office answered the visitor's read (the page is not showing its invented examples)`,
    (await page.getByText('The office did not answer').count()) === 0,
    '',
  )
  check(
    `${tag}: entering needs no email, link or password and lands in a banner'd office`,
    (await page.locator('.bcsamplebar').count()) === 1,
    '',
  )
  check(
    `${tag}: the browser holds a visitor session, marked as the sample`,
    (await sampleFlag(page)) === true,
    '',
  )
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check(
    `${tag}: the sample's projects are shown`,
    /Riverside Café Launch/.test(body) &&
      /Autumn Menu Research/.test(body) &&
      /Winter Market Pop-up/.test(body),
    '',
  )
  check(
    `${tag}: nothing of Grant's, and no test debris, is on the page`,
    !/grant|innergy|rogers|legacy|wellness studio|japan spring|fixture|verify-/i.test(body),
    body.match(/grant|innergy|rogers|legacy|wellness studio|japan spring|fixture|verify-/i)?.[0] ??
      '',
  )
  await page.screenshot({ path: `${out}/${tag}-2-sample-home.png`, fullPage: false })
  check(`${tag}: no page errors so far`, errors.length === 0, errors.join(' | '))

  // ---- C. a project and the team ----------------------------------------------------------------------------------------
  await page.getByText('Riverside Café Launch').first().click()
  await page.waitForFunction(
    "(document.body.innerText || '').includes('Chat with Team')",
    undefined,
    { timeout: 30000 },
  )
  await page.waitForTimeout(1500)
  const project = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  check(
    `${tag}: the project opens with its own tasks`,
    /Book the council fire-safety inspection/.test(project),
    '',
  )
  check(
    `${tag}: no unfinished label (a done task is not called late, nothing says undefined or NaN)`,
    !/\bundefined\b|\bNaN\b|\[object/.test(project),
    project.match(/\bundefined\b|\bNaN\b|\[object/)?.[0] ?? '',
  )
  await page.screenshot({ path: `${out}/${tag}-3-project.png` })

  // The microphone: a visitor is told why, and nothing is asked of the office.
  const mic = page.locator('[aria-label*="Talk to the team out loud"]').first()
  if ((await mic.count()) > 0) {
    await mic.click()
    await page.waitForTimeout(1200)
    const said = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    check(
      `${tag}: calling the team says it needs your own office, and does not dial`,
      /needs your own office/i.test(said),
      '',
    )
  }

  // Opening the team reads the visitor's OWN thread through the visitor-only section, and the gateway answers it.
  const threadRead = page.waitForResponse(
    (r) => r.url().includes('section=sample_conversation') && r.request().method() === 'GET',
    { timeout: 20000 },
  )
  await page.locator('[data-bc-dock]:visible').first().click()
  const thread = await threadRead.catch(() => null)
  check(
    `${tag}: opening the team reads the visitor's own thread, and it is answered`,
    thread !== null && thread.status() === 200,
    thread === null
      ? 'no request for the visitor thread was made'
      : `http ${String(thread.status())}`,
  )
  // Close it the way a person does. The page remembers an open dock across a reload, and on a phone it covers the screen.
  await page
    .locator('[data-dock-close]')
    .first()
    .click()
    .catch(() => null)
  await page.waitForTimeout(500)

  // A write attempted through the real page: the sample is read-only and says so in words.
  // The button lives on the home screen, so go there first; a missing button or form is a FAILURE, never a skip.
  await page.goto(`${ENTRY.split('?')[0]}`, { waitUntil: 'domcontentloaded' })
  await page
    .waitForFunction("(document.body.innerText || '').includes('Your projects')", undefined, {
      timeout: 60000,
    })
    .catch(() => null)
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(3000)
  const newBtn = page.getByRole('button', { name: /new project/i }).first()
  // Wait for the button itself, not for a fixed pause: the home screen is still drawing when the network goes quiet.
  await newBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => null)
  await page.screenshot({ path: `${out}/${tag}-3a-home.png` })
  check(
    `${tag}: the home screen offers New project (the write attempt below can run)`,
    (await newBtn.count()) > 0,
    '',
  )
  const nameField = page.locator('#bc-newproject-name')
  // The home screen redraws while it finishes loading and a redraw can close the form, so press again until it holds.
  let opened = false
  for (let attempt = 0; attempt < 4 && !opened; attempt++) {
    await newBtn.click().catch(() => null)
    await page.waitForTimeout(1500)
    opened = await nameField.isVisible().catch(() => false)
  }
  check(`${tag}: pressing New project opens the form`, opened, '')
  if (opened) {
    const projectsBefore =
      (await page.locator('body').innerText()).match(
        /Riverside Café Launch|Autumn Menu Research|Winter Market Pop-up/g,
      )?.length ?? 0
    await nameField.fill('Visitor Spoil Test')
    await nameField.press('Enter')
    await page.waitForTimeout(4000)
    const after = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    check(
      `${tag}: the refusal is a sentence, not a code`,
      /changes are not saved/i.test(after.slice(after.indexOf('Your projects'))),
      '',
    )
    check(
      `${tag}: no raw code leaks to the visitor`,
      !/sample_readonly|guest_only|\b403\b/.test(after),
      after.match(/sample_readonly|guest_only|\b403\b/)?.[0] ?? '',
    )
    const projectsAfter =
      after.match(/Riverside Café Launch|Autumn Menu Research|Winter Market Pop-up/g)?.length ?? 0
    check(
      `${tag}: and no project was made`,
      !/Visitor Spoil Test/.test(after.slice(after.indexOf('Your projects') + 20)) &&
        projectsAfter <= projectsBefore,
      `${String(projectsBefore)} -> ${String(projectsAfter)}`,
    )
    await page.screenshot({ path: `${out}/${tag}-3b-new-project-refused.png` })
  }

  // The one real turn, only when asked for. Sample context must be used and nothing of anybody's real office.
  if (withChat) {
    await page.goto(`${ENTRY.split('?')[0]}`, { waitUntil: 'domcontentloaded' })
    await page
      .waitForFunction("(document.body.innerText || '').includes('Riverside')", undefined, {
        timeout: 60000,
      })
      .catch(() => null)
    await page.getByText('Riverside Café Launch').first().click()
    await page.waitForTimeout(1500)
    await page.locator('[data-bc-dock]').first().click()
    await page.waitForTimeout(800)
    // The dock's composer is addressed the way a person finds it: by what it asks, and by its Send button.
    const box = page.getByPlaceholder(/Ask the team about/i).first()
    await box.waitFor({ state: 'visible', timeout: 15000 })
    const before = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    await box.fill('What is the total budget for the Riverside site, and who supplies the coffee?')
    await page
      .getByRole('button', { name: /^send$/i })
      .first()
      .click()
    // The real worker answers; allow it time and keep reading rather than assuming.
    const deadline = Date.now() + 240000
    let answer = ''
    // The answer is in hand only when the "working on it" state has gone AND the sample's own figure is on the page.
    // The first draft matched figures that other panels already show, and passed while the team was still thinking.
    const answered = (text: string): boolean =>
      !/working on it/i.test(text) &&
      /88,000/.test(text.slice(text.lastIndexOf('What is the total budget')))
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000)
      const now = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      if (answered(now)) {
        answer = now.slice(now.lastIndexOf('What is the total budget'))
        break
      }
    }
    await page.screenshot({ path: `${out}/${tag}-4-chat.png` })
    void before
    check(
      `${tag}: the team answered from the sample's own papers (£88,000, after the question)`,
      answer !== '',
      answer === '' ? 'no sample figure after the question before the deadline' : '',
    )
    check(
      `${tag}: and nothing of Grant's or anybody's real office is in it`,
      !/grant|innergy|rogers|legacy|wellness studio|japan spring/i.test(answer),
      answer.match(/grant|innergy|rogers|legacy|wellness studio|japan spring/i)?.[0] ?? '',
    )
  }

  // ---- D. leaving: sample -> create your own office --------------------------------------------------------------------
  await page.goto(`${ENTRY.split('?')[0]}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
  await page.locator('[data-bc-sample-create]').first().click()
  await page.waitForSelector('.bcentrycard', { timeout: 30000 }).catch(async (e) => {
    await page.screenshot({ path: `${out}/${tag}-FAILED-create.png` })
    console.log(
      `  the entry did not appear after Create your own office; the page is at ${page.url().replace(/https?:\/\/[^/]+/, '')}`,
    )
    throw e
  })
  await page.waitForTimeout(800)
  check(
    `${tag}: Create your own office leaves the sample and lands on the create form`,
    (await page.locator('[data-bc-entry-form="create"]:visible').count()) === 1,
    page.url().replace(/https?:\/\/[^/]+/, ''),
  )
  check(
    `${tag}: and the visitor's session and identity are gone from the browser`,
    (await sampleFlag(page)) === null && !(await storageKeys(page)).includes('hq.visitor'),
    (await storageKeys(page)).join(','),
  )
  await page.screenshot({ path: `${out}/${tag}-5-create.png` })

  // ---- E. the sample is still there afterwards, and leaving via the header goes back to the entry -----------------------
  await page.locator('[data-bc-sample-start]').click()
  await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
  check(`${tag}: after leaving, Explore works again`, (await sampleFlag(page)) === true, '')
  await page.getByText('Leave sample').first().click()
  // A hosted page shows the entry to anybody signed out. A local, non-hosted server only draws it with ?welcome=1
  // (the prototype is what it shows otherwise), so on a local run ask for it; the deployed run is the real proof.
  await page
    .waitForSelector('.bcentrycard', { timeout: PAGE === undefined ? 8000 : 30000 })
    .catch(async (e) => {
      if (PAGE !== undefined) throw e
      await page.goto(ENTRY, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.bcentrycard', { timeout: 30000 })
    })
  check(
    `${tag}: Leave sample returns to the entry with nothing held`,
    (await sampleFlag(page)) === null,
    '',
  )
  check(`${tag}: no page errors anywhere in the journey`, errors.length === 0, errors.join(' | '))
  await context.close()
}
await browser.close()
server?.close()
const passed = results.filter(Boolean).length
console.log(
  `\n${String(passed)}/${String(results.length)} passed (captures in ${out}; chat ${withChat ? 'on' : 'off'})`,
)
process.exit(passed === results.length ? 0 : 1)
