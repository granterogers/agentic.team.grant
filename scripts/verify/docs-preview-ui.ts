/*
 * AN EXTERNAL DOCUMENT READ ON DEMAND, DRIVEN IN A REAL BROWSER (0990).
 *   npx tsx scripts/verify/docs-preview-ui.ts
 * The gateway is STUBBED (nothing here reaches Supabase or Google). Every state of the preview contract is drawn at 1440
 * and 390: loading, ready (text, PDF, image), failed (retryable and not), unsupported (a format; a disconnected source),
 * stale, a refetch notice, and an imported copy; plus the thumbnail the viewer keeps on the device. Screenshots go to
 * .out/ux-preview-*.png and are meant to be OPENED, not trusted.
 */
import { readFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4693
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
const PDF = await readFile('web/studio/samples/journey.pdf')
const PNG = await readFile('web/studio/samples/venue.png')
const SLUG = 'legacy-coaching-course'

const item = (o: Record<string, unknown>): Record<string, unknown> => ({
  source: 'drive',
  connector: 'drive',
  origin: 'Google Drive',
  mime: '',
  size_bytes: 20480,
  words: 4000,
  added_at: '2026-10-01T10:00:00Z',
  modified_at: '2026-10-01T09:00:00Z',
  imported: false,
  import_available: true,
  import_state: 'none',
  has_file: false,
  version_count: 1,
  current_version: 1,
  also_in: [],
  tags: [],
  duplicates: [],
  ...o,
})
const docs = [
  item({ id: 'pv-text', title: 'Q3 pricing doc', external_ref: 'f-text', kind: 'google-doc' }),
  item({
    id: 'pv-pdf',
    title: 'Board pack.pdf',
    external_ref: 'f-pdf',
    mime: 'application/pdf',
    kind: 'pdf',
  }),
  item({ id: 'pv-img', title: 'Site photo.png', external_ref: 'f-img', mime: 'image/png' }),
  item({ id: 'pv-zip', title: 'Archive.zip', external_ref: 'f-zip', mime: 'application/zip' }),
  item({ id: 'pv-403', title: 'Contract no access', external_ref: 'f-403' }),
  item({ id: 'pv-flaky', title: 'Flaky rate limited doc', external_ref: 'f-flaky' }),
  item({ id: 'pv-stale', title: 'Older than the source', external_ref: 'f-stale' }),
  item({ id: 'pv-fresh', title: 'Read again after a change', external_ref: 'f-fresh' }),
  item({ id: 'pv-off', title: 'Switched off source doc', external_ref: 'f-off' }),
  item({ id: 'pv-slow', title: 'Slow to read', external_ref: 'f-slow' }),
  item({
    id: 'pv-old',
    title: 'Picture from an older version',
    external_ref: 'f-old',
    mime: 'application/pdf',
    modified_at: '2026-10-04T09:00:00Z',
  }),
  item({
    id: 'pv-copy',
    title: 'Imported plan',
    source: 'upload',
    connector: null,
    origin: 'Yours',
    imported: true,
    import_available: false,
    import_state: 'imported',
    has_file: false,
    thumbnail: { available: true, kind: 'excerpt', excerpt: 'Imported words.' },
  }),
]

const ready = (
  kind: string,
  payload: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  state: 'ready',
  kind,
  mode: 'on_demand',
  payload,
  alternatives: ['open_source', 'import'],
  source: {
    connector: 'drive',
    url: 'https://drive.google.com/file/d/x/view',
    modified: '2026-10-01T09:00:00.000Z',
  },
  cache: {
    fetched_at: '2026-10-05T10:00:00Z',
    source_modified_time: '2026-10-01T09:00:00.000Z',
    refetched: true,
    was_stale: false,
  },
  ...extra,
})
const SRC = {
  connector: 'drive',
  url: 'https://drive.google.com/file/d/x/view',
  modified: '2026-10-01T09:00:00.000Z',
}
const answers: Record<string, (n: number) => Record<string, unknown>> = {
  'pv-text': () =>
    ready('text', {
      type: 'text',
      text: 'Pricing for the autumn cohort.\n\nPlans start at 40 pounds a month, with three tiers.\nOnboarding takes two weeks.',
      format: 'plain',
      truncated: false,
      chars: 120,
    }),
  'pv-pdf': () =>
    ready('pdf', {
      type: 'stream',
      mime: 'application/pdf',
      size: PDF.byteLength,
      name: 'Board pack.pdf',
    }),
  'pv-img': () =>
    ready('image', {
      type: 'stream',
      mime: 'image/png',
      size: PNG.byteLength,
      name: 'Site photo.png',
    }),
  'pv-old': () =>
    ready(
      'pdf',
      { type: 'stream', mime: 'application/pdf', size: PDF.byteLength, name: 'Older.pdf' },
      { source: { ...SRC, modified: '2026-10-04T09:00:00.000Z' } },
    ),
  'pv-zip': () => ({
    state: 'unsupported',
    reason_code: 'unsupported_format',
    reason: 'Team HQ cannot show a archive here. Open it in Drive, or import it to keep a copy.',
    alternatives: ['open_source', 'import'],
    source: SRC,
  }),
  'pv-403': () => ({
    state: 'failed',
    reason_code: 'forbidden',
    reason: 'Drive will not let the connected Google account read this file. <b id="pwned">x</b>',
    retryable: false,
    alternatives: ['open_source', 'import'],
    source: SRC,
  }),
  'pv-flaky': (n) =>
    n === 1
      ? {
          state: 'failed',
          reason_code: 'rate_limited',
          reason: 'Drive is asking Team HQ to slow down. Try again in a minute.',
          retryable: true,
          alternatives: ['retry', 'open_source', 'import'],
          source: SRC,
        }
      : ready('text', {
          type: 'text',
          text: 'Back after a retry. The second read worked.',
          format: 'plain',
          truncated: false,
          chars: 44,
        }),
  'pv-stale': () => ({
    state: 'stale',
    kind: 'text',
    mode: 'on_demand',
    reason:
      'Drive had a problem answering (503). Try again shortly. Showing what Team HQ read last time.',
    reason_code: 'unavailable',
    retryable: true,
    alternatives: ['retry', 'open_source', 'import'],
    payload: {
      type: 'text',
      text: 'The last text Team HQ read, before Drive stopped answering.',
      format: 'plain',
      truncated: false,
      chars: 58,
    },
    source: SRC,
  }),
  'pv-fresh': () =>
    ready(
      'text',
      {
        type: 'text',
        text: 'The words after the change.',
        format: 'plain',
        truncated: false,
        chars: 27,
      },
      {
        notice: 'Drive changed this file since Team HQ last read it, so it was read again.',
        cache: {
          fetched_at: '2026-10-05T10:00:00Z',
          source_modified_time: '2026-10-04T09:00:00.000Z',
          refetched: true,
          was_stale: true,
        },
      },
    ),
  'pv-off': () => ({
    state: 'unsupported',
    reason_code: 'source_disconnected',
    reason:
      'This source is switched off for the project, so Team HQ does not read it or show what it had read. Switch the source back on, open it in Drive, or use an imported copy.',
    alternatives: ['open_source', 'reconnect'],
  }),
  'pv-slow': () =>
    ready('text', {
      type: 'text',
      text: 'Finally read.',
      format: 'plain',
      truncated: false,
      chars: 13,
    }),
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })

const drive = async (
  label: string,
  viewport: { width: number; height: number },
  touch: boolean,
): Promise<void> => {
  const ctx = await browser.newContext({
    viewport,
    ...(touch ? { hasTouch: true, isMobile: true } : {}),
  })
  const page: Page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const previews: Record<string, number> = {}
  const streams: string[] = []
  const posts: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('hq.token', 'stub-token-for-test')
  })
  await page.route('**/*', async (route) => {
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
      const body = JSON.parse(route.request().postData() ?? '{}') as { action: string }
      posts.push(body.action)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({
          result: {
            ok: true,
            state: 'pending',
            note: 'Requested. Team HQ is fetching the file from Drive now; the copy is made when it arrives.',
          },
        }),
      })
    }
    const section = parsed.searchParams.get('section') ?? ''
    const id = parsed.searchParams.get('id') ?? ''
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({ data }),
      })
    if (section === 'project_documents') {
      return json({ documents: String(parsed.searchParams.get('slug')) === SLUG ? docs : [] })
    }
    if (section === 'document_preview') {
      previews[id] = (previews[id] ?? 0) + 1
      if (id === 'pv-slow') await new Promise((r) => setTimeout(r, 1400))
      return json(
        (
          answers[id] ??
          (() => ({ state: 'failed', reason: 'no stub', retryable: false, alternatives: [] }))
        )(previews[id] ?? 1),
      )
    }
    if (section === 'document_preview_file') {
      streams.push(id)
      return route.fulfill({
        status: 200,
        headers: { ...headers, 'content-type': id === 'pv-img' ? 'image/png' : 'application/pdf' },
        body: id === 'pv-img' ? PNG : PDF,
      })
    }
    if (section === 'document')
      return json({
        id,
        title: 'Imported plan',
        mime_type: 'text/plain',
        content: 'Imported words, held by Team HQ.',
        url: '',
      })
    if (section === 'document_versions') return json({ versions: [] })
    if (section === 'studio')
      return json({
        generated_at: new Date().toISOString(),
        crew: [{ slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' }],
        projects: [
          {
            slug: SLUG,
            name: 'Legacy Coaching Course',
            purpose: 'A made-up project.',
            tasks: [],
            documents: [],
            contacts: [],
            sources: [],
            activity: [],
            waiting: [],
            modules: [],
            requests: [],
            layout_board: null,
          },
        ],
      })
    if (section === 'layout') return json({ panels: null, rev: 0, now: Date.now() })
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ error: 'stub' }),
    })
  })
  const wall = async (): Promise<void> => {
    await page.goto(url(`/p/${SLUG}/documents`), { waitUntil: 'domcontentloaded' })
    await page
      .waitForSelector('.bcdocs--wall [data-bc-doc]', { timeout: 15000 })
      .catch(async (e) => {
        await page.screenshot({ path: `.out/ux-preview-wall-missing-${label}.png` })
        console.log(await page.evaluate(inPage('return document.body.innerText.slice(0, 400)')))
        throw e
      })
    await page.waitForTimeout(500)
  }
  const open = async (title: string): Promise<void> => {
    await page
      .locator('.bcdocs--wall [data-bc-doc]', { hasText: title })
      .locator('[data-bc-doc-open]')
      .first()
      .click()
    await page.waitForSelector('.bcdocgrid')
  }
  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(550) // let the viewer finish growing out of its tile before judging it
    await page.screenshot({ path: `.out/ux-preview-${name}-${label}.png` })
  }
  const state = (): ReturnType<Page['locator']> =>
    page.locator('.bcdocpreview [data-bc-pvstate]').first()
  const overflow = async (): Promise<boolean> =>
    (await page.evaluate(
      inPage('return document.documentElement.scrollWidth <= window.innerWidth + 1'),
    )) as boolean

  page.on('console', (m) => {
    if (m.text().startsWith('warmThumb')) console.log('PAGE', m.text())
  })
  await wall()
  // A kept thumbnail for a document whose source has since changed: it must NOT be drawn.
  await page.evaluate(
    inPage(
      `const k = 'hq.docthumb.pv-old.' + String(Date.parse('2026-09-01T09:00:00Z')); localStorage.setItem(k, 'data:image/jpeg;base64,/9j/4AAQ'); localStorage.setItem('hq.docthumbs.index', JSON.stringify([k])); return true`,
    ),
  )

  // ---- ready: a Google Doc as text, with the one quiet line
  await open('Q3 pricing doc')
  await page.waitForSelector('.bcdocpreview .bcdoctext')
  const line = ((await page.locator('[data-bc-pvline]').textContent()) ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  check(
    `[${label}] a Drive document says it is read on demand and not copied`,
    line === 'Read from Google Drive on demand · not copied to Team HQ',
    line,
  )
  check(
    `[${label}] the text is shown, as text`,
    ((await page.locator('.bcdoctext').textContent()) ?? '').includes('Plans start at 40 pounds'),
  )
  check(`[${label}] no import was started by previewing`, !posts.includes('document_import'))
  check(
    `[${label}] a ready preview offers Import in the header, and it is not pressed`,
    (await page.locator('[data-bc-docimport]').count()) === 1,
  )
  check(`[${label}] the page does not scroll sideways`, await overflow())
  await shot('1-ready-text')

  // ---- loading is a visible state
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await open('Slow to read')
  await page.waitForSelector('[data-bc-pvstate="loading"]', { timeout: 1500 })
  const loadingText = ((await state().textContent()) ?? '').replace(/\s+/g, ' ')
  check(
    `[${label}] while Drive is read, the viewer says so and that nothing is copied`,
    /Reading from Google Drive/.test(loadingText) && /Nothing is being copied/.test(loadingText),
    loadingText,
  )
  check(
    `[${label}] and marks the region busy`,
    (await page.locator('.bcdocpreview').getAttribute('aria-busy')) === 'true',
  )
  await shot('2-loading')
  await page.waitForSelector('.bcdoctext')
  check(
    `[${label}] the loading state gives way to the content`,
    ((await page.locator('.bcdoctext').textContent()) ?? '').includes('Finally read'),
  )

  // ---- failed, not retryable
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await open('Contract no access')
  await page.waitForSelector('[data-bc-pvstate="failed"]')
  const f403 = ((await state().textContent()) ?? '').replace(/\s+/g, ' ')
  check(
    `[${label}] a refusal is shown with its reason`,
    f403.includes('Drive will not let the connected Google account read this file'),
    f403,
  )
  check(
    `[${label}] CONTROL: a reason is text, never markup`,
    (await page.locator('#pwned').count()) === 0 && f403.includes('<b id="pwned">'),
    f403,
  )
  check(
    `[${label}] and offers no Retry, because retrying cannot help`,
    (await page.locator('[data-bc-pvretry]').count()) === 0,
  )
  check(
    `[${label}] but offers Open source as a real link`,
    (await page.locator('a[data-bc-pvopen]').getAttribute('href')) ===
      'https://drive.google.com/file/d/x/view',
  )
  await shot('3-failed-final')

  // ---- failed, retryable, then retried
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await open('Flaky rate limited')
  await page.waitForSelector('[data-bc-pvstate="failed"]')
  check(
    `[${label}] a rate limit is failed WITH a Try again press`,
    (await page.locator('[data-bc-pvretry]').count()) === 1,
  )
  if (touch) {
    // the viewer grows out of its tile (a transform): measure once it has settled, not mid-flight
    await page.waitForTimeout(600)
    const box = await page.locator('[data-bc-pvretry]').boundingBox()
    check(
      `[${label}] the press is a 44px touch target`,
      (box?.height ?? 0) >= 44 && (box?.width ?? 0) >= 44,
      JSON.stringify(box),
    )
  }
  await shot('4-failed-retry')
  await page.locator('[data-bc-pvretry]').click()
  await page.waitForSelector('.bcdoctext')
  check(
    `[${label}] pressing Try again asks the gateway again and shows the result`,
    previews['pv-flaky'] === 2 &&
      ((await page.locator('.bcdoctext').textContent()) ?? '').includes('second read worked'),
  )

  // ---- unsupported: a format
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await open('Archive.zip')
  await page.waitForSelector('[data-bc-pvstate="unsupported"]')
  const un = ((await state().textContent()) ?? '').replace(/\s+/g, ' ')
  check(
    `[${label}] an unsupported format says so honestly, with Open source and Import`,
    un.includes('cannot show this here') &&
      (await page.locator('a[data-bc-pvopen]').count()) === 1 &&
      (await page.locator('[data-bc-pvimport]').count()) === 1,
    un,
  )
  await shot('5-unsupported')
  const before = posts.length
  await page.locator('[data-bc-pvimport]').click()
  await page.waitForTimeout(400)
  check(
    `[${label}] Import from there is the same explicit press (one document_import, with the document id)`,
    posts.length === before + 1 && posts[posts.length - 1] === 'document_import',
  )

  // ---- unsupported: a disconnected source
  await page.goto(url(`/p/${SLUG}/documents`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await open('Switched off source')
  await page.waitForSelector('[data-bc-pvstate="unsupported"]')
  const off = ((await state().textContent()) ?? '').replace(/\s+/g, ' ')
  check(
    `[${label}] a switched-off source is said to be switched off, with no cached text`,
    off.includes('This source is switched off') && (await page.locator('.bcdoctext').count()) === 0,
    off,
  )
  check(
    `[${label}] and offers no Import of what it may not read`,
    (await page.locator('[data-bc-pvimport]').count()) === 0,
  )
  check(
    `[${label}] and the header no longer offers Import or claims it is being read`,
    (await page
      .locator('[data-bc-docimport]')
      .evaluate((b) => (b as unknown as { hidden: boolean }).hidden)) === true &&
      ((await page.locator('[data-bc-pvline]').textContent()) ?? '').startsWith(
        'Source switched off',
      ),
  )
  await shot('6-disconnected')

  // ---- stale
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await open('Older than the source')
  await page.waitForSelector('[data-bc-pvstate="stale"]')
  const st = ((await page.locator('.bcdocpreview').textContent()) ?? '').replace(/\s+/g, ' ')
  check(
    `[${label}] a stale preview says why ABOVE the content and still shows it`,
    st.includes('Showing what Team HQ read last time') && st.includes('The last text Team HQ read'),
    st,
  )
  check(
    `[${label}] and offers Try again`,
    (await page.locator('.bcpvnotice [data-bc-pvretry]').count()) === 1,
  )
  await shot('7-stale')

  // ---- a refetch notice
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await open('Read again after a change')
  await page.waitForSelector('[data-bc-pvnotice]')
  check(
    `[${label}] a document that was read again because the source changed says so`,
    ((await page.locator('[data-bc-pvnotice]').textContent()) ?? '').includes('read again'),
  )
  await shot('8-refetched')

  // ---- PDF: streamed, rendered, and a small thumbnail kept
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  // The wall now makes a first-page picture itself for an unopened PDF, read through the same authenticated call.
  await page
    .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Board pack' })
    .locator('img.realpage')
    .waitFor({ timeout: 8000 })
    .catch(() => undefined)
  check(
    `[${label}] a PDF tile nobody opened gets a real first page, made through the gateway (no public URL)`,
    (await page
      .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Board pack' })
      .locator('img.realpage')
      .count()) === 1 && streams.includes('pv-pdf'),
  )
  await open('Board pack')
  await page.waitForSelector('.bcdocpages img.bcdocpage', { timeout: 15000 })
  check(
    `[${label}] a PDF is fetched through the gateway and its pages are drawn`,
    streams.includes('pv-pdf') && (await page.locator('.bcdocpages img.bcdocpage').count()) >= 1,
  )
  await page.waitForTimeout(700)
  const kept = (await page.evaluate(
    inPage(
      `return Object.keys(localStorage).filter((k) => k.startsWith('hq.docthumb.pv-pdf.')).map((k) => localStorage.getItem(k).length)`,
    ),
  )) as number[]
  check(
    `[${label}] a small thumbnail of page one was kept on this device (not on the server)`,
    kept.length === 1 && (kept[0] ?? 0) > 500 && (kept[0] ?? 0) < 90000,
    JSON.stringify(kept),
  )
  await shot('9-pdf')
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  await page.waitForTimeout(800)
  check(
    `[${label}] back on the wall, the PDF tile shows the real first page`,
    (await page
      .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Board pack' })
      .locator('img.realpage')
      .count()) === 1,
  )
  // The changed source may now get a FRESH picture of its own (warmed at the new modified time); what must never show is the old one.
  const oldSrcs = (await page
    .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Picture from an older version' })
    .locator('img.realpage')
    .evaluateAll((els) => els.map((e) => (e as unknown as { src: string }).src))) as string[]
  check(
    `[${label}] CONTROL: a tile whose source changed since the kept picture shows NO stale picture`,
    oldSrcs.every((x) => x !== 'data:image/jpeg;base64,/9j/4AAQ'),
    JSON.stringify(oldSrcs.map((x) => x.slice(0, 40))),
  )
  check(
    `[${label}] CONTROL: a tile never opened has no picture either`,
    (await page
      .locator('.bcdocs--wall [data-bc-doc]', { hasText: 'Q3 pricing doc' })
      .locator('img.realpage')
      .count()) === 0,
  )
  await shot('10-wall-thumbnail')

  // ---- image
  await open('Site photo')
  await page.waitForSelector('img.bcdocimage')
  await page.waitForTimeout(500)
  check(
    `[${label}] an image is streamed and shown`,
    streams.includes('pv-img') &&
      (await page
        .locator('img.bcdocimage')
        .evaluate((i) => (i as unknown as { naturalWidth: number }).naturalWidth)) > 0,
  )
  await shot('11-image')

  // ---- imported
  await page.goBack()
  await page.waitForSelector('.bcdocs--wall [data-bc-doc]')
  const beforeCopy = Object.keys(previews).length
  await open('Imported plan')
  await page.waitForSelector('[data-bc-pvline="imported"]')
  const imp = ((await page.locator('[data-bc-pvline]').textContent()) ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  check(
    `[${label}] an imported document is labelled as Team HQ's own copy`,
    imp.startsWith('Imported copy · kept in Team HQ'),
    imp,
  )
  await page.waitForSelector('.bcdoctext')
  check(
    `[${label}] and is shown from what Team HQ holds, with no preview request to the source`,
    ((await page.locator('.bcdoctext').textContent()) ?? '').includes(
      'Imported words, held by Team HQ.',
    ) && Object.keys(previews).length === beforeCopy,
  )
  check(
    `[${label}] and is not offered Import again`,
    (await page.locator('[data-bc-docimport]').count()) === 0,
  )
  await shot('12-imported')

  check(
    `[${label}] nothing was imported by any preview (the only import was the one pressed)`,
    posts.filter((a) => a === 'document_import').length === 1,
  )
  check(`[${label}] no script error on the page`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await drive('1440', { width: 1440, height: 900 }, false)
await drive('390', { width: 390, height: 844 }, true)
await browser.close()
server.close()
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
process.exit(fail === 0 ? 0 : 1)
