// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a capture list, one component per line reads better than the formatter's wrapping
/**
 * The component gallery (aesthetic sprint, 9 October 2026): the real components, side by side, in every appearance.
 *
 *   npx tsx scripts/verify/gallery.ts
 *   SCHEMES=dark,light LOOKS=original,silver ACCENTS=slate,clay GLASS=soft npx tsx scripts/verify/gallery.ts
 *   OUT=.out/gallery
 *
 * It does not keep a second copy of any markup. For each appearance it opens the real page, harvests the live elements of
 * each kind (top bar, project menu, modules, chat, Settings controls, command bar, schedule editor), lays them out in one grid
 * on the same page, so the real stylesheet chain and the real design tokens apply, and captures and audits the grid. A component
 * that is redesigned appears here redesigned, with nothing to keep in step.
 *
 * Before any appearance is judged, the audit is shown a fixture that is wrong in every way it claims to detect (control): if it
 * misses one, the run fails, because a detector that cannot fail says nothing (CLAUDE.md, "a control that cannot fail").
 * Writes OUT/gallery-<context>.png, OUT/gallery.json and OUT/gallery.md.
 */
import '../../src/safety/arm.ts'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { auditScript } from './lib/surface-audit.ts'
import { serveStudio } from './serve-studio.ts'

const PORT = 4714
const OUT = process.env.OUT ?? '.out/gallery'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const pick = (v: string | undefined, d: string): string[] => (v ?? d).split(',').filter((s) => s !== '')
const schemes = pick(process.env.SCHEMES, 'dark,light')
const looks = pick(process.env.LOOKS, 'original,silver,forest,graphite')
const accents = pick(process.env.ACCENTS, 'slate')
const glass = process.env.GLASS ?? 'soft'
const WIDTH = Number(process.env.WIDTH ?? 1440)

type Row = { context: string; components: number; missing: string[]; findings: string[]; shot: string }
const rows: Row[] = []
let failed = false

/* ---------------------------------------------------------------- the control --- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${String(PORT)}/basecamp`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  await page.evaluate(`(() => {
    const g = document.createElement('div'); g.id = 'control'
    g.innerHTML = '<p style="font-size:9px">tiny type</p><button style="width:18px;height:18px">x</button><div style="width:60px;white-space:nowrap;overflow:hidden">this text is far wider than its box and is clipped</div><span style="display:block;padding:6px;background:#c800c8;color:#fff">a foreign hue</span><div style="position:absolute;left:800px;width:50px;height:20px">off the edge</div>'
    document.body.appendChild(g)
  })()`)
  const seen = ((await page.evaluate(auditScript('#control'))) as { out: string[] }).out.join(' | ')
  const wanted: [string, RegExp][] = [
    ['type under 12px', /type under 12px/],
    ['a small touch target', /touch target/],
    ['clipped text', /text clipped/],
    ['a foreign hue', /foreign hue/],
    ['spilling off the edge', /spills off the right edge/],
  ]
  for (const [what, re] of wanted) {
    if (!re.test(seen)) {
      failed = true
      console.log(`CONTROL FAILED: the audit did not see ${what}. It saw: ${seen}`)
    }
  }
  console.log(failed ? 'control: the audit is BLIND to something above' : `control: the audit sees all ${String(wanted.length)} planted defects`)
  await ctx.close()
}

/* ---------------------------------------------------------------- harvesting --- */
const harvest = async (page: Page): Promise<{ name: string; html: string }[]> => {
  const out: { name: string; html: string }[] = []
  const grab = async (name: string, sel: string): Promise<void> => {
    const html = (await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.outerHTML : '' })()`)) as string
    if (html !== '') out.push({ name, html })
  }
  const press = async (sel: string): Promise<boolean> => {
    const l = page.locator(sel).first()
    if ((await l.count()) === 0) return false
    await l.click({ force: true, timeout: 4000 }).catch(() => null)
    await page.waitForTimeout(450)
    return true
  }
  await grab('Top bar', '.bctop')
  const bar = (await page.evaluate(`(() => { const t = document.querySelector('[data-bc-tidy]'); return t && t.parentElement ? t.parentElement.outerHTML : '' })()`)) as string
  if (bar !== '') out.push({ name: 'Canvas toolbar', html: bar })
  const mods = (await page.evaluate(`[...document.querySelectorAll('.bcstage [data-mod]')].map((e) => [e.dataset.mod, e.outerHTML])`)) as [string, string][]
  for (const [id, html] of mods) out.push({ name: `Module: ${id}`, html })
  const note = (await page.evaluate(`(() => { const e = document.querySelector('.bcpostit'); return e ? e.outerHTML : '' })()`)) as string
  if (note !== '') out.push({ name: 'Note', html: note })
  if (await press('[data-bc-menu]')) { await grab('Project menu', '.bcmenupanel:not([hidden])'); await page.keyboard.press('Escape'); await page.waitForTimeout(250) }
  await page.keyboard.press('Control+k'); await page.waitForTimeout(450)
  await grab('Command bar', '#bcjump')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  if (await press('.bcstage [data-cal-new]')) { await grab('Event editor', '.bccal2form'); await page.keyboard.press('Escape'); await page.waitForTimeout(250) }
  if ((await press('[data-bc-pagemenu]')) && (await press('[data-bc-look]'))) { await grab('Background picker', '#viewer .stone, #viewer > *'); await page.keyboard.press('Escape'); await page.waitForTimeout(250) }
  if (await press('[data-bc-dock]')) { await grab('Chat', '#dock'); await page.keyboard.press('Escape'); await page.waitForTimeout(250) }
  if (await press('[data-bc-settings]')) {
    await page.waitForSelector('#settings .stg', { timeout: 5000 }).catch(() => null)
    for (const tab of ['appearance', 'behaviour', 'connections']) {
      if (await press(`#settings [data-setting="${tab}"]`)) await grab(`Settings: ${tab}`, '#settings .stg-col')
    }
  }
  return out
}

const COMPONENTS_EXPECTED = ['Top bar', 'Canvas toolbar', 'Project menu', 'Command bar', 'Chat', 'Settings: appearance', 'Settings: behaviour']

/* ---------------------------------------------------------------- the gallery --- */
for (const scheme of schemes) for (const look of looks) for (const accent of accents) {
  if (look !== 'original' && accent !== accents[0]) continue
  const context = `${scheme}-${look}-${accent}`
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 } })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: '${accent}', texture: 'concrete', scheme: '${scheme}', density: 'comfortable', look: '${look}', glass: '${glass}', depth: 'soft' })) } catch {}`)
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(PORT)}/basecamp`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const slug = ((await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]')?.dataset.bcGo ?? ''`)) as string) || '/p/riverside'
  await page.goto(`http://127.0.0.1:${String(PORT)}${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]', { timeout: 8000 })
  await page.waitForTimeout(700)
  const parts = await harvest(page)
  /* Lay them out on the same page: a grid of labelled cells holding inert clones. */
  await page.evaluate(`((parts) => {
    for (const id of ['root', 'dock', 'settings', 'viewer', 'undobar', 'droplayer']) { const e = document.getElementById(id); if (e) e.hidden = true; if (e && id === 'root') e.style.display = 'none' }
    for (const e of document.querySelectorAll('.bcmenupanel-ghost, #bcjump')) e.hidden = true
    const realSettings = document.getElementById('settings'); if (realSettings) realSettings.id = 'settings-real'
    const g = document.createElement('div'); g.id = 'gallery'
    g.style.cssText = 'width:' + innerWidth + 'px;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px;padding:20px;align-items:start;background:var(--bc-canvas);min-height:100vh'
    const st = document.createElement('style')
    st.textContent = '#gallery .gcell{display:grid;gap:8px;min-width:0}#gallery .gcell>h2{margin:0;font:600 12px/1.2 var(--bc-font);letter-spacing:.06em;text-transform:uppercase;color:var(--bc-text-muted)}#gallery .gbox{position:relative;min-height:60px;max-height:560px;overflow:hidden;border-radius:12px;pointer-events:none}#gallery .gbox>*{position:relative!important;inset:auto!important;left:auto!important;top:auto!important;width:100%!important;max-width:100%!important;transform:none!important;margin:0!important;display:block}#gallery .gbox>.bctop{position:relative!important;height:auto}#gallery .gcell.wide{grid-column:span 2}'
    document.head.appendChild(st)
    for (const p of parts) {
      const c = document.createElement('div'); c.className = 'gcell' + (/Settings|Top bar|toolbar|Chat/.test(p.name) ? ' wide' : '')
      const h = document.createElement('h2'); h.textContent = p.name
      const b = document.createElement('div'); b.className = 'gbox'
      const t = document.createElement('template'); t.innerHTML = p.html.trim()
      for (const e of t.content.querySelectorAll('[hidden]:not(input)')) e.removeAttribute('hidden')
      b.appendChild(t.content)
      if (/^Settings/.test(p.name)) { const w = document.createElement('div'); w.id = 'settings'; w.style.cssText = 'position:static;display:block;background:transparent;padding:0;inset:auto'; w.className = 'stg-host'; const col = b; w.append(...col.childNodes); b.appendChild(w) }
      c.append(h, b); g.appendChild(c)
    }
    document.body.appendChild(g)
    document.body.style.overflow = 'auto'
  })(${JSON.stringify(parts)})`)
  await page.waitForTimeout(400)
  const a = (await page.evaluate(auditScript('#gallery'))) as { out: string[] }
  const shot = `${OUT}/gallery-${context}.png`
  await page.locator('#gallery').screenshot({ path: shot })
  const have = new Set(parts.map((p) => p.name))
  const missing = COMPONENTS_EXPECTED.filter((n) => !have.has(n))
  const findings = [...a.out.filter((f) => !/page scrolls sideways/.test(f)), ...errors.splice(0).map((e) => `page error: ${e}`), ...missing.map((m) => `component not found: ${m}`)]
  rows.push({ context, components: parts.length, missing, findings, shot })
  console.log(`${findings.length === 0 ? 'ok  ' : 'DEF '} ${context}: ${String(parts.length)} components${findings.length ? ` - ${findings[0]}` : ''}`)
  await ctx.close()
}
await browser.close()
server.close()

await writeFile(`${OUT}/gallery.json`, JSON.stringify(rows, null, 1))
await writeFile(
  `${OUT}/gallery.md`,
  [`# Component gallery`, ``, `${String(rows.length)} appearances; components harvested from the live page, never copied.`, ``, `| appearance | components | findings |`, `|---|---|---|`, ...rows.map((r) => `| ${r.context} | ${String(r.components)} | ${r.findings.length === 0 ? 'none' : r.findings.slice(0, 2).join('; ').replace(/\|/g, '/')} |`)].join('\n'),
)
const bad = rows.filter((r) => r.findings.length > 0).length
console.log(`gallery: ${String(rows.length - bad)} clean, ${String(bad)} with findings, of ${String(rows.length)}`)
process.exit(failed ? 1 : 0)
