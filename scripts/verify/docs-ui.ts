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

/* an image previews in place */
await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcdocfilter')
await page.waitForTimeout(400)
await page
  .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'The venue' })
  .locator('[data-bc-doc-open]')
  .click()
await page.waitForSelector('.bcdocgrid')
await page.waitForTimeout(800)
check(
  'an image document previews as the image itself',
  (await page.locator('.bcdocimage').count()) === 1,
)
await page.screenshot({ path: '.out/ux-docs-07-image.png' })
await page.goBack()
await page.waitForTimeout(300)

/* --- the office's own list, versions and import (stubbed gateway) -------- */
const calls: { action?: string; args?: Record<string, unknown>; section?: string }[] = []
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p2 = await ctx2.newPage()
const err2: string[] = []
p2.on('pageerror', (e) => {
  err2.push(e.message)
})
await p2.addInitScript(() => {
  localStorage.setItem('hq.token', 'stub-token-for-test')
})
const item = (o: Record<string, unknown>): Record<string, unknown> => ({
  source: 'upload',
  connector: null,
  origin: 'yours',
  mime: 'application/pdf',
  size_bytes: 20480,
  words: 4000,
  added_at: '2026-10-01T10:00:00Z',
  modified_at: '2026-10-02T10:00:00Z',
  imported: false,
  import_available: false,
  import_state: 'none',
  version_count: 1,
  current_version: 1,
  also_in: [],
  tags: [],
  duplicates: [],
  ...o,
})
const docs = [
  item({
    id: 'd1',
    title: 'Office Drive report',
    source: 'drive',
    connector: 'drive',
    external_ref: 'abc',
    import_available: true,
    version_count: 3,
    current_version: 3,
    current_state: 'approved',
    pending_version: { id: 'd1p', state: 'draft', version: 4 },
    kind: 'google-doc',
  }),
  item({ id: 'd2', title: 'Office upload', source: 'upload' }),
  item({
    id: 'd3',
    title: 'Drive plan, read not copied',
    source: 'drive',
    connector: 'drive',
    external_ref: 'plan1',
    mime: '',
    import_available: true,
    thumbnail: {
      available: true,
      kind: 'excerpt',
      derived_from: 'extracted_text',
      excerpt: 'The Q3 plan. Customers want faster onboarding. <b>Pricing</b> is clear.',
    },
  }),
  item({
    id: 'd4',
    title: 'Drive contract, fetch failed',
    source: 'drive',
    connector: 'drive',
    external_ref: 'ctr1',
    import_available: true,
    import_state: 'pending',
    import_error: 'I could not read that PDF - drive 404: File not found',
  }),
]
await p2.route('**/*', async (route) => {
  const u = route.request().url()
  if (!u.includes('hq-api')) return route.continue()
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const parsed = new URL(u)
  if (route.request().method() === 'POST') {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      action: string
      args: Record<string, unknown>
    }
    calls.push({ action: body.action, args: body.args })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ result: { ok: true, state: 'pending', note: 'Requested.' } }),
    })
  }
  const section = parsed.searchParams.get('section') ?? ''
  calls.push({ section, args: Object.fromEntries(parsed.searchParams) })
  if (section === 'project_documents')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ data: { documents: docs } }),
    })
  if (section === 'document_versions')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({
        data: {
          versions: [
            {
              document_id: 'd1a',
              version: 1,
              is_current: false,
              state: 'archived',
              can_roll_back_to: true,
            },
            { document_id: 'd1', version: 3, is_current: true, state: 'approved' },
            {
              document_id: 'd1b',
              version: 2,
              is_current: false,
              state: 'archived',
              can_roll_back_to: true,
            },
            { document_id: 'd1p', version: 4, is_current: false, is_pending: true, state: 'draft' },
            {
              document_id: 'd1e',
              version: null,
              is_current: false,
              is_earlier_draft: true,
              state: 'archived',
            },
          ],
        },
      }),
    })
  return route.fulfill({
    status: 500,
    contentType: 'application/json',
    headers,
    body: JSON.stringify({ error: 'stub' }),
  })
})
await p2.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(1500)
const asked = calls.find((c) => c.section === 'project_documents')
check(
  'signed in, the page asks the office for the unified list for this project',
  asked !== undefined && String(asked.args?.slug ?? '') !== '',
  JSON.stringify(asked),
)
check(
  'and shows the office list instead of the prototype documents',
  (await p2.locator('.bcdocs--wall [data-bc-doc]').count()) === 4,
  String(await p2.locator('.bcdocs--wall [data-bc-doc]').count()),
)
const planTile = p2.locator('.bcdocs--wall [data-bc-doc]', {
  hasText: 'Drive plan, read not copied',
})
check(
  'a tile shows the first words of the cached excerpt instead of invented lines',
  (await planTile.locator('.bcxpagetext').textContent())?.startsWith(
    'The Q3 plan. Customers want faster onboarding.',
  ) === true && (await planTile.locator('.bcpline').count()) === 0,
)
check(
  'CONTROL: the excerpt is text, never markup (a tag in it is shown, not made)',
  (await planTile.locator('.bcxpagetext b').count()) === 0 &&
    ((await planTile.locator('.bcxpagetext').textContent()) ?? '').includes('<b>Pricing</b>'),
)
check(
  'CONTROL: a document with no excerpt keeps the drawn page',
  (await p2
    .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Office upload' })
    .locator('.bcxpagetext')
    .count()) === 0,
)
await p2.screenshot({ path: '.out/ux-docs-wall-excerpt-1440.png' })
check(
  'the Documents list keeps the approved document and says "v3 Approved · v4 Draft" on its tile',
  (
    await p2
      .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Office Drive report' })
      .locator('.bcvchip--draft')
      .textContent()
  )?.trim() === 'v3 Approved · v4 Draft',
)
await p2.screenshot({ path: '.out/ux-docs-wall-draft-chip.png' })
await p2
  .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Office Drive report' })
  .locator('[data-bc-doc-open]')
  .click()
await p2.waitForSelector('.bcdocgrid')
await p2.waitForTimeout(800)
check(
  'a document with history lists its versions, newest first',
  (await p2.locator('.bcversion .bcvn').allTextContents()).join(',') === 'v4,v3,v2,v1,·',
  (await p2.locator('.bcversion .bcvn').allTextContents()).join(','),
)
check(
  'each version says its own state: v3 Approved is current, v4 is a Draft, the replaced draft is "Earlier draft"',
  (await p2.locator('.bcversion .bcvstate').allTextContents()).join(',') ===
    'Draft,Approved,Replaced,Replaced,Earlier draft' &&
    (await p2.locator('.bcversion.is-current .bcvstate').textContent()) === 'Approved' &&
    (await p2.locator('.bcversion.is-pending').count()) === 1,
  (await p2.locator('.bcversion .bcvstate').allTextContents()).join(','),
)
check(
  'the record says "v3 Approved · v4 Draft" - the approved version stays visible beside the draft',
  (await p2.locator('.bcfact', { hasText: 'Version' }).locator('dd').textContent())?.includes(
    'v3 Approved · v4 Draft',
  ) === true,
)
await p2.screenshot({ path: '.out/ux-docs-versions-draft.png' })
await p2.locator('[data-bc-docapprove]').click()
await p2.waitForTimeout(400)
const appr = calls.find((c) => c.action === 'document_approve')
check(
  'Approve this version sends document_approve for the DRAFT only on the press',
  appr !== undefined && appr.args?.p_document === 'd1p',
  JSON.stringify(appr),
)
await p2.locator('[data-bc-docimport]').click()
await p2.waitForTimeout(500)
const imp = calls.find((c) => c.action === 'document_import')
check(
  'Import sends document_import with p_document_id, only on the press',
  imp !== undefined && imp.args?.p_document_id === 'd1',
  JSON.stringify(imp),
)
await p2.waitForSelector('[data-bc-docrestore]')
await p2.locator('[data-bc-docrestore]').first().click()
await p2.waitForTimeout(400)
const rb = calls.find((c) => c.action === 'document_rollback')
check(
  'returning to a version sends document_rollback (a new version, nothing deleted)',
  rb !== undefined && typeof rb.args?.p_document_id === 'string',
  JSON.stringify(rb),
)
/* a requested import whose fetch failed says why and offers the press again */
await p2.goBack()
await p2.waitForSelector('.bcdocs--wall [data-bc-doc]')
await p2
  .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Drive contract, fetch failed' })
  .locator('[data-bc-doc-open]')
  .click()
await p2.waitForSelector('.bcdocgrid')
const recordHead = (
  (await p2.locator('.bcrecordhead', { hasText: 'Drive contract' }).textContent()) ?? ''
).replace(/\s+/g, ' ')
check(
  'a failed fetch is shown with its reason, not as a silent "requested"',
  recordHead.includes('could not fetch this file yet') &&
    recordHead.includes('drive 404: File not found'),
  recordHead,
)
check('and the press is offered again', (await p2.locator('[data-bc-docimport]').count()) === 1)
await p2.screenshot({ path: '.out/ux-docs-import-failed-1440.png' })
const before = calls.filter((c) => c.action === 'document_import').length
await p2.locator('[data-bc-docimport]').click()
await p2.waitForTimeout(400)
const retried = calls.filter((c) => c.action === 'document_import')
check(
  'pressing it sends document_import for that document again',
  retried.length === before + 1 && retried[retried.length - 1]?.args?.p_document_id === 'd4',
  JSON.stringify(retried),
)
/* the same list on a phone: the excerpt tile is there and nothing pushes the page sideways */
await p2.setViewportSize({ width: 390, height: 844 })
await p2.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
await p2.waitForSelector('.bcdocs--wall [data-bc-doc]')
await p2.waitForTimeout(600)
check(
  'on a 390px phone the excerpt tile still shows its words',
  ((await p2.locator('.bcxpagetext').first().textContent()) ?? '').startsWith('The Q3 plan.'),
)
const sideways = await p2.evaluate(
  inPage('return document.documentElement.scrollWidth - document.documentElement.clientWidth'),
)
check('and the phone page does not scroll sideways', Number(sideways) <= 0, String(sideways))
await p2.locator('.bcdocs--wall').scrollIntoViewIfNeeded()
await p2.locator('.bcxpagetext').first().scrollIntoViewIfNeeded()
await p2.screenshot({ path: '.out/ux-docs-wall-excerpt-390.png' })
await ctx2.close()
/* the saved web pages, on the Sources surface */
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p3 = await ctx3.newPage()
await p3.addInitScript(() => localStorage.setItem('hq.token', 'stub-token-for-test'))
const asked3: string[] = []
await p3.route('**/*', async (route) => {
  const u = route.request().url()
  if (!u.includes('hq-api')) return route.continue()
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const q = Object.fromEntries(new URL(u).searchParams)
  if (q.section === 'web_sources') {
    asked3.push(q.project ?? '')
    return route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          count: 1,
          pages: [
            {
              document_id: 'w1',
              url: 'https://example.com/pricing',
              title: 'Example pricing',
              kind: 'page',
              retrieved_at: '2026-10-03T10:00:00Z',
              agent: { slug: 'emma', name: 'Emma' },
              research_task: { job_id: 'j', label: 'competitor pricing' },
              found_via: { how: 'search', query: 'competitor pricing', rank: 2 },
              indexed: true,
              citations: { count: 2 },
              screenshot: { available: true },
            },
          ],
        },
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
await p3.goto(url(`${slug}/sources`), { waitUntil: 'domcontentloaded' })
await p3.waitForTimeout(1500)
check(
  "signed in, Sources asks the office for this project's saved web pages",
  asked3.length > 0 && asked3[0] !== '',
  asked3.join(','),
)
const web =
  (await p3
    .locator('.bcwebsrc')
    .textContent()
    .catch(() => '')) ?? ''
check(
  'each page shows where it came from, who read it and for what',
  web.includes('Example pricing') &&
    web.includes('Emma') &&
    web.includes('competitor pricing') &&
    web.includes('result 2'),
  web.replace(/\s+/g, ' '),
)
check('and how often a report cites it', web.includes('cited in 2 answers'))
check(
  'the link opens the page itself in a new tab, safely',
  (await p3.locator('.bcwebtitle').getAttribute('rel')) === 'noopener noreferrer',
)
await p3.screenshot({ path: '.out/ux-docs-06-websources.png' })
await ctx3.close()

check('no page errors from the office path', err2.length === 0, err2.join(' | '))

check('no page errors', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
