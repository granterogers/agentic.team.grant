/**
 * The studio stops moving when it is asked to.
 *
 *   npm run verify:motion
 *
 * Issue #120. `prefers-reduced-motion` is a setting the operating system
 * already knows, and for some people it is not a preference but the difference
 * between using a page and closing it.
 *
 * ## The issue's premise was half wrong, which is worth recording
 *
 * #120 was filed saying reduced motion "is not honoured". It largely was:
 * `motion.js` checks it in `spring()` and `carry()`, `alive.js` checks it
 * before every ambient cue, and the stylesheet already had nine
 * `prefers-reduced-motion` blocks.
 *
 * What did not exist was any way to know that. Nine hand-written blocks against
 * ninety-four transitions and animations is a coverage question nobody can
 * answer by reading, and every new rule since has been one more chance to
 * forget. **A guarantee nothing measures is a guarantee that decays**, which is
 * the same argument every other suite in this directory was written from.
 *
 * ## What it measures
 *
 * The page is opened twice — once normally, once with `reducedMotion: 'reduce'`
 * — and every element on every screen is asked what its computed
 * animation and transition durations are. The reduced pass must find nothing
 * still running.
 *
 * The comparison is the point. A page with no motion in EITHER pass would
 * satisfy a naive "nothing is animating" assertion while having lost the design
 * entirely, so the normal pass has a floor: the studio is supposed to move.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4633
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
// P3: these read the dashboard of the person whose pages are being captured, so they name that office first.
const OFFICE_FIRST = new Set(['hq_studio', 'usage_overview', 'hq_studio_lately'])
const callOf = (fn: string, args: string): string =>
  `app.${fn}(${OFFICE_FIRST.has(fn) ? `app.sole_person_office()${args === '' ? '' : `, ${args}`}` : args})`
const sections: Record<string, unknown> = {}
for (const [name, fn, args] of [
  ['studio', 'hq_studio', ''],
  ['studio_settings', 'hq_studio_settings', ''],
  ['usage_overview', 'usage_overview', '30'],
  ['studio_setup', 'hq_setup', ''],
] as const) {
  sections[name] = (
    (await db.execute(`select ${callOf(fn, args)} as d`)).rows[0] as { d: unknown }
  ).d
}

const server = createServer(async (rq, rs) => {
  let f = join('web/studio', decodeURIComponent((rq.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  // A dotless path is a route, as on the host (#382: the older studio is under /classic).
  if (!existsSync(f) && extname(f) === '') f = join('web/studio', 'index.html')
  if (!existsSync(f)) {
    rs.writeHead(404)
    rs.end('not here')
    return
  }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  rs.end(await readFile(f))
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

/*
  What is moving, named.

  A count would say "eleven things are animating" and send you looking. The
  selector and the property are what make a finding fixable, which is the same
  reason `npm run wide` names the element rather than reporting that the page
  overflows.

  Infinite animations are separated from finite ones because they are a
  different problem: a 200ms fade that survives reduced motion is a rule
  somebody forgot, and a loop that never stops is the thing people actually
  cannot tolerate.
*/
const MOVING = `(() => {
  const named = (el) => {
    const id = el.id === '' ? '' : '#' + el.id
    const cls = typeof el.className === 'string' && el.className !== ''
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : ''
    return (el.tagName.toLowerCase() + id + cls).slice(0, 44)
  }
  const secs = (v) => String(v).split(',')
    .map((x) => Number.parseFloat(x) || 0)
    .reduce((a, b) => Math.max(a, b), 0)

  const looping = []
  const finite = []
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue

    const anim = secs(cs.animationDuration)
    if (anim > 0.02) {
      const forever = String(cs.animationIterationCount).split(',')
        .some((x) => x.trim() === 'infinite')
      ;(forever ? looping : finite).push(named(el) + ' animation ' + anim + 's')
    }
    /*
      A transition duration is potential rather than actual movement: it only
      animates when a property changes. It still counts. Reduced motion means
      the hover does not slide either, and a 340ms grid-template-columns on the
      shell is the single largest movement in the product.
    */
    const trans = secs(cs.transitionDuration)
    if (trans > 0.02) finite.push(named(el) + ' transition ' + trans + 's')
  }
  return { looping: [...new Set(looping)], finite: [...new Set(finite)] }
})()`

type Moving = { looping: string[]; finite: string[] }

const sweep = async (reduce: boolean): Promise<Moving> => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  })
  const page = await context.newPage()
  // The page has to know which office it belongs to before its first line
  // runs, or the shim below never sees a URL with hq-api in it. ADR-0048.
  await page.addInitScript(namesAnOffice())

  await page.addInitScript(`
    window.__S = ${JSON.stringify(sections)};
    try { localStorage.setItem('hq.token', 'verify-motion'); } catch (e) {}
    window.fetch = async (input) => {
      const url = String(input);
      if (url.includes('hq-api')) {
        const m = /section=([a-z_]+)/.exec(url);
        return new Response(JSON.stringify({ data: m ? (window.__S[m[1]] ?? {}) : {} }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
  `)
  await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2_000)

  const all: Moving = { looping: [], finite: [] }
  const take = async (): Promise<void> => {
    const got = (await page.evaluate(MOVING)) as Moving
    all.looping.push(...got.looping)
    all.finite.push(...got.finite)
  }
  await take()

  // Into a project, where most of the product lives, and then Settings.
  await page.evaluate(`document.querySelector('[data-open]')?.click()`)
  await page.waitForTimeout(1_200)
  await take()
  await page.evaluate(`document.querySelector('[data-settings]')?.click()`)
  await page.waitForTimeout(900)
  await take()

  if (process.env.SHOT === '1') {
    await page.screenshot({ path: `.out/motion-${reduce ? 'reduced' : 'full'}.png` })
  }
  await context.close()
  return { looping: [...new Set(all.looping)], finite: [...new Set(all.finite)] }
}

const browser = await chromium.launch()
const full = await sweep(false)
const calm = await sweep(true)

/*
  The floor first.

  A page with no motion in EITHER pass would pass a naive "nothing is animating"
  assertion while having lost the design. `verify:design` exists because that
  happened once — a week of motion work went into a file the deploy did not
  ship, and every check was green.
*/
check(
  'the studio moves when nobody has asked it not to',
  `${String(full.looping.length)} looping, ${String(full.finite.length)} finite`,
  full.looping.length + full.finite.length >= 10,
)

check(
  'and nothing loops forever once reduced motion is asked for',
  calm.looping.length === 0 ? 'nothing' : calm.looping.slice(0, 4).join(' · '),
  calm.looping.length === 0,
)

check(
  'and nothing transitions or animates at all',
  calm.finite.length === 0 ? 'nothing' : calm.finite.slice(0, 6).join(' · '),
  calm.finite.length === 0,
)

/*
  And the JavaScript half, which the CSS cannot cover.

  `spring()` builds keyframes and calls `el.animate()`; `carry()` starts a View
  Transition that paints an overlay over the whole page for about 900ms. Neither
  is a CSS rule, so neither appears in the sweep above, and both are among the
  largest movements in the product.
*/
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
})
const page = await context.newPage()
await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1_200)

const js = (await page.evaluate(`(async () => {
  const m = await import('./motion.js');
  const el = document.createElement('div');
  document.body.append(el);
  const a = m.spring(el, { opacity: '0' }, { opacity: '1' });
  const springMs = a.effect.getTiming().duration;
  a.cancel();
  let carried = false;
  m.carry('probe', null, () => { carried = true });
  el.remove();
  return { reduced: m.reduced(), springMs, carried };
})()`)) as { reduced: boolean; springMs: number; carried: boolean }
await context.close()

check(
  'the motion module knows reduced motion is asked for',
  String(js.reduced),
  js.reduced === true,
)
check(
  'a spring collapses to a token duration rather than its measured curve',
  `${String(js.springMs)}ms, against 288ms for a move`,
  js.springMs <= 120,
)
/*
  `carry()` must still perform the update. A reduced-motion path that skipped
  the work rather than the animation would be a page that stops navigating for
  the people who need it most — the failure mode worth guarding, not the
  animation.
*/
check(
  'and carry still does the work, it just does not animate it',
  js.carried ? 'the update ran' : 'THE UPDATE WAS SKIPPED',
  js.carried === true,
)

await browser.close()
server.close()

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
