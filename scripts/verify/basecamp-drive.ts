/*
 * ADDING A FILE FROM DRIVE, DRIVEN IN A BROWSER.
 *
 * `verify:drive-live` proves the office can really browse Grant's Drive and
 * really record a pick. This proves the PAGE can: the chooser, the panel,
 * walking into a folder, searching, picking, and what the document looks like
 * afterwards.
 *
 * Drive itself is stubbed HERE and real THERE, deliberately: driving the real
 * drive from every browser run would put this suite's picks in Grant's projects
 * and its searches in his quota. What is asserted is the page's half - that it
 * asks the office rather than inventing a list, that it never holds a
 * credential, and that a picked file becomes a document that opens the real
 * thing.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4705
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (process.env.SUBJECT === 'source') throw new Error('asked for source')
  const { readFile } = await import('node:fs/promises')
  await readFile('.out/live/index.html')
  server = await serveLive(PORT)
  subject = 'the deployed bytes in .out/live'
} catch {
  server = await serveStudio(PORT)
}
console.log(`subject: ${subject}\n`)
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

/* What the office answers when asked about Drive. Shaped exactly as the
   deployed section answers, which `verify:drive-live` pins to the real thing. */
const TOP = [
  {
    id: '1folderAAAAAAAAAAAAAAAAAAAA',
    name: 'Legacy Coaching',
    mime: 'application/vnd.google-apps.folder',
    isFolder: true,
    modified: '2026-09-01T10:00:00Z',
    icon: '',
    thumbnail: '',
    open: 'https://drive.google.com/drive/folders/1folderAAAAAAAAAAAAAAAAAAAA',
    owner: 'Grant Rogers',
  },
  {
    id: '1sheetBBBBBBBBBBBBBBBBBBBBB',
    name: 'Pricing model',
    mime: 'application/vnd.google-apps.spreadsheet',
    isFolder: false,
    modified: '2026-09-20T09:00:00Z',
    icon: '',
    thumbnail: '',
    open: 'https://docs.google.com/spreadsheets/d/1sheetBBBBBBBBBBBBBBBBBBBBB/edit',
    owner: 'Grant Rogers',
  },
]
const INSIDE = [
  {
    id: '1docCCCCCCCCCCCCCCCCCCCCCCC',
    name: 'WS01 opening assessment',
    mime: 'application/vnd.google-apps.document',
    isFolder: false,
    modified: '2026-09-18T09:00:00Z',
    icon: '',
    thumbnail: '',
    open: 'https://docs.google.com/document/d/1docCCCCCCCCCCCCCCCCCCCCCCC/edit',
    owner: 'Grant Rogers',
  },
]

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } })
await ctx.addInitScript(
  `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
)
const asked: string[] = []
const linked: Record<string, unknown>[] = []
await ctx.route('**/hq-api**', async (route) => {
  const request = route.request()
  const target = new URL(request.url())
  const section = target.searchParams.get('section') ?? ''
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    return
  }
  if (section === 'drive') {
    const folder = target.searchParams.get('folder') ?? ''
    const q = target.searchParams.get('q') ?? ''
    asked.push(`drive folder=${folder} q=${q}`)
    const files =
      q !== ''
        ? INSIDE.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
        : folder === ''
          ? TOP
          : INSIDE
    await route.fulfill({
      status: 200,
      headers: cors,
      body: JSON.stringify({ data: { folder, q, files } }),
    })
    return
  }
  if (request.method() === 'POST') {
    const body = JSON.parse(request.postData() ?? '{}') as {
      action?: string
      args?: Record<string, unknown>
    }
    if (body.action === 'drive_link') {
      linked.push(body.args ?? {})
      await route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify({
          result: { ok: true, id: 'doc-1', added: true, kind: 'google-doc' },
        }),
      })
      return
    }
  }
  /* Everything else refused, so the page falls back to its prototype rows and
     says so - which is the state every capture in this repository runs in. */
  await route.abort('connectionfailed')
})
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const slug = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(400)

/* --- 1. the chooser ------------------------------------------------------ */
await page.locator('[data-bc-upload]').first().click()
await page.waitForTimeout(300)
const sources = await page.locator('[data-bc-from]').allInnerTexts()
check('Add a file asks where it is coming from', sources.length === 2, sources.join(' | '))
check(
  'and offers this computer and Google Drive, and nothing that does not work',
  sources.join(' ').includes('computer') && sources.join(' ').includes('Google Drive'),
  sources.join(' | '),
)
check('nothing is browsing Drive before it is asked to', asked.length === 0, asked.join(', '))

/* --- 2. browsing --------------------------------------------------------- */
await page.locator('[data-bc-from="drive"]').click()
await page.waitForSelector('[data-bc-drivepanel]', { timeout: 8000 })
await page.waitForTimeout(400)
check('choosing Drive asks the office what is in it', asked.length === 1, asked.join(', '))
const listed = await page.locator('.bcdriveitem').count()
check('and the drive is listed', listed === TOP.length, `${String(listed)} item(s)`)
const shown = await page.locator('[data-bc-drivepanel]').innerText()
check(
  'a spreadsheet is called a Google Sheet rather than a MIME type',
  shown.includes('Google Sheet') && !shown.includes('vnd.google-apps'),
  shown.replace(/\n+/g, ' / ').slice(0, 200),
)
check(
  'a folder offers to be opened and not to be added',
  (await page.locator('[data-bc-drivein]').count()) === 1 &&
    (await page.locator('[data-bc-drivepick]').count()) === 1,
  `${String(await page.locator('[data-bc-drivein]').count())} folder(s), ${String(await page.locator('[data-bc-drivepick]').count())} addable`,
)

/* --- 3. walking in and back ---------------------------------------------- */
await page.locator('[data-bc-drivein]').click()
await page.waitForTimeout(600)
check(
  'walking into a folder asks for that folder',
  asked.at(-1)?.includes('folder=1folder') === true,
  asked.join(', '),
)
check(
  'and shows what is inside it',
  (await page.locator('[data-bc-drivepanel]').innerText()).includes('WS01'),
  '',
)
check('with a way back out', (await page.locator('[data-bc-driveback]').count()) === 1)
check(
  'and it says where you are',
  (await page.locator('.bcdrivewhere').innerText()).includes('Legacy Coaching'),
  await page.locator('.bcdrivewhere').innerText(),
)
await page.locator('[data-bc-driveback]').click()
await page.waitForTimeout(600)
check(
  'going back returns to the top of the drive',
  (await page.locator('.bcdriveitem').count()) === TOP.length,
)

/* --- 4. searching -------------------------------------------------------- */
await page.locator('#bc-drive-q').fill('WS01')
await page.locator('[data-bc-drivesearch]').click()
await page.waitForTimeout(600)
check(
  'searching asks the office to search',
  asked.at(-1)?.includes('q=WS01') === true,
  asked.at(-1) ?? '',
)
check('and shows what it found', (await page.locator('.bcdriveitem').count()) === 1)

/* --- 5. picking ---------------------------------------------------------- */
await page.locator('[data-bc-drivepick]').first().click()
await page.waitForTimeout(900)
check('picking a file tells the office which file', linked.length === 1, JSON.stringify(linked))
check(
  'by its Drive id, its name and its kind, and names Drive as where it came from',
  linked[0]?.p_external_ref === '1docCCCCCCCCCCCCCCCCCCCCCCC' &&
    String(linked[0]?.p_title ?? '').includes('WS01') &&
    linked[0]?.p_connector === 'drive' &&
    linked[0]?.p_source_title === 'Google Drive',
  JSON.stringify(linked[0]),
)
check(
  'and the panel closes once it is in',
  (await page.locator('[data-bc-drivepanel]').count()) === 0,
)

/*
  THE PAGE NEVER HELD A CREDENTIAL. It asked the office for a section; the
  office asked Drive. Anything else would put something on Grant's laptop that
  can read his whole drive.
*/
const naughty = (await page.evaluate(
  inPage(`const out = []
     for (const k of Object.keys(localStorage)) {
       const v = String(localStorage.getItem(k) ?? '')
       if (/ya29\\.|refresh_token|client_secret/.test(v)) out.push(k)
     }
     return out`),
)) as string[]
check(
  'and nothing Google-shaped was ever stored in this browser',
  naughty.length === 0,
  naughty.join(', '),
)
check(
  'nor did the page ask Google directly',
  !asked.some((a) => a.includes('googleapis')),
  asked.join(', '),
)

/*
 * --- WHAT HAPPENS WHEN DRIVE WILL NOT PLAY ------------------------------
 *
 * Grant's §27: auth cancelled, auth expired, permission denied, file
 * unavailable, provider disconnected. Every one of them reaches the page as
 * the OFFICE'S OWN SENTENCE, because the office is the only thing that knows
 * which of them it was - and the page must not turn any of them into an empty
 * drive, which would say "you have nothing in Drive" about a connection that
 * failed.
 */
{
  const troubles: [string, number, string][] = [
    [
      'a connection that was never made',
      502,
      'Google is not connected yet. Connect it in Settings and try again.',
    ],
    [
      'a grant that has been withdrawn',
      502,
      'Google would not renew the connection: invalid_grant',
    ],
    ['a drive that refuses', 502, 'Drive would not answer: Insufficient Permission'],
  ]
  for (const [what, status, sentence] of troubles) {
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 950 } })
    await ctx2.addInitScript(
      `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
    )
    await ctx2.route('**/hq-api**', async (route) => {
      const target = new URL(route.request().url())
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
        return
      }
      if ((target.searchParams.get('section') ?? '') === 'drive') {
        await route.fulfill({
          status,
          headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
          body: JSON.stringify({ error: sentence }),
        })
        return
      }
      await route.abort('connectionfailed')
    })
    const p2 = await ctx2.newPage()
    await p2.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
    await p2.waitForSelector('.bcmain')
    await p2.waitForTimeout(400)
    await p2.locator('[data-bc-upload]').first().click()
    await p2.waitForTimeout(250)
    await p2.locator('[data-bc-from="drive"]').click()
    await p2.waitForTimeout(1200)
    const told = await p2
      .locator('[data-bc-drivepanel]')
      .innerText()
      .catch(() => '')
    check(
      `${what}: the page says so, in the office's own words`,
      told.includes(sentence.split(':')[0] ?? sentence),
      told.replace(/\n+/g, ' / ').slice(0, 200),
    )
    check(
      `${what}: and does not report it as an empty drive`,
      !/nothing here/i.test(told),
      told.replace(/\n+/g, ' / ').slice(0, 160),
    )
    await ctx2.close()
  }
}

check('nothing threw', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
console.log(
  '\nDRIVE ITSELF IS STUBBED HERE and real in `npm run verify:drive-live`, which\n' +
    "browses Grant's own drive through the deployed gateway and picks a file from it.",
)
process.exit(fail === 0 ? 0 : 1)
