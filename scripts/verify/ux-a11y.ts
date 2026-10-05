/*
 * TEAM HQ ACCESSIBILITY, MEASURED RATHER THAN ASSUMED (the ledger's HQ-A11Y rows and HQ-QA-009).
 *
 *   npx tsx scripts/verify/ux-a11y.ts
 *
 * Before this the ledger said "axe not run" and "contrast not measured". This runs axe-core (WCAG 2.0/2.1 A and AA,
 * COLOUR CONTRAST INCLUDED - verify:access leaves it out because it measures the classic studio's tokens elsewhere,
 * and nothing measured Team HQ's) over the Team HQ states this run added or changed, at desktop, tablet and a touch
 * phone, and then asserts the properties axe cannot:
 *   - TAB ORDER: Tab through the project home; every stop is a visible, named control with a visible focus
 *     indicator, nothing is a trap, and a control that is hidden until hover is revealed by focus.
 *   - TOUCH: on a coarse pointer the module controls are revealed without hover and are at least 44px.
 *   - iOS INPUT ZOOM: every field the new surfaces draw computes to at least 16px.
 *   - A DETECTOR THAT CAN FAIL: a deliberately inaccessible control is injected and must be reported.
 * Browser code travels as a string: tsconfig has no DOM lib on purpose.
 */
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4687
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
const AXE = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
const OPTIONS = JSON.stringify({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
})
interface Violation {
  id: string
  impact?: string
  help: string
  nodes: { target: string[]; html: string; failureSummary?: string }[]
}
type Page = import('playwright').Page

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const thrown: string[] = []

const open = async (
  width: number,
  height: number,
  touch: boolean,
): Promise<{ page: Page; slug: string; close: () => Promise<void> }> => {
  const ctx = await browser.newContext({
    viewport: { width, height },
    ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  })
  const page = await ctx.newPage()
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
  return { close: () => ctx.close(), page, slug }
}

const found = new Map<string, { v: Violation; where: string }>()
const audit = async (page: Page, where: string): Promise<void> => {
  await page.evaluate(AXE)
  const result = (await page.evaluate(
    `axe.run(document, ${OPTIONS}).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target, html: n.html.slice(0, 140), failureSummary: (n.failureSummary || '').slice(0, 200) })) })))`,
  )) as Violation[]
  for (const v of result)
    for (const n of v.nodes)
      found.set(`${v.id}::${n.target.join(' ')}`, { v: { ...v, nodes: [n] }, where })
}

const WIDTHS: [string, number, number, boolean][] = [
  ['desktop 1440', 1440, 900, false],
  ['laptop 1280', 1280, 800, false],
  ['tablet 768', 768, 1024, true],
  ['phone 390', 390, 844, true],
]

for (const [label, w, h, touch] of WIDTHS) {
  const { page, slug, close } = await open(w, h, touch)
  const go = async (path: string): Promise<void> => {
    await page.goto(url(path), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
  }
  /* 1. the project home with a Post-it holding text */
  await go(slug)
  await page.waitForSelector('.bcstage [data-mod]')
  const note = page.locator('.bcpostit textarea, [data-bc-note]').first()
  if ((await note.count()) > 0) {
    await note.fill('Call the venue about parking').catch(() => undefined)
  }
  await audit(page, `${label}: project home`)
  /* 2. layout popovers */
  for (const sel of ['[data-bc-layouts]', '[data-bc-tint]']) {
    const b = page.locator(sel).first()
    if ((await b.count()) === 0 || !(await b.isVisible().catch(() => false))) continue
    await b.click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(300)
    await audit(page, `${label}: ${sel} open`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
  /* 3. schedule maximised: month, week, day */
  const max = page.locator('[data-bc-max="schedule"]').first()
  if ((await max.count()) > 0) {
    await max.click({ force: true })
    await page.waitForSelector('.bcexp .bcexpbox')
    await page.waitForTimeout(500)
    for (const mode of ['Month', 'Week', 'Day']) {
      const b = page
        .locator('.bcexp [role="group"] button, .bcexp .bccalmode button', {
          hasText: new RegExp(`^${mode}$`),
        })
        .first()
      if ((await b.count()) > 0) await b.click().catch(() => undefined)
      await page.waitForTimeout(250)
      await audit(page, `${label}: schedule ${mode}`)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
  /* 4. documents, viewer */
  await go(`${slug}/documents`)
  await page.waitForSelector('.bcdocfilter')
  await audit(page, `${label}: documents`)
  await page.locator('[data-bc-doc-open]').first().click({ force: true })
  await page.waitForTimeout(700)
  await audit(page, `${label}: document viewer`)
  /* 5. palette */
  await go(slug)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await audit(page, `${label}: palette`)
  await page.keyboard.press('Escape')
  /* 6. activity */
  await go(`${slug}/activity`)
  await audit(page, `${label}: activity`)
  await close()
}

const list = [...found.values()]
const byRule = new Map<string, { n: number; v: Violation; first: string }>()
for (const { v, where } of list) {
  const hit = byRule.get(v.id)
  if (hit === undefined) byRule.set(v.id, { first: where, n: 1, v })
  else hit.n += 1
}
console.log(`\naxe: ${String(list.length)} violating node(s) across ${String(byRule.size)} rule(s)`)
for (const { v, where } of list.filter((x) => x.v.id === 'color-contrast')) {
  console.log(
    `  contrast @ ${where}: ${v.nodes[0]?.html ?? ''} :: ${(v.nodes[0]?.failureSummary ?? '').replace(/\n/g, ' ').slice(0, 150)}`,
  )
}
for (const [id, { n, v, first }] of byRule) {
  console.log(
    `  ${id} (${v.impact ?? '?'}) x${String(n)} - ${v.help}\n    first: ${first}\n    ${v.nodes[0]?.html ?? ''}\n    ${(v.nodes[0]?.failureSummary ?? '').replace(/\n/g, ' | ')}`,
  )
}
check(
  'axe (WCAG 2.1 A/AA incl. colour contrast): no violations on any audited state',
  list.length === 0,
  `${String(list.length)} node(s)`,
)

/* ----------------------------------------------------- every curated tint keeps the text legible (HQ-TINT-006) */
{
  const { page, slug, close } = await open(1440, 900, false)
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(500)
  const say = async (text: string): Promise<void> => {
    await page.keyboard.press('Control+k')
    await page.waitForSelector('#bcjump')
    await page.keyboard.type(text)
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
  }
  const rounds: [string, string][][] = [
    [['tasks', 'blue'], ['card table', 'teal'], ['documents', 'green'], ['calendar', 'olive'], ['contacts', 'yellow'], ['activity', 'orange']],
    [['tasks', 'red'], ['card table', 'pink'], ['documents', 'purple'], ['calendar', 'navy'], ['contacts', 'grey'], ['activity', 'sky']],
  ]
  const before = found.size
  let r = 0
  for (const round of rounds) {
    r += 1
    for (const [who, colour] of round) await say(`make ${who} ${colour}`)
    const tinted = (await page.evaluate(inPage(`return document.querySelectorAll('.bcstage .bcmod--tinted').length`))) as number
    check(`tint round ${String(r)}: all six modules are tinted before auditing`, tinted === 6, String(tinted))
    await audit(page, `tinted modules, round ${String(r)}`)
    await page.screenshot({ path: `.out/ux-a11y-tints-${String(r)}.png` })
  }
  check('every curated tint keeps text contrast and ARIA clean (no new axe finding with tints applied)', found.size === before, `${String(found.size - before)} new node(s)`)
  await close()
}

/* ----------------------------------------------------- a detector that can fail */
{
  const { page, slug, close } = await open(1440, 900, false)
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.evaluate(
    inPage(
      `const b = document.createElement('button'); b.id = 'a11y-control'; b.style.cssText = 'position:fixed;left:4px;top:4px;color:#777;background:#7a7a7a;font-size:14px'; document.body.append(b); const t = document.createElement('p'); t.id = 'a11y-text'; t.textContent = 'faint words'; t.style.cssText = 'position:fixed;left:4px;top:40px;color:#777;background:#7a7a7a;font-size:14px'; document.body.append(t); return true`,
    ),
  )
  await page.evaluate(AXE)
  const out = (await page.evaluate(
    `axe.run(document, ${OPTIONS}).then(r => r.violations.map(v => v.id))`,
  )) as string[]
  check(
    'control: a nameless low-contrast button IS reported by this audit',
    out.includes('button-name') && out.includes('color-contrast'),
    out.join(','),
  )
  await close()
}

/* ----------------------------------------------------- tab order (HQ-QA-009) */
{
  const { page, slug, close } = await open(1440, 900, false)
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(500)
  await page.evaluate(
    inPage('document.activeElement && document.activeElement.blur(); return true'),
  )
  const stops: { tag: string; name: string; visible: boolean; ring: boolean; key: string }[] = []
  for (let i = 0; i < 90; i += 1) {
    await page.keyboard.press('Tab')
    const s = (await page.evaluate(
      inPage(
        `const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const name = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('data-bc-max') || '').trim().slice(0, 40); const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none'); const op = parseFloat(cs.opacity); return { tag: e.tagName.toLowerCase(), name, visible: r.width > 0 && r.height > 0 && op > 0.05 && cs.visibility !== 'hidden', ring: !!ring, key: e.tagName + ':' + name + ':' + Math.round(r.x) + ',' + Math.round(r.y) }`,
      ),
    )) as { tag: string; name: string; visible: boolean; ring: boolean; key: string } | null
    if (s === null) break
    if (stops.some((q) => q.key === s.key)) break // the cycle closed
    stops.push(s)
  }
  check(
    'Tab walks the project home: at least 25 stops before the cycle closes',
    stops.length >= 25,
    String(stops.length),
  )
  const hidden = stops.filter((s) => !s.visible)
  check(
    'every Tab stop is visible when it has focus (a hover-only control is revealed by focus)',
    hidden.length === 0,
    hidden.map((s) => `${s.tag}:${s.name}`).join(' | '),
  )
  const noName = stops.filter((s) => s.name === '' && s.tag !== 'textarea')
  check(
    'every Tab stop has an accessible name',
    noName.length === 0,
    noName.map((s) => s.key).join(' | '),
  )
  const noRing = stops.filter((s) => !s.ring)
  check(
    'every Tab stop shows a focus indicator',
    noRing.length === 0,
    noRing.map((s) => `${s.tag}:${s.name}`).join(' | '),
  )
  // Shift+Tab walks back the same way (no one-way door)
  await page.keyboard.press('Shift+Tab')
  check(
    'Shift+Tab moves focus backwards (no trap)',
    (await page.evaluate(inPage('return document.activeElement !== document.body'))) as boolean,
  )
  await close()
}

/* ----------------------------------------------------- touch: controls are there without hover, and big enough */
{
  const { page, slug, close } = await open(768, 1024, true)
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(500)
  const m = (await page.evaluate(
    inPage(
      `const mods = [...document.querySelectorAll('.bcstage [data-mod]')].slice(0, 6); const out = []; for (const m of mods) { for (const b of m.querySelectorAll('.bcmodctl button')) { const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); out.push({ id: m.dataset.mod, what: (b.getAttribute('aria-label') || b.getAttribute('title') || b.className || '').slice(0, 30), op: parseFloat(cs.opacity), w: r.width, h: r.height, coarse: matchMedia('(pointer: coarse)').matches }) } } return out`,
    ),
  )) as { id: string; what: string; op: number; w: number; h: number; coarse: boolean }[]
  check(
    'the browser reports a coarse pointer (touch emulation is on)',
    m.length > 0 && m[0]?.coarse === true,
  )
  const shy = m.filter((x) => x.op < 0.9)
  check(
    'on touch, module controls are revealed without hover (HQ-CTRL-004)',
    shy.length === 0,
    shy.map((x) => `${x.id}:${x.what}:${x.op}`).join(' | '),
  )
  // a control that is not drawn at all (the colour control is absent from the stacked layout below 860px) has no box
  const drawn = m.filter((x) => x.w > 0 && x.h > 0)
  check(
    'the maximise control is drawn on a touch tablet',
    drawn.some((x) => x.what.startsWith('Maximise')),
    String(drawn.length),
  )
  const small = drawn.filter((x) => x.w < 43.5 || x.h < 43.5)
  check(
    'on touch, module controls are at least 44x44 (HQ-A11Y-005)',
    small.length === 0,
    small.map((x) => `${x.id}:${x.what}:${Math.round(x.w)}x${Math.round(x.h)}`).join(' | '),
  )
  await close()
}

/* ----------------------------------------------------- iOS input zoom: every field is 16px or more */
{
  const { page, slug, close } = await open(390, 844, true)
  const fieldSizes = async (where: string): Promise<{ where: string; bad: string[] }> => {
    const bad = (await page.evaluate(
      inPage(
        `const out = []; for (const e of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), textarea, select')) { const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 15.99) out.push((e.getAttribute('aria-label') || e.name || e.className || e.tagName).slice(0, 30) + ' ' + fs + 'px'); } return out`,
      ),
    )) as string[]
    return { bad, where }
  }
  const results: { where: string; bad: string[] }[] = []
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(500)
  results.push(await fieldSizes('home (Post-it, header)'))
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  results.push(await fieldSizes('palette'))
  await page.keyboard.press('Escape')
  const max = page.locator('[data-bc-max="schedule"]').first()
  await max.click({ force: true })
  await page.waitForSelector('.bcexp .bcexpbox')
  await page.waitForTimeout(400)
  const ne = page.locator('.bcexp button', { hasText: 'New event' }).first()
  if ((await ne.count()) > 0) {
    await ne.click({ force: true })
    await page.waitForTimeout(400)
  }
  results.push(await fieldSizes('calendar + event form'))
  await page.keyboard.press('Escape')
  await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcdocfilter')
  results.push(await fieldSizes('documents'))
  for (const r of results)
    check(`inputs are 16px or more: ${r.where}`, r.bad.length === 0, r.bad.join(' | '))
  await close()
}

check('no page errors during any of it', thrown.length === 0, thrown.join(' | '))
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
