/**
 * Every layout, at every width, in every skin.
 *
 *   npm run verify:layouts            everything
 *   WIDTHS=390 npm run verify:layouts one width
 *
 * Issue #41. Grant: *"every layout at 390/768/1440 in both themes and both
 * palettes."*
 *
 * ## The combinatorial trap, and how this avoids it
 *
 * Four widths x two themes x five palettes x eight routes is 320 page states,
 * which at a second each is a run nobody will wait for. But the axes are not
 * independent in the way that multiplication assumes:
 *
 *   GEOMETRY — overflow, text size, touch targets — cannot vary by palette. A
 *   palette changes custom properties that are all colours. So geometry is
 *   swept across widths only, once.
 *
 *   COLOUR — contrast — cannot vary by width. So contrast is sampled across
 *   every palette and both themes, on the routes that carry the most kinds of
 *   text, at one width.
 *
 * That is 32 states plus 20, instead of 320, and it tests the same things.
 *
 * ## What it asserts
 *
 * The four in CLAUDE.md's visual standard, which `verify:ui` already enforces
 * for web/hq and nothing enforced for web/studio:
 *
 *   - no horizontal overflow of the document
 *   - no text below 12px
 *   - no interactive target below 44px
 *   - no input below 16px (iOS Safari zooms the page on focus otherwise)
 *
 * plus WCAG AA contrast on body text, which nothing checked anywhere.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'

const ROOT = 'web/studio'
const PORT = 4615
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.mjs': 'text/javascript; charset=utf-8',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
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

const WIDTHS = (process.env.WIDTHS ?? '390,768,1024,1440').split(',').map(Number)
const PALETTES = ['paper', 'slate', 'clay', 'ink', 'moss']
/*
  A route is a project tab, or — prefixed — a tab of the settings sheet.

  `settings/governance` is here because #54 put a whole reading surface behind
  a sheet this audit had never opened. Thirty-eight green states said nothing
  about it: an audit that looks somewhere other than where the user looks
  passes for the wrong reason, which this repository has now done three times
  in one day.
*/
const ROUTES = [
  'overview',
  'team',
  'documents',
  'tasks',
  'contacts',
  'sources',
  'activity',
  /*
    Project Settings, all four panes (#36).

    Every one, because this audit's own header records what happens otherwise:
    thirty-eight green states said nothing about a surface it had never opened,
    and the first run pointed at one found three defects. Four panes is four
    surfaces, and the pane with the switches and the text boxes is the one with
    touch targets and 16px inputs on it.
  */
  'project/people',
  'project/automations',
  'project/labels',
  'project/project',
  'settings/governance',
]

type Finding = { where: string; what: string }
const findings: Finding[] = []
let checked = 0

/*
  Geometry, in the page.

  Written as a string rather than a closure because this project's tsconfig has
  no `dom` lib — the same reason `scripts/verify/probe.ts` does it.

  Two exclusions, both deliberate. SVG children report geometry ignoring the
  viewport that clips them, so every drawn cover looks like an overflow.
  Anything inside a scroll container or a fixed element is overflowing on
  purpose — the section tabs and the phone's bottom bar both scroll.
*/
const GEOMETRY = `(() => {
  const out = { wide: [], small: [], tiny: [], input: [], clipped: [] }
  const w = document.documentElement.clientWidth
  const sw = document.documentElement.scrollWidth
  if (sw > w + 1) out.wide.push('document is ' + sw + 'px in a ' + w + 'px viewport')

  /*
    A box that hides content must SAY it hides content (#108).

    The dashboard panels scroll, and Chromium draws an overlay scrollbar that
    is invisible until you are already scrolling. So a panel ended mid-row,
    sliced horizontally through a title, and it did not read as "there is more
    below" -- it read as a rendering fault, on the tab you land on. Every
    check was green: it is not overflow, not small type, not low contrast and
    not a dead control. It was found by opening the PNG, which is the third
    time that has been the only thing that found a defect.

    So: any box with more content than it shows must give the eye one of two
    things. Either a classic scrollbar taking real width in the gutter -- the
    difference between offsetWidth and clientWidth -- or a marker class this
    page sets when there is content beyond the edge, which is what draws the
    fade. An overlay scrollbar counts as neither, because it is not painted.
  */
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (!/(auto|scroll)/.test(cs.overflowY)) continue
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const hidden = el.scrollHeight - el.clientHeight
    if (hidden <= 4) continue
    const gutter = el.offsetWidth - el.clientWidth > 2
    const marked = el.closest('.more, .above, [data-more]') != null ||
                   el.parentElement?.classList.contains('more') === true
    if (!gutter && !marked) {
      const what = (el.getAttribute('aria-label') || el.className || el.tagName).toString()
      out.clipped.push(hidden + 'px hidden in "' + what.trim().slice(0, 40) + '" with nothing to say so')
    }
  }

  const named = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim()
    return t.replace(/\\s+/g, ' ').slice(0, 44)
  }
  /*
    What is BEHIND an open sheet is not the surface being audited.

    With a sheet open the studio blurs the shell, drops its saturation and
    scales it to 0.994 -- deliberately, so the sheet reads as nearer. That
    scale multiplies every rect behind it, and a 44px button measures 43.74:
    the audit reported the theme toggle as an undersized touch target on two
    widths, on a page nobody can touch, because pointer-events are off there
    too. Measuring a decorative transform is exactly the false red that gets a
    check switched off.

    Scoped rather than excluded by class name: when a sheet is open the sheet
    IS the page, so everything else is skipped.

    No backticks in this comment: it lives inside a template literal.
  */
  const front = document.body.classList.contains('behind')
    ? [...document.querySelectorAll('#settings, #viewer')].filter((v) => !v.hidden)
    : []
  const inFront = (el) => front.length === 0 || front.some((v) => v.contains(el))
  for (const el of document.querySelectorAll('*')) {
    if (el.ownerSVGElement != null) continue
    if (!inFront(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue

    // Text size, on elements that hold text directly.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
    if (own) {
      const px = Number.parseFloat(cs.fontSize)
      /*
        A single character inside a small round element is a MONOGRAM, not
        text — the initial behind a portrait that has not loaded. The 12px
        floor is about reading, and there is nothing to read. Stated as
        narrowly as possible so it cannot quietly excuse a real label: one
        character, round, and under 34px across.
      */
      const t = (el.textContent || '').trim()
      /*
        Size is not part of the test. The first version capped it at 34px and
        then reported the 42px portraits on the team board — a single letter in
        a circle is a monogram at any size, and adding a pixel bound just moves
        where the false report happens.
      */
      const round = Number.parseFloat(cs.borderRadius) >= r.width / 2 - 1
      const monogram = t.length === 1 && round
      if (px > 0 && px < 12 && !monogram) out.small.push(px.toFixed(1) + 'px "' + named(el) + '"')
    }

    // Touch targets.
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role') || ''
    const clickable = tag === 'button' || tag === 'a' || tag === 'input' ||
                      tag === 'textarea' || role === 'tab' || role === 'option' ||
                      role === 'switch'
    if (clickable) {
      /*
        The 44px minimum is a TOUCH rule and is only asserted where the pointer
        is coarse — which is what the CSS itself says.

        Asserting it at 1024px and 1440px produced 52 findings that were all
        correct behaviour: a 26px collapse chevron under a cursor is standard,
        and inflating every desktop control to 44px to satisfy a phone
        guideline would make the desktop worse. The pointer media query is asked
        rather than the width, because a narrow window on a laptop is still a
        mouse.

        No backticks in this comment: it lives inside a template literal and a
        backtick ends the string. Second time tonight.
      */
      const coarse = matchMedia('(pointer: coarse)').matches
      const inScroller = el.closest('[data-cmd-row]') != null
      if (coarse && !inScroller && (r.height < 44 || r.width < 24)) {
        out.tiny.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + named(el) + '"')
      }
      if ((tag === 'input' || tag === 'textarea')) {
        const px = Number.parseFloat(cs.fontSize)
        if (px < 16) out.input.push(px.toFixed(1) + 'px "' + named(el) + '"')
      }
    }
  }
  return out
})()`

/*
  Contrast, in the page.

  Relative luminance per WCAG 2.1, sampled on elements that hold their own text.
  Backgrounds are walked up the ancestry until something opaque is found,
  because almost every surface here is a translucent glass layer over another —
  taking the element's own `background-color` would read `rgba(…, 0)` and call
  every panel a failure.
*/
const CONTRAST = `(() => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  /*
    Chromium returns oklch() verbatim from getComputedStyle when the author
    wrote oklch(), so an rgb-only parser returned null, the backdrop walk fell
    through to white, and every agent's monogram was reported as 1.00:1. Rather
    than reimplement colour conversion, ask the browser: painting the value on
    a scratch element and reading it back gives rgb for anything it understands.
  */
  const scratch = document.createElement('span')
  scratch.style.display = 'none'
  document.body.appendChild(scratch)
  const parse = (s) => {
    let v = s
    if (!v.startsWith('rgb')) {
      scratch.style.color = ''
      scratch.style.color = v
      v = getComputedStyle(scratch).color
    }
    const m = v.match(/rgba?\\(([^)]+)\\)/)
    if (m == null) return null
    const p = m[1].split(/[,\\s/]+/).filter((x) => x !== '').map((x) => Number.parseFloat(x))
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }
  }
  /*
    An element painted with a GRADIENT has a transparent background-color, so
    the walk used to sail past it to the page behind and compare white text
    against a pale ground — reporting the filled Call button, which is perfectly
    legible, as 1.00:1. A gradient is opaque for our purposes, so the walk stops
    there and reports it as untestable rather than as a failure.
  */
  const backdrop = (el) => {
    for (let p = el; p != null; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.backgroundImage !== 'none' && cs.backgroundImage.includes('gradient')) return null
      const c = parse(cs.backgroundColor)
      if (c != null && c.a > 0.85) return c.rgb
    }
    return [255, 255, 255]
  }
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
    if (!own) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden') continue
    const fg = parse(cs.color)
    if (fg == null || fg.a < 0.5) continue
    const bg = backdrop(el)
    if (bg == null) continue   // painted on a gradient; not measurable this way
    const l1 = lum(fg.rgb), l2 = lum(bg)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const px = Number.parseFloat(cs.fontSize)
    const bold = Number.parseFloat(cs.fontWeight) >= 700
    // WCAG AA: 3.0 for large text (>=24px, or >=18.66px bold), else 4.5.
    const need = (px >= 24 || (px >= 18.66 && bold)) ? 3.0 : 4.5
    if (ratio < need) {
      const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 36)
      out.push(ratio.toFixed(2) + ':1 need ' + need + ' — "' + t + '"')
    }
  }
  return [...new Set(out)]
})()`

const browser = await chromium.launch()

/*
  A token, so the WRITER's controls are drawn and therefore measured.

  Without one `canWrite()` is false and the page draws a reader's view: no
  textareas, no selects, no time input, no buttons. This audit reported 68
  green states over Project Settings while having seen none of the controls on
  it — an audit that looks somewhere other than where the user looks passes for
  the wrong reason, and the user is a writer.

  Not a real token. `verify:wired` uses the same word for the same purpose: the
  page only asks whether one is present before drawing, and every fetch it then
  makes fails and falls back to the invented data, which is what this audit
  measures anyway.
*/
const AS_WRITER = `try{localStorage.setItem('hq.token','audit')}catch(e){}`

const open = async (page: import('playwright').Page, route: string) => {
  await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(450)
  await page.locator('.project[data-open="legacy-coaching-course"]').click()
  await page.waitForTimeout(400)
  if (route.startsWith('project/')) {
    // The pane fetches its own payload before it draws, so the wait is longer
    // than a tab switch: measuring at 300ms would measure the word "Reading
    // the office…" and report a screen with nothing on it as clean.
    await page.locator('[data-tab="settings"]').click()
    await page.waitForTimeout(1100)
    await page.locator(`[data-setpane="${route.slice('project/'.length)}"]`).click()
    await page.waitForTimeout(450)
    return
  }
  if (route.startsWith('settings/')) {
    await page.locator('[data-settings]').first().click()
    await page.waitForTimeout(450)
    await page.locator(`[data-setting="${route.slice('settings/'.length)}"]`).click()
    await page.waitForTimeout(450)
    return
  }
  await page.locator(`[data-tab="${route}"]`).click()
  await page.waitForTimeout(300)
}

// --- geometry: every width, every route, one skin ---------------------------
for (const width of WIDTHS) {
  /*
    Under 861px the audit emulates a TOUCH device, and that is not cosmetic.

    The 44px rule is written on `pointer: coarse`, because a 390px window on a
    laptop is still a mouse. A Playwright context with a narrow viewport and no
    `hasTouch` reports `pointer: fine`, so every one of those rules was inert
    and the audit reported fourteen controls as too small AFTER they had been
    fixed. The audit has to be the device it is standing in for.
  */
  const touch = width <= 860
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: touch,
    isMobile: touch,
  })
  await ctx.route('**/*', (r) =>
    r
      .request()
      .url()
      .startsWith(`http://127.0.0.1:${String(PORT)}`)
      ? void r.continue()
      : void r.abort(),
  )
  await ctx.addInitScript(AS_WRITER)
  const page = await ctx.newPage()
  for (const route of ROUTES) {
    await open(page, route)
    const g = (await page.evaluate(GEOMETRY)) as Record<string, string[]>
    checked++
    for (const [kind, list] of Object.entries(g)) {
      const label = {
        wide: 'overflows',
        small: 'text under 12px',
        tiny: 'target under 44px',
        input: 'input under 16px',
        clipped: 'content cut with no affordance',
      }[kind]
      for (const item of [...new Set(list)].slice(0, 4)) {
        findings.push({ where: `${String(width)}px ${route}`, what: `${String(label)} — ${item}` })
      }
    }
  }
  console.log(`  geometry ${String(width)}px — done`)
  await ctx.close()
}

// --- contrast: every palette, both themes, at one width ---------------------
for (const scheme of ['light', 'dark'] as const) {
  for (const palette of PALETTES) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    })
    await ctx.route('**/*', (r) =>
      r
        .request()
        .url()
        .startsWith(`http://127.0.0.1:${String(PORT)}`)
        ? void r.continue()
        : void r.abort(),
    )
    await ctx.addInitScript(AS_WRITER)
    await ctx.addInitScript(seedAppearance(scheme, { palette, texture: 'plaster' }))
    const page = await ctx.newPage()
    /*
      Two surfaces, not one. The overview is the page you land on; governance
      is the one with four new tinted states on it — an accent scope pill, a
      muted state pill, a warning tally and a red count — and none of them
      exists anywhere the overview can see.
    */
    for (const where of ['overview', 'settings/governance'] as const) {
      await open(page, where)
      const bad = (await page.evaluate(CONTRAST)) as string[]
      checked++
      for (const item of bad.slice(0, 5)) {
        findings.push({ where: `${scheme}/${palette} ${where}`, what: `contrast — ${item}` })
      }
    }
    await ctx.close()
  }
  console.log(`  contrast ${scheme} — done`)
}

await browser.close()
server.close()

const lines = [
  '# Layout audit',
  '',
  'Generated by `npm run verify:layouts` (issue #41).',
  '',
  `- page states checked: **${String(checked)}**`,
  `- widths: ${WIDTHS.join(', ')}px · palettes: ${PALETTES.join(', ')} · both themes`,
  `- findings: **${String(findings.length)}**`,
  '',
  findings.length === 0
    ? 'No overflow, no text under 12px, no target under 44px, no input under 16px, and every text/background pair meets WCAG AA.'
    : [
        '| where | finding |',
        '|---|---|',
        ...findings.map((f) => `| ${f.where} | ${f.what} |`),
      ].join('\n'),
  '',
]
await writeFile('docs/testing/layouts.md', lines.join('\n'))

console.log(`\n${String(checked)} states · ${String(findings.length)} findings`)
for (const f of findings.slice(0, 40)) console.log(`  ${f.where}  ${f.what}`)
if (findings.length > 0) process.exit(1)
