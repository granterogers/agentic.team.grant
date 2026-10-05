/*
 * DOCS AND FILES: EVERY DOCUMENT, NOT THE ONE THAT HAPPENED TO WORK.
 *
 * Grant, 22 September: "File behaviour is inconsistent. Some PDFs can be
 * clicked while other assets cannot. Audit the file/document interaction
 * rather than patching only one example... the Grant Rogers avatar document
 * having no useful thumbnail and not opening; audio files not being
 * clickable/useful... Do not design Docs & Files around PDFs alone."
 *
 * So the shape of this file is a LOOP over every document in the gallery and
 * over every row in the list, in both views, asserting that each one presses
 * and that what it does is what the row said it would do. A check written
 * against one document would pass today and pass again the next time somebody
 * adds a file type nobody thought about.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4677
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

/*
  BACK TO THE BOARD, which is now more than one press.

  §21 made dismissal step exactly one level: a record inside a sheet closes to
  the sheet, and the sheet closes to the page. A single Escape used to do both,
  so loops like this one pressed once and carried on -- and now leave the sheet
  open, whose backdrop swallows the next click and reports as a timeout on a
  control that is perfectly fine.

  Pressing until nothing is open is the honest way to say "get me back to the
  page", and it is bounded so a surface that will not close fails as a test
  rather than hanging.
*/
const dismissAll = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    if ((await page.locator('[data-bc-expanded]').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  /*
    WAIT FOR THE LINK, NOT FOR A DURATION. A fixed pause was enough when this
    suite ran alone and not when it ran after eleven others: the slug came back
    empty, the next navigation went to a route with no project in it, and the
    suite died waiting for a control that route does not have - which reads as
    a product defect and was a stopwatch.
  */
  await page.waitForSelector('[data-bc-go^="/p/"]', { timeout: 20000 })
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()
check('the home page names a project to open', slug !== '', slug)

/*
  THE VIEW PREFERENCE PERSISTS - correctly, because somebody who chose the
  list meant it - so the gallery has to be ASKED for rather than assumed. The
  first draft assumed, and timed out on a page that was doing exactly what it
  was told.
*/
const gallery = async (): Promise<void> => {
  await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-docview]')
  await page.waitForTimeout(300)
  if ((await page.locator('.bcdocs--wall').count()) === 0) {
    await page.locator('[data-bc-docview="wall"]').click()
    await page.waitForTimeout(300)
  }
  await page.waitForSelector('.bcdoc')
  await page.waitForTimeout(600)
}
await gallery()

/* --- 1. every document in the gallery is pressable ---------------------- */
const docs = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('[data-bc-doc]')) {
       out.push({
         ref: el.dataset.bcDoc ?? '',
         title: el.dataset.bcDocTitle ?? '',
         kind: (el.querySelector('.bcdocmeta')?.textContent ?? '').split('·')[0].trim(),
         pressable: el.querySelector('[data-bc-doc-open]') !== null,
       })
     }
     return out`),
)) as { ref: string; title: string; kind: string; pressable: boolean }[]

check(
  'the gallery has documents of more than one kind',
  new Set(docs.map((d) => d.kind)).size >= 3,
  [...new Set(docs.map((d) => d.kind))].join(', '),
)
const inert = docs.filter((d) => !d.pressable || d.ref === '')
check(
  'every document in the gallery can be pressed',
  inert.length === 0,
  inert.map((d) => `${d.title} (${d.kind})`).join(', '),
)
check(
  'and the audit covers the two Grant named by hand',
  docs.some((d) => d.title.includes('Avatar')) && docs.some((d) => d.kind === 'Audio'),
  docs.map((d) => d.title).join(', '),
)

/* --- 2. every one of them actually does something ----------------------- */
/*
  Three outcomes are acceptable and they are told apart by what happens, not
  by what the code says: a new tab opens, the detail view opens, or — for a
  recording — the detail view opens WITH A PLAYER in it. Nothing at all is
  the failure, and it is the one this file was written for.
*/
const outcomes: string[] = []
const wrong: string[] = []
for (const d of docs) {
  await gallery()
  const before = ctx.pages().length
  const popup = page
    .waitForEvent('popup', { timeout: 2500 })
    .then(() => 'tab')
    .catch(() => '')
  await page
    .locator(`[data-bc-doc-open="${d.ref.replace(/"/g, '\\"')}"]`)
    .first()
    .click()
  const tab = await popup
  await page.waitForTimeout(500)
  const detail = (await page.locator('[data-bc-expanded="document"]').count()) > 0
  const player = (await page.locator('[data-bc-expanded="document"] [data-bc-audio]').count()) > 0
  const got = tab === 'tab' ? 'tab' : player ? 'player' : detail ? 'details' : 'nothing'
  outcomes.push(`${d.title}: ${got}`)
  if (got === 'nothing') wrong.push(`${d.title} (${d.kind}) did nothing`)
  if (d.kind === 'Audio' && got !== 'player') wrong.push(`${d.title} is audio and did not play`)
  for (const p of ctx.pages().slice(before)) await p.close()
  await dismissAll()
}
check(
  'pressing each one opens it, plays it, or shows its details',
  wrong.length === 0,
  `${wrong.join('; ')}\n        all: ${outcomes.join(' | ')}`,
)

/* --- 3. the same is true in the list view ------------------------------- */
await gallery()
await page.locator('[data-bc-docview="list"]').click()
await page.waitForTimeout(500)
const rows = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bclist [data-bc-doc]')) {
       out.push({
         title: el.dataset.bcDocTitle ?? '',
         pressable: el.querySelector('[data-bc-doc-open]') !== null,
         says: (el.querySelector('.bcpmeta')?.textContent ?? '').trim(),
       })
     }
     return out`),
)) as { title: string; pressable: boolean; says: string }[]
check(
  'the list view lists the same documents',
  rows.length === docs.length,
  `${String(rows.length)} vs ${String(docs.length)}`,
)
check(
  'every row in the list view is pressable too',
  rows.every((r) => r.pressable),
  rows
    .filter((r) => !r.pressable)
    .map((r) => r.title)
    .join(', '),
)
check(
  'and no row promises something it cannot do',
  rows.every((r) => ['Opens in a new tab', 'Plays here', 'Details'].includes(r.says)),
  rows.map((r) => `${r.title}: ${r.says}`).join(' | '),
)

/* --- 4. a recording plays where it was found ---------------------------- */
const audioRow = rows.find((r) => r.says === 'Plays here')
check('a recording says it plays here rather than opening a tab', audioRow !== undefined)
if (audioRow !== undefined) {
  await page.locator(`[data-bc-doc-title="${audioRow.title}"] [data-bc-doc-open]`).first().click()
  await page.waitForTimeout(600)
  const playable = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-audio]')
       if (el === null) return 'no player'
       if (!el.controls) return 'no controls'
       return el.currentSrc === '' ? 'no source' : 'ok'`),
  )) as string
  check('and the player is a real one with a real source', playable === 'ok', playable)
  /*
    PRESSED, not merely present. A player that cannot start is a control that
    exists and does nothing, which is the whole subject of this file.
  */
  const played = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-audio]')
       return el.play().then(() => 'playing').catch((e) => 'refused: ' + e.name)`),
  )) as string
  check('and it plays when it is asked to', played === 'playing', played)
  await dismissAll()
}

/* --- 5. a document with no file gets details, not silence --------------- */
const noFile = rows.find((r) => r.says === 'Details')
check(
  'a document the office only has a record of says so',
  noFile !== undefined,
  rows.map((r) => r.says).join(', '),
)
if (noFile !== undefined) {
  await page.locator(`[data-bc-doc-title="${noFile.title}"] [data-bc-doc-open]`).first().click()
  await page.waitForTimeout(600)
  const body = await page.locator('[data-bc-expanded="document"]').innerText()
  check(
    'and pressing it shows what the office does know',
    body.includes(noFile.title) && /no file behind this one/i.test(body),
    body.replace(/\n/g, ' / ').slice(0, 180),
  )
  await dismissAll()
}

/* --- 6. thumbnails: a real page where there is one, a glyph where not --- */
await gallery()
await page.waitForTimeout(1200)
const thumbs = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcdoc')) {
       const t = el.querySelector('.bcthumb')
       out.push({
         title: el.dataset.bcDocTitle ?? '',
         real: t.querySelector('.realpage') !== null,
         glyph: t.querySelector('.bcglyph') !== null,
         drawn: t.querySelector('.bcpage') !== null,
         h: Math.round(t.getBoundingClientRect().height),
       })
     }
     return out`),
)) as { title: string; real: boolean; glyph: boolean; drawn: boolean; h: number }[]
const empty = thumbs.filter((t) => !t.real && !t.glyph && !t.drawn)
check(
  'every tile shows something: a rendered page, a glyph, or a drawn fallback',
  empty.length === 0,
  empty.map((t) => t.title).join(', '),
)
check(
  'at least one is a really rendered page rather than a fallback',
  thumbs.some((t) => t.real),
  thumbs.map((t) => `${t.title}:${t.real ? 'real' : t.glyph ? 'glyph' : 'drawn'}`).join(' | '),
)
check(
  'and no tile has collapsed to nothing',
  thumbs.every((t) => t.h > 60),
  thumbs.map((t) => `${t.title}:${String(t.h)}`).join(' | '),
)

/* --- 7. the face of a document is what the FILE is ---------------------- */

/*
  TWO MECHANISMS, DELIBERATELY REDUNDANT, AND WHAT THAT MEANS FOR THIS SUITE.

  The renderer derives a face from the kind, the media type and the filename;
  the painter corrects it once the real bytes have a type. Either one alone
  settles to the right answer, so sabotaging one of them leaves every check
  below green - which is not the checks being weak, it is the redundancy
  working. The control that these checks CAN fail is therefore the combined
  revert: both halves reading the four words `app.studio_documents` emits,
  which is exactly the code that put lines of written text over a photograph.
  Run with both reverted, the five checks in this section go red.

  A first-frame check was written for this and removed: `fileFor` resolves on a
  microtask for a local file, so the painter has already run by the time a
  browser round trip can look, and the check could not fail either.
*/

/*
  THE DEFECT THIS SECTION EXISTS FOR.

  `app.studio_documents` maps every document in the office onto four words -
  `audio`, `made`, `pdf` and `doc` - and the gallery decided a tile's face from
  that word. So a photograph, a spreadsheet, a slide deck and a zip all arrived
  as `doc` and were drawn as PAGES OF WRITTEN TEXT: lines of prose over a
  picture, which is the one thing the drawing is not allowed to be.

  The assertion is a property rather than a list, because a list of file types
  goes stale the first time somebody uploads one nobody wrote down: NOTHING
  whose file is a picture, a recording, a spreadsheet, a video or a type this
  office does not know is drawn as a written page.
*/
const NOTAPAGE =
  /\.(png|jpe?g|gif|webp|svg|avif|heic|bmp|tiff?|xlsx?|csv|tsv|ods|numbers|pptx?|odp|key|mp4|mov|webm|mkv|avi|m4v|mp3|wav|m4a|ogg|oga|aac|flac|opus|weba|zip|gz|tar|7z|dmg|exe)(\?|$)/i

type Face = {
  title: string
  ref: string
  word: string
  drawn: boolean
  glyph: boolean
  real: boolean
}
const facesIn = async (sel: string): Promise<Face[]> =>
  (await page.evaluate(
    inPage(`const out = []
       for (const el of document.querySelectorAll('${sel}')) {
         const t = el.querySelector('[data-bc-thumb]')
         if (t === null) continue
         const meta = el.querySelector('.bcdocmeta, .bcitemmeta')
         out.push({
           title: el.dataset.bcDocTitle ?? '',
           ref: t.dataset.bcThumb ?? '',
           word: ((meta === null ? '' : meta.textContent) ?? '').split('·')[0].trim(),
           drawn: t.querySelector('.bcpline') !== null,
           glyph: t.querySelector('.bcglyph') !== null,
           real: t.querySelector('.realpage') !== null,
         })
       }
       return out`),
  )) as Face[]

await gallery()
await page.waitForTimeout(1800)
const wall = await facesIn('.bcdoc')

const liars = wall.filter((f) => NOTAPAGE.test(f.ref) && f.drawn && !f.real)
check(
  'nothing that is not a written document is drawn as a page of writing',
  liars.length === 0,
  liars.map((f) => `${f.title} (${f.ref})`).join(', '),
)

const pictures = wall.filter((f) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(f.ref))
check(
  'a picture in the gallery is the picture itself',
  pictures.length > 0 && pictures.every((f) => f.real),
  pictures.map((f) => `${f.title}:${f.real ? 'real' : f.glyph ? 'glyph' : 'drawn'}`).join(' | '),
)

const unknown = wall.filter((f) => /\.(zip|gz|tar|7z|dmg|exe)(\?|$)/i.test(f.ref))
check(
  'a file of a type the office has never met gets a deliberate fallback, not a blank and not a lie',
  unknown.length > 0 && unknown.every((f) => f.glyph && !f.drawn),
  unknown.map((f) => `${f.title}:${f.glyph ? 'glyph' : f.drawn ? 'drawn' : 'nothing'}`).join(' | '),
)

/*
  THE CAPTION AND THE PICTURE SAY THE SAME THING. A tile showing a spreadsheet
  with the word "Document" under it is worse than either half being wrong on
  its own, because each is then evidence that the other is broken.
*/
const WORDFOR: Record<string, string> = {
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  csv: 'Spreadsheet',
  xlsx: 'Spreadsheet',
  xls: 'Spreadsheet',
  pptx: 'Slides',
  ppt: 'Slides',
  mp4: 'Video',
  mov: 'Video',
  wav: 'Audio',
  mp3: 'Audio',
  m4a: 'Audio',
  zip: 'File',
  gz: 'File',
  tar: 'File',
}
const mislabelled = wall.filter((f) => {
  const ext = (f.ref.split(/[?#]/)[0] ?? '').split('.').pop()?.toLowerCase() ?? ''
  const want = WORDFOR[ext]
  return want !== undefined && f.word !== want
})
check(
  'and the word under it names the same thing the picture does',
  mislabelled.length === 0,
  mislabelled.map((f) => `${f.title}: said "${f.word}"`).join(', '),
)

/*
  TWO VIEWS OF ONE LIST. The row drew four lines of text unconditionally while
  the gallery drew each document as what it is, so the same spreadsheet was a
  green object in one view and a written page in the other. Compared document
  by document rather than by counting, because two lists of the same length can
  still disagree about every entry.
*/
await page.locator('[data-bc-docview="list"]').click()
await page.waitForSelector('.bcitem')
await page.waitForTimeout(1800)
const list = await facesIn('.bcitem')
const shape = (f: Face): string =>
  f.real ? 'real' : f.glyph ? 'glyph' : f.drawn ? 'drawn' : 'nothing'
const disagree = wall
  .map((f) => ({ f, r: list.find((x) => x.ref === f.ref) }))
  .filter(({ f, r }) => r !== undefined && (shape(r) !== shape(f) || r.word !== f.word))
check(
  'the gallery and the list show every document the same way',
  list.length === wall.length && disagree.length === 0,
  disagree
    .map(
      ({ f, r }) =>
        `${f.title}: wall ${shape(f)}/${f.word} vs list ${shape(r as Face)}/${(r as Face).word}`,
    )
    .join(' | '),
)

/* --- 8. a recording plays, whatever word the office filed it under ------- */
/*
  DELIBERATELY THE ONE THE OFFICE FILED AS A PLAIN DOCUMENT. Picking the first
  recording in the list would pick the one already marked `audio`, which every
  version of this code gets right - a sample made only of cases the old code
  also handles proves nothing about the change.
*/
const rec =
  list.find((f) => /\.(wav|mp3|m4a)(\?|$)/i.test(f.ref) && f.title === 'Ben, second message') ??
  list.find((f) => /\.(wav|mp3|m4a)(\?|$)/i.test(f.ref))
check(
  'a recording is in the list to test with',
  rec !== undefined,
  list.map((f) => f.ref).join(' | '),
)
if (rec !== undefined) {
  /*
    BY TITLE, NOT BY REFERENCE. Two documents can point at one file - the
    reference is the file - so finding the row by reference found the FIRST
    recording, which is the one the office had already marked `audio` and which
    every version of this code gets right. The check was green against a
    sabotage because it was looking at the wrong row.
  */
  const says = (await page.evaluate(
    inPage(`const el = [...document.querySelectorAll('.bcitem')]
         .find((x) => (x.dataset.bcDocTitle ?? '') === ${JSON.stringify(rec.title)})
       return el === null || el === undefined ? '' : (el.querySelector('.bcpmeta')?.textContent ?? '').trim()`),
  )) as string
  check(
    'the row says it plays here rather than promising a new tab',
    /plays here/i.test(says),
    says,
  )
  await page.locator('.bcitem', { hasText: rec.title }).first().click()
  await page.waitForTimeout(700)
  check(
    'and pressing it gives a player, not a page with nothing on it',
    (await page.locator('audio[data-bc-audio]').count()) > 0,
    await page
      .locator('.bcrecordhead h1')
      .first()
      .innerText()
      .catch(() => ''),
  )
  await dismissAll()
}

/* --- 9. a picture that will not load falls back rather than lying ------- */

/*
  The one path that cannot be reached by looking at the page: the image's
  `load` listener stood alone, so a file that 404s or will not decode left the
  DRAWN PAGE standing in for a photograph. The request is failed at the browser
  rather than by editing a fixture, so this exercises the real handler.
*/
await page.route('**/samples/venue.png', (route) => route.abort())
await gallery()
await page.waitForTimeout(2000)
const broken = (await facesIn('.bcdoc')).find((f) => /venue\.png/.test(f.ref))
check('the picture that could not load is still in the gallery', broken !== undefined)
if (broken !== undefined) {
  check(
    'a picture that will not load falls back to a glyph, never to a drawn page',
    broken.glyph && !broken.drawn && !broken.real,
    `real=${String(broken.real)} glyph=${String(broken.glyph)} drawn=${String(broken.drawn)}`,
  )
}
await page.unroute('**/samples/venue.png')

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
