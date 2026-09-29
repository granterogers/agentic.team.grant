/**
 * What the design system actually IS, measured from the rendered page.
 *
 *   npm run system              # the whole inventory
 *   npm run system -- --type    # one section: type, colour, parts, geometry
 *
 * §§17-20 of the UX QA v2 standard (docs/spec/ux-qa-v2-2026-09-15.md). Grant's
 * argument for it, learned on another product: *"A product may compile, pass
 * Playwright, pass axe, have no overflow, have working controls -- and still
 * look terrible. FULL UX QA must therefore audit visual coherence."*
 *
 * Every other check in this repository asks whether something is broken. This
 * one asks whether the product was designed by one person or by eleven, and it
 * answers with counts rather than with an opinion: how many type sizes are in
 * use, how many of them are used once, how many near-identical greys, how many
 * different ways a card is drawn.
 *
 * ## It measures the RENDER, not the source
 *
 * A stylesheet says what is declared. The page says what is used. Those differ
 * wherever a rule does not match, wherever a token falls back, and wherever an
 * inline style overrides -- and this file has shipped all three. `--ink-1` was
 * written into a rule for a token that does not exist; the declaration looked
 * deliberate and the render fell back to inherit.
 *
 * ## It reports and fails nothing, with one exception
 *
 * Like `space` and `wide`, the inventory is for reading. A number is not a
 * defect: eight type sizes might be a scale or might be a mess, and only
 * looking at the page decides. The exception is the fallback-font check, which
 * IS pass/fail, because section 56 is unambiguous -- *"a beautiful typography
 * specification rendered in fallback Arial is a failure"* -- and because
 * section 17 forbids judging typography while the intended fonts did not load.
 * Without that gate every other typographic reading here would be unreliable,
 * which is the state this sandbox is permanently in.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'

const ROOT = 'web/studio'
const PORT = 4655
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

const only =
  process.argv
    .slice(2)
    .find((a) => a.startsWith('--'))
    ?.replace('--', '') ?? ''
const wanted = (section: string) => only === '' || only === section

/*
  Where the inventory is taken.

  Representative, not exhaustive: section 15's warning about a screenshot system
  nobody maintains applies to this too. These eight cover every layout primitive
  the product has -- a board, a gallery, a list, a conversation, a form, a
  settings page and two empty-ish states -- and adding a ninth of the same shape
  would add rows without adding an answer.
*/
const SCREENS: [string, (p: import('playwright').Page) => Promise<void>][] = [
  [
    'home',
    async () => {
      /* the landing state */
    },
  ],
  [
    'project · overview',
    async (p) => {
      await open(p)
      await tab(p, 'overview')
    },
  ],
  [
    'project · ai team',
    async (p) => {
      await open(p)
      await tab(p, 'team')
    },
  ],
  [
    'project · documents',
    async (p) => {
      await open(p)
      await tab(p, 'documents')
    },
  ],
  [
    'project · tasks',
    async (p) => {
      await open(p)
      await tab(p, 'tasks')
    },
  ],
  [
    'project · contacts',
    async (p) => {
      await open(p)
      await tab(p, 'contacts')
    },
  ],
  [
    'project settings',
    async (p) => {
      await open(p)
      await tab(p, 'settings')
    },
  ],
  [
    'global settings',
    async (p) => {
      await press(p, '[data-settings]', 600)
    },
  ],
]

/*
  Forced clicks, because the studio never stops moving.

  `breathe()` and `scatter()` run for as long as the page is open, so
  Playwright's "element is visible, enabled and STABLE" check can never pass
  inside it — CLAUDE.md records this and every other suite here already does
  the same thing. Without the force every project screen timed out after thirty
  seconds and the inventory silently covered two screens of eight.
*/
const press = async (p: import('playwright').Page, sel: string, settle: number) => {
  /*
    `:visible`, because the first match in DOM order is not the one a person
    can press. The project switcher's dropdown carries the same `data-open`
    attributes and is hidden until the menu is opened, so a bare `.first()`
    resolved to an invisible menu item and every project screen reported
    "Element is not visible" — which reads like a product defect and is the
    locator picking the wrong twin.
  */
  await p.locator(`${sel}:visible`).first().click({ force: true, timeout: 6000 })
  await p.waitForTimeout(settle)
}
const open = async (p: import('playwright').Page) => {
  await press(p, '[data-open="legacy-coaching-course"]', 700)
}
const tab = async (p: import('playwright').Page, id: string) => {
  await press(p, `[data-tab="${id}"]`, 500)
}

/*
  Everything visible, as the browser resolved it.

  Text-bearing elements only for type -- an empty div has a font-size and it is
  not a typographic decision -- and every element for colour and geometry,
  because a border on a wrapper is a design decision whether or not it holds
  words.
*/
const HARVEST = `(() => {
  const out = { type: [], colour: [], box: [], parts: [], small: [], drawn: [] }
  /*
    Every colour resolved to one comparable space.

    The first draft compared the strings the browser hands back, and they are
    not in one notation: an rgb() triple is 0-255 while a color(srgb ...) is
    0-1, and oklch() is neither. The near-duplicate detector took the first
    three numbers of each and reported 130 pairs, of which the top one was a
    near-black said to be nearly white at a distance of 1.5. A check that is
    wrong in the alarming direction teaches you to ignore the check.

    A 1x1 canvas is the shortest honest converter: the browser paints the value
    and hands back the bytes it painted, whatever notation it arrived in.

    No backticks in this comment: it is inside a template literal, and that is
    the third time in one session.
  */
  const pad = document.createElement('canvas')
  pad.width = 1; pad.height = 1
  const pen = pad.getContext('2d', { willReadFrequently: true })
  const memo = new Map()
  const rgba = (value) => {
    if (memo.has(value)) return memo.get(value)
    let said = value
    try {
      pen.clearRect(0, 0, 1, 1)
      pen.fillStyle = value
      pen.fillRect(0, 0, 1, 1)
      const d = pen.getImageData(0, 0, 1, 1).data
      said = d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(2)
    } catch (e) { /* leave it as written */ }
    memo.set(value, said)
    return said
  }
  const seen = new Set()
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim() !== '')
    if (own) {
      out.type.push([
        cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
        Math.round(parseFloat(cs.fontSize) * 10) / 10,
        cs.fontWeight,
        /*
          The RATIO, not the pixels.

          The first draft recorded computed line-height in px and reported 28
          distinct values across 15 sizes, which reads as chaos and is
          arithmetic: one ratio of 1.35 produces 17.6px at 13px and 18.9px at
          14px. A type system is a set of ratios; measuring the product of a
          ratio and a size and then counting the products is measuring the wrong
          thing, and I would have gone and "fixed" a scale that was already
          coherent.

          No backticks in this comment: template literal.
        */
        cs.lineHeight === 'normal' ? 'normal'
          : (parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2),
        cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing,
        el.tagName.toLowerCase(),
      ].join('|'))
      out.colour.push('text ' + rgba(cs.color))
      /*
        Anything under the 12px floor, NAMED. A histogram that says 106
        elements are 11.5px tells you there is a problem and not where it is,
        and the first thing anybody does with that number is go looking.
      */
      const px = parseFloat(cs.fontSize)
      if (px > 0 && px < 12) {
        const t = (el.textContent || '').trim()
        const round = parseFloat(cs.borderRadius) >= el.getBoundingClientRect().width / 2 - 1
        const monogram = t.length === 1 && round
        /*
          Text DRAWN inside a document cover is a picture of a page, not a
          label. Every document tile carries a facsimile of its first page with
          the title set into it at 11px, and the real caption sits underneath at
          12.5px - so the small one is the illustration and the readable one is
          the interface.

          Counted and reported separately rather than skipped, because a silent
          exemption is how a floor gets weakened until it matches nothing. The
          rule is narrow on purpose: inside an SVG, inside an element that is a
          drawn page. Interface text in an SVG elsewhere would still be caught.

          verify:layouts reaches the same conclusion by a different route - it
          drops every SVG child because their geometry ignores the viewport that
          clips them - which is why the two audits disagreed about this before
          the exemption was written down.
        */
        const drawn = el.ownerSVGElement !== null && el.closest('.page') !== null
        if (drawn) out.drawn.push(px.toFixed(1) + 'px  "' + t.slice(0, 30) + '"')
        else if (!monogram) {
          out.small.push(px.toFixed(1) + 'px  ' + el.tagName.toLowerCase()
            + '.' + (typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '')
            + '  "' + t.slice(0, 34) + '"')
        }
      }
    }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') out.colour.push('fill ' + rgba(cs.backgroundColor))
    if (cs.backgroundImage !== 'none' && cs.backgroundImage.includes('gradient')) {
      out.colour.push('gradient ' + cs.backgroundImage.slice(0, 120))
    }
    if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') {
      out.colour.push('edge ' + rgba(cs.borderTopColor))
      out.box.push('border ' + cs.borderTopWidth + ' ' + cs.borderTopStyle)
    }
    if (cs.borderTopLeftRadius !== '0px') out.box.push('radius ' + cs.borderTopLeftRadius)
    if (cs.boxShadow !== 'none') out.box.push('shadow ' + cs.boxShadow.slice(0, 90))
    /*
      A part's SHAPE signature: what makes two things look like the same kind of
      object. Deliberately not the class name -- section 19 asks how many visual
      implementations exist for a concept, and two classes drawing the identical
      box are one implementation with two names, while one class drawn five
      different ways is five.
    */
    const boxed = cs.borderTopLeftRadius !== '0px' || cs.boxShadow !== 'none'
      || (cs.borderTopStyle !== 'none' && cs.borderTopWidth !== '0px')
    if (boxed && r.width > 40 && r.height > 24) {
      const sig = [
        'r:' + cs.borderTopLeftRadius,
        'b:' + (cs.borderTopStyle === 'none' ? 'none' : cs.borderTopWidth + ' ' + cs.borderTopColor),
        's:' + (cs.boxShadow === 'none' ? 'none' : cs.boxShadow.split('rgb')[0].trim()),
        'p:' + cs.paddingTop + '/' + cs.paddingLeft,
      ].join(' ')
      out.parts.push(sig)
      seen.add(sig)
    }
  }
  return out
})()`

/*
  Does the same role render at the same size on every screen? (#160)

  Grant: *"The typography appears to change when moving from the global homepage
  into a project. This should not happen unless there is a deliberate design
  reason."*

  The commonest size per screen cannot answer that, and the first draft used it:
  a screen made of task rows has a different mode than one made of caption
  lines, and reporting that as drift would be reporting composition. The
  falsifiable question is whether a NAMED ROLE - the body, a lead paragraph, a
  caption, a heading - is the same size wherever it appears. If it is not, the
  scale is being re-decided per screen, which is what he is seeing.

  No backticks in this comment: template literal.
*/
const ROLES = `(() => {
  const out = {}
  const roles = {
    'body': 'body',
    'lead': '.t-lead',
    'meta': '.t-meta',
    'label': '.t-label',
    'title': '.t-title',
    'button': '.btn',
    'nav item': '.navitem',
  }
  for (const [name, sel] of Object.entries(roles)) {
    const el = document.querySelector(sel)
    if (el === null) continue
    const cs = getComputedStyle(el)
    out[name] = Math.round(parseFloat(cs.fontSize) * 10) / 10 + '/'
      + (parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2)
      + ' ' + cs.fontWeight
  }
  return out
})()`

/** Did the intended faces actually arrive? Section 56, and it is pass/fail. */
const FONTS = `(() => {
  const want = new Set()
  for (const sheet of document.styleSheets) {
    let rules = null
    try { rules = sheet.cssRules } catch (e) { continue }
    if (rules === null) continue
    for (const rule of rules) {
      if (rule.constructor.name === 'CSSFontFaceRule') {
        want.add(rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim())
      }
    }
  }
  const loaded = new Set()
  for (const f of document.fonts) if (f.status === 'loaded') loaded.add(f.family.replace(/["']/g, ''))
  return { want: [...want], loaded: [...loaded] }
})()`

type Bag = Map<string, number>
const bump = (bag: Bag, key: string) => {
  bag.set(key, (bag.get(key) ?? 0) + 1)
}
const sorted = (bag: Bag) => [...bag.entries()].sort((a, b) => b[1] - a[1])

const type: Bag = new Map()
const colour: Bag = new Map()
const colourLight: Bag = new Map()
const small: Bag = new Map()
const drawn: Bag = new Map()
const roleDrift = new Map<string, Map<string, string[]>>()
const box: Bag = new Map()
const parts: Bag = new Map()
const perScreen: string[] = []

const browser = await chromium.launch()
let fonts = { want: [] as string[], loaded: [] as string[] }

for (const theme of ['dark', 'light'] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  /*
    The scheme is asked for the way a person asks for it, through the stored
    preference. Playwright's `colorScheme` sets the media query only, and the
    studio's default is an EXPLICIT choice written to `data-scheme` on the root
    -- so every dark block is guarded against that attribute and the media query
    decides nothing. Four audits once stood in for a light user this way and
    produced twenty-five contrast failures against correct code.
  */
  await ctx.addInitScript(seedAppearance(theme))
  const page = await ctx.newPage()
  for (const [name, go] of SCREENS) {
    await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    try {
      await go(page)
    } catch (e) {
      const said = String(e).split('\n')[0] ?? ''
      perScreen.push(`  could not reach ${theme}/${name} — ${said.slice(0, 110)}`)
      continue
    }
    if (fonts.want.length === 0) fonts = (await page.evaluate(FONTS)) as typeof fonts
    const got = (await page.evaluate(HARVEST)) as {
      type: string[]
      colour: string[]
      box: string[]
      parts: string[]
      small: string[]
      drawn: string[]
    }
    for (const t of got.type) bump(type, t)
    /*
      Colours are kept PER THEME. A dark ink and a light ink are not two ways of
      saying one thing, and pooling them made the near-duplicate report compare
      them against each other - which is how the first run announced that a
      near-black was nearly white.
    */
    for (const c of got.colour) bump(theme === 'dark' ? colour : colourLight, c)
    for (const sm of got.small) bump(small, `${theme}/${name}  ${sm}`)
    for (const d of got.drawn) bump(drawn, d)
    for (const b of got.box) bump(box, b)
    for (const p of got.parts) bump(parts, p)
    /*
      Per screen as well as pooled, which is the only way to answer #160.

      Grant: *"The typography appears to change when moving from the global
      homepage into a project. This should not happen unless there is a
      deliberate design reason."* A pooled histogram cannot answer that - it
      says the product uses fifteen sizes, not which screen introduced which
      one. The commonest face-and-size per screen is the comparison he is
      describing, and if two screens disagree about it, he is right.
    */
    const bodyOf = (rows: string[]) => {
      const tally = new Map<string, number>()
      for (const r of rows) {
        const bits = r.split('|')
        const key = `${String(bits[0])} ${String(bits[1])}px`
        tally.set(key, (tally.get(key) ?? 0) + 1)
      }
      return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-'
    }
    const seenRoles = (await page.evaluate(ROLES)) as Record<string, string>
    for (const [role, said] of Object.entries(seenRoles)) {
      const bag = roleDrift.get(role) ?? new Map<string, string[]>()
      const where = bag.get(said) ?? []
      where.push(`${theme}/${name}`)
      bag.set(said, where)
      roleDrift.set(role, bag)
    }
    const fams = new Set(got.type.map((r) => r.split('|')[0]))
    perScreen.push(
      `  ${theme}/${name.padEnd(22)} ${String(got.type.length).padStart(4)} text · ` +
        `${String(got.parts.length).padStart(3)} boxed · body ${bodyOf(got.type).padEnd(26)}` +
        `${String(fams.size)} famil${fams.size === 1 ? 'y' : 'ies'}`,
    )
  }
  await ctx.close()
}
await browser.close()
server.close()

/* -- the report ------------------------------------------------------------ */

const rule = (s: string) => `\n─── ${s} ${'─'.repeat(Math.max(0, 62 - s.length))}`

console.log(rule('what was walked'))
console.log(perScreen.join('\n'))

/* Fonts first, because section 17 says every reading below depends on it. */
const missing = fonts.want.filter(
  (f) => !fonts.loaded.some((l) => l.toLowerCase() === f.toLowerCase()),
)
console.log(rule('fonts (§56)'))
console.log(`  declared: ${fonts.want.join(', ') || 'none'}`)
console.log(`  loaded:   ${fonts.loaded.join(', ') || 'NONE'}`)
if (missing.length > 0) {
  console.log(`  ⚠ NOT LOADED: ${missing.join(', ')}`)
  console.log('    Every typographic reading below is against the fallback face and')
  console.log('    is unreliable. §17: do not judge typography while the intended')
  console.log('    fonts failed to load.')
}

if (wanted('type')) {
  console.log(rule('typography (§17)'))
  const families = new Map<string, number>()
  const sizes = new Map<number, number>()
  const weights = new Map<string, number>()
  const leading = new Map<string, number>()
  const tracking = new Map<string, number>()
  for (const [k, n] of type) {
    const [fam, size, weight, lh, ls] = k.split('|')
    bump(families, fam ?? '?')
    sizes.set(Number(size), (sizes.get(Number(size)) ?? 0) + n)
    bump(weights, weight ?? '?')
    bump(leading, lh ?? '?')
    bump(tracking, ls ?? '?')
  }
  console.log(`  families  ${families.size}: ${[...families.keys()].join(', ')}`)
  console.log(`  sizes     ${sizes.size} in use`)
  const bySize = [...sizes.entries()].sort((a, b) => b[0] - a[0])
  for (const [s, n] of bySize) {
    console.log(
      `     ${String(s).padStart(6)}px  ${String(n).padStart(5)} elements${n <= 2 ? '   ← used once or twice' : ''}`,
    )
  }
  console.log(`  weights   ${[...weights.keys()].sort().join(', ')}`)
  console.log(`  leading   ${leading.size} distinct: ${[...leading.keys()].sort().join(', ')}`)
  console.log(`  tracking  ${tracking.size} distinct: ${[...tracking.keys()].join(', ')}`)
  const rare = bySize.filter(([, n]) => n <= 2).length
  console.log(`\n  ${rare} of ${sizes.size} sizes appear on two elements or fewer.`)
  console.log('  A size used once is a decision made once, which is what a scale exists')
  console.log('  to prevent. It is not automatically wrong — a display heading is used')
  console.log('  once per page by design — so read it, do not obey it.')
}

if (wanted('colour')) {
  for (const [theme, bag] of [
    ['dark', colour],
    ['light', colourLight],
  ] as const) {
    console.log(rule(`colour · ${theme} (§18)`))
    const inks = sorted(bag).filter(([k]) => k.startsWith('text '))
    const fills = sorted(bag).filter(([k]) => k.startsWith('fill '))
    const edges = sorted(bag).filter(([k]) => k.startsWith('edge '))
    const grads = sorted(bag).filter(([k]) => k.startsWith('gradient '))
    console.log(
      `  ${inks.length} ink colours · ${fills.length} fills · ${edges.length} border colours · ${grads.length} gradients`,
    )
    const show = (label: string, rows: [string, number][]) => {
      console.log(`\n  ${label}`)
      for (const [k, n] of rows.slice(0, 14))
        console.log(`     ${String(n).padStart(5)}  ${k.replace(/^\w+ /, '')}`)
      if (rows.length > 14) console.log(`     … and ${String(rows.length - 14)} more`)
    }
    show('ink', inks)
    show('fills', fills)
    show('borders', edges)
    /*
    Near-duplicates, which is the finding section 18 actually asks for: *"duplicate
    near-identical values"*. Two greys three points apart are not a palette, they
    are two people. Compared in plain sRGB distance, which is crude and is enough
    to notice the ones a person would not be able to tell apart.
  */
    const nums = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const near: string[] = []
    const all = [...inks, ...fills, ...edges].map(([k]) => k.replace(/^\w+ /, ''))
    const uniq = [...new Set(all)]
    for (let i = 0; i < uniq.length; i += 1) {
      for (let j = i + 1; j < uniq.length; j += 1) {
        const a = nums(uniq[i] ?? '').slice(0, 3)
        const b = nums(uniq[j] ?? '').slice(0, 3)
        if (a.length < 3 || b.length < 3) continue
        /* Opaque pairs only. A 14% wash of the accent is not a near-duplicate of
         the accent, it is the accent at 14%, and reporting it as a palette
         defect is the alarming wording for the normal state. */
        const alpha = (v: string) => Number((v.match(/[\d.]+/g) ?? [])[3] ?? 1)
        if (alpha(uniq[i] ?? '') < 0.99 || alpha(uniq[j] ?? '') < 0.99) continue
        const d = Math.sqrt(a.reduce((m, v, k) => m + (v - (b[k] ?? 0)) ** 2, 0))
        if (d > 0 && d < 9) near.push(`${uniq[i]}  ≈  ${uniq[j]}   (distance ${d.toFixed(1)})`)
      }
    }
    console.log(`\n  near-identical pairs (sRGB distance under 9): ${near.length}`)
    for (const p of near.slice(0, 12)) console.log(`     ${p}`)
    if (near.length > 12) console.log(`     … and ${String(near.length - 12)} more`)
  }
}

if (wanted('parts')) {
  console.log(rule('components (§19)'))
  const rows = sorted(parts)
  console.log(
    `  ${rows.length} distinct box shapes on ${String([...parts.values()].reduce((a, b) => a + b, 0))} elements.`,
  )
  console.log('  A shape is radius + border + shadow + padding — not the class name,')
  console.log('  because two classes drawing the identical box are one component with')
  console.log('  two names, and one class drawn five ways is five components.\n')
  for (const [k, n] of rows.slice(0, 22)) console.log(`     ${String(n).padStart(5)}  ${k}`)
  if (rows.length > 22) console.log(`     … and ${String(rows.length - 22)} more`)
  const once = rows.filter(([, n]) => n === 1).length
  console.log(`\n  ${once} shapes appear exactly once.`)
}

if (wanted('geometry')) {
  console.log(rule('geometry (§20)'))
  const radii = sorted(box).filter(([k]) => k.startsWith('radius '))
  const shadows = sorted(box).filter(([k]) => k.startsWith('shadow '))
  const borders = sorted(box).filter(([k]) => k.startsWith('border '))
  console.log(
    `  ${radii.length} radii · ${shadows.length} shadows · ${borders.length} border widths\n`,
  )
  console.log('  radii')
  for (const [k, n] of radii.slice(0, 16))
    console.log(`     ${String(n).padStart(5)}  ${k.replace('radius ', '')}`)
  console.log('  border widths')
  for (const [k, n] of borders.slice(0, 8))
    console.log(`     ${String(n).padStart(5)}  ${k.replace('border ', '')}`)
  console.log(`  shadows: ${shadows.length} distinct`)
  for (const [k, n] of shadows.slice(0, 10))
    console.log(`     ${String(n).padStart(5)}  ${k.replace('shadow ', '').slice(0, 70)}`)
}

console.log(rule('does a role keep its size between screens? (#160)'))
{
  /*
    SIZE drift is the finding. Weight drift usually is not.

    The current navigation entry is heavier than the others, at the same size,
    which is the "you are here" distinction and is deliberate. Counting that as
    drift makes this check fire on correct behaviour, and a check that fires on
    correct behaviour is one nobody reads - which this repository has recorded
    about a routing control and about a security pattern.

    So the two are reported apart: a role whose SIZE changes between screens is
    a scale being re-decided, and a role whose weight changes at one size is
    emphasis.
  */
  let drift = 0
  for (const [role, bag] of roleDrift) {
    const sizes = new Set([...bag.keys()].map((k) => k.split(' ')[0]))
    if (sizes.size === 1) {
      const weights = new Set([...bag.keys()].map((k) => k.split(' ')[1]))
      console.log(
        `  ${role.padEnd(10)} ${[...sizes][0]}  — the same size everywhere` +
          (weights.size > 1 ? `, ${String(weights.size)} weights (emphasis)` : ''),
      )
      continue
    }
    drift += 1
    console.log(`  ${role.padEnd(10)} ${String(sizes.size)} DIFFERENT SIZES:`)
    for (const [said, where] of bag) {
      console.log(
        `     ${said.padEnd(16)} ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` +${String(where.length - 4)}` : ''}`,
      )
    }
  }
  console.log(
    `\n  ${
      drift === 0
        ? 'No role changes size between screens, and the family never changes.'
        : `${String(drift)} role(s) have their size re-decided per screen.`
    }`,
  )
}

console.log(rule('below the 12px floor (§17, and the visual standard)'))
console.log(
  `  exempt: ${String([...drawn.values()].reduce((a, b) => a + b, 0))} strings drawn INSIDE a document`,
)
console.log('  cover — a facsimile of the page, with the readable caption beneath it.')
if (small.size === 0) {
  console.log('  everything else: nothing under the floor')
} else {
  for (const [k, n] of sorted(small).slice(0, 24))
    console.log(`     ${String(n).padStart(3)}x  ${k}`)
  if (small.size > 24) console.log(`     … and ${String(small.size - 24)} more distinct`)
}

console.log(rule('what this is not'))
console.log('  A pass or a fail, except for the fonts. It is the inventory §16 asks')
console.log("  for, and the judgement it feeds is §22's, which is a person looking")
console.log('  at the page and deciding. Counts narrow where to look.')

if (missing.length > 0) {
  console.log('\nsystem FAILED — the declared fonts did not load, so §17 says the')
  console.log('typographic readings above cannot be trusted.')
  process.exit(1)
}
