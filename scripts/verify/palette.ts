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

/* --- workspace commands in words, one-step to-do, ask the team (HQ-CONV-001/002, HQ-CMD-008/013) ------------- */
{
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(500)
  const width = async (id: string): Promise<number> =>
    (await page.evaluate(
      inPage(
        `const e = document.querySelector('.bcstage [data-mod="${id}"]'); return e ? e.getBoundingClientRect().width : 0`,
      ),
    )) as number
  const typeIn = async (text: string): Promise<void> => {
    await page.keyboard.press('Control+k')
    await page.waitForSelector('#bcjump')
    await page.keyboard.type(text)
    await page.waitForTimeout(250)
  }
  const w0 = await width('documents')
  await typeIn('make documents bigger')
  const doRows = await rows()
  check(
    'typing "make documents bigger" offers a Workspace row that says what it will do',
    doRows[0]?.startsWith('Make Docs & Files bigger') === true && /Workspace/.test(doRows[0] ?? ''),
    doRows.slice(0, 3).join(' | '),
  )
  await page.screenshot({ path: '.out/ux-palette-10-workspace-command.png' })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const w1 = await width('documents')
  check(
    'pressing it grows the Documents module (the same layout operation the handles use)',
    w1 > w0 + 20,
    `${String(w0)} -> ${String(w1)}`,
  )
  await typeIn('make tasks blue')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const stored = (await page.evaluate(
    inPage(
      `return localStorage.getItem('bc.stage.' + ${JSON.stringify(slug.split('/')[2] ?? '')}) ?? ''`,
    ),
  )) as string
  check('"make tasks blue" stores the tint', /"tint":"sky"/.test(stored), stored.slice(0, 160))
  await typeIn('zoom out')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check(
    '"zoom out" zooms the stage',
    /"zoom":0\.9/.test(
      (await page.evaluate(
        inPage(
          `return localStorage.getItem('bc.stage.' + ${JSON.stringify(slug.split('/')[2] ?? '')}) ?? ''`,
        ),
      )) as string,
    ),
  )
  await typeIn('hide sources')
  check(
    '"hide sources" (not a module on this page) offers no workspace row, rather than guessing',
    !(await rows()).some((r) => /Workspace/.test(r)),
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  /* one-step to-do */
  await typeIn('add task call the venue about parking')
  const tr = await rows()
  check(
    '"add task ..." offers to add that to-do, saying whether it is saved',
    tr[0]?.startsWith('Add to-do: call the venue about parking') === true &&
      /Preview only/.test(tr[0] ?? ''),
    tr.slice(0, 2).join(' | '),
  )
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  check(
    'pressing it creates the to-do and opens the To-dos so it is SEEN',
    /\/tasks$/.test(page.url()) &&
      (await page.locator('body').innerText()).includes('call the venue about parking'),
    page.url(),
  )
  await page.screenshot({ path: '.out/ux-palette-11-added-todo.png' })
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await typeIn('call the venue')
  check(
    'a bare phrase typed to SEARCH never offers to create anything',
    !(await rows()).some((r) => /^Add to-do/.test(r)),
  )
  await page.keyboard.press('Escape')

  /* ask the team: last, and only on a press */
  await typeIn('docs')
  const ar = await rows()
  check(
    '"Ask the team" is offered last, never first',
    /^Ask the team: docs/.test(ar[ar.length - 1] ?? '') && !/^Ask the team/.test(ar[0] ?? ''),
    ar.join(' | '),
  )
  await page.locator('#bcjump .bcjumprow', { hasText: 'Ask the team:' }).click()
  await page.waitForTimeout(900)
  const before = (await page.locator('body').innerText()).slice(-400)
  check(
    'pressing it puts the message in the team conversation and closes the palette',
    ((await page.locator('#bcjump').count()) === 0 && /(^|\n)docs\s*\n/i.test(before)) ||
      /\ndocs\b/i.test(before),
    before.slice(-120),
  )
  await page.screenshot({ path: '.out/ux-palette-12-asked.png' })
}

check('no page errors', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
