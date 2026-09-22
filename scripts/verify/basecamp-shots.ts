/*
 * Capture the experimental Basecamp-inspired experience, at the four widths
 * the specification names.
 *
 * THIS PASSES AND FAILS NOTHING. It is the capture half of §14A's loop; the
 * critique is done by opening the images. A directory full of unreviewed
 * captures is a FAILED visual-verification phase, not a completed one.
 *
 * Two things it does beyond taking pictures, both because this repository has
 * been burnt by their absence:
 *
 *  - it prints page errors (`pageerror`), because a hoisted function reaching
 *    a `let` declared below it throws once, recovers, and is invisible in
 *    every capture;
 *  - it reports the screens it could NOT capture rather than dying on the
 *    first unreachable selector, because one throw taking twelve captures
 *    with it is how most of a product stops being watched.
 */
import { mkdir } from 'node:fs/promises'
import { chromium, devices } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4632
const OUT = '.out/basecamp'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const SIZES = [
  { id: 'desktop', width: 1440, height: 900, touch: false },
  { id: 'compact', width: 1024, height: 768, touch: false },
  { id: 'tablet', width: 768, height: 1024, touch: true },
  { id: 'phone', width: 390, height: 844, touch: true },
] as const

const only = process.env.SIZE ?? ''
const sizes = only === '' ? SIZES : SIZES.filter((s) => s.id === only)

/*
  --lang, as well as the context locale.

  Playwright's `locale` sets Accept-Language and navigator.language; Chromium
  renders a native date input using its own UI language, which is a separate
  setting — so every capture of the task form showed mm/dd/yyyy for a person
  who will only ever see dd/mm/yyyy. Not a product defect, but a screenshot
  that misrepresents the product is one Grant would reasonably read as one.
*/
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const missed: string[] = []
const thrown: string[] = []
let taken = 0

for (const size of sizes) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    /*
      en-GB, because the browser decides how a date input renders and the
      harness was showing mm/dd/yyyy in every capture of a form Grant will
      only ever see as dd/mm/yyyy. A screenshot in the wrong locale is a
      screenshot of something nobody uses.
    */
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    /*
      TOUCH EMULATION ON for the narrow legs. A control measures 50x29 in a
      bare 390px viewport and 58x52 in a real touch context, because the phone
      rules add the padding — so a touch-target reading taken without it is a
      finding about the harness.
    */
    ...(size.touch ? devices['Pixel 7'] : {}),
    deviceScaleFactor: 1,
    isMobile: size.touch,
    hasTouch: size.touch,
  })
  await ctx.newPage().then((p) => p.close())
  const page = await ctx.newPage()
  await page.setViewportSize({ width: size.width, height: size.height })
  page.on('pageerror', (e) => {
    thrown.push(`${size.id}: ${e.message}`)
  })

  const shot = async (name: string, path: string, after?: () => Promise<void>): Promise<void> => {
    try {
      await page.goto(url(path), { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.bcmain', { timeout: 6000 })
      await page.waitForTimeout(450)
      if (after !== undefined) await after()
      /*
        WAIT FOR THE REAL PAGE. §21's thumbnails are rendered by pdf.js, which
        is 330KB loaded lazily plus a worker plus a decode - comfortably longer
        than the settle this harness used, so every capture of the Docs and
        Files pane showed the DRAWN placeholder and none showed the product.
        A capture that photographs the fallback is a capture of something
        nobody sees.

        Bounded and non-fatal: a screen with no PDF, or one whose file will not
        parse, carries on after the timeout with the drawing, which is exactly
        what a person would see.
      */
      if ((await page.locator('[data-bc-thumb]').count()) > 0) {
        await page.waitForSelector('.bcthumb .realpage', { timeout: 6000 }).catch(() => null)
        await page.waitForTimeout(250)
      }
      await page.screenshot({ path: `${OUT}/${name}-${size.id}.png`, fullPage: false })
      await page.screenshot({ path: `${OUT}/${name}-${size.id}-full.png`, fullPage: true })
      taken += 1
    } catch (e) {
      missed.push(
        `${name}-${size.id}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      )
    }
  }

  const slug = await (async (): Promise<string> => {
    await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    return (await page.evaluate(
      `(() => { const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
         return el === null ? '' : (el.dataset.bcGo ?? '') })()`,
    )) as string
  })()

  await shot('home', '/basecamp')
  if (slug !== '') {
    await shot('overview', slug)
    await shot('tasks', `${slug}/tasks`)
    await shot('tasks-adding', `${slug}/tasks`, async () => {
      await page.locator('[data-bc-addtask]').first().click()
      await page.waitForTimeout(250)
    })
    await shot('task-record', `${slug}/tasks`, async () => {
      await page.locator('[data-bc-task-open]').first().click()
      await page.waitForSelector('#bc-edit-who', { timeout: 5000 })
      await page.waitForTimeout(300)
    })
    /*
      §10 and §9's own surfaces. A screen with no capture is a screen nobody
      is watching, and both of these were reachable the moment they had a
      route - so they get a capture in the same commit as the route.
    */
    await shot('chat', `${slug}/chat`)
    await shot('board', `${slug}/board`)
    await shot('schedule', `${slug}/schedule`)
    await shot('team', `${slug}/team`)
    await shot('documents', `${slug}/documents`)
    await shot('documents-list', `${slug}/documents`, async () => {
      await page.locator('[data-bc-docview="list"]').click()
      await page.waitForTimeout(400)
    })
    await shot('home-arrange', slug, async () => {
      await page.locator('[data-bc-arrange]').first().click()
      await page.waitForTimeout(300)
    })
    /*
      CONTACTS WAS IN NO CAPTURE AT ALL until this line. It is one of the six
      tools this experience renders, it has a preview on the overview, and
      nobody had ever looked at the surface behind it — which is exactly how
      the Activity defect survived four capture runs.
    */
    await shot('contacts', `${slug}/contacts`)
    await shot('sources', `${slug}/sources`)
    await shot('activity', `${slug}/activity`)
  }
  await shot('my-tasks', '/basecamp/tasks')
  await shot('jump-open', '/basecamp', async () => {
    await page.locator('[data-bc-jump]').first().click()
    await page.waitForTimeout(250)
  })
  await shot('search-empty', '/basecamp/search')
  await shot('search-results', '/basecamp', async () => {
    await page.locator('[data-bc-jump]').first().click()
    await page.waitForTimeout(200)
    await page.locator('#bcjumpq').fill('interview')
    await page.waitForTimeout(200)
    await page.keyboard.press('Shift+Enter')
    await page.waitForSelector('#bc-search-q', { timeout: 5000 })
    await page.waitForTimeout(350)
  })
  await shot('jump-typed', '/basecamp', async () => {
    await page.locator('[data-bc-jump]').first().click()
    await page.waitForTimeout(200)
    await page.locator('#bcjumpq').fill('ta')
    await page.waitForTimeout(250)
  })

  await ctx.close()
}

await browser.close()
server.close()

console.log(`captured ${String(taken)} screen(s) into ${OUT}/`)
if (thrown.length > 0) {
  console.log(`\nPAGE ERRORS (${String(thrown.length)}):`)
  for (const t of new Set(thrown)) console.log(`  ${t}`)
}
if (missed.length > 0) {
  console.log(`\nCOULD NOT CAPTURE (${String(missed.length)}):`)
  for (const m of missed) console.log(`  ${m}`)
}
console.log('\nThis passes and fails nothing. Open the images.')
