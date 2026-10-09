// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a long assertion table, one check per line reads better than the formatter's wrapping
/**
 * The aesthetic pass's browser suite (9 October 2026). Real Chromium against the working tree's page, served locally as the
 * prototype office (no network, no production). Looks for what a person would see, then asserts the properties:
 *
 *   npx tsx scripts/verify/aesthetic-qa.ts            # all sections
 *   ONLY=layout,background npx tsx scripts/verify/aesthetic-qa.ts
 *   LIVE=1 prints each result as it happens; captures go to .out/aesthetic-qa/
 *
 * Sections: layout (a press is not an arrangement), background (choose, apply, navigate, reload, reopen, change),
 * schedule (module and maximised views agree, persisted), burger (keyboard, aria, reduced motion), grid (dots crisp and
 * evenly spaced at every zoom and pixel density), settings (accent and scheme persist and reach the surfaces),
 * contrast (text against what it sits on, both schemes, two accents), phone (no horizontal overflow).
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { type Browser, chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any
declare const localStorage: any

const PORT = 4701
const OUT = '.out/aesthetic-qa'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser: Browser = await chromium.launch()
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
const only = new Set((process.env.ONLY ?? '').split(',').filter((s) => s !== ''))
const want = (s: string): boolean => only.size === 0 || only.has(s)

type Verdict = 'pass' | 'fail'
const results: { name: string; v: Verdict; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, v: ok ? 'pass' : 'fail', detail })
  if (process.env.LIVE === '1') console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail === '' ? '' : ` - ${detail}`}`.slice(0, 260))
}

const open = async (opts: { w?: number; h?: number; scheme?: string; palette?: string; touch?: boolean; dpr?: number; reduced?: boolean } = {}) => {
  const ctx = await browser.newContext({
    viewport: { width: opts.w ?? 1440, height: opts.h ?? 900 },
    deviceScaleFactor: opts.dpr ?? 1,
    hasTouch: opts.touch === true,
    isMobile: opts.touch === true,
    colorScheme: 'dark',
    reducedMotion: opts.reduced === true ? 'reduce' : 'no-preference',
  })
  await ctx.addInitScript(
    `try { if (!localStorage.getItem('studio.appearance')) localStorage.setItem('studio.appearance', JSON.stringify({ palette: '${opts.palette ?? 'slate'}', texture: 'concrete', own: null, ownName: '', scheme: '${opts.scheme ?? 'dark'}', density: 'comfortable' })) } catch {}`,
  )
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const slugs = (await page.evaluate(
    `[...document.querySelectorAll('[data-bc-go^="/p/"]')].map((e) => e.dataset.bcGo)`,
  )) as string[]
  const slug = slugs[0] ?? ''
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]', { timeout: 8000 })
  await page.waitForTimeout(500)
  return { ctx, page, errors, slug, slugs }
}
const press = async (page: Page, sel: string): Promise<void> => {
  await page.locator(sel).first().click({ force: true })
  await page.waitForTimeout(250)
}
const rects = (page: Page): Promise<{ id: string; x: number; y: number; w: number; h: number }[]> =>
  page.evaluate(
    `[...document.querySelectorAll('.bcstage [data-mod]')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.mod, x: r.left, y: r.top, w: r.width, h: r.height } })`,
  ) as any
const crossing = (a: any, b: any): boolean => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1
const overlapping = (list: any[]): string[] => {
  const out: string[] = []
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) if (crossing(list[i], list[j])) out.push(`${list[i].id}/${list[j].id}`)
  return out
}

/* ----------------------------------------------------------------- layout --- */
if (want('layout')) {
  const { ctx, page, errors } = await open()
  const start = await rects(page)
  check('the default board has no overlapping modules', overlapping(start).length === 0, overlapping(start).join(','))
  /* The defect: a press inside a module stored every rectangle at this width. */
  const first = start[0] ?? { x: 0, y: 0, w: 0, h: 0, id: '' }
  await page.mouse.click(first.x + 60, first.y + 120)
  await page.waitForTimeout(300)
  const stored1 = (await page.evaluate(`localStorage.getItem('bc.stage.' + location.pathname.split('/')[2])`)) as string | null
  const geometryFrozen = stored1 !== null && JSON.parse(stored1).mods?.some((m: any) => m.placed === true)
  check('pressing inside a module does not freeze the arrangement', !geometryFrozen, stored1?.slice(0, 120) ?? 'nothing stored')
  await press(page, '[data-bc-dock]')
  await page.waitForTimeout(900)
  const docked = await rects(page)
  const board = (await page.evaluate(`(() => { const r = document.querySelector('[data-bc-board]').getBoundingClientRect(); return { r: r.right } })()`)) as any
  check('opening the chat re-fits the modules to the narrower board', docked.every((m) => m.x + m.w <= board.r + 1), docked.map((m) => `${m.id}:${Math.round(m.x + m.w)}`).join(' '))
  check('no module overlaps another with the chat open', overlapping(docked).length === 0, overlapping(docked).join(','))
  await page.screenshot({ path: `${OUT}/layout-dock-open.png` })
  await press(page, '[data-bc-dock]')
  await page.waitForTimeout(900)
  const closed = await rects(page)
  check('closing the chat gives the modules their room back', closed.map((m) => Math.round(m.x + m.w)).join() === start.map((m) => Math.round(m.x + m.w)).join(), '')
  /* A real arrangement is kept to the pixel across the same changes. */
  const head = page.locator('.bcstage [data-mod="tasks"] .bcmodhead').first()
  const hb = (await head.boundingBox()) as any
  await page.mouse.move(hb.x + 40, hb.y + 12)
  await page.mouse.down()
  await page.mouse.move(hb.x + 140, hb.y + 70, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const moved = await rects(page)
  const before = moved.find((m) => m.id === 'tasks') as any
  check('dragging a module moves it', Math.abs(before.x - first.x) > 40, `${Math.round(before.x - first.x)}px`)
  await press(page, '[data-bc-dock]')
  await page.waitForTimeout(900)
  const after = (await rects(page)).find((m) => m.id === 'tasks') as any
  check('a module the person placed stays exactly where they put it when the chat opens', Math.abs(after.x - before.x) < 2 && Math.abs(after.y - before.y) < 2, `${Math.round(after.x)},${Math.round(after.y)} vs ${Math.round(before.x)},${Math.round(before.y)}`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(900)
  const reloaded = (await rects(page)).find((m) => m.id === 'tasks') as any
  check('the arrangement survives a reload', Math.abs(reloaded.x - after.x) < 2 && Math.abs(reloaded.y - after.y) < 2, '')
  /* A redraw inside the 250ms before the zoom is stored used to snap the board back to its old zoom. */
  await page.locator('[data-bc-zoom="reset"]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-zoom="in"]').first().click({ force: true })
  await page.locator('[data-bc-zoom="in"]').first().click({ force: true })
  const liveZoom = (await page.evaluate(`document.querySelector('.bczoomval').textContent`)) as string
  await page.locator('[data-bc-menu]').first().click({ force: true })
  await page.waitForTimeout(100)
  const afterZoom = (await page.evaluate(`document.querySelector('.bczoomval').textContent`)) as string
  check('opening the menu straight after zooming keeps the zoom', liveZoom === afterZoom && liveZoom !== '100%', `${liveZoom} -> ${afterZoom}`)
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
  /* The viewport changing under a default board. */
  const w = await open()
  for (const width of [1280, 1024, 900]) {
    await w.page.setViewportSize({ width, height: 800 })
    await w.page.waitForTimeout(500)
    const list = await rects(w.page)
    check(`the default board fits and does not overlap at ${String(width)}px`, overlapping(list).length === 0, overlapping(list).join(','))
  }
  await w.ctx.close()
}

/* ------------------------------------------------------------- background --- */
if (want('background')) {
  const { ctx, page, slug, slugs, errors } = await open()
  const state = (): Promise<any> =>
    page.evaluate(
      `(() => { const b = document.querySelector('[data-bc-board]'); const r = document.getElementById('root'); return { board: b?.getAttribute('data-bg') ?? null, page: r?.getAttribute('data-bg-page') ?? null, pageImg: getComputedStyle(r).backgroundImage.includes('url(') } })()`,
    )
  const openLook = async (): Promise<void> => {
    await press(page, '[data-bc-pagemenu]')
    await press(page, '[data-bc-look]')
    await page.waitForSelector('.bdgrid')
  }
  await openLook()
  await press(page, '[data-bd-pick="walnut"]')
  const pv = await state()
  check('choosing a material previews it on the board and the page', pv.board === 'walnut' && pv.page === 'walnut' && pv.pageImg === true, JSON.stringify(pv))
  await press(page, '[data-bd-apply]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/background-walnut.png` })
  /* Navigate away to another project and back. */
  if (slugs[1] !== undefined) {
    await page.goto(url(slugs[1]), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-bc-board]')
    await page.waitForTimeout(500)
    const other = await state()
    check('another project does not inherit the material', other.board === null && other.page === null, JSON.stringify(other))
  }
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(500)
  const back = await state()
  check('the material is still there after navigating away and back', back.board === 'walnut' && back.page === 'walnut', JSON.stringify(back))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(700)
  const reload = await state()
  check('the material survives a reload', reload.board === 'walnut' && reload.page === 'walnut' && reload.pageImg, JSON.stringify(reload))
  /* Reopen Settings and the look sheet, then change it. */
  await press(page, '[data-bc-settings]')
  await page.waitForSelector('#settings .stg')
  await page.screenshot({ path: `${OUT}/background-settings-open.png` })
  await press(page, '#settings [data-stg-back]')
  await page.waitForTimeout(400)
  await openLook()
  const on = (await page.evaluate(`document.querySelector('[data-bd-pick="walnut"]')?.getAttribute('aria-checked')`)) as string
  check('the look sheet shows the current material as chosen when it is reopened', on === 'true', String(on))
  await press(page, '[data-bd-pick="solid-sage"]')
  await press(page, '[data-bd-apply]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const changed = await state()
  check('the material can be changed again', changed.board === 'solid-sage' && changed.page === 'solid-sage', JSON.stringify(changed))
  /* Restore the default clears the page as well. */
  await openLook()
  await press(page, '[data-bd-default]')
  await press(page, '[data-bd-apply]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const cleared = await state()
  check('restoring the default clears the material from the board and the page', cleared.board === null && cleared.page === null, JSON.stringify(cleared))
  /* Fixed overlays and scrolling sit above a wallpapered page. */
  await openLook()
  await press(page, '[data-bd-pick="walnut"]')
  await press(page, '[data-bd-apply]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await press(page, '[data-bc-menu]')
  const menuTop = (await page.evaluate(`(() => { const m = document.querySelector('.bcmenupanel'); const r = m.getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + 20); return m.contains(e) })()`)) as boolean
  check('the project menu stays on top of a wallpapered page', menuTop === true, '')
  await page.keyboard.press('Escape')
  await press(page, '[data-bc-expand="schedule"]')
  const expTop = (await page.evaluate(`(() => { const m = document.querySelector('.bcexpbox'); const r = m.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 80); return m.contains(e) })()`)) as boolean
  check('a maximised view stays on top of a wallpapered page', expTop === true, '')
  await page.screenshot({ path: `${OUT}/background-maximised-over-walnut.png` })
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* --------------------------------------------------------------- schedule --- */
if (want('schedule')) {
  const { ctx, page, slug, errors } = await open()
  const modView = (): Promise<string> => page.evaluate(`document.querySelector('.bcstage [data-bc-cal]')?.getAttribute('data-view') ?? ''`) as Promise<string>
  check('the module opens on the month', (await modView()) === 'month', await modView())
  for (const v of ['week', 'day', 'month']) {
    await press(page, `.bcstage [data-cal-view="${v}"]`)
    check(`${v} selected in the module updates it without maximising`, (await modView()) === v, await modView())
  }
  await press(page, '.bcstage [data-cal-view="week"]')
  const label = (await page.evaluate(`document.querySelector('.bcstage .bccal2minititle')?.textContent ?? ''`)) as string
  check('the week view says which week it is', /\d/.test(label), label)
  await press(page, '.bcstage [data-cal-nav="next"]')
  const label2 = (await page.evaluate(`document.querySelector('.bcstage .bccal2minititle')?.textContent ?? ''`)) as string
  check('next moves the module by a week', label2 !== label, `${label} -> ${label2}`)
  await press(page, '[data-bc-expand="schedule"]')
  const expView = (await page.evaluate(`document.querySelector('.bcexpbox [data-bc-cal]')?.getAttribute('data-view')`)) as string
  check('the maximised schedule opens on the view chosen in the module', expView === 'week', expView)
  await press(page, '.bcexpbox [data-cal-view="day"]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('a view chosen in the maximised schedule is the one the module shows afterwards', (await modView()) === 'day', await modView())
  const stored = (await page.evaluate(`localStorage.getItem('bc.cal.' + location.pathname.split('/')[2])`)) as string
  check('the choice is stored for the project', stored !== null && JSON.parse(stored).view === 'day', String(stored))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(600)
  check('the choice survives a reload', (await modView()) === 'day', await modView())
  /* No overlap or clipping in the module's own bar at several module widths. */
  for (const view of ['day', 'week', 'month']) {
    await press(page, `.bcstage [data-cal-view="${view}"]`)
    const bad = (await page.evaluate(`(() => { const bar = document.querySelector('.bcstage .bccal2compact'); if (!bar) return 'no bar'; const els = [...bar.querySelectorAll('.bccal2minibar > *, .bccal2views--mini button')]; const rs = els.map((e) => e.getBoundingClientRect()); const host = bar.getBoundingClientRect(); const out = []; for (const r of rs) if (r.right > host.right + 1 || r.left < host.left - 1) out.push('clipped'); for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push('overlap') } return out.join(',') })()`)) as string
    check(`the module's controls neither overlap nor clip in ${view}`, bad === '', bad)
  }
  void slug
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
  /* A phone: touch targets. */
  const ph = await open({ w: 390, h: 844, touch: true })
  const small = (await ph.page.evaluate(`[...document.querySelectorAll('.bccal2views--mini button, .bccal2minibar button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.height < 36 || r.width < 30) }).map((e) => e.textContent.trim() + ':' + Math.round(e.getBoundingClientRect().height))`)) as string[]
  check('the module controls are touch-sized on a phone', small.length === 0, small.join(','))
  await ph.ctx.close()
}

/* ------------------------------------------------------------------ burger --- */
if (want('burger')) {
  const { ctx, page, errors } = await open()
  const exp = (): Promise<string> => page.evaluate(`document.querySelector('[data-bc-menu]').getAttribute('aria-expanded')`) as Promise<string>
  check('the menu starts closed', (await exp()) === 'false', await exp())
  await page.keyboard.press('Tab')
  await page.focus('[data-bc-menu]')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('Enter opens the menu and sets aria-expanded', (await exp()) === 'true', await exp())
  const focused = (await page.evaluate(`document.activeElement?.className ?? ''`)) as string
  check('focus moves into the menu when it opens', focused.includes('bcmenuitem'), focused)
  await page.keyboard.press('ArrowDown')
  const second = (await page.evaluate(`document.activeElement?.textContent?.trim() ?? ''`)) as string
  check('the arrow keys move between entries', second !== '', second)
  await page.screenshot({ path: `${OUT}/burger-open.png` })
  const cross = (await page.evaluate(`getComputedStyle(document.querySelector('.bcburger .bcb2')).opacity`)) as string
  check('the three lines become a cross when open (the middle line is gone)', Number.parseFloat(cross) < 0.1, cross)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(40)
  check('Escape closes the menu at once (aria-expanded is false before the motion ends)', (await exp()) === 'false', await exp())
  const leaving = (await page.evaluate(`!!document.querySelector('[data-bc-menu-ghost]') && document.querySelector('[data-bc-menu]').hasAttribute('data-closing')`)) as boolean
  check('closing plays a transition: a picture of the panel lifts away and the cross folds back', leaving === true, '')
  const real = (await page.evaluate(`[...document.querySelectorAll('.bcmenupanel')].filter((e) => !e.hasAttribute('data-bc-menu-ghost') && !e.hidden).length`)) as number
  check('the real panel is already shut while the picture leaves', real === 0, String(real))
  await page.waitForTimeout(350)
  check('the picture is gone afterwards', (await page.locator('[data-bc-menu-ghost]').count()) === 0, '')
  const back = (await page.evaluate(`document.activeElement?.hasAttribute('data-bc-menu')`)) as boolean
  check('focus returns to the button', back === true, '')
  await press(page, '[data-bc-menu]')
  await page.mouse.click(900, 600)
  await page.waitForTimeout(250)
  check('pressing outside closes it', (await exp()) === 'false', await exp())
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
  const calm = await open({ reduced: true })
  await press(calm.page, '[data-bc-menu]')
  const anim = (await calm.page.evaluate(`getComputedStyle(document.querySelector('.bcmenupanel')).animationName`)) as string
  check('under reduced motion the menu does not animate', anim === 'none', anim)
  await calm.ctx.close()
  const touch = await open({ w: 390, h: 844, touch: true })
  await press(touch.page, '[data-bc-menu]')
  const small = (await touch.page.evaluate(`[...document.querySelectorAll('.bcmenuitem')].filter((e) => e.getBoundingClientRect().height < 44).length`)) as number
  check('menu entries are 44px or taller on a touch screen', small === 0, String(small))
  const inView = (await touch.page.evaluate(`(() => { const r = document.querySelector('.bcmenupanel').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth })()`)) as boolean
  check('the menu fits inside a phone screen', inView, '')
  await touch.ctx.close()
}

/* --------------------------------------------------------------- maximise --- */
if (want('maximise')) {
  const { ctx, page, errors } = await open()
  const probe = (): Promise<{ w: number; opacity: string } | null> =>
    page.evaluate(`(() => { const b = document.querySelector('.bcexpbox'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), opacity: getComputedStyle(b).opacity } })()`) as any
  await page.locator('[data-bc-expand="schedule"]').first().click({ force: true })
  await page.waitForTimeout(60)
  const early = await probe()
  await page.waitForTimeout(600)
  const final = await probe()
  check('the maximised view grows from its module (it is smaller part-way than at rest)', early !== null && final !== null && early.w < final.w - 20, `${String(early?.w)} -> ${String(final?.w)}`)
  const solid = (await page.evaluate(`(() => { const c = getComputedStyle(document.querySelector('.bcexpbox')).backgroundColor; return c })()`)) as string
  check('the maximised surface has an opaque face', !/rgba\(.*,\s*0(\.\d+)?\)$/.test(solid) && solid !== 'rgba(0, 0, 0, 0)', solid)
  await page.keyboard.press('Escape')
  /* Closing goes through history (Back), so the picture appears a tick later: look for it for a moment. */
  const ghost = (await page.evaluate(`new Promise((res) => { const t0 = performance.now(); const look = () => { if (document.querySelector('[data-bc-ghost]')) return res(true); if (performance.now() - t0 > 600) return res(false); setTimeout(look, 15) }; look() })`)) as boolean
  check('closing settles back as a picture of the view (a ghost) towards its module', ghost === true, '')
  await page.waitForTimeout(600)
  check('no ghost is left behind', (await page.locator('[data-bc-ghost]').count()) === 0, '')
  const calm = await open({ reduced: true })
  await calm.page.locator('[data-bc-expand="schedule"]').first().click({ force: true })
  await calm.page.waitForTimeout(60)
  const w1 = (await calm.page.evaluate(`document.querySelector('.bcexpbox').getBoundingClientRect().width`)) as number
  await calm.page.waitForTimeout(500)
  const w2 = (await calm.page.evaluate(`document.querySelector('.bcexpbox').getBoundingClientRect().width`)) as number
  check('under reduced motion the maximised view appears at its full size at once', Math.abs(w1 - w2) < 2, `${String(w1)} vs ${String(w2)}`)
  await calm.ctx.close()
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* -------------------------------------------------------------------- grid --- */
if (want('grid')) {
  for (const dpr of [1, 2]) {
    const { ctx, page, errors } = await open({ dpr })
    const probe = (): Promise<any> =>
      page.evaluate(`(() => {
        const c = document.querySelector('.bcgridcv'); const board = document.querySelector('[data-bc-board]')
        if (!c) return { error: 'no canvas' }
        const g = c.getContext('2d'); const w = c.width, h = c.height
        const d = g.getImageData(0, 0, w, h).data
        /* Dots are the connected blobs of non-transparent pixels along one row band; take the row with the most coverage. */
        let best = 0, bestY = 0
        for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) n++; if (n > best) { best = n; bestY = y } }
        const xs = []; let inDot = false, start = 0
        for (let x = 0; x < w; x++) { const on = d[(bestY * w + x) * 4 + 3] > 40; if (on && !inDot) { inDot = true; start = x } if (!on && inDot) { inDot = false; xs.push((start + x - 1) / 2) } }
        const gaps = xs.slice(1).map((v, i) => v - xs[i])
        const scale = c.width / board.clientWidth
        return { dots: xs.length, gaps: gaps.map((g) => g / scale), scale, covered: best }
      })()`)
    let zooms = 0
    for (const z of ['reset', 'in', 'in', 'out', 'out', 'out', 'out']) {
      await press(page, `[data-bc-zoom="${z}"]`)
      await page.waitForTimeout(500)
      const p = await probe()
      zooms += 1
      const label = (await page.evaluate(`document.querySelector('.bczoomval').textContent`)) as string
      /* The first and last dot can be cut by the canvas edge, which moves their centre; the interior is what must be even. */
      const inner = p.gaps ? p.gaps.slice(1, -1) : []
      const spread = inner.length > 2 ? Math.max(...inner) - Math.min(...inner) : 99
      check(`dots are drawn at ${label} (dpr ${String(dpr)})`, p.dots >= 8, `${String(p.dots)} dots in the busiest row`)
      /* Crisp and even: every gap in a row is the same within a device pixel, because positions are snapped. */
      check(`dots are evenly spaced at ${label} (dpr ${String(dpr)})`, spread <= 1.01 / p.scale + 0.02 * 24, `spread ${spread.toFixed(2)} css px, gaps ${inner.slice(0, 5).map((g: number) => g.toFixed(1)).join(',')}`)
      if (zooms === 3) await page.screenshot({ path: `${OUT}/grid-dpr${String(dpr)}-${label.replace('%', 'pct')}.png`, clip: { x: 0, y: 200, width: 700, height: 400 } })
    }
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

/* ---------------------------------------------------------------- settings --- */
if (want('settings')) {
  const { ctx, page, slug, errors } = await open({ scheme: 'dark', palette: 'slate' })
  const root = (): Promise<any> =>
    page.evaluate(`(() => { const s = getComputedStyle(document.documentElement); return { scheme: document.documentElement.dataset.scheme, palette: document.documentElement.dataset.palette, accent: s.getPropertyValue('--bc-accent').trim(), canvas: s.getPropertyValue('--bc-canvas').trim(), stored: JSON.parse(localStorage.getItem('studio.appearance') || '{}') } })()`)
  const settingsPane = async (): Promise<void> => {
    await press(page, '[data-bc-settings]')
    await page.waitForSelector('#settings .stg')
    await press(page, '#settings [data-setting="appearance"]')
    await page.waitForSelector('[data-palette-pick]')
  }
  await settingsPane()
  const a0 = await root()
  await press(page, '[data-palette-pick="clay"]')
  const a1 = await root()
  check('choosing an accent changes the accent token', a1.accent !== a0.accent && a1.palette === 'clay', `${a0.accent} -> ${a1.accent}`)
  const reached = (await page.evaluate(`(() => { const t = document.querySelector('#settings .st-swatch[aria-pressed="true"]'); const s = getComputedStyle(document.querySelector('#settings .stg-navitem[aria-current], #settings .stg-navitem.is-on, #settings .stg-navitem[aria-selected="true"]') || document.body); return { pressed: t?.dataset.palettePick, line: getComputedStyle(t).borderTopColor } })()`)) as any
  check('the Settings page itself wears the chosen accent', reached.pressed === 'clay', JSON.stringify(reached))
  await press(page, '[data-scheme-pick="light"]')
  const l = await root()
  check('choosing Light applies it at once', l.scheme === 'light' && l.canvas !== a1.canvas, `${a1.canvas} -> ${l.canvas}`)
  await page.screenshot({ path: `${OUT}/settings-appearance-light-clay.png` })
  const stored = l.stored
  check('both choices are stored', stored.scheme === 'light' && stored.palette === 'clay', JSON.stringify(stored))
  /* Persist across a reload and show on the board's own surfaces. */
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(600)
  const r = await root()
  check('after a reload the scheme and the accent are still applied', r.scheme === 'light' && r.palette === 'clay', JSON.stringify({ s: r.scheme, p: r.palette }))
  const surfaces = (await page.evaluate(`(() => { const n = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null }; const btn = n('[data-bc-dock]'); const mod = n('.bcstage [data-mod]'); return { btn: btn?.backgroundColor, mod: mod?.backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--bc-accent').trim() } })()`)) as any
  check('the board shows the chosen scheme (module surface is light)', /^(rgb|color)/.test(surfaces.mod ?? '') && !/^rgb\(\s*(2[0-9]|[0-3]?[0-9]),/.test(surfaces.mod ?? ''), JSON.stringify(surfaces))
  await press(page, '[data-bc-dock]')
  await page.waitForTimeout(500)
  const sendLook = (): Promise<string> =>
    page.evaluate(`(() => { const b = document.querySelector('#dock .btn.primary'); return b ? getComputedStyle(b).backgroundImage + '|' + getComputedStyle(b).backgroundColor : '' })()`) as Promise<string>
  const withClay = await sendLook()
  await page.evaluate(`document.documentElement.dataset.palette = 'moss'`)
  await page.waitForTimeout(200)
  const withMoss = await sendLook()
  await page.evaluate(`document.documentElement.dataset.palette = 'clay'`)
  check('the chat send button follows the accent (it changes with the palette)', withClay !== '' && withClay !== withMoss, `${withClay.slice(0, 60)} vs ${withMoss.slice(0, 60)}`)
  await page.screenshot({ path: `${OUT}/settings-persisted-light-clay-dock.png` })
  /* Device (system) follows the system preference. */
  await settingsPane()
  await press(page, '[data-scheme-pick="system"]')
  const sys = await root()
  check('Device follows the system (no explicit scheme on the page)', sys.scheme === undefined && sys.stored.scheme === 'system', JSON.stringify({ s: sys.scheme, st: sys.stored.scheme }))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* ---------------------------------------------------------------- contrast --- */
if (want('contrast')) {
  const SCAN = `(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true })
    const rgba = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
    const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat([a]) }
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const bgOf = (el) => { let acc = [0, 0, 0, 0]; const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e); for (const e of chain) { const cs = getComputedStyle(e); const c = rgba(cs.backgroundColor); if (c[3] > 0) acc = over(acc, c); if (acc[3] >= 0.99) return { c: acc, image: false }; if (cs.backgroundImage !== 'none' && !/^linear-gradient\\(rgba?\\(0, 0, 0, 0\\)/.test(cs.backgroundImage)) { return { c: acc[3] > 0 ? acc : rgba(getComputedStyle(document.documentElement).getPropertyValue('--bc-surface')), image: true } } } return { c: over(acc, rgba(getComputedStyle(document.body).backgroundColor || '#000')), image: false } }
    const out = []; const seen = new Set()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim(); if (t.length < 2) continue
      const el = n.parentElement; if (!el) continue
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || Number.parseFloat(cs.opacity) < 0.5) continue
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
      if (el.closest('[hidden], [aria-hidden="true"], .bcpostit, svg, .bcpg, .bcthumb, .realpage, [disabled]')) continue
      const fg = rgba(cs.color); const bg = bgOf(el)
      const fgc = fg[3] < 1 ? over(fg, bg.c) : fg
      const rt = ratio(fgc, bg.c)
      const size = Number.parseFloat(cs.fontSize); const bold = Number.parseInt(cs.fontWeight, 10) >= 700
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
      /* A gradient or image cannot be sampled from computed style; the primary button is covered by the token-pair check below. */
      if (bg.image && el.closest('.btn.primary')) continue
      if (rt < need) { const key = (el.className || el.tagName) + '|' + t.slice(0, 24); if (!seen.has(key)) { seen.add(key); out.push({ cls: String(el.className || el.tagName).slice(0, 48), text: t.slice(0, 28), ratio: Number(rt.toFixed(2)), need, image: bg.image }) } }
    }
    return out
  })()`
  const surfaces: { name: string; go: (p: Page) => Promise<void> }[] = [
    { name: 'board', go: async () => undefined },
    { name: 'dock', go: async (p) => press(p, '[data-bc-dock]') },
    { name: 'menu', go: async (p) => press(p, '[data-bc-menu]') },
    { name: 'maximised schedule', go: async (p) => press(p, '[data-bc-expand="schedule"]') },
    { name: 'maximised team', go: async (p) => { await p.goto(`${p.url()}/x/team`, { waitUntil: 'domcontentloaded' }) } },
    { name: 'look sheet', go: async (p) => { await press(p, '[data-bc-pagemenu]'); await press(p, '[data-bc-look]'); await p.waitForSelector('.bdgrid') } },
    { name: 'settings team', go: async (p) => { await press(p, '[data-bc-settings]'); await p.waitForSelector('#settings .stg') } },
    { name: 'settings appearance', go: async (p) => { await press(p, '[data-bc-settings]'); await p.waitForSelector('#settings .stg'); await press(p, '#settings [data-setting="appearance"]') } },
    { name: 'settings services', go: async (p) => { await press(p, '[data-bc-settings]'); await p.waitForSelector('#settings .stg'); await press(p, '#settings [data-setting="connections"]') } },
  ]
  let total = 0
  for (const scheme of ['dark', 'light']) {
    for (const palette of ['slate', 'clay']) {
      for (const s of surfaces) {
        const { ctx, page } = await open({ scheme, palette })
        try {
          await s.go(page)
          await page.waitForTimeout(500)
          const bad = (await page.evaluate(SCAN)) as any[]
          total += bad.length
          check(`text contrast: ${s.name}, ${scheme}, ${palette}`, bad.length === 0, bad.slice(0, 6).map((b) => `${b.cls} "${b.text}" ${String(b.ratio)}<${String(b.need)}${b.image ? ' (on image)' : ''}`).join(' ; '))
        } catch (e) {
          check(`text contrast: ${s.name}, ${scheme}, ${palette}`, false, `could not reach: ${String(e).split('\n')[0]}`)
        }
        await ctx.close()
      }
    }
  }
  console.log(`contrast offenders in total: ${String(total)}`)
}

/* ------------------------------------------------------------------ tokens --- */
if (want('tokens')) {
  for (const scheme of ['dark', 'light']) {
    for (const palette of ['slate', 'moss', 'clay', 'ink', 'paper']) {
      const { ctx, page } = await open({ scheme, palette })
      const r = (await page.evaluate(`(() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true })
        const rgb = (s) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data] }
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
        const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
        const s = getComputedStyle(document.documentElement); const t = (n) => rgb(s.getPropertyValue(n).trim())
        const accent = t('--bc-accent'), ink = t('--bc-accent-ink'), surface = t('--bc-surface'), canvas = t('--bc-canvas')
        return {
          inkOnAccent: ratio(accent, ink), accentOnSurface: ratio(accent, surface), accentOnCanvas: ratio(accent, canvas),
          text: ratio(t('--bc-text'), surface), strong: ratio(t('--bc-text-strong'), surface), muted: ratio(t('--bc-text-muted'), surface), mutedOnCanvas: ratio(t('--bc-text-muted'), canvas),
          heading: ratio(t('--bc-heading'), surface), warn: ratio(t('--bc-warn'), surface), danger: ratio(t('--bc-danger'), surface), success: ratio(t('--bc-success'), surface), amber: ratio(t('--bc-amber'), surface), info: ratio(t('--bc-info'), surface),
          studioAccent: s.getPropertyValue('--accent').trim() === s.getPropertyValue('--bc-accent').trim() || rgb(s.getPropertyValue('--accent')).join() === accent.join(),
        }
      })()`)) as any
      const tag = `${scheme}, ${palette}`
      check(`text on the accent reads (${tag})`, r.inkOnAccent >= 4.5, r.inkOnAccent.toFixed(2))
      check(`the accent is distinct from its surface (${tag})`, r.accentOnSurface >= 3, r.accentOnSurface.toFixed(2))
      check(`body, strong and muted text clear 4.5:1 on surface and canvas (${tag})`, Math.min(r.text, r.strong, r.muted, r.mutedOnCanvas) >= 4.5, `${r.text.toFixed(1)} ${r.strong.toFixed(1)} ${r.muted.toFixed(1)} ${r.mutedOnCanvas.toFixed(1)}`)
      check(`state and heading colours clear 4.5:1 on surface (${tag})`, Math.min(r.heading, r.warn, r.danger, r.success, r.amber, r.info) >= 4.5, `${['heading', 'warn', 'danger', 'success', 'amber', 'info'].map((k) => `${k} ${r[k].toFixed(1)}`).join(' ')}`)
      check(`the studio accent is the Team HQ accent (${tag})`, r.studioAccent === true, '')
      await ctx.close()
    }
  }
}

/* ------------------------------------------------------------------- phone --- */
if (want('phone')) {
  for (const w of [360, 390, 430]) {
    for (const scheme of ['dark', 'light']) {
      const { ctx, page, errors } = await open({ w, h: 844, touch: true, scheme })
      const over = (): Promise<number> => page.evaluate(`Math.max(0, document.documentElement.scrollWidth - innerWidth)`) as Promise<number>
      check(`no horizontal overflow on the board at ${String(w)}px ${scheme}`, (await over()) <= 1, String(await over()))
      await press(page, '[data-bc-menu]')
      check(`no horizontal overflow with the menu open at ${String(w)}px ${scheme}`, (await over()) <= 1, String(await over()))
      await page.keyboard.press('Escape')
      await press(page, '[data-bc-settings]')
      await page.waitForTimeout(400)
      check(`no horizontal overflow in Settings at ${String(w)}px ${scheme}`, (await over()) <= 1, String(await over()))
      if (w === 390) await page.screenshot({ path: `${OUT}/phone-settings-${scheme}.png` })
      check('no page errors', errors.length === 0, errors.join(' | '))
      await ctx.close()
    }
  }
}

await browser.close()
server.close()
const failed = results.filter((r) => r.v === 'fail')
for (const f of failed) console.log(`FAIL  ${f.name}${f.detail === '' ? '' : ` - ${f.detail}`}`.slice(0, 400))
console.log(`\n${String(results.length - failed.length)} passed, ${String(failed.length)} failed (of ${String(results.length)})`)
process.exitCode = failed.length === 0 ? 0 : 1
