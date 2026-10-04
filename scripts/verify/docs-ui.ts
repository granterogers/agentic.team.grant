/*
 * DOCUMENTS AS A UNIFIED VIEW, DRIVEN IN A REAL BROWSER (4 October 2026).
 *   npx tsx scripts/verify/docs-ui.ts
 * Source filters that reflect what is present, search, kind filter, the extra
 * sort modes, a small indicator on every document, and the in-app viewer with
 * its metadata. Screenshots go to .out/ux-docs-*.png.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4691
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
await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcdocfilter')
await page.waitForTimeout(500)
const visible = async (): Promise<number> =>
  page.locator('.bcdocs--wall [data-bc-doc]:not([hidden])').count()
const all = await visible()
check('the surface lists the project documents', all >= 10, String(all))
await page.screenshot({ path: '.out/ux-docs-01-all.png' })

/* source filter: only present sources are offered, with counts */
const chips = (await page.locator('.bcsrcchip').allTextContents()).map((t) =>
  t.replace(/\s+/g, ' ').trim(),
)
check('All is offered first, with a count', chips[0]?.startsWith('All') === true, chips.join(' | '))
check(
  'Google Drive, Uploaded, Generated and NotebookLM are offered because they are present',
  ['Drive', 'Uploaded', 'Generated', 'Notebook'].every((w) => chips.some((c) => c.startsWith(w))),
  chips.join(' | '),
)
check('a source with no documents is not offered', !chips.some((c) => c.startsWith('Notion')))
await page.locator('.bcsrcchip', { hasText: 'Drive' }).click()
await page.waitForTimeout(300)
const drive = await visible()
check('choosing Google Drive shows only Drive documents', drive === 2, String(drive))
check(
  'the chosen filter says it is pressed',
  (await page.locator('.bcsrcchip[aria-pressed="true"]').first().textContent())?.includes(
    'Drive',
  ) === true,
)
await page.screenshot({ path: '.out/ux-docs-02-drive.png' })
await page.locator('.bcsrcchip', { hasText: 'Generated' }).click()
await page.waitForTimeout(300)
check('choosing Generated shows only what the team made', (await visible()) === 1)
await page.locator('.bcsrcchip', { hasText: 'All' }).click()
await page.waitForTimeout(300)
check('All brings everything back', (await visible()) === all)

/* search filters in place and does not lose the caret */
await page.locator('[data-bc-docq]').click()
await page.keyboard.type('avatar')
await page.waitForTimeout(300)
const found = await visible()
check('searching narrows the list', found > 0 && found < all, String(found))
check(
  'typing did not take the focus away',
  (await page.evaluate(
    inPage(`return document.activeElement?.hasAttribute('data-bc-docq') === true`),
  )) as boolean,
)
await page.fill('[data-bc-docq]', 'zzzzqqq')
await page.waitForTimeout(300)
check('a search that matches nothing says so', await page.locator('[data-bc-docnone]').isVisible())
await page.fill('[data-bc-docq]', '')
await page.waitForTimeout(300)
check('clearing the search restores the list', (await visible()) === all)

/* kind filter */
await page.selectOption('[data-bc-doctype]', 'pdf')
await page.waitForTimeout(300)
const pdfs = await visible()
check('the kind filter narrows to PDFs', pdfs > 0 && pdfs < all, String(pdfs))
await page.selectOption('[data-bc-doctype]', 'all')
await page.waitForTimeout(300)

/* sort */
const modes = (await page.locator('[data-bc-docsort] option').allTextContents()).map((t) =>
  t.trim(),
)
check(
  'sort offers name, dates, size, type and source',
  ['Name', 'Date uploaded', 'Date modified', 'Size', 'Type', 'Source'].every((m) =>
    modes.includes(m),
  ),
  modes.join(','),
)
await page.selectOption('[data-bc-docsort]', 'name')
await page.waitForTimeout(300)
const titles = await page.locator('.bcdocs--wall .bcdoctitle').allTextContents()
const sorted = [...titles].sort((a, b) =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }),
)
check('sorting by name sorts by name', JSON.stringify(titles) === JSON.stringify(sorted))
await page.selectOption('[data-bc-docsort]', 'source')
await page.waitForTimeout(300)
check('sorting by source does not lose or duplicate anything', (await visible()) === all)

/* indicators */
const marks = await page.locator('.bcdocs--wall .bcdocsrc').count()
check('every document with a known source carries a small indicator', marks >= 8, String(marks))
const w = (await page.evaluate(
  inPage(
    `const m = document.querySelector('.bcdocs--wall .bcdocsrc'); const r = m.getBoundingClientRect(); return [r.width, r.height]`,
  ),
)) as number[]
check(
  'the indicator is small (about twenty pixels)',
  (w[0] ?? 99) <= 24 && (w[1] ?? 99) <= 24,
  JSON.stringify(w),
)

/* list view */
await page.locator('[data-bc-docview="list"]').click()
await page.waitForTimeout(300)
check(
  'the list view shows the same indicators',
  (await page.locator('.bclist .bcdocsrc').count()) >= 8,
)
await page.screenshot({ path: '.out/ux-docs-03-list.png' })
await page.locator('[data-bc-docview="wall"]').click()
await page.waitForTimeout(200)

/* the viewer */
await page
  .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Customer research report' })
  .locator('[data-bc-doc-open]')
  .click()
await page.waitForSelector('.bcdocgrid')
await page.waitForTimeout(500)
check(
  'pressing a document opens it here, not a new tab',
  (await page.locator('.bcdocgrid').count()) === 1,
)
const facts = (await page.locator('.bcfact dt').allTextContents()).join('|')
check(
  'the viewer shows its source and size',
  facts.includes('Source') && facts.includes('Size'),
  facts,
)
check(
  'a Drive document offers Open source',
  (await page.locator('[data-bc-opensource]').count()) === 1,
)
check(
  'an external document offers an explicit Import',
  (await page.locator('[data-bc-docimport]').count()) === 1,
)
await page.screenshot({ path: '.out/ux-docs-04-viewer.png' })
await page.goBack()
await page.waitForTimeout(400)

check('no page errors', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
