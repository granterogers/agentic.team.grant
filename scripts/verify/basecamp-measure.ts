/*
 * Measure the experimental experience against the geometry §4.3 and §14 name.
 *
 * Reading a capture produces confident, wrong findings — three of four in one
 * recorded pass of this repository. A capture says WHERE to look; this says
 * WHAT is actually wrong. Everything printed here is a computed box from a
 * real browser, never a value read back out of the stylesheet.
 *
 * It reports and fails nothing, except the three things the acceptance matrix
 * states as absolutes: no page-level horizontal overflow, the first useful
 * module above 40% of the phone viewport, and no clipped interactive control.
 */
import { chromium, devices } from 'playwright'
import { serveStudio } from './serve-studio.ts'

/*
  Browser code travels as a STRING — this repository's existing convention for
  every check that drives Chromium, because tsconfig carries no DOM library
  and adding one would hand `src/` a second definition of fetch.
*/
const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4633
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

type Box = { w: number; h: number; x: number; y: number }

const SIZES = [
  { id: 'desktop', width: 1440, height: 900, touch: false },
  { id: 'compact', width: 1024, height: 768, touch: false },
  { id: 'tablet', width: 768, height: 1024, touch: true },
  { id: 'phone', width: 390, height: 844, touch: true },
] as const

const browser = await chromium.launch()
const problems: string[] = []

for (const size of SIZES) {
  const ctx = await browser.newContext({
    ...(size.touch ? devices['Pixel 7'] : {}),
    viewport: { width: size.width, height: size.height },
    isMobile: size.touch,
    hasTouch: size.touch,
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  const slug = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(400)

  console.log(`\n=== ${size.id} ${String(size.width)}x${String(size.height)} ===`)

  const box = async (sel: string): Promise<Box | null> =>
    (await page.evaluate(
      inPage(`const el = document.querySelector(${JSON.stringify(sel)})
         if (el === null) return null
         const r = el.getBoundingClientRect()
         return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }`),
    )) as Box | null

  for (const sel of ['.bcmain', '.bctop', '.bchome', '.bchead', '.bcwork', '.bcrail', '.bctray']) {
    const b = await box(sel)
    console.log(
      `  ${sel.padEnd(14)} ${b === null ? 'NOT PRESENT' : `${String(b.w)}x${String(b.h)} at ${String(b.x)},${String(b.y)}`}`,
    )
  }

  /* --- the grid's own rhythm (§4.3: three columns, ~325px, 16px gutters) --- */
  /*
    A MEASURE NAMES WHAT IT MEASURED TO. This read `.bcgrid` and printed "n/a"
    for anything else, so the day the home stopped being that grid the rhythm
    went unmeasured and the line still looked like an answer.
  */
  const grid = (await page.evaluate(
    inPage(`for (const sel of ['.bcwork', '.bcgrid', '.bccomp']) {
         const g = document.querySelector(sel)
         if (g === null) continue
         const cs = getComputedStyle(g)
         return { sel, cols: cs.gridTemplateColumns, gap: cs.gap }
       }
       return null`),
  )) as { sel: string; cols: string; gap: string } | null
  console.log(
    grid === null
      ? '  columns        NO LAYOUT FOUND — the measure matched nothing'
      : `  columns        ${grid.cols}  gap ${grid.gap}  (measured to ${grid.sel})`,
  )
  if (grid === null) {
    problems.push(
      `${size.id}: the column measure matched nothing, which is not the same as a good score`,
    )
  }

  /* --- page-level horizontal overflow, an absolute --- */
  const over = (await page.evaluate(
    inPage('return document.documentElement.scrollWidth - document.documentElement.clientWidth'),
  )) as number
  console.log(`  horizontal overflow  ${String(over)}px`)
  if (over > 0) {
    const who = (await page.evaluate(
      inPage(`const limit = ${String(size.width)}
         const out = []
         for (const el of document.querySelectorAll('body *')) {
           const r = el.getBoundingClientRect()
           if (r.width === 0 || r.height === 0) continue
           if (r.right <= limit + 1) continue
           /* SVG children, and anything inside a scroll container or a fixed
              element, look like overflow and never are. */
           if (el.closest('svg') !== null) continue
           let p = el.parentElement
           let skip = false
           while (p !== null && p !== document.body) {
             const cs = getComputedStyle(p)
             if (cs.position === 'fixed' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') skip = true
             p = p.parentElement
           }
           if (skip) continue
           out.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40) + ' right=' + Math.round(r.right))
         }
         return out.slice(-6)`),
    )) as string[]
    problems.push(
      `${size.id}: ${String(over)}px of page-level horizontal overflow — ${who.join(' | ')}`,
    )
  }

  /* --- overlap in the top row, which a capture shows and a box proves --- */
  const collide = (await page.evaluate(
    inPage(`const parts = [...document.querySelectorAll('.bctop .bcleft, .bctop .bcjump, .bctop .bcright')]
         .map((e) => ({ name: e.className, r: e.getBoundingClientRect() }))
       const hits = []
       for (let i = 0; i < parts.length - 1; i += 1) {
         const a = parts[i]
         const b = parts[i + 1]
         if (a !== undefined && b !== undefined && a.r.right > b.r.left + 0.5) {
           hits.push(a.name + ' overlaps ' + b.name + ' by ' + Math.round(a.r.right - b.r.left) + 'px')
         }
       }
       return hits`),
  )) as string[]
  if (collide.length > 0) {
    console.log(`  TOP ROW COLLISION  ${collide.join('; ')}`)
    problems.push(`${size.id}: top row collision — ${collide.join('; ')}`)
  }

  /*
    A CHIP IS NOT A BAR.

    `.bcstatus` is inline-flex, which is right — and as a grid child an item
    stretches to its column anyway, so a one-word status rendered 299px wide
    on the desktop overview and 454px at 1024. It read as a progress bar or a
    disabled input, on every screen, from the first commit. No audit that
    looks at overflow, contrast, type size or dead controls can see it,
    because a stretched chip is none of those things.
  */
  const stretched = (await page.evaluate(
    inPage(`const out = []
       for (const el of document.querySelectorAll('.bcstatus')) {
         const r = el.getBoundingClientRect()
         if (r.width === 0) continue
         const p2 = el.parentElement
         if (p2 === null) continue
         const pr = p2.getBoundingClientRect()
         /* Only meaningful where the parent is meaningfully wider than the text. */
         if (pr.width < 160) continue
         if (r.width > pr.width - 8) {
           out.push((el.textContent ?? '').trim().slice(0, 24) + ' ' + Math.round(r.width) + 'px in ' + Math.round(pr.width) + 'px')
         }
       }
       return out`),
  )) as string[]
  console.log(`  stretched chips  ${stretched.length === 0 ? 'none' : String(stretched.length)}`)
  if (stretched.length > 0) {
    problems.push(
      `${size.id}: ${String(stretched.length)} status chip(s) stretched to fill their container — ${stretched.join('; ')}`,
    )
  }

  /*
    THE CARD TREATMENT AND FULL BLEED MUST AGREE.

    §4.3's canvas/surface relationship is the quiet margin around a distinct
    work surface, and §14 says to reduce that margin before shrinking
    content. At 1024 and 768 the surface ran edge to edge WHILE keeping its
    16px radius and its shadow — a rounded, shadowed card pressed flat
    against both viewport edges, which is worse than either choice and reads
    as a flat dark dashboard. The phone is deliberately full-bleed and
    deliberately drops both.
  */
  const surface = (await page.evaluate(
    inPage(`const m = document.querySelector('.bcmain')
       if (m === null) return null
       const r = m.getBoundingClientRect()
       const cs = getComputedStyle(m)
       return {
         left: Math.round(r.x),
         right: Math.round(window.innerWidth - r.right),
         radius: Number.parseFloat(cs.borderTopLeftRadius),
         shadow: cs.boxShadow !== 'none' && cs.boxShadow !== '',
       }`),
  )) as { left: number; right: number; radius: number; shadow: boolean } | null
  if (surface !== null) {
    const bleeds = surface.left === 0 && surface.right === 0
    const carded = surface.radius > 0 || surface.shadow
    console.log(
      `  surface        gutters ${String(surface.left)}/${String(surface.right)}, radius ${String(surface.radius)}, shadow ${surface.shadow ? 'yes' : 'no'}`,
    )
    if (bleeds && carded) {
      problems.push(
        `${size.id}: the main surface runs edge to edge but still carries a radius (${String(surface.radius)}px) or a shadow — a card pressed flat against the viewport`,
      )
    }
    if (!bleeds && (surface.left < 8 || surface.right < 8)) {
      problems.push(
        `${size.id}: the quiet margin is only ${String(surface.left)}/${String(surface.right)}px`,
      )
    }
  }

  /*
    EXACTLY ONE FIXED BOTTOM BAR.

    `.bctray` is the personal tray, and the phone rules make it fixed. Reusing
    the class for a row of links lifted those links out of the page and
    stacked them invisibly under the real tray — a collision that exists only
    at the width where the class means something else, which is precisely the
    width nobody checks a stylesheet at.
  */
  const fixedBars = (await page.evaluate(
    inPage(`return [...document.querySelectorAll('.bctray')]
         .filter((el) => getComputedStyle(el).position === 'fixed').length`),
  )) as number
  console.log(`  fixed bottom bars  ${String(fixedBars)}`)
  if (fixedBars > 1) {
    problems.push(
      `${size.id}: ${String(fixedBars)} elements are fixed bottom bars — the tray class has been reused for something that is not the tray`,
    )
  }

  /* --- the fold, on the phone only (§6.2 and the acceptance matrix) --- */
  if (size.id === 'phone') {
    const fold = (await page.evaluate(
      inPage(`const first = document.querySelector('.bchome [data-mod] h2, .bcgrid .bctool h2')
         if (first === null) return null
         const r = first.getBoundingClientRect()
         return { y: Math.round(r.top + window.scrollY), name: (first.textContent ?? '').trim() }`),
    )) as { y: number; name: string } | null
    if (fold === null) {
      console.log('  first module   NO CONTENT FOUND — the measure matched nothing')
      problems.push(
        'phone: the fold measure matched nothing, which is not the same as a good score',
      )
    } else {
      const pct = Math.round((fold.y / size.height) * 100)
      console.log(
        `  first module   "${fold.name}" at ${String(fold.y)}px = ${String(pct)}% of the viewport`,
      )
      if (pct >= 40) {
        problems.push(
          `phone: the first useful module is at ${String(pct)}% of the viewport; the matrix requires under 40%`,
        )
      }
    }
  }

  /* --- touch targets on the narrow legs --- */
  if (size.touch) {
    const small = (await page.evaluate(
      inPage(`const out = []
         for (const el of document.querySelectorAll('button, a, input, summary')) {
           const r = el.getBoundingClientRect()
           if (r.width === 0 || r.height === 0) continue
           if (r.height >= 43.5 && r.width >= 43.5) continue
           const name = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 28)
           out.push(el.tagName.toLowerCase() + ' "' + name + '" ' + Math.round(r.width) + 'x' + Math.round(r.height))
         }
         return out`),
    )) as string[]
    console.log(`  under 44px     ${small.length === 0 ? 'none' : String(small.length)}`)
    for (const s of small) console.log(`    ${s}`)
    if (small.length > 0)
      problems.push(
        `${size.id}: ${String(small.length)} control(s) under 44px — ${small.join('; ')}`,
      )
  }

  await ctx.close()
}

/* ---------------- the experience does not follow the studio's scheme ------- */

/*
  §4.1 supplies ONE palette, the observed dark one, and every token in
  bc/tokens.css is a literal scoped to the experience root. So choosing light
  in the studio must not half-lighten the experiment: what would break is not
  the tokens but a rule that inherits a STUDIO token, and that failure looks
  like one element flipping while everything around it stays put — dark text
  on dark, or a lone white card.

  Asked through the stored preference rather than through `colorScheme`,
  because the studio's default is an explicit choice and the media query
  stopped deciding anything; scripts/verify/seed-appearance.ts records what
  that cost the last time an audit got it wrong.
*/
{
  const readColours = async (scheme: 'light' | 'dark'): Promise<string> => {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    })
    await ctx.addInitScript(
      `try { localStorage.setItem('studio.appearance', ${JSON.stringify(JSON.stringify({ scheme }))}) } catch {}`,
    )
    const page = await ctx.newPage()
    await page.goto(url('/basecamp/p/legacy-coaching-course'), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bchome')
    await page.waitForTimeout(600)
    const seen = (await page.evaluate(
      inPage(`const out = []
         for (const el of document.querySelectorAll('.bcmain *')) {
           const cs = getComputedStyle(el)
           out.push(cs.color + ';' + cs.backgroundColor + ';' + cs.borderTopColor)
         }
         return document.documentElement.dataset.scheme + '::' + out.join('|')`),
    )) as string
    await ctx.close()
    return seen
  }
  const light = await readColours('light')
  const dark = await readColours('dark')
  const lightAsked = light.startsWith('light::')
  const darkAsked = dark.startsWith('dark::')
  console.log(`\n=== scheme independence ===`)
  console.log(
    `  preference applied   light:${lightAsked ? 'yes' : 'NO'} dark:${darkAsked ? 'yes' : 'NO'}`,
  )
  if (!lightAsked || !darkAsked) {
    /*
      If the preference did not take, the comparison below passes for the
      wrong reason — two identical runs of the same scheme. This repository
      has shipped that exact vacuous pass before.
    */
    problems.push(
      'the stored appearance preference did not apply, so scheme independence was not actually tested',
    )
  } else {
    const same = light.slice(light.indexOf('::')) === dark.slice(dark.indexOf('::'))
    console.log(`  colours identical    ${same ? 'yes' : 'NO'}`)
    if (!same) {
      problems.push(
        'an element inside the experience changes colour with the studio scheme — a studio token has leaked into a rule that should use a bc token',
      )
    }
  }

  await browser.close()
  server.close()
}

if (problems.length === 0) {
  console.log('\nno absolute violations')
  process.exit(0)
}
console.log(`\n${String(problems.length)} PROBLEM(S):`)
for (const p of problems) console.log(`  - ${p}`)
process.exit(1)
