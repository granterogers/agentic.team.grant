/*
 * THE COMMAND PALETTE: FIND AND ACT, DRIVEN IN A REAL BROWSER (4 October 2026).
 *   npx tsx scripts/verify/palette.ts
 * Cmd/Ctrl+K opens Team HQ's own palette (not the classic studio's bar), which
 * finds project content across stores and performs workspace actions.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4692
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
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})
await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const slug = (await page.evaluate(
  inPage(
    `const el = document.querySelector('[data-bc-go^="/p/"]'); return el ? el.dataset.bcGo : ''`,
  ),
)) as string
await page.evaluate(
  inPage(
    `for (const k of Object.keys(localStorage)) if (k.startsWith('bc.')) localStorage.removeItem(k); return true`,
  ),
)
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcstage [data-mod]')
await page.waitForTimeout(500)
const rows = async (): Promise<string[]> =>
  (await page.locator('#bcjump .bcjumprow').allTextContents()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  )

await page.keyboard.press('Control+k')
await page.waitForSelector('#bcjump')
check('Ctrl+K opens the Team HQ palette', (await page.locator('#bcjump').count()) === 1)
check('and not the classic studio bar', (await page.locator('.cmd, [data-cmd]').count()) === 0)
await page.screenshot({ path: '.out/ux-palette-01-empty.png' })
await page.keyboard.press('Control+k')
await page.waitForTimeout(150)
check('Ctrl+K again closes it', (await page.locator('#bcjump').count()) === 0)
await page.keyboard.press('Meta+k')
await page.waitForSelector('#bcjump')
check('Cmd+K opens it too', (await page.locator('#bcjump').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

/* find */
await page.keyboard.press('Control+k')
await page.keyboard.type('avatar')
await page.waitForTimeout(250)
const found = await rows()
check(
  'typing finds tasks and documents in the project',
  found.some((r) => /Task/.test(r)) && found.some((r) => /Document/.test(r)),
  found.join(' | '),
)
await page.screenshot({ path: '.out/ux-palette-02-find.png' })
await page.keyboard.press('Escape')

/* a Post-it is searchable */
await page.locator('.bcpostittext').first().click()
await page.keyboard.type('Remember the zebra contract')
await page.keyboard.press('Control+k')
await page.keyboard.type('zebra')
await page.waitForTimeout(250)
check(
  'a Post-it is found by its text',
  (await rows()).some((r) => /Note/.test(r)),
  (await rows()).join(' | '),
)
await page.keyboard.press('Escape')

/* events are found, and open the event */
await page.keyboard.press('Control+k')
await page.keyboard.type('Weekly planning')
await page.waitForTimeout(250)
check(
  'a calendar event is found by its title',
  (await rows()).some((r) => /Event/.test(r)),
  (await rows()).join(' | '),
)
await page.keyboard.press('Escape')

/* actions */
await page.keyboard.press('Control+k')
await page.keyboard.type('new event')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForSelector('.bccal2dlg form')
check('"New event" opens the event editor', (await page.locator('.bccal2dlg form').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

await page.keyboard.press('Control+k')
await page.keyboard.type('zoom out')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check(
  '"Zoom out" zooms the workspace',
  ((await page.locator('.bczoomval').textContent()) ?? '').trim() === '90%',
)

await page.keyboard.press('Control+k')
await page.keyboard.type('layout: planning')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check(
  'choosing a layout preset rearranges the page',
  (await page.locator('.bcstage [data-mod]').count()) === 5,
)
await page.screenshot({ path: '.out/ux-palette-03-planning.png' })

await page.keyboard.press('Control+k')
await page.keyboard.type('reset the view')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check(
  '"Reset the view" restores everything and keeps the note',
  (await page.locator('.bcstage [data-mod]').count()) === 6 &&
    ((await page.locator('.bcpostittext').first().inputValue()) ?? '').includes('zebra'),
)

await page.keyboard.press('Control+k')
await page.keyboard.type('new post')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
check('"New Post-it note" adds a note', (await page.locator('.bcpostit').count()) === 2)

/* keyboard: arrows move, focus returns */
await page.keyboard.press('Control+k')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown')
check(
  'arrow keys move the selection',
  (await page.locator('#bcjump [aria-selected="true"]').count()) === 1,
)
await page.keyboard.press('Escape')
check('Escape closes the palette', (await page.locator('#bcjump').count()) === 0)

/* a text field does not swallow it */
await page.locator('.bcpostittext').last().click()
await page.keyboard.press('Control+k')
await page.waitForSelector('#bcjump')
check('the palette opens even from inside a Post-it', (await page.locator('#bcjump').count()) === 1)
await page.keyboard.press('Escape')

/* the office's own search adds what this browser does not hold */
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p2 = await ctx2.newPage()
const asked: string[] = []
await p2.addInitScript(() => localStorage.setItem('hq.token', 'stub'))
await p2.route('**/*', async (route) => {
  const u = route.request().url()
  if (!u.includes('hq-api')) return route.continue()
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const q = Object.fromEntries(new URL(u).searchParams)
  if (q.section === 'project_search') {
    asked.push(q.q ?? '')
    return route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            kind: 'page',
            id: 'x',
            title: 'Pricing page saved from the web',
            snippet: 'competitor pricing',
            project_slug: 'legacy-coaching-course',
            url_hint: '/p/legacy-coaching-course/documents',
            score: 1,
          },
        ],
      }),
    })
  }
  return route.fulfill({
    status: 500,
    headers,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'stub' }),
  })
})
await p2.goto(url(slug), { waitUntil: 'domcontentloaded' })
await p2.waitForSelector('.bcstage [data-mod]')
await p2.keyboard.press('Control+k')
await p2.keyboard.type('pricing')
await p2.waitForTimeout(900)
const orows = (await p2.locator('#bcjump .bcjumprow').allTextContents()).join(' | ')
check(
  'signed in, the palette asks the office to search',
  asked.includes('pricing'),
  asked.join(','),
)
check(
  'and shows what the office found when it arrives',
  /Web page/.test(orows) && /Pricing page saved/.test(orows),
  orows,
)
await ctx2.close()

check('no page errors', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
