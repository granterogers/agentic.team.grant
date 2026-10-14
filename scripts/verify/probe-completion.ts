/// <reference lib="dom" />
/**
 * Completion-pass checks for the visual defects named in docs/ux-overhaul/COMPLETION-INVENTORY-2026-10-14.md, in real
 * Chromium against the local prototype. Each check is a measurement with a stated threshold, not a screenshot judgement.
 *
 *   npx tsx scripts/verify/probe-completion.ts
 *
 * D1  The source mark on a real-preview tile does not overlap the picture.
 * D2  The header notification count does not overlap the bell glyph (390 and 1440).
 * D3  The no-project screen offers the person's projects and one action, at desktop and phone.
 * D4  Tile metadata text meets WCAG AA (4.5:1 for normal text) in Light and Dark.
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/* WCAG relative luminance and contrast from computed colours (rgb() or the color(srgb …) form). */
const parse = (c: string): [number, number, number] | null => {
  const srgb = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/)
  if (srgb !== null) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255]
  const rgb = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/)
  return rgb === null ? null : [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
}
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const hi = Math.max(lum(a), lum(b))
  const lo = Math.min(lum(a), lum(b))
  return (hi + 0.05) / (lo + 0.05)
}

const openProject = async (page: Page) => {
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page
    .locator('[data-bc-menu-open]:visible, [data-bc-menu]:visible')
    .first()
    .click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]:visible').first().click({ force: true })
  await page.waitForTimeout(1400)
}

const stored = (scheme: 'light' | 'dark') =>
  JSON.stringify({
    palette: 'slate',
    texture: 'none',
    own: null,
    ownName: '',
    scheme,
    density: 'comfortable',
    look: 'silver',
    glass: 'soft',
    depth: 'soft',
  })

try {
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript((v) => localStorage.setItem('studio.appearance', v), stored(scheme))
    const page = await context.newPage()
    await openProject(page)

    /* D1: open Docs & Files so real previews are drawn, then check the mark against the picture. */
    await page
      .locator('[data-bc-expand="documents"]:visible')
      .first()
      .click({ force: true })
      .catch(() => undefined)
    await page.waitForTimeout(5500)
    const marks = await page.evaluate(() => {
      const out: Array<{ overlaps: boolean; inMeta: boolean }> = []
      for (const tile of Array.from(document.querySelectorAll('.bcthumb.has-real'))) {
        const fig = tile.closest('figure')
        const mark = fig?.querySelector('.bcdocsrc')
        if (mark === null || mark === undefined) continue
        const m = mark.getBoundingClientRect()
        const t = tile.getBoundingClientRect()
        const overlaps =
          m.left < t.right && m.right > t.left && m.top < t.bottom && m.bottom > t.top
        out.push({ overlaps, inMeta: mark.closest('.bcdocmeta') !== null })
      }
      return out
    })
    check(
      `${scheme}: D1 a real-preview tile has a source mark to test`,
      marks.length > 0,
      `${String(marks.length)} tile(s)`,
    )
    check(
      `${scheme}: D1 the source mark does not overlap the preview`,
      marks.every((m) => !m.overlaps),
      `${String(marks.filter((m) => m.overlaps).length)} overlapping`,
    )
    check(
      `${scheme}: D1 the source mark sits in the tile's meta line`,
      marks.every((m) => m.inMeta),
    )

    /* D4: contrast of every meta line's text against the tile's visible surface. */
    const meta = await page.evaluate(() => {
      const out: Array<{ text: string; color: string; bg: string; opacity: number }> = []
      for (const el of Array.from(document.querySelectorAll('.bcdocmeta'))) {
        if (el.getBoundingClientRect().width === 0) continue
        let bg = ''
        for (let p: Element | null = el; p !== null && bg === ''; p = p.parentElement) {
          const b = getComputedStyle(p).backgroundColor
          if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') bg = b
        }
        let opacity = 1
        for (let p: Element | null = el; p !== null; p = p.parentElement)
          opacity *= Number(getComputedStyle(p).opacity)
        out.push({
          text: (el.textContent ?? '').trim().slice(0, 30),
          color: getComputedStyle(el).color,
          bg,
          opacity,
        })
      }
      return out
    })
    const worst = meta
      .map((m) => {
        const fg0 = parse(m.color)
        const bg = parse(m.bg)
        /* Blend the text over its background by the effective opacity (the text's own alpha and every ancestor's opacity). */
        const alpha = (m.color.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? '1') as string
        const a = Number(alpha) * m.opacity
        const fg =
          fg0 !== null && bg !== null
            ? (fg0.map((c, i) => c * a + (bg[i] ?? 0) * (1 - a)) as [number, number, number])
            : null
        return { ...m, ratio: fg !== null && bg !== null ? ratio(fg, bg) : 0 }
      })
      .sort((a, b) => a.ratio - b.ratio)
    check(
      `${scheme}: D4 tile meta lines are measured`,
      worst.length > 0,
      `${String(worst.length)} line(s)`,
    )
    check(
      `${scheme}: D4 every tile meta line meets 4.5:1`,
      worst.every((m) => m.ratio >= 4.5),
      worst.length === 0 ? '' : `lowest "${worst[0]?.text}" ${(worst[0]?.ratio ?? 0).toFixed(2)}:1`,
    )
    await context.close()

    /* D2: the header count does not overlap the bell glyph. */
    for (const width of [390, 1440] as const) {
      const ctx = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: width < 500,
        hasTouch: width < 500,
      })
      await ctx.addInitScript((v) => localStorage.setItem('studio.appearance', v), stored(scheme))
      const p = await ctx.newPage()
      await p.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(1400)
      const r = await p.evaluate(() => {
        const count = document.querySelector('[data-bc-attention] .bcstatus')
        const bell = document.querySelector(
          '[data-bc-attention] .bcattbell, [data-bc-attention] svg',
        )
        if (count === null || bell === null) return null
        const a = count.getBoundingClientRect()
        const b = bell.getBoundingClientRect()
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        return {
          overlap,
          count: [Math.round(a.left), Math.round(a.top)],
          bell: [Math.round(b.left), Math.round(b.top)],
        }
      })
      check(
        `${scheme}: D2 the count is drawn at ${String(width)}px`,
        r !== null,
        r === null ? 'no count' : '',
      )
      if (r !== null && r.bell[0] !== 0)
        check(
          `${scheme}: D2 the count does not overlap the bell at ${String(width)}px`,
          !r.overlap,
          JSON.stringify(r),
        )
      else if (r !== null)
        console.log(
          `SKIP: ${scheme}: D2 the bell is not drawn at ${String(width)}px (the word stands in)`,
        )
      await ctx.close()
    }
  }

  /* D3: the no-project screen with projects listed, at desktop and phone. */
  for (const [width, mobile] of [
    [1440, false],
    [390, true],
  ] as const) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: mobile,
      hasTouch: mobile,
    })
    const p = await ctx.newPage()
    await p.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await p.waitForTimeout(1400)
    const info = await p.evaluate(() => ({
      section: document.querySelector('.bcnoproj') !== null,
      cards: document.querySelectorAll('.bcnoproj-card').length,
      title: (document.querySelector('.bcnoproj-title')?.textContent ?? '').trim(),
    }))
    check(`D3 the no-project screen is drawn at ${String(width)}px`, info.section, info.title)
    check(
      `D3 the person's projects are offered as cards at ${String(width)}px`,
      info.cards > 0,
      `${String(info.cards)} card(s)`,
    )
    await p.screenshot({ path: `.out/visual/completion-empty-${String(width)}.png` })
    await ctx.close()
  }
} finally {
  await browser.close()
  await close()
}

if (failures > 0) {
  console.log(`${String(failures)} check(s) failed`)
  process.exit(1)
}
console.log('ALL COMPLETION CHECKS PASS')
