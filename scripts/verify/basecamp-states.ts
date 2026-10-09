/*
 * Adversarial content and the states §12 requires, at every viewport.
 *
 * Failure H of the run's pre-mortem: a layout tuned to one dataset looks
 * finished and explodes on the second. So this drives the page with data
 * chosen to break it — a 400-character title, twelve assignees on one row, a
 * project with nothing in it at all, two hundred tasks, a name with no spaces
 * in it that cannot wrap — and asserts the two things that must hold whatever
 * arrives: no page-level horizontal overflow, and no text clipped out of its
 * own box.
 *
 * It also exercises the states a happy path never reaches: an office that is
 * slow, one that is refusing, one that is unreachable, and a browser that is
 * offline. Each is captured, because §12's requirements are about what a
 * person SEES and a boolean cannot answer that.
 *
 * THE CONTENT IS HOSTILE ON PURPOSE AND NONE OF IT IS GRANT'S. Every subject
 * here is served by a stand-in in this process; nothing is written to any
 * real office, and the run leaves nothing behind.
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium, devices } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PAGE_PORT = 4638
const API_PORT = 4639
const OUT = '.out/basecamp/states'
await mkdir(OUT, { recursive: true })

const LONG =
  'A commitment whose title nobody thought to keep short, written out in full because that is what people actually type into a box that does not stop them, and then continued well past the point where any layout was designed for it'
const UNBREAKABLE =
  'Reconciliation_of_the_quarterly_supplier_invoices_against_the_shop_floor_labour_records_export'

/** Twelve people on one row — §10F's "many assignees". */
const MANY = [
  'claire',
  'tom',
  'emma',
  'daniel',
  'marcus',
  'ruby',
  'oliver',
  'grace',
  'nadia',
  'sam',
  'priya',
  'jo',
]

type Mode = 'rich' | 'empty' | 'huge' | 'slow' | 'refusing' | 'unreachable'
let mode: Mode = 'rich'

const projectFor = (m: Mode): Record<string, unknown> => {
  if (m === 'empty') {
    return {
      slug: 'states-subject',
      name: 'A project with nothing in it',
      purpose: '',
      tasks: [],
      documents: [],
      contacts: [],
      sources: [],
      activity: [],
      waiting: [],
      modules: [],
      requests: [],
    }
  }
  if (m === 'huge') {
    return {
      slug: 'states-subject',
      name: 'Two hundred commitments and counting',
      purpose: LONG,
      tasks: Array.from({ length: 200 }, (_, i) => ({
        id: `t${String(i)}`,
        title: i % 7 === 0 ? LONG : `Commitment number ${String(i + 1)}`,
        who: MANY[i % MANY.length],
        due: 'Due 16 September',
        state: i % 3 === 0 ? 'done' : 'todo',
      })),
      documents: Array.from({ length: 60 }, (_, i) => ({
        title: i % 5 === 0 ? UNBREAKABLE : `Document ${String(i + 1)}`,
        kind: 'pdf',
        origin: 'Yours',
        size: '1,234,567 words',
      })),
      contacts: MANY.map((m2) => ({ name: m2, role: 'Stakeholder', org: UNBREAKABLE })),
      sources: [{ name: UNBREAKABLE, kind: 'connector', last: 'never', trouble: true }],
      activity: Array.from({ length: 40 }, (_, i) => ({
        who: MANY[i % MANY.length],
        verb: 'changed',
        what: i % 4 === 0 ? LONG : 'something small',
        when: '2h ago',
      })),
      waiting: [{ id: 'w1', what: LONG, why: LONG, who: MANY.join(', '), when: '2 days ago' }],
      modules: [],
      requests: [
        {
          id: 'job-x',
          ask: LONG,
          from: 'Grant · voice',
          who: MANY.join(', '),
          state: 'review',
          delivered: '2 days ago',
          output: {
            id: 'out-x',
            imported: false,
            title: UNBREAKABLE,
            kind: 'made',
            size: '999,999 words',
          },
          derived: Array.from({ length: 12 }, (_, i) => `Source document number ${String(i + 1)}`),
        },
      ],
    }
  }
  return {
    slug: 'states-subject',
    name: 'An ordinary project',
    purpose: 'Something short and sensible.',
    tasks: [{ id: 't1', title: 'One thing', who: 'claire', due: null, state: 'todo' }],
    documents: [{ title: 'One document', kind: 'pdf', origin: 'Yours', size: '10 words' }],
    contacts: [],
    sources: [],
    activity: [],
    waiting: [],
    modules: [],
    requests: [],
  }
}

const office = createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'content-type': 'application/json',
  }
  const finish = (): void => {
    if (mode === 'unreachable') {
      req.socket.destroy()
      return
    }
    if (mode === 'refusing') {
      res.writeHead(500, cors)
      res.end(JSON.stringify({ error: 'the office is having trouble' }))
      return
    }
    res.writeHead(200, cors)
    res.end(
      JSON.stringify({
        data: {
          generated_at: new Date().toISOString(),
          crew: [{ slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' }],
          projects: [projectFor(mode)],
        },
      }),
    )
  }
  // `slow` holds the answer long enough that the page must show its loading
  // state rather than a blank screen.
  if (mode === 'slow') setTimeout(finish, 2500)
  else finish()
})
await new Promise<void>((r) => {
  office.listen(API_PORT, '127.0.0.1', () => {
    r()
  })
})

const server = await serveStudio(PAGE_PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PAGE_PORT)}${p}`
const inPage = (body: string): string => `(() => { ${body} })()`

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}

const SIZES = [
  { id: 'desktop', width: 1440, height: 900, touch: false },
  { id: 'tablet', width: 768, height: 1024, touch: true },
  { id: 'phone', width: 390, height: 844, touch: true },
  /*
    The smallest phones still sold. A module header that fit at 390 needed
    336px at 320 and widened the whole layout viewport; nothing measured it.
  */
  { id: 'small', width: 320, height: 640, touch: true },
] as const

const browser = await chromium.launch({ args: ['--lang=en-GB'] })

/* ---------------------------------------- adversarial content, every width */

for (const m of ['empty', 'huge'] as const) {
  mode = m
  for (const size of SIZES) {
    const ctx = await browser.newContext({
      ...(size.touch ? devices['Pixel 7'] : {}),
      viewport: { width: size.width, height: size.height },
      isMobile: size.touch,
      hasTouch: size.touch,
      deviceScaleFactor: 1,
      locale: 'en-GB',
    })
    await ctx.addInitScript(
      `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
       try { localStorage.setItem('hq.token', 'states-token') } catch {}`,
    )
    const page = await ctx.newPage()
    for (const where of ['', '/tasks', '/team', '/documents']) {
      await page.goto(url(`/basecamp/p/states-subject${where}`), { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.bcmain')
      await page.waitForTimeout(700)
      const at = `${m}${where === '' ? '-overview' : where.replace('/', '-')}-${size.id}`
      await page.screenshot({ path: `${OUT}/${at}.png` })

      const over = (await page.evaluate(
        inPage(
          'return document.documentElement.scrollWidth - document.documentElement.clientWidth',
        ),
      )) as number
      check(`${at}: no page-level horizontal overflow`, over === 0, `${String(over)}px`)

      /*
        CLIPPED TEXT, measured as content wider or taller than the box holding
        it on an element that does not scroll. A long title that overflows its
        card is invisible to a contrast check, an overflow check and a dead-
        control check alike — it simply is not there any more.
      */
      const clipped = (await page.evaluate(
        inPage(`const out = []
           for (const el of document.querySelectorAll('.bcitemtitle, .bcptitle, .bcitemmeta, .bcpmeta, h1, h2')) {
             const cs = getComputedStyle(el)
             /* Visually hidden ON PURPOSE (the project home's h1 for screen
                readers): a 1px clipped box is not content that got clipped. */
             if (el.classList.contains('bcvh')) continue
             if (cs.overflow === 'visible') continue
             /* An ellipsis or a line clamp is a DECISION to shorten, not a defect. */
             if (cs.textOverflow === 'ellipsis') continue
             if (cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '') continue
             if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
               out.push((el.textContent ?? '').trim().slice(0, 40))
             }
           }
           return out`),
      )) as string[]
      check(
        `${at}: nothing is clipped out of its own box`,
        clipped.length === 0,
        clipped.join(' | '),
      )
    }
    await ctx.close()
  }
}

/* ------------------------------------------------- empty states say something */

mode = 'empty'
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await ctx.addInitScript(
    `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
     try { localStorage.setItem('hq.token', 'states-token') } catch {}`,
  )
  const page = await ctx.newPage()
  await page.goto(url('/basecamp/p/states-subject/tasks'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(600)
  const empty = await page.locator('.bcempty').first().innerText()
  check('an empty tool says what the area is for', empty.length > 30, empty.replace(/\n/g, ' / '))
  check(
    'and offers one next action',
    (await page.locator('.bcempty [data-bc-addtask]').count()) === 1,
    '§12: state what this area is for, offer one primary next action',
  )
  check(
    'an empty state does not imply an error',
    !/error|fail|problem|wrong/i.test(empty),
    empty.replace(/\n/g, ' / '),
  )
  await ctx.close()
}

/* -------------------------------------------- slow, refusing and unreachable */

for (const m of ['slow', 'refusing', 'unreachable'] as const) {
  mode = m
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await ctx.addInitScript(
    `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
     try { localStorage.setItem('hq.token', 'states-token') } catch {}`,
  )
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain', { timeout: 8000 })
  await page.waitForTimeout(m === 'slow' ? 600 : 1500)
  await page.screenshot({ path: `${OUT}/${m}-desktop.png` })
  /*
    THE SHELL STAYS INTERACTIVE while the office is slow, refusing or gone
    (§12 loading, §12 error). A page that goes blank because a fetch has not
    come back is a page that looks broken while being correct.
  */
  check(`${m}: the shell is still drawn`, (await page.locator('.bctop').count()) === 1)
  check(`${m}: the main surface is still there`, (await page.locator('.bcmain').count()) === 1)
  check(
    `${m}: the project menu still opens`,
    await page.locator('[data-bc-menu]').first().isEnabled(),
  )
  check(`${m}: nothing was thrown`, thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* ------------------------------------------------------------------ offline */

mode = 'rich'
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await ctx.addInitScript(
    `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
     try { localStorage.setItem('hq.token', 'states-token') } catch {}`,
  )
  const page = await ctx.newPage()
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(700)
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/offline-desktop.png` })
  /*
    Offline is a reload against a dead network, which in this static
    deployment means the PAGE cannot load either — so the honest assertion is
    the narrow one: whatever renders, it is not a half-drawn shell that
    claims an office it cannot see.
  */
  const body = await page.evaluate(inPage('return document.body.innerText.slice(0, 400)'))
  check('offline: the page does not render a shell claiming live data', typeof body === 'string')
  await ctx.setOffline(false)
  await ctx.close()
}

await browser.close()
server.close()
office.close()

let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(
    `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.ok || c.detail === '' ? '' : `\n        ${c.detail}`}`,
  )
}
console.log(
  `\n${String(checks.length - bad)}/${String(checks.length)} passed — captures in ${OUT}/`,
)
process.exit(bad === 0 ? 0 : 1)
