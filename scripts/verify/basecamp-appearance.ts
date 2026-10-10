// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * Project appearance (Project settings, Appearance), in real Chromium against the local prototype office:
 *
 *   npx tsx scripts/verify/basecamp-appearance.ts
 *
 * Module colour mode, minimised-module opacity (default 80%), grid-dot opacity and texture strength: the defaults, an immediate
 * preview, persistence per project across a reload, isolation between projects, the board actually wearing each setting, reset,
 * and both schemes. Screenshots go to .out/appearance.
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const localStorage: any
declare const getComputedStyle: any

const OUT = process.env.OUT ?? '.out/appearance'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(4741)
const browser = await chromium.launch()
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const u = (p: string): string => `http://127.0.0.1:4741${p}`

async function open(scheme: 'dark' | 'light', width = 1440, height = 900) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 600,
    isMobile: width < 600,
  })
  await ctx.addInitScript(
    `try { if (!localStorage.getItem('studio.appearance')) localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable', look: 'original', glass: 'soft', depth: 'soft' })) } catch {}`,
  )
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, errors }
}
const slugs = async (page: Page): Promise<string[]> => {
  await page.goto(u('/basecamp'), { waitUntil: 'domcontentloaded' }).catch(() => null)
  await page.waitForTimeout(900)
  return (await page.evaluate(
    `[...document.querySelectorAll('[data-bc-go^="/p/"]')].map((e) => e.dataset.bcGo.split('/')[2])`,
  )) as string[]
}
const stored = (page: Page, slug: string): Promise<any> =>
  page.evaluate(
    `JSON.parse(localStorage.getItem('bc.stage.${slug}') || 'null')?.bg ?? null`,
  ) as Promise<any>

for (const scheme of ['dark', 'light'] as const) {
  const { ctx, page, errors } = await open(scheme)
  const all = [...new Set(await slugs(page))]
  const [a, b] = all
  check(
    `${scheme}: the prototype office has two projects to tell apart`,
    a !== undefined && b !== undefined,
    all.join(','),
  )
  if (a === undefined || b === undefined) {
    await ctx.close()
    continue
  }

  await page.goto(u(`/p/${a}/settings`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-setpane="appearance"]', { timeout: 8000 })
  check(`${scheme}: Project settings has an Appearance pane`, true)
  await page.locator('[data-setpane="appearance"]').click({ force: true })
  await page.waitForSelector('[data-ap]')
  const vals = (await page.evaluate(
    `(() => ({ mod: document.querySelector('[data-ap-range=mod]').value, dots: document.querySelector('[data-ap-range=dots]').value, tex: document.querySelector('[data-ap-range=tex]').value, mode: document.querySelector('[data-ap-mode][aria-checked=true]')?.dataset.apMode }))()`,
  )) as any
  check(
    `${scheme}: defaults are module 80%, dots 60%, texture 40%, whole card coloured`,
    vals.mod === '80' && vals.dots === '60' && vals.tex === '40' && vals.mode === 'card',
    JSON.stringify(vals),
  )
  check(`${scheme}: nothing is stored until a setting is changed`, (await stored(page, a)) === null)
  await page.screenshot({ path: `${OUT}/pane-default-${scheme}.png` })

  // A slider previews while it moves, before anything is saved.
  await page.locator('[data-ap-range="mod"]').evaluate((el: any) => {
    el.value = '45'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const live = (await page.evaluate(
    `getComputedStyle(document.querySelector('[data-ap-sample]')).getPropertyValue('--bc-mod-op').trim()`,
  )) as string
  check(`${scheme}: the sample previews at once (module opacity 0.45)`, live === '0.45', live)
  check(`${scheme}: …and nothing is saved yet`, (await stored(page, a)) === null)
  await page
    .locator('[data-ap-range="mod"]')
    .evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })))
  let rec = await stored(page, a)
  check(
    `${scheme}: releasing the slider saves it on this project`,
    rec?.mod === 0.45 && rec?.id === 'default',
    JSON.stringify(rec),
  )

  await page.locator('[data-ap-range="dots"]').fill('100')
  await page.locator('[data-ap-range="tex"]').fill('100')
  await page.locator('[data-ap-mode="edge"]').click({ force: true })
  rec = await stored(page, a)
  check(
    `${scheme}: dots, texture and colour mode are saved too`,
    rec?.dots === 1 && rec?.tex === 1 && rec?.modMode === 'edge' && rec?.mod === 0.45,
    JSON.stringify(rec),
  )
  const rootTex = (await page.evaluate(
    `document.getElementById('root').style.getPropertyValue('--bc-tex-op')`,
  )) as string
  check(`${scheme}: the page texture follows the slider at once`, rootTex === '1', rootTex)
  await page.screenshot({ path: `${OUT}/pane-changed-${scheme}.png` })

  // The real board wears it.
  await page.goto(u(`/p/${a}`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(700)
  const board = (await page.evaluate(
    `(() => { const bd = document.querySelector('[data-bc-board]'); const m = document.querySelector('.bcstage .bcmod--tinted, .bcmod--tinted'); return { mode: bd.getAttribute('data-modmode'), dotop: getComputedStyle(bd).getPropertyValue('--bc-dot-op').trim(), op: m ? getComputedStyle(m, '::before').opacity : null, tex: document.getElementById('root').style.getPropertyValue('--bc-tex-op'), wash: m ? getComputedStyle(m, '::before').backgroundImage.includes('rgba') || getComputedStyle(m, '::before').backgroundImage.length : 0 } })()`,
  )) as any
  check(
    `${scheme}: after a reload the board is in "title and border" mode with module opacity 45%`,
    board.mode === 'edge' && board.op === '0.45',
    JSON.stringify(board),
  )
  check(
    `${scheme}: the grid opacity (100% = 1.67x the original) and texture reach the page`,
    board.dotop === '1.67' && board.tex === '1',
    JSON.stringify(board),
  )
  await page.screenshot({ path: `${OUT}/board-edge-${scheme}.png` })

  // Switching back to whole-card colouring changes what the module draws (the colour wash returns).
  const washOf = async (mode: string): Promise<string> => {
    await page.evaluate(
      `document.querySelector('[data-bc-board]').setAttribute('data-modmode', '${mode}')`,
    )
    return (await page.evaluate(
      `getComputedStyle(document.querySelector('.bcmod--tinted'), '::before').backgroundImage`,
    )) as string
  }
  const edgeImg = await washOf('edge')
  const cardImg = await washOf('card')
  check(
    `${scheme}: the two modes draw different faces (the wash is only in "entire card")`,
    edgeImg !== cardImg &&
      cardImg.split('linear-gradient').length > edgeImg.split('linear-gradient').length,
  )
  await page.evaluate(
    `document.querySelector('[data-bc-board]').setAttribute('data-modmode', 'edge')`,
  )

  // Per project: the other project keeps the defaults.
  await page.goto(u(`/p/${b}`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  const other = (await page.evaluate(
    `(() => { const bd = document.querySelector('[data-bc-board]'); const m = document.querySelector('.bcmod--tinted'); return { mode: bd.getAttribute('data-modmode'), op: m ? getComputedStyle(m, '::before').opacity : null } })()`,
  )) as any
  check(
    `${scheme}: another project is untouched (card mode, 80%)`,
    other.mode === null && other.op === '0.8',
    JSON.stringify(other),
  )
  check(`${scheme}: nothing was stored for the other project`, (await stored(page, b)) === null)

  // Reset.
  await page.goto(u(`/p/${a}/settings`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-setpane="appearance"]')
  await page.locator('[data-setpane="appearance"]').click({ force: true })
  await page.locator('[data-ap-reset]').click({ force: true })
  rec = await stored(page, a)
  check(
    `${scheme}: reset returns every setting to its default`,
    rec?.dots === 0.6 && rec?.tex === 0.4 && rec?.mod === 0.8 && rec?.modMode === 'card',
    JSON.stringify(rec),
  )

  check(`${scheme}: no page errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// A phone: the pane's controls are 44px and the page does not overflow.
{
  const { ctx, page, errors } = await open('dark', 390, 844)
  const [a] = await slugs(page)
  await page.goto(u(`/p/${a}/settings`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-setpane="appearance"]')
  await page.locator('[data-setpane="appearance"]').click({ force: true })
  await page.waitForSelector('[data-ap]')
  const m = (await page.evaluate(
    `(() => { const small = [...document.querySelectorAll('[data-ap] button, [data-ap] input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5) }).map((e) => e.tagName + ':' + (e.textContent || e.dataset.apRange || '').slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().height)); return { small, sw: document.documentElement.scrollWidth } })()`,
  )) as any
  check('phone: the appearance controls are 44px tall', m.small.length === 0, m.small.join(', '))
  check('phone: no horizontal overflow', m.sw <= 391, String(m.sw))
  await page.screenshot({ path: `${OUT}/pane-phone.png` })
  check('phone: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
server.close()
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
