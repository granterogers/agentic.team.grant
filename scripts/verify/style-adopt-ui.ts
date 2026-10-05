/*
 * "Use this report's style for the project" in the document viewer, against a stubbed gateway (HQ-STYLE-013, 0970).
 *   npx tsx scripts/verify/style-adopt-ui.ts        (screenshots: .out/ux-style-adopt-*.png)
 *
 * Proves: the control is drawn only for a made report that has provenance; pressing sends style_adopt_from_document
 * with the project and the document and NO confirmation; a style already in place is asked about first (Keep sends
 * nothing, Replace sends p_confirm); a report with no recorded style says so; the page has no overflow at 1440 and 390.
 */
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4695
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
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const probe = await (await browser.newContext()).newPage()
await probe.goto(url('/'))
await probe.waitForTimeout(500)
const slug = (await probe.evaluate(
  `document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`,
)) as string

const item = (o: Record<string, unknown>): Record<string, unknown> => ({
  source: 'generated',
  connector: null,
  origin: 'made',
  mime: 'application/pdf',
  size_bytes: 20480,
  words: 0,
  added_at: '2026-10-04T10:00:00Z',
  modified_at: '2026-10-04T10:00:00Z',
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
  item({ id: 'm1', title: 'Made with a style', produced_by: 'Claire' }),
  item({ id: 'm2', title: 'Made before styles', produced_by: 'Claire' }),
  item({ id: 'm3', title: 'Made no provenance', produced_by: 'Claire' }),
  item({ id: 'u1', title: 'An upload', source: 'upload', origin: 'yours' }),
]
const provenance: Record<string, unknown> = {
  m1: { has_provenance: true, has_style_snapshot: true },
  m2: { has_provenance: true, has_style_snapshot: false },
  m3: { has_provenance: false },
  u1: { has_provenance: false },
}

let mode: 'free' | 'has-style' | 'no-snapshot' = 'free'
const posts: { action?: string; args?: Record<string, unknown> }[] = []
const errors: string[] = []

const open = async (page: Page, title: string): Promise<void> => {
  await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await page
    .locator('.bcdocs--wall [data-bc-doc]', { hasText: title })
    .locator('[data-bc-doc-open]')
    .click()
  await page.waitForSelector('.bcdocgrid')
  await page.waitForTimeout(500)
}

for (const [label, viewport] of [
  ['1440', { height: 900, width: 1440 }],
  ['390', { height: 844, width: 390 }],
] as const) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    errors.push(e.message)
  })
  await page.addInitScript(() => localStorage.setItem('hq.token', 'stub-token-for-test'))
  await page.route('**/*', async (route) => {
    const u = route.request().url()
    if (!u.includes('hq-api')) return route.continue()
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    }
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      })
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (route.request().method() === 'POST') {
      const b = JSON.parse(route.request().postData() ?? '{}') as {
        action: string
        args: Record<string, unknown>
      }
      posts.push(b)
      if (b.action !== 'style_adopt_from_document') return json({ result: { ok: true } })
      if (mode === 'no-snapshot')
        return json({
          result: {
            error:
              'This report was made before its style was recorded, so there is no style to save from it. Nothing was changed.',
          },
        })
      if (mode === 'has-style' && b.args.p_confirm !== true)
        return json({
          result: {
            ok: false,
            needs_confirmation: true,
            replaces: ['palette', 'tone'],
            message:
              "This project already has a style of its own. Saving this report's style replaces it. Nothing has been changed yet.",
          },
        })
      return json({ result: { ok: true, adopted: true, dropped: [] } })
    }
    const q = new URL(u).searchParams
    const section = q.get('section') ?? ''
    if (section === 'project_documents') return json({ data: { documents: docs } })
    if (section === 'document_provenance')
      return json({ data: provenance[q.get('id') ?? ''] ?? { has_provenance: false } })
    return json({ error: 'stub' }, 500)
  })

  // ---- the control is drawn only where it can work
  await open(page, 'Made with a style')
  check(
    `[${label}] a made report with provenance offers the control`,
    (await page.locator('[data-bc-docstyleuse]').count()) === 1,
  )
  await page.screenshot({ path: `.out/ux-style-adopt-${label}-1-offer.png` })
  await open(page, 'Made no provenance')
  check(
    `[${label}] a made report with NO provenance does not`,
    (await page.locator('[data-bc-docstyleuse]').count()) === 0,
  )
  await open(page, 'An upload')
  check(
    `[${label}] an upload does not`,
    (await page.locator('[data-bc-docstyleuse]').count()) === 0,
  )

  // ---- a project with no style of its own: one press, no confirmation sent
  mode = 'free'
  posts.length = 0
  await open(page, 'Made with a style')
  await page.locator('[data-bc-docstyleuse]').click()
  await page.waitForTimeout(400)
  const first = posts.find((p) => p.action === 'style_adopt_from_document')
  check(
    `[${label}] pressing sends style_adopt_from_document with the project and the document`,
    first?.args?.p_document === 'm1' &&
      typeof first?.args?.p_slug === 'string' &&
      first.args.p_slug !== '',
    JSON.stringify(first),
  )
  check(
    `[${label}] and does not send a confirmation unasked`,
    first !== undefined && !('p_confirm' in (first.args ?? {})),
  )
  check(
    `[${label}] it says it is done`,
    ((await page.locator('[data-bc-docstylesay]').textContent()) ?? '').includes('Done.'),
  )
  await page.screenshot({ path: `.out/ux-style-adopt-${label}-2-done.png` })

  // ---- a project that already has a style: asked first
  mode = 'has-style'
  posts.length = 0
  await open(page, 'Made with a style')
  await page.locator('[data-bc-docstyleuse]').click()
  await page.waitForSelector('[data-bc-docstylereplace]')
  check(
    `[${label}] a style already in place is asked about, in words`,
    ((await page.locator('[data-bc-docstyleask]').textContent()) ?? '').includes('replaces it'),
  )
  check(
    `[${label}] and nothing was confirmed yet`,
    posts
      .filter((p) => p.action === 'style_adopt_from_document')
      .every((p) => p.args?.p_confirm !== true),
  )
  await page.screenshot({ path: `.out/ux-style-adopt-${label}-3-confirm.png` })
  await page.locator('[data-bc-docstylekeep]').click()
  check(
    `[${label}] Keep sends nothing more and says nothing was changed`,
    posts.filter((p) => p.action === 'style_adopt_from_document').length === 1 &&
      ((await page.locator('[data-bc-docstylesay]').textContent()) ?? '').includes(
        'Nothing was changed',
      ),
  )
  await page.locator('[data-bc-docstyleuse]').click()
  await page.waitForSelector('[data-bc-docstylereplace]')
  await page.locator('[data-bc-docstylereplace]').click()
  await page.waitForTimeout(400)
  const confirmed = posts.filter((p) => p.action === 'style_adopt_from_document').at(-1)
  check(
    `[${label}] Replace sends p_confirm: true`,
    confirmed?.args?.p_confirm === true,
    JSON.stringify(confirmed),
  )

  // ---- a report with no recorded style
  mode = 'no-snapshot'
  posts.length = 0
  await open(page, 'Made before styles')
  check(
    `[${label}] a report with provenance but no recorded style still offers the press, and says why`,
    ((await page.locator('.bcdocstyle .bcpmeta').first().textContent()) ?? '').includes(
      'before its style was recorded',
    ),
  )
  await page.locator('[data-bc-docstyleuse]').click()
  await page.waitForTimeout(400)
  check(
    `[${label}] the press says so and offers no confirmation`,
    ((await page.locator('[data-bc-docstylesay]').textContent()) ?? '').includes(
      'no style to save',
    ) && (await page.locator('[data-bc-docstylereplace]').count()) === 0,
  )
  await page.screenshot({ path: `.out/ux-style-adopt-${label}-4-nosnapshot.png` })

  const overflow = await page.evaluate(
    `document.documentElement.scrollWidth > document.documentElement.clientWidth`,
  )
  check(`[${label}] no sideways overflow`, overflow === false)
  const small = (await page.evaluate(
    `[...document.querySelectorAll('.bcdocstyle button')].filter(b => b.getBoundingClientRect().height < 28 && b.offsetParent).length`,
  )) as number
  check(`[${label}] the buttons are not tiny`, small === 0)
  await ctx.close()
}
check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
