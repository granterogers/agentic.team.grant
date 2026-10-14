// @ts-nocheck: the code the page runs is written against the browser's DOM, which this project's type setup does not load
// (the tsconfig has no DOM library, on purpose). The file is checked by running it, which is what the verifier is for.
/*
 * Empty offices, read-only visitors and refused sessions, in a real Chromium, against a mocked office. Nothing from
 * production.
 *   npm run verify:access-browser
 *
 * Asserted at desktop 1440 x 900 and phone 390 x 844:
 *   E1. an office with no projects says so, and shows no load error
 *   P1. a visitor with no session sees the sign-in screen, and no export, archive or restore control
 *   A1. a writer whose session the office refuses (401) on an export is told so, beside the control, and the session is cleared
 *   A2. a writer whose archive fails at the office (502) is told why, in the office's words, and keeps the session
 *   A3. a writer whose restore is refused (401) is left read-only, with no restore control, and the session is cleared
 *   A4. a writer whose archive the office refuses (400) is told in the office's words, in the open project menu
 * Each refusal is a different path through the page. Control, run by hand and recorded in the ledger: removing the sign-out
 * from the read path turns A1b red at both sizes.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright'
import { buildArchive } from '../../src/portability/archive.ts'

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
    if (extname(path) === '') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(await readFile('web/studio/index.html'))
      return
    }
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4794, '127.0.0.1', () => r()))

const ORIGIN = 'http://127.0.0.1:4794'
const SIGNIN = 'https://signin.test/functions/v1/signin'
const GATEWAY = 'https://gw.test/functions/v1/hq-api'
const SLUG = 'harbour-plan'
const PROJECT_ID = '6f1c2b8e-0000-4000-8000-0000000000aa'
const EXPORTED_AT = '2026-10-14T09:00:00.000Z'
const session = JSON.stringify({
  access_token: 'writer-token-for-tests',
  refresh_token: 'refresh-for-tests',
  expires_at: Date.now() + 60 * 60 * 1000,
})
const archiveBytes = (
  await buildArchive(
    {
      format: 'ai-team-hq/project-package',
      format_version: 1,
      project: { slug: SLUG, name: 'Harbour plan' },
      documents: [],
      tasks: [],
    },
    { slug: SLUG, exportedAt: EXPORTED_AT },
  )
).bytes

const project = {
  id: PROJECT_ID,
  slug: SLUG,
  name: 'Harbour plan',
  brief: 'A brief long enough to read as the brief of a real project.',
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
}

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const browser = await chromium.launch()

type Office = {
  projects: unknown[]
  /** How the gateway answers the export, the archive and the restore. */
  exportStatus?: number
  archiveStatus?: number
  restoreStatus?: number
  withSession: boolean
}

async function open(
  office: Office,
  width: number,
  mobile: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    acceptDownloads: true,
    isMobile: mobile,
    hasTouch: mobile,
  })
  await context.addInitScript(
    ({ signin, gateway, sess, held }) => {
      const w = window as unknown as Record<string, string>
      w.HQ_SIGNIN = signin
      w.HQ_API = gateway
      if (held && localStorage.getItem('hq.session') === null)
        localStorage.setItem('hq.session', sess)
    },
    { signin: SIGNIN, gateway: GATEWAY, sess: session, held: office.withSession },
  )
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
      return json(200, {
        data: { projects: office.projects, crew: [], appearance: null, avatar_base: '' },
      })
    }
    if (section === 'project_export') {
      if (office.exportStatus === 401) return json(401, { error: 'not signed in' })
      return json(200, { data: { format: 'ai-team-hq/project-package', project: { slug: SLUG } } })
    }
    if (section === 'project_archive') {
      if (office.archiveStatus === 502)
        return json(502, { error: 'the archive could not be read', section })
      return route.fulfill({
        status: 200,
        contentType: 'application/zip',
        body: Buffer.from(archiveBytes),
      })
    }
    if (section === 'project_restore' && route.request().method() === 'POST') {
      if (office.restoreStatus === 401) return json(401, { error: 'not signed in' })
      if (office.restoreStatus === 400)
        return json(400, { error: 'the archive does not match its manifest: files/plan.png' })
      return json(201, { data: { ok: true, slug: 'restored', report: {} } })
    }
    return json(404, { error: 'not in this check', section })
  })
  await context.route('https://**', (route) => route.abort())
  const page = await context.newPage()
  return { context, page }
}

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
  await page.waitForTimeout(600)
}

const sessionHeld = (page: Page) => page.evaluate(() => localStorage.getItem('hq.session') !== null)

/*
  The sentence the page draws beside a control (office.js say): the element with the words must share its block with the
  control that was pressed, and be rendered. Read in the page, because the sentence can sit below the fold of a settings
  pane, where Playwright's visibility test does not describe what the person can reach.
*/
const sayBeside = (page: Page, control: string, words: string) =>
  page.evaluate(
    ({ control, words }) => {
      const button = document.querySelector(control) as HTMLElement | null
      if (button === null) return { ok: false, detail: `no control ${control}` }
      // A person presses a control they can see. The settings pane lays out off-screen content lazily, so the control is
      // brought on screen first, as a tap would find it, and the sentence beside it is measured then.
      button.scrollIntoView({ block: 'center' })
      const block = button.closest('[data-saidwrap]') ?? button.parentElement
      const said = [...(block?.querySelectorAll('[data-said]') ?? [])].find((x) =>
        (x.textContent ?? '').includes(words),
      ) as HTMLElement | undefined
      if (said === undefined) return { ok: false, detail: `no sentence in the control's block` }
      const cs = getComputedStyle(said)
      // Decided on the computed style, which is stable; a box measured mid-animation is reported in the detail, not judged.
      const r = said.getBoundingClientRect()
      const rendered =
        cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
      return {
        ok: rendered,
        detail: `${(said.textContent ?? '').trim().slice(0, 60)} [display ${cs.display}, visibility ${cs.visibility}, box ${Math.round(r.width)}x${Math.round(r.height)}]`,
      }
    },
    { control, words },
  )
const bodyText = (page: Page) => page.evaluate(() => document.body.innerText)

for (const [label, width, mobile] of [
  ['desktop', 1440, false],
  ['phone', 390, true],
] as const) {
  // E1. An office with no projects says so.
  {
    const { context, page } = await open({ projects: [], withSession: true }, width, mobile)
    await page.goto(`${ORIGIN}/?welcome=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const text = await bodyText(page)
    check(
      `${label}: E1. an office with no projects says so, and shows no load error`,
      /no projects yet|create your first project|your office is ready/i.test(text) &&
        !/could not be loaded/i.test(text),
      text.replace(/\s+/g, ' ').slice(0, 90),
    )
    await context.close()
  }

  // P1. A visitor with no session cannot reach a single write control. The visitor's own screen must be the one shown,
  // or a count of zero proves nothing: the settings pane is not drawn for a visitor at all.
  {
    const { context, page } = await open({ projects: [project], withSession: false }, width, mobile)
    await page.goto(`${ORIGIN}/p/${SLUG}/settings`, { waitUntil: 'domcontentloaded' })
    const visitorScreen = await page
      .getByText('Sign in to see your office', { exact: false })
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false)
    const writes = await page
      .locator(
        '[data-export], [data-archive-download], [data-stdexport], [data-archive], [data-bc-restore-file]',
      )
      .count()
    check(
      `${label}: P1. a visitor with no session sees the sign-in screen, and no export, archive or restore control`,
      visitorScreen && writes === 0 && !(await sessionHeld(page)),
      `visitor screen ${String(visitorScreen)}, write controls ${String(writes)}`,
    )
    await context.close()
  }

  // A1. A refused session on an export: told beside the control, and the session is cleared.
  {
    const { context, page } = await open(
      { projects: [project], withSession: true, exportStatus: 401 },
      width,
      mobile,
    )
    await openSettings(page)
    await press(page, '[data-export]')
    await page.waitForTimeout(1200)
    const beside = await sayBeside(page, '[data-export]', 'You are not signed in any more')
    check(
      `${label}: A1. a refused session on export is told in words, beside the control that was pressed`,
      beside.ok,
      beside.detail,
    )
    check(
      `${label}: A1b. the refused session is cleared from this browser`,
      !(await sessionHeld(page)),
    )
    await context.close()
  }

  // A2. An archive that fails at the office keeps the session and says why, in the office's words.
  {
    const { context, page } = await open(
      { projects: [project], withSession: true, archiveStatus: 502 },
      width,
      mobile,
    )
    await openSettings(page)
    await press(page, '[data-archive-download]')
    await page.waitForTimeout(1200)
    const beside = await sayBeside(page, '[data-archive-download]', 'the archive could not be read')
    check(
      `${label}: A2. an archive the office could not make is told in its own words, beside the control`,
      beside.ok,
      beside.detail,
    )
    check(
      `${label}: A2b. a failure at the office does not sign the person out`,
      await sessionHeld(page),
    )
    await context.close()
  }

  // A3. A refused session on a restore: the page is left read-only, and the restore is not offered.
  {
    const { context, page } = await open(
      { projects: [project], withSession: true, restoreStatus: 401 },
      width,
      mobile,
    )
    await openSettings(page)
    await page.setInputFiles('[data-bc-restore-file]', {
      name: 'harbour-plan-archive.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(archiveBytes),
    })
    await page.waitForTimeout(1200)
    // KNOWN GAP, recorded in the ledger: once the session is cleared, "You are not signed in any more" is not drawn
    // anywhere. The person is shown the read-only state (sign-in first, no restore control) and not the words.
    const restoreControls = await page
      .locator('[data-bc-menu-restore], [data-bc-restore-file]')
      .count()
    const signedOutMark = (await bodyText(page)).includes('sign in first')
    check(
      `${label}: A3. a refused session on restore leaves the page read-only: sign-in-first shown, no restore control`,
      signedOutMark && restoreControls === 0,
      `sign-in-first ${String(signedOutMark)}, restore controls ${String(restoreControls)}`,
    )
    check(
      `${label}: A3b. the refused session is cleared from this browser`,
      !(await sessionHeld(page)),
    )
    await context.close()
  }

  // A4. The office refuses the archive (400, its own sentence) with the session intact: the sentence is shown in the menu,
  // which opens to show it. Before the fix it was written into a closed menu and the person was told nothing.
  {
    const { context, page } = await open(
      { projects: [project], withSession: true, restoreStatus: 400 },
      width,
      mobile,
    )
    await openSettings(page)
    await page.setInputFiles('[data-bc-restore-file]', {
      name: 'harbour-plan-archive.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(archiveBytes),
    })
    await page.waitForTimeout(1200)
    const drawn = await page.evaluate(() => {
      const e = document.querySelector('[data-bc-restore-said]') as HTMLElement | null
      if (e === null) return { ok: false, detail: 'no restore block drawn' }
      const box = e.getBoundingClientRect()
      const words = (e.textContent ?? '').trim()
      return {
        ok:
          words.includes('the archive does not match its manifest') &&
          box.width > 0 &&
          box.height > 0,
        detail: `${words.slice(0, 70)} [box ${Math.round(box.width)}x${Math.round(box.height)}]`,
      }
    })
    check(
      `${label}: A4. a refused archive is told in the office's words, in an open menu`,
      drawn.ok,
      drawn.detail,
    )
    check(
      `${label}: A4b. the session is kept when the office refuses an archive`,
      await sessionHeld(page),
    )
    await context.close()
  }
}

await browser.close()
server.close()
console.log(
  failed === 0
    ? '\nAccess, empty offices and refusals: every check passed.'
    : `\nAccess, empty offices and refusals: ${String(failed)} check(s) FAILED.`,
)
process.exitCode = failed === 0 ? 0 : 1
