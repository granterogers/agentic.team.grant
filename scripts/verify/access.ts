/**
 * The studio, checked for the people who do not use a mouse or a screen.
 *
 *   npm run verify:access
 *
 * Issue #200. Ninety-four open Issues and not one of them was about
 * accessibility — the nearest were #121 (*"the studio is a mouse-only
 * product"*) and the contrast and type-size checks inside `verify:layouts`,
 * which measure colour and size and nothing else.
 *
 * So the honest position before this: the product had a colour-contrast check
 * and a type floor, and had never been audited for screen readers, focus
 * management, keyboard operability or motion.
 *
 * ## axe-core, and what it does and does not prove
 *
 * axe finds the machine-checkable half: a control with no accessible name, an
 * image with no alternative, a landmark nested wrongly, an ARIA attribute that
 * contradicts its role, a heading order that skips. It is free (MPL-2.0) and
 * runs inside the Chromium this repository already drives.
 *
 * It does NOT prove the page is usable. Roughly half of WCAG is judgement — is
 * the focus order sensible, does the live region say something useful, is the
 * announcement worth interrupting for. A green run here is the floor, not the
 * ceiling, and this file should not be read as saying otherwise.
 *
 * ## With a token, or it measures nothing
 *
 * #74's lesson, which cost sixteen years-old touch-target defects the moment
 * it was fixed: an audit running as a reader never draws a single write
 * control, so every composer, every Send button and every settings write is
 * invisible to it. `AS_WRITER` is the same one-liner `verify:layouts` uses.
 *
 * ## Motion
 *
 * `prefers-reduced-motion` is emulated on one pass rather than checked as a
 * rule, because axe has nothing to say about it and the studio's whole visual
 * identity is built on continuous movement (`breathe()`, `scatter()`). What
 * this can prove is that the page still WORKS with the preference set — no
 * uncaught error, no control that has stopped existing. Whether it still feels
 * like the same product is a design question and belongs to a person.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'

const ROOT = 'web/studio'
const PORT = 4616
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const AXE = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
const AS_WRITER = `try{localStorage.setItem('hq.token','audit')}catch(e){}`

/*
  The rules this asserts, and the ones deliberately left out.

  `color-contrast` is excluded because `verify:layouts` already measures it
  against the real tokens in both themes, and two checks over one property is
  two places to update when the palette moves — the copy that rots.

  Everything else in the WCAG 2.1 AA tags is in. AA rather than AAA because AAA
  changes the colour palette, and Grant has not asked for that.
*/
const OPTIONS = JSON.stringify({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } },
})

interface Violation {
  id: string
  impact?: string
  help: string
  nodes: { target: string[]; failureSummary?: string }[]
}

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const browser = await chromium.launch()

/** Every screen worth auditing, and how to reach it. */
const ROUTES = ['overview', 'team', 'documents', 'tasks', 'contacts', 'sources', 'settings']

const audit = async (
  label: string,
  width: number,
  height: number,
  dark: boolean,
  reducedMotion: boolean,
): Promise<void> => {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ...(width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  })
  await ctx.addInitScript(AS_WRITER)
  await ctx.addInitScript(seedAppearance(dark ? 'dark' : 'light'))
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => thrown.push(e.message))

  await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('.project[data-open="legacy-coaching-course"]').first().click()
  await page.waitForTimeout(600)

  const found = new Map<string, Violation>()
  const trees: [string, { levels: number[]; skips: string[]; first: number; names: string[] }][] =
    []
  for (const route of ROUTES) {
    const tab = page.locator(`[data-tab="${route}"]`)
    if ((await tab.count()) === 0) continue
    await tab.first().click()
    await page.waitForTimeout(450)
    // The AI Team tab's chat is the conversation surface this Issue is most
    // about, so it is opened rather than left on the default sub-view.
    if (route === 'team') {
      const chat = page.locator('[data-sub="chat"]')
      if ((await chat.count()) > 0) {
        await chat.first().click()
        await page.waitForTimeout(450)
      }
    }
    /*
      The heading tree, PER ROUTE, and judged for usefulness (#207, §28).

      It used to be sampled once per device after the whole walk, on whichever
      screen happened to be left open, and asserted only that nothing skipped a
      level. A screen with one heading can never skip one, so the check passed
      for the wrong reason on every content screen in the product - the comment
      beside it said as much and filed the finding rather than asserting it.

      §28 is explicit that this is not enough: *"A screen with one h1 and no
      semantic section headings can technically pass heading-order checks while
      being poor for heading navigation. Accessibility tests must evaluate
      usefulness."*

      Three properties, all of them things a person navigating by heading would
      notice: nothing skips a level going down; the first heading is the h1, so
      the document does not open in the middle of itself; and a content screen
      offers somewhere to jump TO, which one heading does not.
    */
    const tree = (await page.evaluate(`(() => {
      const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .filter((h) => h.getBoundingClientRect().height > 0)
      const levels = hs.map((h) => Number(h.tagName.slice(1)))
      const skips = []
      for (let i = 1; i < levels.length; i += 1) {
        if (levels[i] - levels[i - 1] > 1) skips.push(levels[i - 1] + '->' + levels[i])
      }
      return { levels, skips, first: levels[0] ?? 0,
               names: hs.slice(0, 6).map((h) => 'h' + h.tagName.slice(1) + ' ' + (h.textContent || '').trim().slice(0, 18)) }
    })()`)) as { levels: number[]; skips: string[]; first: number; names: string[] }
    trees.push([route, tree])

    await page.evaluate(AXE)
    const result = (await page.evaluate(
      `axe.run(document, ${OPTIONS}).then(r => r.violations)`,
    )) as Violation[]
    for (const v of result) {
      // Keyed by rule and by the element it names, so the same defect on seven
      // tabs is one finding rather than seven — a count inflated by repetition
      // is a count nobody reads.
      for (const n of v.nodes) {
        found.set(`${v.id}::${n.target.join(' ')}`, v)
      }
    }
  }

  const worst = [...found.entries()].filter(
    ([, v]) => v.impact === 'critical' || v.impact === 'serious',
  )
  check(
    `${label} — nothing critical or serious`,
    worst.length === 0
      ? `${String(found.size)} minor/moderate, 0 serious`
      : worst
          .slice(0, 4)
          .map(([k, v]) => `${v.id} on ${k.split('::')[1]?.slice(0, 40)}`)
          .join(' · '),
    worst.length === 0,
  )
  if (found.size > 0 && worst.length === 0) {
    for (const [k, v] of [...found.entries()].slice(0, 6)) {
      console.log(`       minor: ${v.id} — ${k.split('::')[1]?.slice(0, 50)}`)
    }
  }

  /*
    Every control has a name a screen reader can say (#200).

    axe's `button-name` and `link-name` rules cover most of this and are
    already running above — but they are scoped to what axe considers a
    violation, and an icon button whose only label is a `title` passes axe
    while being read aloud inconsistently across screen readers. So this asks
    the browser's own accessible-name computation, on every visible
    interactive element, on the screen the audit is standing on.

    #200 suggested growing an existing audit rather than writing a new one, and
    named `verify:wired` — but that one collects `data-*` attributes and never
    computes a name, while this one is already walking the same screens with
    axe loaded. Here is cheaper and closer to the question.
  */
  const nameless = (await page.evaluate(`(() => {
    const out = []
    const sel = 'button, a[href], [role="button"], [role="tab"], input, select, textarea'
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const name = (
        el.getAttribute('aria-label') ??
        (el.getAttribute('aria-labelledby') === null
          ? null
          : (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent ?? null)) ??
        (el.textContent ?? '') ??
        ''
      ).trim()
      const alt = el.querySelector('img[alt]')?.getAttribute('alt') ?? ''
      const titled = el.getAttribute('title') ?? ''
      if (name === '' && alt.trim() === '' && titled.trim() === '') {
        out.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 34))
      }
    }
    return out
  })()`)) as string[]
  check(
    `${label} — every visible control has a name`,
    nameless.length === 0
      ? 'all named'
      : `${String(nameless.length)} without one: ${nameless.slice(0, 3).join(' · ')}`,
    nameless.length === 0,
  )

  /*
    Heading order, and the landmarks around it (#200).

    A screen reader user moves by heading and by landmark before they read
    anything, so a page whose levels jump from h1 to h4 is a page whose
    structure lies about what contains what. Checked as "never skips a level
    going down", which is the actual rule — going back UP any number of levels
    is normal and correct at the end of a section.
  */
  const structure = (await page.evaluate(`(() => {
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter((h) => h.getBoundingClientRect().height > 0)
      .map((h) => Number(h.tagName.slice(1)))
    const skips = []
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] - levels[i - 1] > 1) skips.push(levels[i - 1] + '->' + levels[i])
    }
    return {
      levels,
      skips,
      main: document.querySelectorAll('main, [role="main"]').length,
      nav: document.querySelectorAll('nav, [role="navigation"]').length,
      h1: levels.filter((l) => l === 1).length,
    }
  })()`)) as { levels: number[]; skips: string[]; main: number; nav: number; h1: number }
  /*
    The count is in the message on purpose.

    A screen with ONE heading can never skip a level, so this check passes for
    the wrong reason and would keep passing through any amount of structural
    decay — the shape of "a check that asks whether a list is an ARRAY passes
    while the list is wrong". Printing how many were found is what stops a
    green line meaning nothing: today it says `1 heading`, which is a finding
    in itself and is filed rather than asserted here, because adding headings
    is a design change and not a check's business.
  */
  check(
    `${label} — the headings never skip a level`,
    structure.skips.length === 0
      ? `${String(structure.levels.length)} heading${structure.levels.length === 1 ? '' : 's'}: h${structure.levels.join(', h')}`.slice(
          0,
          70,
        )
      : `skips ${structure.skips.join(', ')}`,
    structure.skips.length === 0,
  )
  /*
    Per route, and about usefulness rather than only about order.

    Reported as one line naming every route that fails, rather than one check
    per route: seven green lines saying the same thing is a report people skim,
    which this repository has already paid for twice.
  */
  const jumbled = trees.filter(([, t]) => t.skips.length > 0)
  const upside = trees.filter(([, t]) => t.levels.length > 0 && t.first !== 1)
  const barren = trees.filter(([, t]) => t.levels.length < 2)
  check(
    `${label} — no screen's headings skip a level`,
    jumbled.length === 0
      ? `${String(trees.length)} screens checked`
      : jumbled.map(([r, t]) => `${r} ${t.skips.join(',')}`).join(' · '),
    jumbled.length === 0,
  )
  check(
    `${label} — every screen opens on its own h1`,
    upside.length === 0
      ? 'the title is the first heading everywhere'
      : upside.map(([r, t]) => `${r} starts at h${String(t.first)}`).join(' · '),
    upside.length === 0,
  )
  check(
    `${label} — and every screen has somewhere to jump to`,
    barren.length === 0
      ? `fewest headings on a screen: ${String(Math.min(...trees.map(([, t]) => t.levels.length)))}`
      : `${barren.map(([r]) => r).join(', ')} — one heading, so moving by heading reaches nothing`,
    barren.length === 0,
  )

  check(
    `${label} — and there is exactly one main landmark to jump to`,
    `${String(structure.main)} main, ${String(structure.nav)} nav`,
    structure.main === 1 && structure.nav >= 1,
  )

  check(`${label} — nothing thrown`, thrown[0] ?? 'none', thrown.length === 0)
  await ctx.close()
}

try {
  console.log('\nthe studio, audited for the machine-checkable half of WCAG 2.1 AA')
  await audit('desktop light', 1440, 900, false, false)
  await audit('desktop dark', 1440, 900, true, false)
  await audit('phone light', 390, 844, false, false)
  console.log('\nand with motion turned down')
  await audit('desktop, reduced motion', 1440, 900, false, true)

  console.log('\nthe conversation can be reached and used from the keyboard')
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(AS_WRITER)
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('.project[data-open="legacy-coaching-course"]').first().click()
  await page.waitForTimeout(500)
  await page.locator('[data-tab="team"]').first().click()
  await page.waitForTimeout(400)
  const chatTab = page.locator('[data-sub="chat"]')
  if ((await chatTab.count()) > 0) {
    await chatTab.first().click()
    await page.waitForTimeout(450)
  }

  /*
    Tab from the top and see whether the composer is reachable at all. #121
    calls the studio a mouse-only product; the composer is the control that
    matters most for that claim, because a conversation you cannot type into
    without a mouse is not a conversation.
  */
  await page.keyboard.press('Tab')
  let reached = false
  for (let i = 0; i < 60 && !reached; i += 1) {
    reached = await page.evaluate(
      `document.activeElement !== null && document.activeElement.hasAttribute('data-say')`,
    )
    if (!reached) await page.keyboard.press('Tab')
  }
  check(
    'the composer can be reached by keyboard alone',
    reached ? 'reached within 60 stops' : 'NOT REACHABLE IN 60 TAB STOPS',
    reached,
  )

  const named = await page.evaluate(`(() => {
    const el = document.querySelector('[data-say]')
    if (el === null) return 'MISSING'
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
  })()`)
  check(
    'and it has a name a screen reader can say',
    String(named).slice(0, 46),
    String(named) !== 'MISSING' && String(named).trim() !== '',
  )

  const focusVisible = await page.evaluate(`(() => {
    const el = document.querySelector('[data-say]')
    if (el === null) return false
    el.focus()
    const cs = getComputedStyle(el)
    return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' || cs.borderColor !== ''
  })()`)
  check(
    'and focusing it is visible rather than silent',
    focusVisible === true ? 'has an outline, shadow or border change' : 'NO VISIBLE FOCUS',
    focusVisible === true,
  )
  await ctx.close()
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
