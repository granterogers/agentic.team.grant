/*
 * Export, ZIP backup and restore, in a real Chromium, against a mocked office. Nothing from production.
 *   npm run verify:archive-browser
 *
 * Local class: a static server over web/studio and a mocked gateway (page.route). The mocked answers are produced by the
 * REAL modules the gateway uses (src/portability/archive.ts and export-route.ts), so every byte the browser saves is the
 * byte the product would send. The gateway's own rules are tested in tests/gateway. Asserted at desktop and 390 x 844:
 *   A. the project JSON export downloads as the package it was given
 *   B. the archive downloads as a ZIP whose bytes are exactly the archive, and which carries the original file
 *   C. each of the four standard formats downloads as the bytes the renderer makes
 *   D. pressing the download button does NOT open the archive-the-project confirmation (the regression this found)
 *   E. a ZIP chosen in the restore control is sent as the same bytes, and a success moves to the restored project
 *   F. a refused restore shows the office's sentence, and nothing moves
 * Control, run by hand and recorded in the ledger: with the download button given the archive attribute again, B and D
 * go red at both sizes. The page was restored afterwards and this script is green on it.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { buildArchive, readZip } from '../../src/portability/archive.ts'
import { renderStandardExport } from '../../src/portability/export-route.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const b = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(b)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4796, '127.0.0.1', () => r()))

const ORIGIN = 'http://127.0.0.1:4796'
const SIGNIN = 'https://signin.test/functions/v1/signin'
const GATEWAY = 'https://gw.test/functions/v1/hq-api'
const PROJECT_ID = '6f1c2b8e-0000-4000-8000-0000000000aa'
const SLUG = 'harbour-plan'
const RESTORED_SLUG = 'harbour-plan-restored'
const EXPORTED_AT = '2026-10-14T09:00:00.000Z'
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
])
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const pkg = {
  format: 'ai-team-hq/project-package',
  format_version: 1,
  exported_at: EXPORTED_AT,
  project: {
    slug: SLUG,
    name: 'Harbour plan',
    brief: 'A brief long enough to read as the brief of a real project.',
  },
  documents: [
    {
      title: 'Floor plan',
      text: null,
      original: {
        mime_type: 'image/png',
        bytes: PNG.length,
        storage_path: `${PROJECT_ID}/upload/plan.png`,
      },
    },
  ],
  tasks: [],
}
const pkgWithOriginal = {
  ...pkg,
  documents: [
    {
      title: 'Floor plan',
      original: {
        mime_type: 'image/png',
        bytes: PNG.length,
        sha256: sha(PNG),
        archive_name: `files/${sha(PNG)}.png`,
      },
    },
  ],
}
const archive = await buildArchive(pkgWithOriginal, { slug: SLUG, exportedAt: EXPORTED_AT }, [
  { name: `files/${sha(PNG)}.png`, data: PNG },
])
const archiveBytes = archive.bytes
const emptyRecords = {
  project: SLUG,
  name: 'Harbour plan',
  zone: 'Europe/London',
  records: [] as unknown[],
}
const STANDARD: Record<string, { file: string; body: string; type: string }> = {}
// The page names each standard file as the project slug and its own stem (project-settings.js STANDARD_EXPORT_FILES).
const PAGE_NAMES: Record<string, string> = {
  vcard: 'contacts.vcf',
  ics: 'calendar.ics',
  csv: 'tasks.csv',
  json: 'tasks.json',
}
for (const format of ['vcard', 'ics', 'csv', 'json']) {
  const out = renderStandardExport(format, emptyRecords, { exportedAt: EXPORTED_AT })
  STANDARD[format] = {
    file: `${SLUG}-${PAGE_NAMES[format]}`,
    body: out.body,
    type: out.contentType,
  }
}
// A ZIP with a tampered original: the bytes of the file changed, so the manifest refuses it.
const tampered = Uint8Array.from(archiveBytes)
const at = Array.from({ length: tampered.length - PNG.length + 1 }, (_, i) => i).find((i) =>
  PNG.every((b, j) => tampered[i + j] === b),
)
if (at === undefined) throw new Error('fixture: the PNG is not in the archive')
tampered[at + 5] = (tampered[at + 5] ?? 0) ^ 0xff

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const session = JSON.stringify({
  access_token: 'writer-token-for-tests',
  refresh_token: 'refresh-for-tests',
  expires_at: Date.now() + 60 * 60 * 1000,
})
const studio = {
  data: {
    projects: [
      {
        id: PROJECT_ID,
        slug: SLUG,
        name: 'Harbour plan',
        brief: pkg.project.brief,
        status: 'active',
        documents: [],
        tasks: [],
        contacts: [],
        collections: [],
        sources: [],
        automations: [],
        conversation: [],
        calendar: [],
        activity: [],
        references: [],
        outputs: [],
      },
    ],
    crew: [],
    appearance: null,
    avatar_base: '',
  },
}

const browser = await chromium.launch()

async function openWriter(
  width: number,
  mobile: boolean,
  options: { tamperedDownload?: boolean } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    acceptDownloads: true,
    isMobile: mobile,
    hasTouch: mobile,
  })
  await context.addInitScript(
    ({ signin, gateway, sess }) => {
      const w = window as unknown as Record<string, string>
      w.HQ_SIGNIN = signin
      w.HQ_API = gateway
      if (localStorage.getItem('hq.session') === null) localStorage.setItem('hq.session', sess)
    },
    { signin: SIGNIN, gateway: GATEWAY, sess: session },
  )
  const restores: { body: Buffer; contentType: string }[] = []
  // Once a restore is accepted, the office holds the restored project, so the page it moves to can show it.
  let restoredNow = false
  await context.route(`${SIGNIN}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, said: 'not in this check' }),
    }),
  )
  await context.route(`${GATEWAY}*`, async (route) => {
    const url = new URL(route.request().url())
    const section = url.searchParams.get('section') ?? ''
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (section === 'studio') {
      const restored = {
        ...studio.data.projects[0],
        id: 'restored-id',
        slug: RESTORED_SLUG,
        name: 'Harbour plan (restored)',
      }
      return json(200, {
        data: {
          ...studio.data,
          projects: restoredNow ? [...studio.data.projects, restored] : studio.data.projects,
        },
      })
    }
    if (section === 'project_export') {
      return json(200, { data: pkgWithOriginal })
    }
    if (section === 'project_archive') {
      return route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: { 'content-disposition': `attachment; filename="${SLUG}-archive.zip"` },
        body: Buffer.from(archiveBytes),
      })
    }
    if (section === 'project_standard_export') {
      const s = STANDARD[url.searchParams.get('format') ?? ''] ?? STANDARD.json
      return route.fulfill({ status: 200, contentType: s.type, body: s.body })
    }
    if (section === 'project_restore' && route.request().method() === 'POST') {
      restores.push({
        body: Buffer.from(route.request().postDataBuffer() ?? Buffer.alloc(0)),
        contentType: route.request().headers()['content-type'] ?? '',
      })
      const refused = options.tamperedDownload === true
      if (refused)
        return json(400, {
          error: `the archive does not match its manifest: files/${sha(PNG)}.png`,
        })
      restoredNow = true
      return json(201, {
        data: { ok: true, already: false, slug: RESTORED_SLUG, project_id: 'new' },
      })
    }
    return json(404, { error: 'not in this check', section })
  })
  await context.route('https://**', (route) => route.abort())
  const page = await context.newPage()
  return { context, page, restores }
}

/*
  A press as the element itself receives it. Playwright refuses to click a control inside a scrolled settings pane that is
  not in the viewport, even with force; the page's handlers are attached to the element, so its click() is the press.
*/
const press = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => (el as HTMLElement).click())

async function openSettings(page: Page) {
  await page.goto(`${ORIGIN}/p/${SLUG}/settings`, { waitUntil: 'domcontentloaded' })
  await page
    .waitForFunction(() => document.querySelector('[data-setpane="project"]') !== null, null, {
      timeout: 10000,
    })
    .catch(() => undefined)
  await press(page, '[data-setpane="project"]').catch(() => undefined)
  await page
    .waitForFunction(() => document.querySelector('[data-export]') !== null, null, {
      timeout: 10000,
    })
    .catch(() => undefined)
}

for (const [label, width, mobile] of [
  ['desktop', 1440, false],
  ['phone', 390, true],
] as const) {
  // A-D. Downloads from the project settings.
  {
    const { context, page } = await openWriter(width, mobile)
    await openSettings(page)
    check(
      `${label}: the export buttons are drawn for a writer`,
      (await page.locator('[data-export]').count()) === 1,
    )

    const jsonDownload = page.waitForEvent('download', { timeout: 10000 })
    await press(page, '[data-export]')
    const dl = await jsonDownload
    const savedJson = await readFile((await dl.path()) ?? '')
    check(
      `${label}: A. the JSON export downloads as the package`,
      dl.suggestedFilename() === `${SLUG}.json` &&
        JSON.stringify(JSON.parse(savedJson.toString('utf8'))) === JSON.stringify(pkgWithOriginal),
      dl.suggestedFilename(),
    )

    // Found by its visible label, so the check presses what a person presses whatever attribute it carries.
    const zipDownload = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
    await press(page, 'button:has-text("Download archive (ZIP)")').catch(() => undefined)
    const zip = await zipDownload
    if (zip === null) {
      check(
        `${label}: B. pressing the archive download makes a download`,
        false,
        'no download arrived',
      )
    } else {
      const savedZip = await readFile((await zip.path()) ?? '')
      check(
        `${label}: B. the archive downloads as exactly the archive, named for the project`,
        zip.suggestedFilename() === `${SLUG}-archive.zip` && sha(savedZip) === sha(archiveBytes),
        `${zip.suggestedFilename()} ${savedZip.length} bytes`,
      )
      const carried = readZip(new Uint8Array(savedZip))
      check(
        `${label}: B2. the downloaded archive carries the original file, checked by its SHA-256`,
        carried.get(`files/${sha(PNG)}.png`) !== undefined &&
          sha(carried.get(`files/${sha(PNG)}.png`) ?? new Uint8Array()) === sha(PNG),
      )
    }

    // D. Pressing the download must not open Put it away's confirmation.
    await page.waitForTimeout(400)
    const confirmOpen = await page.locator('.stg-confirmbox').count()
    check(
      `${label}: D. the download button does not open the archive-the-project confirmation`,
      confirmOpen === 0,
      `confirmation count ${String(confirmOpen)}`,
    )

    for (const format of ['vcard', 'ics', 'csv', 'json']) {
      const expected = STANDARD[format] ?? { file: '', body: '', type: '' }
      const pending = page.waitForEvent('download', { timeout: 10000 })
      await press(page, `[data-stdexport="${format}"]`)
      const d = await pending
      const saved = await readFile((await d.path()) ?? '')
      check(
        `${label}: C. ${format} downloads as the renderer's bytes`,
        d.suggestedFilename() === expected.file && saved.toString('utf8') === expected.body,
        `${d.suggestedFilename()} saved ${String(saved.length)} expected ${String(expected.body.length)} | ${saved.toString('utf8').slice(0, 60)}`,
      )
    }
    await context.close()
  }

  // E. Restore a chosen ZIP: sent as the same bytes, and a success moves to the restored project.
  {
    const { context, page, restores } = await openWriter(width, mobile)
    await openSettings(page)
    await page.setInputFiles('[data-bc-restore-file]', {
      name: `${SLUG}-archive.zip`,
      mimeType: 'application/zip',
      buffer: Buffer.from(archiveBytes),
    })
    await page
      .waitForURL(new RegExp(`/p/${RESTORED_SLUG}`), { timeout: 10000 })
      .catch(() => undefined)
    check(
      `${label}: E. a restore sends the chosen ZIP as the same bytes`,
      restores.length === 1 && sha(restores[0]?.body ?? new Uint8Array()) === sha(archiveBytes),
      `${String(restores.length)} request(s)`,
    )
    const restoreSaid =
      (await page
        .locator('[data-bc-restore-said]')
        .first()
        .textContent()
        .catch(() => '')) ?? ''
    check(
      `${label}: E2. a success moves to the restored project`,
      page.url().includes(`/p/${RESTORED_SLUG}`),
      `${page.url().slice(0, 70)} | said: ${restoreSaid.slice(0, 120)}`,
    )
    await context.close()
  }

  // F. A refused restore shows the office's sentence, and nothing moves.
  {
    const { context, page, restores } = await openWriter(width, mobile, { tamperedDownload: true })
    await openSettings(page)
    // The office refuses this copy (the mock answers 400 with its manifest sentence), so nothing is restored.
    await page.setInputFiles('[data-bc-restore-file]', {
      name: `${SLUG}-archive.zip`,
      mimeType: 'application/zip',
      buffer: Buffer.from(tampered),
    })
    await page.waitForTimeout(1200)
    const said = (await page.locator('[data-bc-restore-said]').first().textContent()) ?? ''
    check(
      `${label}: F. a refused restore shows the office's sentence`,
      said.includes('does not match its manifest'),
      said.slice(0, 100),
    )
    check(
      `${label}: F2. a refused restore does not move the page`,
      !page.url().includes(`/p/${RESTORED_SLUG}`),
      page.url().slice(0, 90),
    )
    check(
      `${label}: F3. the refused file was sent to the office as it is, which refuses it`,
      restores.length === 1 && sha(restores[0]?.body ?? new Uint8Array()) === sha(tampered),
      `${String(restores.length)} request(s)`,
    )
    await context.close()
  }
}

await browser.close()
server.close()
console.log(
  failed === 0
    ? '\nArchive and export in the browser: every check passed.'
    : `\nArchive and export in the browser: ${String(failed)} check(s) FAILED.`,
)
process.exitCode = failed === 0 ? 0 : 1
