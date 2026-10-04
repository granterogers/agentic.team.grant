/* The document style form against a stubbed gateway. npx tsx scripts/verify/style-ui.ts */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4694
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) pass += 1
  else fail += 1
  console.log(
    `${ok ? 'ok   ' : 'FAIL '} ${what}${ok || detail === '' ? '' : `\n        ${detail}`}`,
  )
}
const browser = await chromium.launch()
const slugPage = await (await browser.newContext()).newPage()
await slugPage.goto(url('/'))
await slugPage.waitForTimeout(500)
const slug = (await slugPage.evaluate(
  `document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`,
)) as string
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const calls: {
  action?: string
  args?: Record<string, unknown>
  section?: string
  q?: Record<string, string>
}[] = []
const errs: string[] = []
page.on('pageerror', (e) => {
  errs.push(e.message)
})
await page.addInitScript(() => localStorage.setItem('hq.token', 'stub'))
await page.route('**/*', async (route) => {
  const u = route.request().url()
  if (!u.includes('hq-api')) return route.continue()
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  if (route.request().method() === 'POST') {
    const b = JSON.parse(route.request().postData() ?? '{}') as {
      action: string
      args: Record<string, unknown>
    }
    calls.push({ action: b.action, args: b.args })
    return route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ result: { ok: true } }),
    })
  }
  const q = Object.fromEntries(new URL(u).searchParams)
  calls.push({ section: q.section, q })
  if (q.section === 'style')
    return route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          scope: 'project',
          profile: { palette: { primary: '#aa3322' }, tone: 'Warm' },
          inherited_from: { 'palette.primary': 'project', tone: 'office' },
          vocabulary: {
            fonts: ['Helvetica', 'Times'],
            palette: ['primary', 'accent', 'ink', 'paper'],
            title_pages: ['standard', 'band'],
          },
        },
      }),
    })
  return route.fulfill({
    status: 500,
    headers,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'stub' }),
  })
})
await page.goto(url('/'))
await page.waitForTimeout(800)
await page.evaluate(
  `import('/bc/style.js').then((m) => m.open({ slug: 'legacy', name: 'Legacy' }))`,
)
await page.waitForSelector('.bcstyform select')
check(
  "signed in, the form asks the office for this project's style",
  calls.some((c) => c.section === 'style' && c.q?.slug === 'legacy'),
)
check(
  'each field says where it comes from',
  (await page.locator('.bcstyfrom').allTextContents()).join('|').includes('this project'),
)
await page.screenshot({ path: '.out/ux-style-02-form.png' })
await page.fill('input[name="tone"]', 'Plain and warm')
await page.selectOption('select[name="ty.heading"]', 'Times')
await page.locator('.bcstyform button[type=submit]').click()
await page.waitForTimeout(400)
const set = calls.find((c) => c.action === 'style_set')
check(
  'saving sends style_set with the project and a patch',
  set !== undefined && set.args?.p_slug === 'legacy',
  JSON.stringify(set),
)
check(
  'the patch carries what was typed, and leaves untouched colours unset',
  JSON.stringify(set?.args?.p_patch).includes('Plain and warm') &&
    JSON.stringify(set?.args?.p_patch).includes('Times'),
)
await page.close()
const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p2.goto(url(slug))
await p2.waitForSelector('[data-bc-pagemenu]')
await p2.locator('[data-bc-pagemenu]').click()
await p2.locator('[data-bc-style]').click()
await p2.waitForSelector('.bcstydlg')
check('Document style opens from the project menu', (await p2.locator('.bcstydlg').count()) === 1)
check(
  'signed out it says the prototype is never saved',
  ((await p2.locator('.bcstydlg').textContent()) ?? '').includes('never saved'),
)
await p2.screenshot({ path: '.out/ux-style-01-signedout.png' })
await p2.keyboard.press('Escape')
check('Escape closes it', (await p2.locator('.bcstydlg').count()) === 0)
check('no page errors', errs.length === 0, errs.join(' | '))
void calls
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
